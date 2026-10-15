/**
 * Lógica compartida de recepción de webhooks de WooCommerce.
 *
 * WooCommerce firma cada entrega con HMAC-SHA256 (base64) sobre el cuerpo
 * crudo, en la cabecera `X-WC-Webhook-Signature`, usando el secreto del
 * webhook creado en WordPress. Ese secreto se captura al registrar los
 * webhooks (ver `listenOrderWebhook` en lib/woocommerce.ts) y se guarda
 * cifrado en `Store.webhookSecret`.
 *
 * Cabeceras relevantes:
 *   X-WC-Webhook-Topic        order.created | order.updated | order.deleted | product.*
 *   X-WC-Webhook-Resource     order | product | ...
 *   X-WC-Webhook-Delivery-ID  id único de entrega (deduplicación / reintentos)
 *   X-WC-Webhook-Signature    firma base64
 */
import { NextResponse } from 'next/server';
import { hasDatabase, prisma } from '@/lib/prisma';
import { decryptSecret, verifyHmac } from '@/lib/crypto';
import { parseOrderWebhook } from '@/lib/woocommerce';
import { enqueueOrderJob } from '@/lib/queue';
import { round2 } from '@/lib/utils';
import { rateLimit, clientIp, tooManyRequests } from '@/lib/rate-limit';
import { withSystem, withTenant } from '@/lib/tenant-context';

/** Estados de WooCommerce que consideramos "pagado" → se envía al proveedor */
const PAID_STATUSES = ['processing', 'completed'];

export async function handleWooWebhook(req: Request, storeDomain?: string) {
  // Los webhooks son legítimamente frecuentes: 300/min por IP y bloqueo de 60 s
  const limit = rateLimit(`woo-hook:${clientIp(req)}`, 300, 60_000, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfterSeconds, 'Demasiados webhooks desde esta IP');

  const rawBody = await req.text();
  const topic = req.headers.get('x-wc-webhook-topic') ?? 'unknown';
  const resource = req.headers.get('x-wc-webhook-resource') ?? topic.split('.')[0];
  const signature = req.headers.get('x-wc-webhook-signature') ?? '';
  const deliveryId = req.headers.get('x-wc-webhook-delivery-id') ?? '';
  const domain = storeDomain ? decodeURIComponent(storeDomain) : req.headers.get('x-wc-webhook-source-domain') ?? '';

  console.log(`[webhook/woocommerce] ${topic} (${resource}) · tienda ${domain || '—'} · entrega ${deliveryId || '—'}`);

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false, error: 'Payload no es JSON válido' }, { status: 400 });
  }

  if (!hasDatabase()) {
    return NextResponse.json({
      ok: true,
      mode: 'demo',
      topic,
      signatureReceived: Boolean(signature),
      message: 'Webhook recibido y parseado (sin persistencia: DATABASE_URL no configurada)',
    });
  }

  // ── Localización de la tienda ────────────────────────────────────────────
  // El webhook llega sin saber de qué cliente es: se resuelve en modo sistema
  // (motivo explícito) y a partir de ahí TODO el trabajo ocurre en el contexto
  // del dueño de la tienda, para que el aislamiento multi-cliente se mantenga.
  const store = await withSystem('webhook de WooCommerce: identificar la tienda por dominio', () =>
    domain
      ? prisma.store.findFirst({ where: { domain: { contains: domain } } })
      : prisma.store.findFirst({ where: { platform: 'WOOCOMMERCE' }, orderBy: { createdAt: 'asc' } }),
  );

  if (!store) {
    return NextResponse.json({ ok: false, error: `No hay ninguna tienda WooCommerce que corresponda a "${domain || 'sin dominio'}"` }, { status: 404 });
  }

  return withTenant(store.userId, () => handleWooStoreEvent(req, { rawBody, topic, resource, signature, deliveryId, domain, payload, store }), 'webhook-woo');
}

