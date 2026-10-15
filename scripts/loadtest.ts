/**
 * scripts/loadtest.ts — Medición real de capacidad (no estimaciones).
 *
 *   npm run loadtest                 # medición estándar
 *   npm run loadtest -- --requests=400 --concurrency=40
 *
 * Mide tres cosas sobre la app que está corriendo:
 *   1. Latencia HTTP de las pantallas y APIs clave bajo concurrencia.
 *   2. Latencia de las consultas a PostgreSQL más habituales.
 *   3. Caudal de la cola (BullMQ + Redis): cuántos trabajos por segundo traga
 *      con la concurrencia configurada en el worker de sincronización.
 *
 * Escribe el resultado en `logs/loadtest-<fecha>.json` para poder comparar
 * entre versiones. No modifica datos de clientes: la cola usa una cola aparte
 * (loadtest) que se destruye al terminar.
 */
import '../workers/env';
import fs from 'node:fs';
import path from 'node:path';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { prisma } from '../src/lib/prisma';
import { withSystem } from '../src/lib/tenant-context';

const BASE = process.env.APP_URL ?? 'http://localhost:3000';

const arg = (name: string, fallback: number) => {
  const found = process.argv.find((a) => a.startsWith(`--${name}=`));
  return found ? Number(found.split('=')[1]) : fallback;
};

const REQUESTS = arg('requests', 200);
const CONCURRENCY = arg('concurrency', 20);
const JOBS = arg('jobs', 60);

const pct = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
const ms = (n: number) => `${n.toFixed(0)} ms`;

interface HttpResult {
  label: string;
  path: string;
  requests: number;
  ok: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  rps: number;
}

async function benchHttp(label: string, path: string, total = REQUESTS, concurrency = CONCURRENCY): Promise<HttpResult> {
  const latencies: number[] = [];
  let ok = 0;
  let issued = 0;
  const started = Date.now();

  const worker = async () => {
    while (issued < total) {
      issued++;
      const t0 = performance.now();
      try {
        const res = await fetch(`${BASE}${path}`, { cache: 'no-store' });
        if (res.ok) ok++;
        await res.arrayBuffer(); // consume el cuerpo: mide la respuesta completa
      } catch {
        /* cuenta como fallo de latencia (se verá en max) */
      }
      latencies.push(performance.now() - t0);
    }
  };

  await Promise.all(Array.from({ length: concurrency }, worker));
  const elapsed = (Date.now() - started) / 1000;
  const sorted = [...latencies].sort((a, b) => a - b);

  return {
    label,
    path,
    requests: total,
    ok,
    p50: pct(sorted, 50),
    p95: pct(sorted, 95),
    p99: pct(sorted, 99),
    max: sorted[sorted.length - 1] ?? 0,
    rps: total / elapsed,
  };
}

async function benchDatabase() {
  const medidas: { label: string; runs: number; p50: number; p95: number }[] = [];
  const casos: { label: string; run: () => Promise<unknown> }[] = [
    {
      label: 'Listado de productos (12 con filtros y orden)',
      run: () =>
        withSystem('loadtest: productos', () =>
          prisma.product.findMany({ take: 12, orderBy: { createdAt: 'desc' }, include: { store: true, supplier: true } }),
        ),
    },
    {
      label: 'KPIs del panel (agregados de pedidos)',
      run: () =>
        withSystem('loadtest: kpis', () =>
          prisma.order.aggregate({ _sum: { total: true, profitAmount: true }, _count: true }),
        ),
    },
    {
      label: 'Cola de sync: últimos registros',
      run: () => withSystem('loadtest: sync logs', () => prisma.syncLog.findMany({ take: 20, orderBy: { createdAt: 'desc' } })),
    },
    {
      label: 'Comprobación de salud de la base',
      run: () => withSystem('loadtest: ping db', () => prisma.$queryRaw`select 1`),
    },
  ];

  for (const caso of casos) {
    const tiempos: number[] = [];
    for (let i = 0; i < 40; i++) {
      const t0 = performance.now();
      await caso.run();
      tiempos.push(performance.now() - t0);
    }
    const sorted = tiempos.sort((a, b) => a - b);
    medidas.push({ label: caso.label, runs: tiempos.length, p50: pct(sorted, 50), p95: pct(sorted, 95) });
  }
  return medidas;
}

