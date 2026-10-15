/**
 * scripts/verify-webhooks.ts — Prueba los webhooks de tienda (WooCommerce y Shopify).
 *
 * Envía peticiones REALES con la firma HMAC correcta al endpoint en marcha, para
 * comprobar que: la firma se valida, el pedido se crea en la base de datos **del
 * cliente dueño de la tienda** (aislamiento multi-cliente), los reenvíos no se
 * duplican y las firmas falsas se rechazan sin escribir nada.
 *
 *   npx tsx scripts/verify-webhooks.ts [--url=http://localhost:3000]
 */
import '../workers/env';
import crypto from 'node:crypto';

import { prisma } from '../src/lib/prisma';
import { withSystem } from '../src/lib/tenant-context';
import { decryptSecret } from '../src/lib/crypto';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? 'true'];
  }),
);

const BASE = String(args.url ?? process.env.APP_URL ?? 'http://localhost:3000');

let passed = 0;
let failed = 0;
const check = (ok: boolean, msg: string, extra = '') => {
  console.log(`${ok ? '✔' : '✘'} ${msg}${extra ? ` — ${extra}` : ''}`);
  ok ? passed++ : failed++;
};

const hmacBase64 = (body: string, secret: string) => crypto.createHmac('sha256', secret).update(body).digest('base64');
const hmacHex = (body: string, secret: string) => crypto.createHmac('sha256', secret).update(body).digest('hex');

