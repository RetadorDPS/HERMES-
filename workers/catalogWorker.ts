/**
 * workers/catalogWorker.ts — Mantiene el catálogo de la plataforma lleno.
 *
 * Jobs:
 *   • `catalog:sync`  → descarga productos del proveedor con las claves de la
 *     plataforma y los guarda en nuestro índice (CJ y AliExpress).
 *   • `catalog:clean` → borra artículos reales que llevan mucho sin refrescarse
 *     (evita mostrar stock/precios viejos como si fueran de hoy).
 *
 * Programación:
 *   • Al arrancar: asegura el catálogo de muestra y lanza una descarga si hay
 *     claves configuradas.
 *   • Cada `CATALOG_SYNC_MINUTES` (por defecto 360 = 6 h) repite la descarga.
 *   • Si no hay claves, no falla: deja el catálogo de muestra y lo dice en el log.
 *
 * Ejecución:
 *   npm run worker            # sync + orders + catálogo
 *   npm run worker:catalog    # sólo el catálogo
 */
import './env';
import { Queue, Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { ensureSampleCatalog, syncCatalog } from '../src/lib/catalog';
import { platformCredentialSummary } from '../src/lib/catalog/platform-credentials';
import { prisma, log } from './lib';
import { hasDatabase } from '../src/lib/prisma';
import { reportEnv } from './env';

const CATALOG_QUEUE = 'catalog';
const SYNC_MINUTES = Number(process.env.CATALOG_SYNC_MINUTES ?? 360);
const PAGES = Number(process.env.CATALOG_SYNC_PAGES ?? 2);
const CATALOG_KEYWORD = process.env.CATALOG_SYNC_KEYWORD ?? '';

const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: null });

async function processJob(job: Job) {
  const started = Date.now();
  const data = job.data as { provider?: any; pages?: number; keyword?: string; categories?: boolean; reason?: string };

  const credentials = await platformCredentialSummary();
  const configured = credentials.filter((c) => c.configured && c.enabled);

  if (configured.length === 0) {
    log('ℹ️  Catálogo: sin claves de plataforma configuradas · el catálogo de muestra sigue activo (Admin → Claves de proveedor)');
    return { ok: true, skipped: true, reason: 'sin-claves' };
  }

  const result = await syncCatalog({
    provider: data.provider,
    pages: data.pages ?? PAGES,
    keyword: data.keyword ?? (CATALOG_KEYWORD || undefined),
    categories: data.categories ?? true,
  });

  for (const r of result.report) {
    log(`${r.ok ? '✅' : '⚠️ '} Catálogo ${r.provider}: ${r.message}${r.categories ? ` · ${r.categories} categorías` : ''}`);
  }

  // Las categorías propias (reales) actualizan el contador de artículos
  if (hasDatabase()) {
    const counts = await prisma.catalogItem.groupBy({ by: ['categoryName'], _count: { _all: true } });
    for (const c of counts) {
      if (!c.categoryName) continue;
      await prisma.catalogCategory.updateMany({ where: { name: c.categoryName }, data: { itemCount: c._count._all } }).catch(() => undefined);
    }
  }

  const total = result.report.reduce((acc, r) => acc + r.items, 0);
  log(`📦 Catálogo actualizado: ${total} productos en ${Date.now() - started} ms (proveedores: ${result.report.map((r) => r.provider).join(', ') || 'ninguno'})`);
  return { ok: result.ok, report: result.report, items: total };
}

async function main() {
  reportEnv();

  // 1) Catálogo de muestra: garantiza que la pantalla nunca esté vacía
  const sample = await ensureSampleCatalog().catch((err) => ({ inserted: false, items: 0, error: (err as Error).message }));
  log(`🖼️  Catálogo de muestra: ${sample.items} artículos${'inserted' in sample && sample.inserted ? ' (cargados ahora)' : ' (ya estaba)'}${(sample as any).error ? ` · aviso: ${(sample as any).error}` : ''}`);

  const queue = new Queue(CATALOG_QUEUE, { connection });
  const worker = new Worker(CATALOG_QUEUE, processJob, { connection, concurrency: 1 });

  worker.on('failed', (job, err) => log(`❌ Catálogo: job ${job?.id} falló → ${err.message}`));
  worker.on('completed', (job) => log(`✔️  Catálogo: job ${job.id} completado`));

  log(`🚀 Catalog Worker arrancado · cola="${CATALOG_QUEUE}" · refresco cada ${SYNC_MINUTES} min`);

  // 2) Repeatable: refresco periódico del catálogo real
  await queue.add(
    'catalog:sync',
    { reason: 'schedule', pages: PAGES, categories: true },
    { repeat: { pattern: `*/${Math.max(SYNC_MINUTES, 15)} * * * *` }, jobId: 'catalog:sync-repeatable', removeOnComplete: true },
  );
  // 3) Primera descarga al arrancar (a los 15 s, para no competir con el boot)
  await queue.add('catalog:sync', { reason: 'initial-boot', pages: PAGES, categories: true }, { delay: 15_000, jobId: `catalog-boot-${Date.now()}` });

  const shutdown = async () => {
    log('👋 Catalog Worker detenido');
    await worker.close().catch(() => undefined);
    await queue.close().catch(() => undefined);
    await connection.quit().catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(async (err) => {
  console.error('[catalogWorker] error fatal:', err);
  process.exit(1);
});