async function benchQueue() {
  const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: null });
  const queue = new Queue('loadtest', { connection });
  await queue.obliterate({ force: true }).catch(() => undefined);

  const processed: number[] = [];
  const worker = new Worker(
    'loadtest',
    async () => {
      // Trabajo del mismo orden de coste que un job de sync que sale por SKIP:
      // una lectura a base de datos y una escritura pequeña.
      await withSystem('loadtest: job', () => prisma.auditLog.create({ data: { action: 'loadtest.job', metadata: { synthetic: true } } }));
      processed.push(1);
    },
    { connection, concurrency: 8 },
  );

  const t0 = Date.now();
  await Promise.all(Array.from({ length: JOBS }, (_, i) => queue.add('loadtest', { i }, { removeOnComplete: true, removeOnFail: true })));

  while (processed.length < JOBS && Date.now() - t0 < 120_000) {
    await new Promise((r) => setTimeout(r, 100));
  }
  const seconds = (Date.now() - t0) / 1000;
  const resultado = { jobs: JOBS, processed: processed.length, seconds, perSecond: processed.length / seconds, concurrency: 8 };

  await worker.close();
  await queue.obliterate({ force: true }).catch(() => undefined);
  await connection.quit();
  await withSystem('loadtest: limpieza', () => prisma.auditLog.deleteMany({ where: { action: 'loadtest.job' } }));
  return resultado;
}

async function main() {
  console.log('\n\u001b[1mMedición de capacidad · DropshipPilot\u001b[0m');
  console.log(`  peticiones por prueba: ${REQUESTS} · concurrencia: ${CONCURRENCY} · trabajos de cola: ${JOBS}\n`);

  const pings = await fetch(`${BASE}/api/health`, { cache: 'no-store' }).then((r) => r.ok).catch(() => false);
  if (!pings) {
    console.error(`\n✘ La app no responde en ${BASE}. Arráncala (npm start) antes de medir.\n`);
    process.exitCode = 1;
    return;
  }

  const http: HttpResult[] = [];
  for (const [label, ruta] of [
    ['Panel (portada con datos reales)', '/dashboard'],
    ['Listado de productos', '/products'],
    ['Catálogo', '/catalog'],
    ['Salud del sistema (API)', '/api/health'],
    ['Datos del cliente (API)', '/api/account/onboarding'],
  ] as const) {
    const r = await benchHttp(label, ruta);
    http.push(r);
    console.log(`  · ${label.padEnd(34)} p50 ${ms(r.p50).padStart(7)} · p95 ${ms(r.p95).padStart(7)} · ${r.rps.toFixed(0)} pet./s · ${r.ok}/${r.requests} correctas`);
  }

  console.log('\n  PostgreSQL (40 ejecuciones de cada consulta):');
  const db = await benchDatabase();
  for (const m of db) console.log(`  · ${m.label.padEnd(44)} p50 ${ms(m.p50).padStart(7)} · p95 ${ms(m.p95).padStart(7)}`);

  console.log('\n  Cola de trabajo (BullMQ + Redis, concurrencia 8):');
  const queue = await benchQueue();
  console.log(`  · ${queue.processed}/${queue.jobs} trabajos en ${queue.seconds.toFixed(1)} s → ${queue.perSecond.toFixed(1)} trabajos/s\n`);

  const salida = { medidoEn: new Date().toISOString(), config: { REQUESTS, CONCURRENCY, JOBS }, http, db, queue };
  const destino = path.join(process.cwd(), 'logs', `loadtest-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, JSON.stringify(salida, null, 2), 'utf8');
  console.log(`  Resultado guardado en ${path.relative(process.cwd(), destino)}\n`);
}

main()
  .catch((err) => {
    console.error('\n✘ Error midiendo:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
