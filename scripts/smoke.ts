/**
 * scripts/smoke.ts — Prueba de humo por HTTP (se ejecuta en cada despliegue).
 *
 * Comprueba que la aplicación DESPLEGADA responde de verdad: salud de la base
 * de datos y de las colas, páginas públicas, endpoints de webhook y el centro
 * de conexión. No necesita claves ni base de datos local: sólo una URL.
 *
 *   npm run smoke                          → contra http://localhost:3000
 *   npm run smoke -- --url=https://midominio.com
 *
 * Sale con código 1 si algo falla, para que el despliegue se detenga.
 */
const args = process.argv.slice(2);
const urlArg = args.find((a) => a.startsWith('--url='))?.slice(6) ?? process.env.SMOKE_URL ?? 'http://localhost:3000';
const base = urlArg.replace(/\/$/, '');
const timeoutMs = Number(args.find((a) => a.startsWith('--timeout='))?.slice(10) ?? 15_000);

interface Check {
  name: string;
  status: 'ok' | 'fail' | 'warn';
  detail: string;
}

const results: Check[] = [];

async function check(name: string, path: string, validate: (body: any, res: Response) => { ok: boolean; detail: string }, opts: { method?: string; allowStatus?: number[] } = {}) {
  const url = `${base}${path}`;
  try {
    const res = await fetch(url, { method: opts.method ?? 'GET', signal: AbortSignal.timeout(timeoutMs), redirect: 'manual' });
    const text = await res.text();
    let body: any = null;
    try {
      body = JSON.parse(text);
    } catch {
      /* HTML */
    }
    const verdict = validate(body, res);
    results.push({ name, status: verdict.ok ? 'ok' : 'fail', detail: verdict.detail });
  } catch (err) {
    results.push({ name, status: 'fail', detail: `sin respuesta: ${(err as Error).message}` });
  }
}

async function main() {
  console.log(`\n\u001b[1mPrueba de humo\u001b[0m → ${base}\n`);

  await check('Salud de la aplicación', '/api/health', (body, res) => {
    const db = body?.checks?.postgres?.ok;
    const redis = body?.checks?.redis?.ok;
    if (!db) return { ok: false, detail: `base de datos no responde (${body?.checks?.postgres?.detail ?? 'sin detalle'})` };
    if (!redis) return { ok: false, detail: `Redis no responde (${body?.checks?.redis?.detail ?? 'sin detalle'})` };
    return { ok: true, detail: `HTTP ${res.status} · postgres y Redis OK` };
  });

  // /api/health devuelve 200 incluso en modo degradado: con la URL pública puede
  // requerir autenticación del proxy, así que aceptamos también 401/403 como
  // «respondiendo» y lo marcamos como aviso.
  const health = results[0];
  if (health.status === 'fail' && /401|403/.test(health.detail)) health.status = 'warn';

  await check('Página de acceso', '/login', (_b, res) => ({ ok: res.status === 200, detail: `HTTP ${res.status}` }));
  await check('Webhook de Stripe (registrado)', '/api/webhooks/stripe', (body) => ({ ok: body?.service !== undefined, detail: body?.configured ? 'configurado' : 'sin claves (el cobro está desactivado)' }));
  await check('Webhook de Lemon Squeezy (registrado)', '/api/webhooks/lemon', (body) => ({ ok: body?.service !== undefined, detail: body?.configured ? 'configurado' : 'sin secreto (opcional)' }));
  await check('Webhook de WooCommerce (registrado)', '/api/webhooks/woocommerce', (body) => ({ ok: Boolean(body), detail: body?.service ?? 'responde' }));
  await check('Instalación OAuth de Shopify', '/api/shopify/install?shop=test.myshopify.com', (_b, res) => {
    if (res.status === 501) return { ok: true, detail: 'sin configurar (se puede conectar con token manual)' };
    if (res.status === 307 || res.status === 302 || res.status === 200) return { ok: true, detail: `redirige/valida (HTTP ${res.status})` };
    return { ok: false, detail: `HTTP ${res.status}` };
  });

  // El centro de conexión exige sesión cuando AUTH_ENABLED=true: 401/403 son respuesta válida.
  await check('Centro de conexión', '/api/setup/status', (_b, res) => {
    if (res.status === 200) return { ok: true, detail: 'abierto (sin autenticación activada)' };
    if (res.status === 401 || res.status === 403) return { ok: true, detail: `protegido con sesión (HTTP ${res.status})` };
    return { ok: false, detail: `HTTP ${res.status}` };
  });

  const ok = results.filter((r) => r.status === 'ok').length;
  const warn = results.filter((r) => r.status === 'warn').length;
  const fail = results.filter((r) => r.status === 'fail').length;

  for (const r of results) {
    const icon = r.status === 'ok' ? '\u001b[32m✔\u001b[0m' : r.status === 'warn' ? '\u001b[33m▲\u001b[0m' : '\u001b[31m✘\u001b[0m';
    console.log(`${icon} ${r.name} — ${r.detail}`);
  }
  console.log(`\n${ok} correctas · ${warn} avisos · ${fail} fallos\n`);

  if (fail > 0) {
    console.log('\u001b[41m\u001b[37m  LA APLICACIÓN DESPLEGADA NO PASA LA PRUEBA DE HUMO  \u001b[0m\n');
    process.exitCode = 1;
  } else if (warn > 0) {
    console.log('\u001b[43m\u001b[30m  OPERATIVA CON AVISOS  \u001b[0m\n');
  } else {
    console.log('\u001b[42m\u001b[30m  DESPLIEGUE CORRECTO  \u001b[0m\n');
  }
}

main().catch((err) => {
  console.error('✘ Error en la prueba de humo:', err);
  process.exitCode = 1;
});
