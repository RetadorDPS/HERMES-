/**
 * scripts/stripe-setup.ts — Prepara Stripe (modo test) en un comando.
 *
 * Hace por API lo que normalmente se hace a mano en el panel:
 *   1. Comprueba que la clave secreta funciona.
 *   2. Crea los 6 precios (3 planes × mensual/anual) con los importes de
 *      src/lib/plans.ts. Es idempotente: usa `lookup_key`, así que repetirlo no
 *      duplica nada.
 *   3. Escribe las variables STRIPE_* en .env.local (haciendo copia de seguridad).
 *   4. Opcionalmente crea una suscripción de prueba y devuelve la URL de pago.
 *
 *   npx tsx scripts/stripe-setup.ts --key=sk_test_…            # prepara todo
 *   npx tsx scripts/stripe-setup.ts --key=sk_test_… --checkout  # además, URL de pago
 *
 * SEGURIDAD: sólo acepta claves de TEST (sk_test_…). Con sk_live_… se niega a
 * seguir para no crear precios reales por accidente.
 */
import '../workers/env';
import fs from 'node:fs';
import path from 'node:path';

import { PLANS } from '../src/lib/plans';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? 'true'];
  }),
);

const API = 'https://api.stripe.com/v1';
let passed = 0;
let failed = 0;
const check = (ok: boolean, msg: string, extra = '') => {
  console.log(`${ok ? '✔' : '✘'} ${msg}${extra ? ` — ${extra}` : ''}`);
  ok ? passed++ : failed++;
};

const key = String(args.key ?? process.env.STRIPE_SECRET_KEY ?? '');
if (!key) {
  console.error('Falta la clave: npx tsx scripts/stripe-setup.ts --key=sk_test_…');
  process.exit(1);
}
if (!key.startsWith('sk_test_')) {
  console.error('✘ Esta herramienta sólo trabaja en modo TEST (sk_test_…). Con una clave real crearías cobros de verdad.');
  process.exit(1);
}

const headers = { authorization: `Bearer ${key}`, 'content-type': 'application/x-www-form-urlencoded' };

async function api(method: 'GET' | 'POST', endpoint: string, body?: Record<string, string>) {
  const res = await fetch(`${API}${endpoint}`, {
    method,
    headers,
    body: body ? new URLSearchParams(body).toString() : undefined,
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${endpoint}: ${json?.error?.message ?? res.status}`);
  return json;
}

/** Precio con `lookup_key`: si ya existe, se reutiliza (idempotente). */
async function ensurePrice(lookupKey: string, amount: number, interval: 'month' | 'year', productName: string) {
  const existing = await api('GET', `/prices?limit=1&lookup_keys[]=${encodeURIComponent(lookupKey)}&expand[]=data.product`);
  if (existing.data?.length) {
    return { id: existing.data[0].id, reused: true, product: existing.data[0].product?.name ?? productName };
  }

  const product = await api('POST', '/products', { name: productName, 'metadata[lookup_key]': lookupKey });
  const price = await api('POST', '/prices', {
    product: product.id,
    unit_amount: String(amount * 100), // Stripe trabaja en céntimos
    currency: 'eur',
    'recurring[interval]': interval,
    lookup_key: lookupKey,
  });
  return { id: price.id, reused: false, product: product.name };
}

async function main() {
  console.log('Preparando Stripe en modo test\n');

  // ── 1. La clave funciona ─────────────────────────────────────────────────
  const balance = await api('GET', '/balance');
  check(Boolean(balance.object === 'balance'), 'La clave secreta funciona', `modo ${balance.livemode ? 'REAL' : 'test'}`);

  // ── 2. Precios de los planes ─────────────────────────────────────────────
  const envLines: string[] = [];
  for (const plan of Object.values(PLANS)) {
    if (!plan.stripePriceEnv) continue;

    for (const interval of ['monthly', 'yearly'] as const) {
      const amount = interval === 'monthly' ? plan.priceMonthly : plan.priceYearly;
      const stripeInterval = interval === 'monthly' ? 'month' : 'year';
      const lookup = `dropshippilot_${plan.tier.toLowerCase()}_${interval}`;
      const envName = interval === 'monthly' ? plan.stripePriceEnv.monthly : plan.stripePriceEnv.yearly;

      const result = await ensurePrice(lookup, amount, stripeInterval, `DropshipPilot ${plan.name} (${interval === 'monthly' ? 'mensual' : 'anual'})`);
      envLines.push(`${envName}="${result.id}"`);
      check(Boolean(result.id), `Precio ${plan.name} ${interval === 'monthly' ? 'mensual' : 'anual'}`, `${result.id} · ${amount} € · ${result.reused ? 'ya existía' : 'creado ahora'}`);
    }
  }

  // ── 3. Escribir .env.local ───────────────────────────────────────────────
  const envPath = path.join(process.cwd(), '.env.local');
  const original = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  const backup = `${envPath}.bak-${Date.now()}`;
  if (original) fs.writeFileSync(backup, original);

  const marker = '# ── Stripe (test) ──';
  const block = [marker, `STRIPE_SECRET_KEY="${key}"`, ...envLines].join('\n');
  const cleaned = original
    .split('\n')
    .filter((line) => !line.startsWith('STRIPE_SECRET_KEY=') && !line.startsWith('STRIPE_PRICE_') && line.trim() !== marker)
    .join('\n');
  fs.writeFileSync(envPath, `${cleaned.trimEnd()}\n\n${block}\n`);

  check(true, 'Variables escritas en .env.local', original ? `copia de seguridad en ${path.basename(backup)}` : 'archivo creado');

  // ── 4. Suscripción de prueba (opcional) ──────────────────────────────────
  if (args.checkout) {
    const proPrice = envLines.find((l) => l.startsWith('STRIPE_PRICE_PRO_MONTHLY='))?.split('=')[1]?.replace(/"/g, '');
    const session = await api('POST', '/checkout/sessions', {
      mode: 'subscription',
      'line_items[0][price]': String(proPrice),
      'line_items[0][quantity]': '1',
      success_url: `${process.env.NEXTAUTH_URL ?? 'http://localhost:3000'}/billing?ok=1`,
      cancel_url: `${process.env.NEXTAUTH_URL ?? 'http://localhost:3000'}/billing?cancel=1`,
      'metadata[tier]': 'PRO',
    });
    check(Boolean(session.url), 'Suscripción de prueba creada en Stripe', `sesión ${session.id}`);
    console.log('');
    console.log('  Paga con la tarjeta de prueba: 4242 4242 4242 4242 · 12/34 · CVC 123');
    console.log(`  ${session.url}`);
  }

  console.log('');
  console.log('Faltan dos cosas que sólo se pueden hacer en el panel de Stripe:');
  console.log('  1. Copiar el «Signing secret» del webhook (whsec_…) → STRIPE_WEBHOOK_SECRET en .env.local');
  console.log('  2. Apuntar el webhook a  https://TU-DOMINIO/api/webhooks/stripe');
  console.log('     Eventos: checkout.session.completed, customer.subscription.created,');
  console.log('              customer.subscription.updated, customer.subscription.deleted, invoice.paid');
  console.log('');
  console.log('Después, reinicia la app y ejecuta:  npm run verify:stripe');

  console.log('');
  console.log(passed + ' comprobaciones superadas · ' + failed + ' fallidas');
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('✘ Error:', err.message);
  process.exitCode = 1;
});
