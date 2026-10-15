/**
 * scripts/verify-load.ts — Prueba de carga ligera contra la app en marcha.
 *
 * Lanza peticiones concurrentes mezclando páginas, API y endpoints públicos, y
 * mide latencias y errores. No es un test de estrés: es la comprobación de que
 * con varias docenas de peticiones simultáneas nada se rompe ni se degrada.
 *
 *   npx tsx scripts/verify-load.ts                  # 200 peticiones, 20 en paralelo
 *   npx tsx scripts/verify-load.ts --requests=600 --concurrency=50 --url=http://localhost:3000
 */
import '../workers/env';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? 'true'];
  }),
);

const BASE = String(args.url ?? process.env.LOAD_TEST_URL ?? 'http://localhost:3000');
const TOTAL = Number(args.requests ?? 200);
const CONCURRENCY = Number(args.concurrency ?? 20);

const ENDPOINTS = [
  { path: '/login', weight: 3, expect: [200] },
  { path: '/api/health', weight: 3, expect: [200, 503] },
  { path: '/dashboard', weight: 2, expect: [200, 307] },
  { path: '/products', weight: 2, expect: [200, 307] },
  { path: '/suppliers', weight: 1, expect: [200, 307] },
  { path: '/billing', weight: 1, expect: [200, 307] },
  { path: '/api/products', weight: 2, expect: [200, 401] },
  { path: '/api/supplier-accounts', weight: 1, expect: [200, 401] },
];

function pick() {
  const pool = ENDPOINTS.flatMap((e) => Array(e.weight).fill(e));
  return pool[Math.floor(Math.random() * pool.length)];
}

interface Result {
  path: string;
  status: number;
  ms: number;
  ok: boolean;
}

async function one(): Promise<Result> {
  const target = pick();
  const started = performance.now();
  try {
    const res = await fetch(`${BASE}${target.path}`, { redirect: 'manual', headers: { 'user-agent': 'DropshipPilot-LoadTest' } });
    const ms = performance.now() - started;
    // Consumimos el cuerpo para no dejar conexiones a medias
    await res.arrayBuffer().catch(() => undefined);
    return { path: target.path, status: res.status, ms, ok: target.expect.includes(res.status) };
  } catch (err) {
    return { path: target.path, status: 0, ms: performance.now() - started, ok: false };
  }
}

async function main() {
  console.log(`Prueba de carga · ${TOTAL} peticiones · ${CONCURRENCY} en paralelo · ${BASE}\n`);

  // Calentamiento (primer render de cada ruta en Next.js)
  await Promise.all(ENDPOINTS.map((e) => fetch(`${BASE}${e.path}`, { redirect: 'manual' }).catch(() => undefined)));

  const results: Result[] = [];
  const pending: Promise<void>[] = [];
  let launched = 0;

  const started = performance.now();
  while (launched < TOTAL) {
    const batch = Math.min(CONCURRENCY - pending.length, TOTAL - launched);
    for (let i = 0; i < batch; i += 1) {
      launched += 1;
      const p = one().then((r) => {
        results.push(r);
        pending.splice(pending.indexOf(p), 1);
      });
      pending.push(p);
    }
    await Promise.race(pending);
  }
  await Promise.all(pending);
  const elapsed = performance.now() - started;

  const okResults = results.filter((r) => r.ok);
  const failures = results.filter((r) => !r.ok);
  const errors = results.filter((r) => r.status === 0);
  const times = results.map((r) => r.ms).sort((a, b) => a - b);
  const pct = (p: number) => times[Math.min(times.length - 1, Math.floor((p / 100) * times.length))] ?? 0;

  // Resumen por ruta
  const byPath = new Map<string, Result[]>();
  for (const r of results) byPath.set(r.path, [...(byPath.get(r.path) ?? []), r]);

  console.log('RUTA'.padEnd(28) + 'PETICIONES'.padStart(11) + 'p50'.padStart(9) + 'p95'.padStart(9) + 'ESTADO'.padStart(10));
  for (const [path, list] of [...byPath.entries()].sort()) {
    const t = list.map((r) => r.ms).sort((a, b) => a - b);
    const p50 = t[Math.floor(t.length * 0.5)];
    const p95 = t[Math.min(t.length - 1, Math.floor(t.length * 0.95))];
    const allOk = list.every((r) => r.ok);
    console.log(
      path.padEnd(28) +
        String(list.length).padStart(11) +
        `${Math.round(p50)}ms`.padStart(9) +
        `${Math.round(p95)}ms`.padStart(9) +
        (allOk ? '✔' : `✘ ${list.filter((r) => !r.ok).length}`).padStart(10),
    );
  }

  console.log('');
  console.log(`Peticiones: ${results.length} · correctas: ${okResults.length} · fallidas: ${failures.length} (sin respuesta: ${errors.length})`);
  console.log(`Tiempo total: ${(elapsed / 1000).toFixed(1)} s · ${(results.length / (elapsed / 1000)).toFixed(0)} peticiones/s`);
  console.log(`Latencia p50 ${Math.round(pct(50))} ms · p95 ${Math.round(pct(95))} ms · p99 ${Math.round(pct(99))} ms · máx ${Math.round(times[times.length - 1] ?? 0)} ms`);

  const errorRate = failures.length / results.length;
  const ok = errorRate <= 0.01 && errors.length === 0;

  console.log('');
  if (ok) {
    console.log('\u001b[42m\u001b[30m  CARGA SOPORTADA SIN ERRORES  \u001b[0m');
  } else {
    console.log(`\u001b[41m\u001b[37m  TASA DE FALLOS ${(errorRate * 100).toFixed(1)}% — revisar  \u001b[0m`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('✘ Error en la prueba de carga:', err);
  process.exitCode = 1;
});
