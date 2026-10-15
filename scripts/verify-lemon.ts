/**
 * scripts/verify-lemon.ts — Prueba el cobro con Lemon Squeezy de verdad.
 *
 * Firma los webhooks EXACTAMENTE como los firma Lemon Squeezy (HMAC-SHA256 en
 * hexadecimal del cuerpo, cabecera `X-Signature`) y los envía al endpoint real
 * de la aplicación, de modo que se ejecuta la verificación de firma y el
 * manejador completo (plan, suscripción, créditos, aviso de pago fallido).
 *
 *   npm run verify:lemon                     → contra http://localhost:3000
 *   npx tsx scripts/verify-lemon.ts --url=http://localhost:3002
 *
 * Necesita LEMON_WEBHOOK_SECRET en el entorno (el mismo que tenga la app).
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
const SECRET = process.env.LEMON_WEBHOOK_SECRET ?? '';

let passed = 0;
let failed = 0;
const check = (ok: boolean, msg: string, extra = '') => {
  console.log(`${ok ? '✔' : '✘'} ${msg}${extra ? ` — ${extra}` : ''}`);
  ok ? passed++ : failed++;
};

/** Firma un cuerpo como Lemon Squeezy: HMAC-SHA256 hex en `X-Signature`. */
function sign(payload: string, secret: string) {
  return crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
}

/** Lemon mantiene el mismo id de suscripción en todos sus eventos: lo imitamos. */
const SUB_ID = '9001234';

interface EventOptions {
  eventName: string;
  type?: 'subscriptions' | 'orders';
  attributes?: Record<string, unknown>;
  custom?: Record<string, unknown>;
  badSignature?: boolean;
  id?: string;
}

async function send(opts: EventOptions) {
  const id = opts.id ?? SUB_ID;
  const payload = JSON.stringify({
    meta: {
      test_mode: true,
      event_name: opts.eventName,
      webhook_id: `wh_test_${crypto.randomBytes(4).toString('hex')}`,
      custom_data: opts.custom ?? {},
    },
    data: {
      type: opts.type ?? 'subscriptions',
      id,
      attributes: {
        store_id: 1,
        customer_id: 4242,
        order_id: 9001,
        variant_id: Number(process.env.LEMON_VARIANT_PRO_MONTHLY ?? 0) || 111222,
        status: 'active',
        user_email: 'verificacion-lemon@test.local',
        renews_at: new Date(Date.now() + 30 * 86400_000).toISOString(),
        created_at: new Date().toISOString(),
        urls: { customer_portal: 'https://app.lemonsqueezy.com/my-orders' },
        ...(opts.attributes ?? {}),
      },
    },
  });

  const signature = opts.badSignature ? sign(payload, 'secreto-equivocado') : sign(payload, SECRET);

  const res = await fetch(`${BASE}/api/webhooks/lemon`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-signature': signature },
    body: payload,
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* respuesta no JSON */
  }
  return { status: res.status, json, text, id };
}