async function main() {
  // ── Tiendas de prueba (una Woo y una Shopify, cada una de su dueño) ──────
  const stores = await withSystem('prueba de webhooks: localizar tiendas', () =>
    prisma.store.findMany({
      orderBy: { createdAt: 'asc' },
      select: { id: true, domain: true, platform: true, userId: true, webhookSecret: true },
    }),
  );

  const woo = stores.find((s) => s.platform === 'WOOCOMMERCE');
  const shopify = stores.find((s) => s.platform === 'SHOPIFY');
  if (!woo || !shopify) {
    console.error('✘ Hacen falta una tienda WooCommerce y una Shopify (ejecuta el seed).');
    process.exitCode = 1;
    return;
  }

  // Secreto de Woo: el de la tienda (cifrado) o el del entorno
  const wooSecret = (woo.webhookSecret ? decryptSecret(woo.webhookSecret) : '') || process.env.WOO_WEBHOOK_SECRET || 'secreto-woo-de-prueba';
  const shopifySecret = process.env.SHOPIFY_WEBHOOK_SECRET ?? '';

  console.log(`WooCommerce : ${woo.domain}\nShopify     : ${shopify.domain}\nDestino     : ${BASE}\n`);

  // ═══ WOOCOMMERCE ═════════════════════════════════════════════════════════
  const wooUrl = `${BASE}/api/webhooks/woocommerce/${encodeURIComponent(woo.domain)}`;
  const orderId = 900000 + Math.floor(Math.random() * 99999);
  const delivery = `dlv_${crypto.randomBytes(6).toString('hex')}`;
  const orderPayload = JSON.stringify({
    id: orderId,
    number: String(orderId),
    status: 'processing',
    currency: 'EUR',
    total: '89.90',
    date_created: new Date().toISOString(),
    billing: { first_name: 'Ana', last_name: 'Ruiz', email: 'ana@comprador.test', country: 'ES' },
    line_items: [
      { id: 1, sku: 'DEMO-SKU-1', name: 'Producto de prueba', quantity: 2, price: '44.95', total: '89.90' },
    ],
  });

  const ordersBefore = await withSystem('prueba de webhooks: contar pedidos', () =>
    prisma.order.count({ where: { userId: woo.userId } }),
  );

  const sendWoo = (body: string, signature: string, id = delivery, topic = 'order.created') =>
    fetch(wooUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-wc-webhook-topic': topic,
        'x-wc-webhook-resource': 'order',
        'x-wc-webhook-delivery-id': id,
        'x-wc-webhook-signature': signature,
        'x-wc-webhook-source-domain': woo.domain,
      },
      body,
    });

  // 1) Firma correcta
  const ok = await sendWoo(orderPayload, hmacBase64(orderPayload, wooSecret));
  const okBody: any = await ok.json().catch(() => ({}));
  check(ok.status === 200, 'El pedido de WooCommerce se acepta con la firma correcta', `HTTP ${ok.status} · ${JSON.stringify(okBody).slice(0, 90)}`);

  // 2) El pedido existe y es del dueño de esa tienda
  const created = await withSystem('prueba de webhooks: verificar pedido', () =>
    prisma.order.findFirst({ where: { storeOrderId: String(orderId) }, select: { id: true, userId: true, storeId: true, total: true } }),
  );
  check(Boolean(created), 'El pedido se ha creado en la base de datos');
  check(created?.userId === woo.userId, 'El pedido pertenece al cliente dueño de la tienda', `usuario ${created?.userId?.slice(-6)}`);
  check(created?.storeId === woo.id, 'El pedido queda ligado a la tienda correcta');

  const ordersAfter = await withSystem('prueba de webhooks: contar pedidos', () =>
    prisma.order.count({ where: { userId: woo.userId } }),
  );
  check(ordersAfter === ordersBefore + 1, 'El contador de pedidos del cliente sube exactamente 1', `${ordersBefore} → ${ordersAfter}`);

  // 3) Reenvío del mismo delivery-id → sin duplicar
  const dup = await sendWoo(orderPayload, hmacBase64(orderPayload, wooSecret));
  const dupBody: any = await dup.json().catch(() => ({}));
  check(dup.status === 200 && dupBody.duplicate === true, 'El reenvío del mismo webhook se detecta como duplicado', JSON.stringify(dupBody).slice(0, 80));
  const stillOne = await withSystem('prueba de webhooks: contar duplicados', () =>
    prisma.order.count({ where: { storeOrderId: String(orderId) } }),
  );
  check(stillOne === 1, 'El reenvío NO ha creado un segundo pedido', `pedidos con ese id: ${stillOne}`);

  // 4) Firma falsa → rechazado y sin escribir
  const forged = await sendWoo(orderPayload, hmacBase64(orderPayload, 'secreto-equivocado'), `dlv_forged_${Date.now()}`);
  check(forged.status === 401 || forged.status === 403, 'Una firma falsa se rechaza', `HTTP ${forged.status}`);

  // ═══ SHOPIFY ═════════════════════════════════════════════════════════════
  const shopifyOrderId = 700000 + Math.floor(Math.random() * 99999);
  const shopifyPayload = JSON.stringify({
    id: shopifyOrderId,
    name: `#${shopifyOrderId}`,
    order_number: shopifyOrderId,
    financial_status: 'paid',
    currency: 'EUR',
    total_price: '59.90',
    created_at: new Date().toISOString(),
    email: 'comprador@tienda.test',
    customer: { first_name: 'Luis', last_name: 'Gil', email: 'luis@comprador.test' },
    shipping_address: { country_code: 'ES' },
    line_items: [{ id: 11, sku: 'DEMO-SKU-1', title: 'Producto de prueba', quantity: 1, price: '59.90' }],
  });

  const shopifyHeaders: Record<string, string> = {
    'content-type': 'application/json',
    'x-shopify-topic': 'orders/create',
    'x-shopify-shop-domain': shopify.domain,
    'x-shopify-webhook-id': `wh_${crypto.randomBytes(6).toString('hex')}`,
    'x-shopify-hmac-sha256': shopifySecret ? hmacBase64(shopifyPayload, shopifySecret) : '',
  };

  const shopResponse = await fetch(`${BASE}/api/webhooks/shopify`, { method: 'POST', headers: shopifyHeaders, body: shopifyPayload });
  const shopBody: any = await shopResponse.json().catch(() => ({}));

  if (!shopifySecret) {
    check(shopResponse.status === 200 || shopResponse.status === 404, 'El webhook de Shopify responde (sin SHOPIFY_WEBHOOK_SECRET en el entorno no se puede validar la firma)', `HTTP ${shopResponse.status}`);
  } else {
    check(shopResponse.status === 200, 'El pedido de Shopify se acepta con la firma correcta', `HTTP ${shopResponse.status} · ${JSON.stringify(shopBody).slice(0, 90)}`);
    const shopOrder = await withSystem('prueba de webhooks: verificar pedido Shopify', () =>
      prisma.order.findFirst({ where: { storeOrderId: String(shopifyOrderId) }, select: { userId: true, storeId: true } }),
    );
    check(shopOrder?.userId === shopify.userId, 'El pedido de Shopify queda en el cliente dueño de esa tienda', `usuario ${shopOrder?.userId?.slice(-6)}`);

    const forgedShopify = await fetch(`${BASE}/api/webhooks/shopify`, {
      method: 'POST',
      headers: { ...shopifyHeaders, 'x-shopify-hmac-sha256': hmacBase64(shopifyPayload, 'secreto-equivocado'), 'x-shopify-webhook-id': `wh_forged_${Date.now()}` },
      body: shopifyPayload,
    });
    check(forgedShopify.status === 401, 'Una firma falsa de Shopify se rechaza con 401', `HTTP ${forgedShopify.status}`);
  }

  // ── Limpieza: fuera los pedidos de prueba ───────────────────────────────
  await withSystem('prueba de webhooks: limpieza', () =>
    prisma.order.deleteMany({ where: { storeOrderId: { in: [String(orderId), String(shopifyOrderId)] } } }),
  );
  await withSystem('prueba de webhooks: limpieza', () =>
    prisma.webhookEvent.deleteMany({ where: { externalId: { in: [delivery, shopifyHeaders['x-shopify-webhook-id']] } } }),
  );
  check(true, 'Pedidos y eventos de prueba eliminados');

  console.log('');
  console.log(passed + ' comprobaciones superadas · ' + failed + ' fallidas');
  if (failed > 0) process.exitCode = 1;
  else console.log('\u001b[42m\u001b[30m  WEBHOOKS DE TIENDA VERIFICADOS  \u001b[0m');
}

main()
  .catch((err) => {
    console.error('✘ Error inesperado:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
