/**
 * POST /api/webhooks/shopify — Recepción de webhooks de Shopify.
 *
 * Temas soportados:
 *   • orders/create, orders/paid          → crea Order + encola envío al proveedor
 *   • orders/updated                      → sincroniza estado
 *   • fulfillments/update                 → actualiza tracking y fulfillment
 *
 * Seguridad: verificación HMAC-SHA256 con SHOPIFY_WEBHOOK_SECRET (obligatoria
 * si la variable está definida) + deduplicación por X-Shopify-Webhook-Id.
 */
import { NextResponse } from 'next/server';
import { hasDatabase, prisma } from '@/lib/prisma';
import { verifyHmac } from '@/lib/crypto';
import { parseOrderWebhook } from '@/lib/shopify';
import { enqueueOrderJob } from '@/lib/queue';
import { round2 } from '@/lib/utils';
import { withSystem, withTenant } from '@/lib/tenant-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const rawBody = await req.text();
  const topic = req.headers.get('x-shopify-topic') ?? 'unknown';
  const shopDomain = req.headers.get('x-shopify-shop-domain') ?? '';
  const hmac = req.headers.get('x-shopify-hmac-sha256') ?? '';
  const webhookId = req.headers.get('x-shopify-webhook-id') ?? '';

  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (secret && !verifyHmac(rawBody, hmac, secret)) {
    // Aviso al dueño de la tienda: puede ser un ataque o un secreto mal copiado
    // (tras un cambio de secreto en Shopify los webhooks dejan de validar).
    if (shopDomain && hasDatabase()) {
      try {
        const { alertUser } = await import('@/lib/alerts');
        const store = await withSystem('webhook de Shopify: identificar tienda para avisar de firma inválida', () =>
          prisma.store.findFirst({ where: { domain: shopDomain }, select: { userId: true, name: true } }),
        );
        if (store) {
          await alertUser(store.userId, 'webhooks', {
            title: `Webhook rechazado en «${store.name}»`,
            body: `Se ha recibido un webhook de <strong>${shopDomain}</strong> (tema <code>${topic}</code>) con la firma HMAC incorrecta y se ha descartado.<br><br>Si acabas de cambiar el secreto del webhook en Shopify, actualiza <code>SHOPIFY_WEBHOOK_SECRET</code> en el servidor. Si no has cambiado nada, alguien está intentando enviar peticiones falsas a tu endpoint.`,
            link: '/monitor',
            cta: 'Revisar el monitor',
          });
        }
      } catch (err) {
        console.warn('[webhook/shopify] no se pudo avisar de la firma inválida:', (err as Error).message);
      }
    }
    return NextResponse.json({ ok: false, error: 'Firma HMAC inválida' }, { status: 401 });
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false, error: 'Payload no es JSON válido' }, { status: 400 });
  }

  console.log(`[webhook/shopify] ${topic} desde ${shopDomain} (id ${webhookId})`);

  if (!hasDatabase()) {
    return NextResponse.json({ ok: true, mode: 'demo', topic, message: 'Webhook recibido y validado (sin persistencia: DATABASE_URL no configurada)' });
  }

  // Deduplicación (Shopify puede reenviar el mismo webhook)
  // La tienda se localiza en modo sistema (el webhook no trae el cliente) y a
  // partir de aquí todo el trabajo ocurre en el contexto de su dueño.
  const store = await withSystem('webhook de Shopify: identificar la tienda por dominio', () =>
    prisma.store.findFirst({ where: { domain: shopDomain } }),
  );
  if (webhookId && store) {
    const exists = await prisma.webhookEvent.findFirst({ where: { storeId: store.id, externalId: webhookId } });
    if (exists) return NextResponse.json({ ok: true, duplicate: true });
  }

  const ownerUserId = store?.userId ?? null;
  if (!ownerUserId) {
    return NextResponse.json({ ok: false, error: `Ninguna tienda conectada corresponde a ${shopDomain}` }, { status: 404 });
  }

  return withTenant(ownerUserId, async () => {
  try {
    const event = await prisma.webhookEvent.create({
      data: { storeId: store?.id, topic, externalId: webhookId || null, signature: hmac, payload },
    });

    if (topic.startsWith('orders/')) {
      const parsed = parseOrderWebhook(payload);
      const userId = ownerUserId;

      // Resolución de los productos locales por SKU
      const itemsWithCost = [];
      for (const item of parsed.items) {
        const variant = item.sku ? await prisma.productVariant.findFirst({ where: { sku: item.sku }, include: { product: true } }) : null;
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

      const order = await prisma.order.upsert({
        where: { storeId_storeOrderId: { storeId: store!.id, storeOrderId: parsed.storeOrderId } },
        update: { status: 'PAID', total: parsed.total, supplierCost, profitAmount: round2(parsed.total - supplierCost) },
        create: {
          userId,
          storeId: store!.id,
          supplierId: itemsWithCost[0]?.productId ? (await prisma.product.findUnique({ where: { id: itemsWithCost[0].productId! } }))?.supplierId ?? null : null,
          storeOrderId: parsed.storeOrderId,
          storeOrderNumber: parsed.storeOrderNumber,
          externalOrderId: parsed.externalOrderId,
          status: payload.financial_status === 'paid' ? 'PAID' : 'PENDING',
          fulfillmentStatus: 'UNFULFILLED',
          customerName: parsed.customerName,
          customerEmail: parsed.customerEmail,
          customerPhone: parsed.customerPhone,
          shippingName: parsed.shippingAddress?.name,
          shippingAddress1: parsed.shippingAddress?.address1,
          shippingAddress2: parsed.shippingAddress?.address2,
          shippingCity: parsed.shippingAddress?.city,
          shippingProvince: parsed.shippingAddress?.province,
          shippingCountry: parsed.shippingAddress?.country,
          shippingZip: parsed.shippingAddress?.zip,
          currency: parsed.currency,
          subtotal: parsed.subtotal,
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

      // Automatización: si el pedido está pagado, se envía al proveedor
      const autoPush = (store?.settings as any)?.autoPushOrders !== false;
      let job = null;
      if (autoPush && ['paid', 'authorized'].includes(String(payload.financial_status ?? ''))) {
        job = await enqueueOrderJob({ orderId: order.id, userId, action: 'push' });
      }

      return NextResponse.json({ ok: true, orderId: order.id, items: itemsWithCost.length, autoPush, job });
    }

    if (topic.startsWith('fulfillments/')) {
      const orderId = String(payload.order_id ?? '');
      if (store && orderId) {
        const tracking = payload.tracking_numbers?.[0] ?? payload.tracking_number;
        await prisma.order.updateMany({
          where: { storeId: store.id, storeOrderId: orderId },
          data: {
            fulfillmentStatus: 'FULFILLED',
            status: 'SHIPPED',
            trackingNumber: Array.isArray(tracking) ? tracking[0] : tracking ?? undefined,
            trackingCompany: payload.tracking_company ?? undefined,
            trackingUrl: payload.tracking_urls?.[0] ?? payload.tracking_url,
            shippedAt: new Date(),
          },
        });
      }
      await prisma.webhookEvent.update({ where: { id: event.id }, data: { processed: true, processedAt: new Date() } });
      return NextResponse.json({ ok: true, topic });
    }

    // products/update → refleja cambios externos sin sobrescribir
    if (topic.startsWith('products/')) {
      await prisma.webhookEvent.update({ where: { id: event.id }, data: { processed: true, processedAt: new Date() } });
      return NextResponse.json({ ok: true, topic, ignored: true });
    }

    return NextResponse.json({ ok: true, topic, unhandled: true });
  } catch (err) {
    console.error('[webhook/shopify]', err);
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
  });
}

/** Shopify envía un GET de verificación al registrar el endpoint */
export async function GET() {
  return NextResponse.json({ ok: true, service: 'DropshipPilot Shopify webhooks', topics: ['orders/create', 'orders/paid', 'orders/updated', 'fulfillments/update', 'products/update'] });
}