async function main() {
  console.log(`\n\u001b[1mLemon Squeezy — verificación de cobros\u001b[0m → ${BASE}\n`);

  if (!SECRET) {
    console.error('✘ Falta LEMON_WEBHOOK_SECRET en el entorno: no puedo firmar los eventos.\n');
    process.exitCode = 1;
    return;
  }

  // ── 0. Estado del endpoint ───────────────────────────────────────────────
  const info = await fetch(`${BASE}/api/webhooks/lemon`).then((r) => r.json()).catch(() => null);
  check(Boolean(info?.service), 'El endpoint de webhooks existe', info?.service ?? 'sin respuesta');
  check(info?.configured === true, 'El endpoint se declara configurado', `configured=${info?.configured}`);
  check(typeof info?.url === 'string' && info.url.includes('Webhooks'), 'Indica cómo registrarlo', 'ok');

  // ── 1. Usuario de prueba ─────────────────────────────────────────────────
  const email = `lemon.verificacion.${Date.now()}@test.local`;
  const passwordHash = await hashPassword('Verificacion123');
  const user = await withSystem('verify-lemon: crear usuario de prueba', () =>
    prisma.user.create({
      data: { email, name: 'Verificación Lemon', passwordHash, plan: 'TRIAL', emailVerifiedAt: new Date() },
      select: { id: true, plan: true },
    }),
  );
  check(user.plan === 'TRIAL', 'Usuario de prueba creado en plan TRIAL', email);

  // ── 2. Firma inválida ────────────────────────────────────────────────────
  const bad = await send({ eventName: 'subscription_created', custom: { user_id: user.id }, badSignature: true });
  check(bad.status === 401, 'Firma inválida rechazada con 401', `HTTP ${bad.status}`);

  const afterBad = await withSystem('verify-lemon: comprobar tras firma inválida', () => prisma.user.findUnique({ where: { id: user.id }, select: { plan: true } }));
  check(afterBad?.plan === 'TRIAL', 'Con firma inválida NO se cambia el plan', `plan=${afterBad?.plan}`);

  // ── 3. Suscripción creada ────────────────────────────────────────────────
  const created = await send({ eventName: 'subscription_created', custom: { user_id: user.id, tier: 'PRO', interval: 'monthly' } });
  check(created.status === 200 && created.json?.ok === true, 'subscription_created aceptado', `HTTP ${created.status}`);

  const sub1 = await withSystem('verify-lemon: leer suscripción', () =>
    prisma.subscription.findUnique({ where: { userId: user.id }, select: { plan: true, status: true, lemonSubscriptionId: true, lemonCustomerId: true, creditsLimit: true, creditsUsed: true } }),
  );
  const user1 = await withSystem('verify-lemon: leer plan', () => prisma.user.findUnique({ where: { id: user.id }, select: { plan: true } }));
  check(user1?.plan === 'PRO', 'El plan del cliente pasa a PRO', `plan=${user1?.plan}`);
  check(sub1?.status === 'ACTIVE', 'La suscripción queda ACTIVE', `status=${sub1?.status}`);
  check(Boolean(sub1?.lemonSubscriptionId), 'Se guarda el id de suscripción de Lemon', sub1?.lemonSubscriptionId ?? '—');
  check((sub1?.creditsLimit ?? 0) === 25000, 'Los créditos se ajustan al plan (25.000)', `${sub1?.creditsLimit}`);
  check((sub1?.creditsUsed ?? -1) === 0, 'El contador de créditos arranca de cero', `${sub1?.creditsUsed}`);

  // ── 4. Renovación ────────────────────────────────────────────────────────
  await withSystem('verify-lemon: gastar créditos', () => prisma.subscription.update({ where: { userId: user.id }, data: { creditsUsed: 120 } }));
  const renewed = await send({ eventName: 'subscription_payment_success', custom: { user_id: user.id, tier: 'PRO' }, attributes: { status: 'active' } });
  const sub2 = await withSystem('verify-lemon: leer tras renovación', () => prisma.subscription.findUnique({ where: { userId: user.id }, select: { creditsUsed: true, status: true } }));
  check(renewed.status === 200, 'subscription_payment_success aceptado', `HTTP ${renewed.status}`);
  check((sub2?.creditsUsed ?? -1) === 0, 'La renovación reinicia los créditos', `creditsUsed=${sub2?.creditsUsed}`);

  // ── 5. Pago fallido ──────────────────────────────────────────────────────
  const failedPay = await send({ eventName: 'subscription_payment_failed', custom: { user_id: user.id, tier: 'PRO' }, attributes: { status: 'past_due' } });
  const sub3 = await withSystem('verify-lemon: leer tras pago fallido', () => prisma.subscription.findUnique({ where: { userId: user.id }, select: { status: true } }));
  check(failedPay.status === 200, 'subscription_payment_failed aceptado', `HTTP ${failedPay.status}`);
  check(sub3?.status === 'PAST_DUE', 'El estado pasa a PAST_DUE', `status=${sub3?.status}`);

  // ── 6. Cobro encontrado por id de suscripción (sin metadata) ─────────────
  const subId = sub1?.lemonSubscriptionId ?? SUB_ID;
  check(sub1?.lemonSubscriptionId === SUB_ID, 'El id de suscripción es el que envía Lemon', `${sub1?.lemonSubscriptionId}`);
  const noMeta = await send({ eventName: 'subscription_updated', type: 'subscriptions', id: subId, attributes: { status: 'active' }, custom: {} });
  const located = noMeta.status === 200 && !JSON.stringify(noMeta.json ?? {}).includes('sin cliente identificable');
  check(located, 'Evento sin metadata: se localiza al cliente por id de suscripción', noMeta.json?.applied?.join(', ') ?? `HTTP ${noMeta.status}`);
  const sub3b = await withSystem('verify-lemon: leer tras evento sin metadata', () => prisma.subscription.findUnique({ where: { userId: user.id }, select: { status: true } }));
  check(sub3b?.status === 'ACTIVE', 'El estado se recupera con ese evento (vuelve a ACTIVE)', `status=${sub3b?.status}`);

  // ── 7. Cancelación ───────────────────────────────────────────────────────
  const cancelled = await send({ eventName: 'subscription_cancelled', id: subId, attributes: { status: 'cancelled' }, custom: { user_id: user.id } });
  const user4 = await withSystem('verify-lemon: leer plan tras cancelar', () => prisma.user.findUnique({ where: { id: user.id }, select: { plan: true } }));
  const sub4 = await withSystem('verify-lemon: leer suscripción tras cancelar', () => prisma.subscription.findUnique({ where: { userId: user.id }, select: { status: true } }));
  check(cancelled.status === 200, 'subscription_cancelled aceptado', `HTTP ${cancelled.status}`);
  check(user4?.plan === 'TRIAL', 'Al cancelar, el cliente vuelve a TRIAL', `plan=${user4?.plan}`);
  check(sub4?.status === 'CANCELED', 'La suscripción queda CANCELED', `status=${sub4?.status}`);

  // ── 8. Checkout ──────────────────────────────────────────────────────────
  const checkout = await fetch(`${BASE}/api/billing/checkout`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ plan: 'PRO', interval: 'monthly', provider: 'lemon' }),
  });
  const checkoutJson: any = await checkout.json().catch(() => null);
  const configured = Boolean(process.env.LEMON_API_KEY && process.env.LEMON_STORE_ID);
  if (configured) {
    check([200, 400].includes(checkout.status), 'Checkout de Lemon responde cuando está configurado', `HTTP ${checkout.status} ${checkoutJson?.error ?? ''}`);
  } else {
    check(checkout.status === 501, 'Sin claves, el checkout de Lemon avisa en vez de romper', `HTTP ${checkout.status}`);
  }

  // ── Limpieza ─────────────────────────────────────────────────────────────
  await withSystem('verify-lemon: borrar usuario de prueba', () => prisma.user.delete({ where: { id: user.id } }));
  check(true, 'Usuario de prueba eliminado', email);

  console.log(`\n${passed} comprobaciones superadas · ${failed} fallidas\n`);
  if (failed > 0) {
    console.log('\u001b[41m\u001b[37m  COBRO CON LEMON SQUEEZY CON FALLOS  \u001b[0m\n');
    process.exitCode = 1;
  } else {
    console.log('\u001b[42m\u001b[30m  COBRO CON LEMON SQUEEZY VERIFICADO  \u001b[0m\n');
  }
}

main()
  .catch((err) => {
    console.error('\n✘ Error en la verificación:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