/** Cuerpo del webhook, ya dentro del contexto del cliente dueño de la tienda. */
async function handleWooStoreEvent(
  req: Request,
  ctx: { rawBody: string; topic: string; resource: string; signature: string; deliveryId: string; domain: string; payload: any; store: any },
) {
  const { rawBody, topic, resource, signature, deliveryId, payload, store } = ctx;

  // ── Verificación de firma ────────────────────────────────────────────────
  const secrets = [decryptSecret(store.webhookSecret), process.env.WOO_WEBHOOK_SECRET ?? ''].filter(Boolean) as string[];
  if (secrets.length) {
    const valid = secrets.some((secret) => verifyHmac(rawBody, signature, secret, 'base64'));
    if (!valid) {
      // Auditoría del intento: nunca debe tumbar la petición si la escritura falla
      // (p. ej. reenvío del mismo delivery-id → violación de unicidad).
      const auditId = `${deliveryId || 'sin-id'}#firma-invalida`;
      await prisma.webhookEvent
        .upsert({
          where: { storeId_externalId: { storeId: store.id, externalId: auditId } },
          update: { error: 'Firma HMAC inválida', signature },
          create: { storeId: store.id, topic, externalId: auditId, signature, processed: false, error: 'Firma HMAC inválida', payload },
        })
        .catch(() => undefined);

      // Aviso al dueño: puede ser un ataque o un secreto desincronizado
      try {
        const { alertUser } = await import('@/lib/alerts');
        await alertUser(store.userId, 'webhooks', {
          title: `Webhook rechazado en «${store.name}»`,
          body: `Se ha recibido un webhook de WooCommerce (tema <code>${topic}</code>) con la firma incorrecta y se ha descartado.<br><br>Si has vuelto a registrar los webhooks en WordPress, copia el nuevo secreto en el servidor (o regístralos de nuevo desde la página Tiendas). Si no has cambiado nada, alguien está enviando peticiones falsas a tu endpoint.`,
          link: '/monitor',
          cta: 'Revisar el monitor',
        });
      } catch (err) {
        console.warn('[woo-webhook] no se pudo avisar de la firma inválida:', (err as Error).message);
      }

      return NextResponse.json({ ok: false, error: 'Firma HMAC inválida' }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === 'production' && !process.env.WOO_ALLOW_UNSIGNED) {
    return NextResponse.json({ ok: false, error: 'La tienda no tiene secreto de webhook configurado (registra los webhooks desde Tiendas)' }, { status: 401 });
  }

  // ── Deduplicación (WooCommerce reintenta hasta 5 veces) ──────────────────
  if (deliveryId) {
    const dup = await prisma.webhookEvent.findFirst({ where: { storeId: store.id, externalId: deliveryId } });
    if (dup) return NextResponse.json({ ok: true, duplicate: true, topic });
  }

  try {
    const event = await prisma.webhookEvent.create({
      data: { storeId: store.id, topic, externalId: deliveryId || null, signature, payload },
    });

    // ─────────────────────────── Pedidos ───────────────────────────
    if (resource === 'order') {
      const parsed = parseOrderWebhook(payload);
      const userId = store.userId;

      const itemsWithCost = [];
      for (const item of parsed.items) {
        const variant = item.sku
          ? await prisma.productVariant.findFirst({ where: { sku: item.sku }, include: { product: true } })
          : null;
        itemsWithCost.push({
          storeLineItemId: item.storeLineItemId,
          productId: variant?.productId ?? null,
          variantId: variant?.id ?? null,
          title: item.title,
          sku: item.sku,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          unitCost: variant ? Number(variant.costPrice) : 0,
          totalPrice: item.totalPrice,
          imageUrl: item.imageUrl,
        });
      }

      const supplierCost = round2(itemsWithCost.reduce((a, i) => a + i.unitCost * i.quantity, 0));
      const wooStatus = String(payload.status ?? '');

      if (topic === 'order.deleted') {
        await prisma.order.updateMany({
          where: { storeId: store.id, storeOrderId: parsed.storeOrderId },
          data: { status: 'CANCELED' },
        });
        await prisma.webhookEvent.update({ where: { id: event.id }, data: { processed: true, processedAt: new Date() } });
        return NextResponse.json({ ok: true, topic, action: 'canceled', storeOrderId: parsed.storeOrderId });
      }

      const status = wooStatus === 'cancelled' ? 'CANCELED' : PAID_STATUSES.includes(wooStatus) ? 'PAID' : 'PENDING';
      const supplierId = itemsWithCost[0]?.productId
        ? ((await prisma.product.findUnique({ where: { id: itemsWithCost[0].productId! }, select: { supplierId: true } }))?.supplierId ?? null)
        : null;

      const existing = await prisma.order.findUnique({
        where: { storeId_storeOrderId: { storeId: store.id, storeOrderId: parsed.storeOrderId } },
        select: { id: true, status: true },
      });

      const order = existing
        ? await prisma.order.update({
            where: { id: existing.id },
            data: { status, supplierCost, profitAmount: round2(parsed.total - supplierCost), total: parsed.total },
          })
        : await prisma.order.create({
            data: {
              userId,
              storeId: store.id,
              supplierId,
              storeOrderId: parsed.storeOrderId,
              storeOrderNumber: parsed.storeOrderNumber,
              status,
              fulfillmentStatus: 'UNFULFILLED',
              customerName: parsed.customerName || null,
              customerEmail: parsed.customerEmail ?? null,
              customerPhone: parsed.customerPhone ?? null,
              shippingName: parsed.shippingAddress?.name || null,
              shippingAddress1: parsed.shippingAddress?.address1 ?? null,
              shippingAddress2: parsed.shippingAddress?.address2 ?? null,
              shippingCity: parsed.shippingAddress?.city ?? null,
              shippingProvince: parsed.shippingAddress?.province ?? null,
              shippingCountry: parsed.shippingAddress?.country ?? null,
              shippingZip: parsed.shippingAddress?.zip ?? null,
              currency: parsed.currency,
              subtotal: round2(parsed.subtotal),
              shippingTotal: parsed.shippingTotal,
              taxTotal: parsed.taxTotal,
              total: parsed.total,
              supplierCost,
              profitAmount: round2(parsed.total - supplierCost),
              orderedAt: parsed.orderedAt,
              items: { create: itemsWithCost },
            },
          });

      await prisma.webhookEvent.update({ where: { id: event.id }, data: { processed: true, processedAt: new Date() } });

      // Automatización: pedido nuevo y pagado → envío automático al proveedor
      const autoPush = (store.settings as any)?.autoPushOrders !== false;
      let job = null;
      if (!existing && autoPush && PAID_STATUSES.includes(wooStatus)) {
        job = await enqueueOrderJob({ orderId: order.id, userId, action: 'push' });
      }

      return NextResponse.json({
        ok: true,
        topic,
        action: existing ? 'updated' : 'created',
        orderId: order.id,
        storeOrderNumber: parsed.storeOrderNumber,
        items: itemsWithCost.length,
        itemsMatched: itemsWithCost.filter((i) => i.variantId).length,
        supplierCost,
        autoPush,
        job,
      });
    }

    // ─────────────────────────── Productos ───────────────────────────
    if (resource === 'product') {
      const sku = String(payload.sku ?? '');
      const externalId = String(payload.id ?? '');
      const variant = sku
        ? await prisma.productVariant.findFirst({ where: { sku } })
        : await prisma.productVariant.findFirst({ where: { storeVariantId: externalId } });

      if (variant) {
        // Registramos el cambio externo sin sobrescribir la fuente de verdad:
        // el proveedor manda; el worker decidirá en el próximo barrido.
        await prisma.syncLog.create({
          data: {
            userId: store.userId,
            storeId: store.id,
            variantId: variant.id,
            productId: variant.productId,
            type: 'STOCK_UPDATE',
            status: 'SKIPPED',
            message: `Cambio de stock detectado en la tienda (${topic}): ${payload.stock_quantity ?? '—'} uds. El próximo barrido del worker reconcilia contra el proveedor.`,
            changes: { field: 'storeQuantity', from: variant.stock, to: payload.stock_quantity ?? null, sku, externalId } as any,
          },
        });
      }

      await prisma.webhookEvent.update({ where: { id: event.id }, data: { processed: true, processedAt: new Date() } });
      return NextResponse.json({ ok: true, topic, matched: Boolean(variant), sku: sku || null });
    }

    await prisma.webhookEvent.update({ where: { id: event.id }, data: { processed: true, processedAt: new Date() } });
    return NextResponse.json({ ok: true, topic, ignored: true });
  } catch (err) {
    console.error('[webhook/woocommerce]', err);
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
