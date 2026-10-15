/**
 * scripts/stripe-simulate-webhook.ts — Prueba el webhook de Stripe de verdad.
 *
 * Los eventos se firman EXACTAMENTE como los firma Stripe (HMAC-SHA256 sobre
 * «<timestamp>.<cuerpo>») y se envían al endpoint real de la aplicación, de modo
 * que se ejecuta la verificación con la librería oficial (`constructEvent`) y el
 * handler completo (cambio de plan, suscripción, créditos) sobre la base de datos.
 *
 *   npx tsx scripts/stripe-simulate-webhook.ts [--url=http://localhost:3000]
 *
 * Necesita STRIPE_WEBHOOK_SECRET en el entorno (el mismo que tenga la app).
 * Crea un usuario de prueba, dispara los eventos y lo borra al terminar.
 */
import '../workers/env';
import crypto from 'node:crypto';

import { prisma } from '../src/lib/prisma';
import { withSystem } from '../src/lib/tenant-context';
import { hashPassword } from '../src/lib/auth';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? 'true'];
  }),
);

const BASE = String(args.url ?? process.env.APP_URL ?? 'http://localhost:3000');
const SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? '';

let passed = 0;
let failed = 0;
const check = (ok: boolean, msg: string, extra = '') => {
  console.log(`${ok ? '✔' : '✘'} ${msg}${extra ? ` — ${extra}` : ''}`);
  ok ? passed++ : failed++;
};

/** Firma un cuerpo como lo hace Stripe (cabecera `Stripe-Signature`). */
function sign(payload: string, secret: string, timestamp = Math.floor(Date.now() / 1000)) {
  const hmac = crypto.createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
  return `t=${timestamp},v1=${hmac}`;
}

async function send(type: string, object: Record<string, unknown>, opts: { badSignature?: boolean; secret?: string } = {}) {
  const payload = JSON.stringify({
    id: `evt_test_${crypto.randomBytes(8).toString('hex')}`,
    object: 'event',
    api_version: '2025-01-01',
    created: Math.floor(Date.now() / 1000),
    type,
    data: { object },
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
  });

  const signature = opts.badSignature
    ? sign(payload, 'secreto-equivocado')
    : sign(payload, opts.secret ?? SECRET);

  const res = await fetch(`${BASE}/api/webhooks/stripe`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': signature },
    body: payload,
  });

  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* respuesta no JSON */
  }
  return { status: res.status, body: json ?? text };
}

async function main() {
  if (!SECRET) {
    console.error('✘ Falta STRIPE_WEBHOOK_SECRET en el entorno (o en .env.local).');
    process.exitCode = 1;
    return;
  }

  console.log(`Webhook de Stripe · destino ${BASE}/api/webhooks/stripe\n`);

  // ── Usuario de prueba en estado TRIAL ────────────────────────────────────
  const email = `stripe.${Date.now()}@test.local`;
  const user = await withSystem('prueba del webhook de Stripe', () =>
    prisma.user.create({
      data: {
        email,
        name: 'Cliente Stripe',
        passwordHash: hashPassword('PruebaSegura123'),
        emailVerifiedAt: new Date(),
        plan: 'TRIAL',
        subscription: { create: { plan: 'TRIAL', status: 'TRIALING', creditsLimit: 200, creditsUsed: 120 } },
      },
    }),
  );

  const state = () =>
    withSystem('prueba del webhook de Stripe', () =>
      prisma.user.findUnique({
        where: { id: user.id },
        select: { plan: true, subscription: { select: { status: true, plan: true, creditsUsed: true, stripeCustomerId: true, stripeSubscriptionId: true } } },
      }),
    );

  // ── 1. Firma falsa: debe rechazarse y no tocar nada ──────────────────────
  const forged = await send(
    'checkout.session.completed',
    { id: 'cs_test_forged', object: 'checkout.session', metadata: { userId: user.id, tier: 'ENTERPRISE' } },
    { badSignature: true },
  );
  const afterForged = await state();
  check(forged.status === 400, 'Un evento con firma falsa se rechaza con 400', `HTTP ${forged.status}`);
  check(afterForged?.plan === 'TRIAL', 'El evento falsificado NO cambia el plan del cliente', `plan sigue en ${afterForged?.plan}`);

  // ── 2. checkout.session.completed → alta de la suscripción ───────────────
  const completed = await send('checkout.session.completed', {
    id: 'cs_test_123',
    object: 'checkout.session',
    mode: 'subscription',
    customer: 'cus_test_webhook_1',
    subscription: 'sub_test_webhook_1',
    metadata: { userId: user.id, tier: 'PRO' },
  });
  const afterCompleted = await state();
  check(completed.status === 200, 'El evento de pago se acepta (200)', JSON.stringify(completed.body).slice(0, 120));
  check(afterCompleted?.plan === 'PRO', 'El plan del cliente pasa a PRO', `plan=${afterCompleted?.plan}`);
  check(afterCompleted?.subscription?.status === 'ACTIVE', 'La suscripción queda activa', `estado=${afterCompleted?.subscription?.status}`);
  check(afterCompleted?.subscription?.stripeSubscriptionId === 'sub_test_webhook_1', 'Se guarda el id de suscripción de Stripe');
  check(afterCompleted?.subscription?.creditsUsed === 0, 'Los créditos se reinician al contratar', `créditos usados=${afterCompleted?.subscription?.creditsUsed}`);

  // ── 3. invoice.paid → renovación mensual ─────────────────────────────────
  await withSystem('prueba del webhook de Stripe', () =>
    prisma.subscription.update({ where: { userId: user.id }, data: { creditsUsed: 180 } }),
  );
  const renewal = await send('invoice.paid', {
    id: 'in_test_1',
    object: 'invoice',
    customer: 'cus_test_webhook_1',
    amount_paid: 7900,
    status: 'paid',
  });
  const afterRenewal = await state();
  check(renewal.status === 200, 'El evento de renovación se acepta (200)');
  check(afterRenewal?.subscription?.creditsUsed === 0, 'La renovación reinicia los créditos del mes', `créditos usados=${afterRenewal?.subscription?.creditsUsed}`);

  // ── 4. customer.subscription.deleted → cancelación ───────────────────────
  const cancelled = await send('customer.subscription.deleted', {
    id: 'sub_test_webhook_1',
    object: 'subscription',
    status: 'canceled',
    customer: 'cus_test_webhook_1',
    metadata: { userId: user.id },
  });
  const afterCancelled = await state();
  check(cancelled.status === 200, 'El evento de cancelación se acepta (200)');
  check(afterCancelled?.plan === 'TRIAL', 'Al cancelar, el cliente vuelve al plan de prueba', `plan=${afterCancelled?.plan}`);
  check(afterCancelled?.subscription?.status === 'CANCELED', 'La suscripción queda marcada como cancelada', `estado=${afterCancelled?.subscription?.status}`);

  // ── 5. Evento desconocido: no rompe ──────────────────────────────────────
  const unknown = await send('customer.updated', { id: 'cus_test_webhook_1', object: 'customer' });
  check(unknown.status === 200, 'Un evento no soportado se ignora sin error', JSON.stringify(unknown.body).slice(0, 80));

  // ── 6. Sin cabecera de firma ─────────────────────────────────────────────
  const noHeader = await fetch(`${BASE}/api/webhooks/stripe`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'evt_x', type: 'checkout.session.completed', data: { object: {} } }),
  });
  check(noHeader.status === 400, 'Sin cabecera Stripe-Signature se rechaza con 400', `HTTP ${noHeader.status}`);

  // ── Limpieza ─────────────────────────────────────────────────────────────
  await withSystem('prueba del webhook de Stripe: limpieza', () => prisma.user.delete({ where: { id: user.id } }));
  check(true, 'Usuario de prueba eliminado (la base queda como estaba)');

  console.log('');
  console.log(passed + ' comprobaciones superadas · ' + failed + ' fallidas');
  if (failed > 0) process.exitCode = 1;
  else console.log('\u001b[42m\u001b[30m  WEBHOOK DE STRIPE VERIFICADO  \u001b[0m');
}

main()
  .catch((err) => {
    console.error('✘ Error inesperado:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
