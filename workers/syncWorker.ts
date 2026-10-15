/**
 * workers/syncWorker.ts — Motor de automatización 24/7 (BullMQ)
 *
 * Flujo por producto (job `sync:product`):
 *   1. Re-escanea la URL del proveedor → precio y stock actuales.
 *   2. Compara con el hash guardado: si no cambió nada, marca SKIPPED (0 llamadas a la API de la tienda).
 *   3. Si cambió el COSTO → recalcula precio con la regla de margen del usuario y actualiza la tienda.
 *   4. Si `stock_proveedor === 0` → marca el producto como AGOTADO en la tienda inmediatamente.
 *   5. Si vuelve el stock → reactiva el producto (ACTIVE).
 *   6. Registra todo en SyncLog (con diff before/after y duración).
 *
 * Job `sync:sweep` (repeatable, cada SYNC_INTERVAL_MINUTES=60 por defecto):
 *   encola todos los productos activos y monitoreados con retardo escalonado
 *   para no saturar proveedores ni tiendas (rate-limit friendly).
 *
 * Ejecución:
 *   npm run worker          # sync + órdenes
 *   npm run worker:sync     # sólo el worker de sincronización
 */
import './env'; // ← debe ir primero: carga .env.local como hace Next
import { Queue, Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { Prisma } from '@prisma/client';
import { checkProvider, filterDueProducts, log, prisma, resolveRule, runForUser, setStoreProductOutOfStock, shutdown, snapshotHash, updateStoreInventory, updateStorePrice, writeSyncLog } from './lib';
import { refreshFxRates, toEur } from '../src/lib/fx';
import { planFor } from '../src/lib/plans';
import { alertOperators, reportLine, runWatchdog } from '../src/lib/watchdog';
import { computeSellingPrice, shouldUpdatePrice } from '../src/lib/pricing';
import type { SupplierKey as ScrapedSupplierKey } from '../src/lib/types';
import { round2 } from '../src/lib/utils';
import { reportEnv } from './env';
import { alertUser } from '../src/lib/alerts';

const SYNC_QUEUE = 'sync';
/**
 * Cada cuánto se DESPIERTA el planificador. No es la frecuencia de sync de cada
 * producto: eso lo decide el plan de su dueño (30/60/120/360 min, ver plans.ts)
 * y lo aplica `filterDueProducts` en cada barrido. El planificador sólo tiene
 * que latir lo bastante a menudo para que el plan más exigente (Enterprise,
 * 30 min) se cumpla.
 */
const SCHEDULER_MIN = Number(process.env.SYNC_SCHEDULER_MINUTES ?? 15);
const CONCURRENCY = Number(process.env.SYNC_CONCURRENCY ?? 8);
const MAX_PER_RUN = Number(process.env.SYNC_MAX_PRODUCTS_PER_RUN ?? 2000);
const PRICE_THRESHOLD_PCT = Number(process.env.SYNC_PRICE_THRESHOLD_PCT ?? 1.5);

const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: null });

// ────────────────────────────── Procesador ──────────────────────────────────

async function processProductSync(job: Job) {
  const started = Date.now();
  const {
    productId,
    type = 'FULL_REFRESH',
    jobId,
    userId: jobUserId,
  } = job.data as { productId: string; type?: string; jobId?: string; userId?: string };

  // Aislamiento multi-cliente: el trabajo se ejecuta en el contexto del dueño
  // (si el job es antiguo y no trae userId, se resuelve desde el producto).
  const userId =
    jobUserId ??
    (await runForUser(null, () => prisma.product.findUnique({ where: { id: productId }, select: { userId: true } })))?.userId ??
    null;

  return runForUser(userId, async () => {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: { store: true, supplier: true, variants: true, user: true },
  });

  if (!product) {
    log(`⚠️  Producto ${productId} no existe: job descartado`);
    return { skipped: true, reason: 'product-not-found' };
  }
  if (!product.isMonitored) {
    await writeSyncLog({
      userId: product.userId,
      storeId: product.storeId,
      supplierId: product.supplierId,
      productId: product.id,
      type: 'FULL_REFRESH',
      status: 'SKIPPED',
      level: 'DEBUG',
      message: 'Producto sin monitorización activa (isMonitored=false)',
      durationMs: Date.now() - started,
      jobId,
    });
    return { skipped: true, reason: 'not-monitored' };
  }

  await job.updateProgress(10);

  // 1) Re-escaneo del proveedor
  const supplierKey = (product.supplier?.type ?? 'ALIEXPRESS') as ScrapedSupplierKey;
  const snapshot = await checkProvider(product.sourceUrl, supplierKey, {
    productId: product.id,
    previousHash: product.providerHash,
    // Las verificaciones y las demos pueden forzar el camino simulado (`demo`).
    mode: (job.data as any)?.providerMode === 'demo' ? 'demo' : (job.data as any)?.providerMode === 'live' ? 'live' : undefined,
  });
  await job.updateProgress(40);

  // ── Red de seguridad (auditoría 15/10) ────────────────────────────────────
  // Si la página no se ha podido interpretar (precio 0 = diseño cambiado, captcha,
  // bloqueo o precio tras registro), NO se toca nada: aplicar ese dato recalcularía
  // el precio de venta a ~0 € y lo publicaría en la tienda. Antes se aplicaba y el
  // producto pasaba de 149,99 € a 1,99 € con el stock a 0.
  if (!snapshot.reliable) {
    await prisma.product.update({
      where: { id: product.id },
      // 'SKIPPED' porque el producto queda intacto: no es un fallo del motor,
      // es un dato del proveedor que no se puede usar.
      data: { lastSyncedAt: new Date(), lastSyncStatus: 'SKIPPED', nextSyncAt: nextRunAt() },
    });
    await writeSyncLog({
      userId: product.userId,
      storeId: product.storeId,
      supplierId: product.supplierId,
      productId: product.id,
      type: 'FULL_REFRESH',
      status: 'SKIPPED',
      level: 'WARN',
      message: `Re-verificación descartada: ${snapshot.unreliableReason}. El producto se queda como estaba (ni precio ni stock se han tocado); se reintentará en el próximo chequeo.`,
      changes: { reliability: { source: snapshot.source, minPrice: snapshot.minPrice, warnings: snapshot.warnings.slice(0, 4) } } as any,
      durationMs: Date.now() - started,
      jobId,
    });
    log(`  ↳ snapshot no fiable (${snapshot.unreliableReason}): ${product.title} sin cambios`);
    await job.updateProgress(100);
    return { ok: false, skipped: true, reason: 'untrusted-snapshot', unreliableReason: snapshot.unreliableReason, durationMs: Date.now() - started };
  }

  const newHash = snapshotHash(snapshot);
  const costChanged = Math.abs(snapshot.minPrice - Number(product.costPrice)) > 0.005;
  const stockChanged = snapshot.stockTotal !== product.stockTotal;
  const perVariantChanged = snapshot.variants.some((sv) => {
    const local = product.variants.find((v) => v.supplierVariantId === sv.supplierVariantId);
    return !local || local.stock !== sv.stock || Math.abs(Number(local.costPrice) - sv.price) > 0.005;
  });

  if (newHash === product.providerHash && !costChanged && !stockChanged && !perVariantChanged) {
    await prisma.product.update({ where: { id: product.id }, data: { lastSyncedAt: new Date(), lastSyncStatus: 'SKIPPED', nextSyncAt: nextRunAt() } });
    await writeSyncLog({
      userId: product.userId,
      storeId: product.storeId,
      supplierId: product.supplierId,
      productId: product.id,
      type: 'FULL_REFRESH',
      status: 'SKIPPED',
      level: 'DEBUG',
      message: `Sin cambios en el proveedor (hash ${newHash.slice(0, 8)} idéntico)`,
      durationMs: Date.now() - started,
      jobId,
    });
    return { skipped: true, reason: 'no-changes' };
  }

  // 2) Regla de pricing efectiva y nuevo precio
  const { rule, name: ruleName } = await resolveRule({ pricingRuleId: product.pricingRuleId, userId: product.userId, category: product.category });
  const breakdown = computeSellingPrice(snapshot.minPrice, snapshot.shippingCost, {
    markupPct: Number(rule?.markupPct ?? 40),
    fixedFee: Number(rule?.fixedFee ?? 0),
    minProfit: Number(rule?.minProfit ?? 1.5),
    minPrice: rule?.minPrice ? Number(rule.minPrice) : null,
    maxPrice: rule?.maxPrice ? Number(rule.maxPrice) : null,
    roundTo: rule?.roundTo ? Number(rule.roundTo) : 0.99,
    includeShipping: rule?.includeShipping ?? true,
  }, ruleName);

  const priceChanged = costChanged && product.autoUpdatePrice && shouldUpdatePrice(Number(product.sellingPrice), breakdown.sellingPrice, PRICE_THRESHOLD_PCT);
  const outOfStock = snapshot.stockTotal === 0;
  const backInStock = !outOfStock && product.stockTotal === 0 && product.autoUpdateStock;

  const changes: Record<string, unknown>[] = [];
  const store = product.store;

  await job.updateProgress(60);

  // 3) Actualización de precio en la tienda
  if (priceChanged && store) {
    const res = await updateStorePrice(
      store,
      { storeProductId: product.storeProductId, storeVariantId: product.variants[0]?.storeVariantId ?? null },
      breakdown.sellingPrice,
      breakdown.compareAtPrice,
    );
    changes.push({ field: 'sellingPrice', from: Number(product.sellingPrice), to: breakdown.sellingPrice, store: store.platform, ok: res.ok, simulated: (res as any).simulated ?? false });
    await writeSyncLog({
      userId: product.userId,
      storeId: store.id,
      supplierId: product.supplierId,
      productId: product.id,
      type: 'PRICE_UPDATE',
      status: res.ok ? 'SUCCESS' : 'FAILED',
      level: res.ok ? 'INFO' : 'ERROR',
      message: res.ok
        ? `Precio actualizado en ${store.platform}: ${Number(product.sellingPrice).toFixed(2)} → ${breakdown.sellingPrice.toFixed(2)} (regla "${ruleName}", costo ${snapshot.minPrice.toFixed(2)})`
        : `Fallo actualizando precio en ${store.platform}: ${res.error}`,
      changes: { field: 'sellingPrice', from: Number(product.sellingPrice), to: breakdown.sellingPrice, costFrom: Number(product.costPrice), costTo: snapshot.minPrice },
      durationMs: Date.now() - started,
      jobId,
    });
  }

  // 4) Stock: variante a variante
  if (product.autoUpdateStock && store) {
    for (const sv of snapshot.variants) {
      const local = product.variants.find((v) => v.supplierVariantId === sv.supplierVariantId);
      if (!local || local.stock === sv.stock) continue;
      const res = await updateStoreInventory(
        store,
        { storeProductId: product.storeProductId, storeVariantId: local.storeVariantId, inventoryItemId: (local.rawPayload as any)?.inventoryItemId ?? null },
        sv.stock,
        product.storeProductId,
      );
      changes.push({ field: `stock:${sv.sku}`, from: local.stock, to: sv.stock, ok: res.ok });
      await prisma.productVariant.update({ where: { id: local.id }, data: { stock: sv.stock, costPrice: sv.price, lastSyncedAt: new Date() } });
    }
  }

  // 5) Agotado → ocultar/reactivar producto en la tienda
  if (outOfStock && product.stockTotal > 0 && store) {
    const res = await setStoreProductOutOfStock(store, { storeProductId: product.storeProductId, storeVariantId: null });
    await writeSyncLog({
      userId: product.userId,
      storeId: store.id,
      supplierId: product.supplierId,
      productId: product.id,
      type: 'STOCK_UPDATE',
      status: res.ok ? 'SUCCESS' : 'FAILED',
      level: res.ok ? 'WARN' : 'ERROR',
      message: res.ok
        ? `⚠️ Proveedor SIN STOCK → producto marcado como AGOTADO en ${store.platform} y despublicado`
        : `Fallo marcando agotado en ${store.platform}: ${res.error}`,
      changes: { field: 'stockTotal', from: product.stockTotal, to: 0 },
      durationMs: Date.now() - started,
      jobId,
    });
    // Aviso al cliente: su producto se ha agotado y se ha despublicado
    if (res.ok) {
      await alertUser(product.userId, 'stock', {
        title: `«${product.title}» se ha agotado y se ha despublicado`,
        body: `El proveedor ya no tiene stock de <strong>${product.title}</strong>. Se ha marcado como agotado en ${store.platform} para evitar ventas sin existencias. Se reactivará automáticamente cuando el proveedor vuelva a tener unidades.`,
        link: `/products`,
        cta: 'Ver producto',
      });
    }
  } else if (backInStock && store) {
    const { setProductStatus } = await import('../src/lib/shopify');
    const res = store.platform === 'SHOPIFY' && product.storeProductId ? await setProductStatus(store, product.storeProductId, 'ACTIVE') : { ok: true };
    await writeSyncLog({
      userId: product.userId,
      storeId: store.id,
      supplierId: product.supplierId,
      productId: product.id,
      type: 'STOCK_UPDATE',
      status: res.ok ? 'SUCCESS' : 'FAILED',
      level: 'INFO',
      message: res.ok ? `Stock recuperado (${snapshot.stockTotal} uds) → producto reactivado en ${store.platform}` : `Fallo reactivando: ${(res as any).error}`,
      changes: { field: 'stockTotal', from: 0, to: snapshot.stockTotal },
      durationMs: Date.now() - started,
      jobId,
    });
    if (res.ok) {
      await alertUser(product.userId, 'stock', {
        title: `«${product.title}» vuelve a tener stock`,
        body: `El proveedor ha repuesto <strong>${product.title}</strong> (${snapshot.stockTotal} unidades) y el producto se ha reactivado en ${store.platform}.`,
        link: `/products`,
        cta: 'Ver producto',
      });
    }
  }

  await job.updateProgress(90);

  // 6) Persistencia del estado final del producto
  await prisma.product.update({
    where: { id: product.id },
    data: {
      costPrice: snapshot.minPrice,
      shippingCost: snapshot.shippingCost,
      sellingPrice: priceChanged ? breakdown.sellingPrice : product.sellingPrice,
      profitAmount: round2(Number(priceChanged ? breakdown.sellingPrice : product.sellingPrice) - snapshot.minPrice - snapshot.shippingCost),
      marginPct: Number(rule?.markupPct ?? product.marginPct),
      stockTotal: snapshot.stockTotal,
      status: outOfStock ? 'OUT_OF_STOCK' : backInStock ? 'ACTIVE' : product.status,
      providerHash: newHash,
      lastSyncedAt: new Date(),
      lastSyncStatus: 'SUCCESS',
      lastSyncError: null,
      nextSyncAt: nextRunAt(),
    },
  });

  const durationMs = Date.now() - started;
  await writeSyncLog({
    userId: product.userId,
    storeId: store?.id,
    supplierId: product.supplierId,
    productId: product.id,
    type: 'FULL_REFRESH',
    status: 'SUCCESS',
    level: 'INFO',
    message: `Sincronización completa (${snapshot.source}) · costo ${snapshot.minPrice.toFixed(2)} ${snapshot.currency} · stock ${snapshot.stockTotal} · ${changes.length} cambios aplicados`,
    changes: changes as Prisma.InputJsonValue,
    durationMs,
    jobId,
  });

  await job.updateProgress(100);
  return { ok: true, changes: changes.length, durationMs, source: snapshot.source };
  });
}

// ───────────────────────── Barrido completo (sweep) ─────────────────────────

async function processSweep(job: Job) {
  const started = Date.now();
  // El barrido es una tarea GLOBAL (recorre los productos de todos los clientes)
  // por eso se ejecuta en modo sistema, y cada job hijo se encola con su userId.
  // 1) Qué productos hay monitorizados y cuándo se sincronizaron por última vez
  const { total, candidates, intervalByUser, monitorizados, frescos } = await runForUser(null, async () => {
    const where = { isMonitored: true, status: { in: ['ACTIVE', 'OUT_OF_STOCK', 'ERROR'] as any } };
    const total = await prisma.product.count({ where });
    const candidates = await prisma.product.findMany({
      where,
      select: { id: true, userId: true, syncPriority: true, lastSyncedAt: true },
      orderBy: [{ syncPriority: 'asc' }, { lastSyncedAt: 'asc' }],
      take: Math.min(total, MAX_PER_RUN),
    });

    // 2) Frecuencia que promete el plan de cada dueño
    const userIds = [...new Set(candidates.map((p) => p.userId))];
    const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, plan: true } });
    const intervalByUser = new Map(users.map((u) => [u.id, planFor(u.plan).syncIntervalMinutes]));

    // 3) Sólo los que ya han cumplido su intervalo
    const due = filterDueProducts(candidates, intervalByUser);
    return { total, candidates: due, intervalByUser, monitorizados: candidates.length, frescos: candidates.length - due.length };
  });

  const queue = new Queue(SYNC_QUEUE, { connection });
  const staggerMs = Math.max(Math.floor((SCHEDULER_MIN * 60_000 * 0.6) / Math.max(candidates.length, 1)), 250);

  log(
    `🔄 Barrido: ${candidates.length} de ${monitorizados} productos toca re-verificar ahora ` +
      `(${frescos} aún frescos según su plan, ${total} monitorizados en total · 1 cada ${staggerMs} ms)`,
  );

  let queued = 0;
  for (const [i, p] of candidates.entries()) {
    await queue.add(
      'sync:product',
      { productId: p.id, userId: p.userId, type: 'FULL_REFRESH', jobId: String(job.id) },
      {
        jobId: `sync-${p.id}-${Date.now()}`,
        priority: p.syncPriority,
        delay: i * staggerMs,
        attempts: 3,
        backoff: { type: 'exponential', delay: 10_000 },
        removeOnComplete: { age: 3600, count: 5000 },
        removeOnFail: { age: 86_400 },
      },
    );
    queued++;
  }

  log(`✅ Barrido completado: ${queued} jobs encolados, ${frescos} omitidos (plan) en ${Date.now() - started} ms`);
  return { queued, skippedFresh: frescos, total };
}

// ───────────────────── Vigilancia del sistema (operador) ────────────────────

/**
 * Job `health:watch` (cada 15 min): comprueba base de datos, Redis, colas,
 * microservicio de scraping y salud de la sincronización. Si algo va mal,
 * avisa por correo a los operadores (rol ADMIN) con freno de una hora por
 * problema. Es la red que faltaba: antes nadie se enteraba de una caída.
 */
/** Refresco de tipos de cambio. Nunca lanza: un feed caído no puede tumbar el motor. */
async function processFxRefresh(job: Job) {
  const result = await refreshFxRates({ force: job.data?.reason === 'manual' });
  const status = result.status;
  log(
    result.skipped
      ? `💱 Divisas: sin cambios (${result.reason}) · 1 USD = ${toEur(1, 'USD')} €`
      : result.ok
        ? `💱 Divisas actualizadas desde el BCE · 1 USD = ${toEur(1, 'USD')} € · 1 GBP = ${toEur(1, 'GBP')} €`
        : `💱 Divisas: no se pudo descargar (${result.reason}) → se mantienen las tasas ${status.source === 'ecb' ? 'últimas conocidas' : 'de reserva'} · 1 USD = ${toEur(1, 'USD')} €`,
  );
  return { ok: result.ok, skipped: Boolean(result.skipped), source: status.source, ageHours: status.ageHours };
}

async function processHealthWatch(job: Job) {
  const report = await runWatchdog();
  if (report.issues.length === 0) {
    log(`🩺 Vigilancia OK · ${reportLine(report)}`);
    return { ok: true, issues: 0 };
  }

  log(`🩺 Vigilancia: ${reportLine(report)}`);
  const alert = await alertOperators(report.issues, { report });
  log(`   ↳ aviso al operador: ${alert.sent ? `enviado a ${alert.recipients} operador(es) por ${alert.transport}` : `no enviado (${alert.reason})`}`);
  return { ok: report.ok, issues: report.issues.length, alerted: alert.sent, jobId: job.id };
}

// ────────────────────────────── Arranque ────────────────────────────────────

async function main() {
  reportEnv();
  log(`🚀 Sync Worker arrancado · cola="${SYNC_QUEUE}" · concurrencia=${CONCURRENCY} · planificador=${SCHEDULER_MIN}min`);

  const worker = new Worker(
    SYNC_QUEUE,
    async (job) => {
      if (job.name === 'sync:sweep') return processSweep(job);
      if (job.name === 'health:watch') return processHealthWatch(job);
      if (job.name === 'fx:refresh') return processFxRefresh(job);
      return processProductSync(job);
    },
    {
      connection,
      concurrency: CONCURRENCY,
      limiter: { max: 40, duration: 1000 }, // máx. 40 jobs/s para no quemar proveedores
      removeOnComplete: { count: 5000 },
    },
  );

  worker.on('completed', (job, result) => {
    try {
      const r = result as any;
      log(`✔ ${job.name} ${job.id} → ${r?.skipped ? `SKIP (${r.reason})` : `OK (${r?.changes ?? 0} cambios, ${r?.durationMs ?? 0} ms)`}`);
    } catch (err) {
      log(`⚠️  Error formateando resultado de ${job?.id}: ${(err as Error).message}`);
    }
  });

  // Nunca dejamos que un error de persistencia aborte el proceso del worker:
  // writeSyncLog ya captura internamente, y aquí añadimos una segunda red.
  worker.on('failed', async (job, err) => {
    try {
      log(`✖ ${job?.name} ${job?.id} intento ${job?.attemptsMade}: ${err.message}`);
      await writeSyncLog({
        productId: (job?.data as any)?.productId ?? null,
        type: 'FULL_REFRESH',
        status: 'FAILED',
        level: 'ERROR',
        message: `Job fallido (intento ${job?.attemptsMade ?? 1}): ${err.message}`,
        attempt: job?.attemptsMade ?? 1,
        jobId: String(job?.id ?? ''),
        errorStack: err.stack,
      });

      // Aviso por correo al dueño (una vez por job; el anti-spam agrupa el resto)
      const data = (job?.data ?? {}) as { userId?: string; productId?: string };
      const owner =
        data.userId ??
        (data.productId
          ? (await runForUser(null, () => prisma.product.findUnique({ where: { id: data.productId }, select: { userId: true } })))?.userId
          : null);
      if (owner) {
        const product = data.productId
          ? await runForUser(owner, () => prisma.product.findUnique({ where: { id: data.productId! }, select: { title: true } }))
          : null;
        await alertUser(owner, 'sync', {
          title: product ? `Fallo sincronizando «${product.title}»` : 'Fallo en el motor de sincronización',
          body: `No se ha podido completar una actualización${product ? ` de <strong>${product.title}</strong>` : ''} tras ${job?.attemptsMade ?? 1} intento(s).<br><br>Motivo: <code>${err.message}</code><br><br>Si se repite, revisa la conexión de la tienda y el proveedor en el monitor de sincronización.`,
          link: '/monitor',
          cta: 'Abrir el monitor',
        });
      }
    } catch (logErr) {
      console.error('[worker] fallo registrando el fallo (el worker continúa):', (logErr as Error).message);
    }
  });

  worker.on('error', (err) => log(`⚠️  Worker error (no fatal): ${err.message}`));

  // Red de seguridad de último recurso: el motor 24/7 no debe morir por una
  // promesa rechazada suelta.
  process.on('unhandledRejection', (reason) => log(`⚠️  Promesa rechazada no capturada (ignorada): ${(reason as Error)?.message ?? reason}`));
  process.on('uncaughtException', (err) => log(`⚠️  Excepción no capturada (el worker sigue vivo): ${err.message}`));

  // Job repeatable: barrido cada INTERVAL_MIN minutos
  const queue = new Queue(SYNC_QUEUE, { connection });
  await queue.add(
    'sync:sweep',
    { type: 'sweep', reason: 'scheduler' },
    { repeat: { pattern: `*/${SCHEDULER_MIN} * * * *` }, jobId: 'sync:sweep-repeatable', removeOnComplete: true },
  );

  // Barrido inicial 20 s después de arrancar (cubre caídas del worker)
  await queue.add('sync:sweep', { type: 'sweep', reason: 'initial-boot' }, { delay: 20_000, jobId: `sync-boot-${Date.now()}` });

  // Vigilancia del sistema cada 15 min (avisa a los operadores si algo se cae)
  const WATCH_MIN = Number(process.env.WATCHDOG_INTERVAL_MINUTES ?? 15);
  await queue.add(
    'health:watch',
    { type: 'watch' },
    { repeat: { pattern: `*/${WATCH_MIN} * * * *` }, jobId: 'health:watch-repeatable', removeOnComplete: true },
  );
  await queue.add('health:watch', { type: 'watch', reason: 'initial-boot' }, { delay: 35_000, jobId: `health-boot-${Date.now()}` });
  log(`🩺 Vigilancia del sistema programada cada ${WATCH_MIN} min (avisa a los operadores con rol ADMIN)`);

  // ── Divisas ───────────────────────────────────────────────────────────────
  // El motor de precios trabaja en euros y los proveedores cobran en su divisa:
  // una tasa desactualizada es un margen mal calculado. Se descargan las tasas
  // del BCE (gratis, sin clave) al arrancar y cada FX_REFRESH_HOURS horas.
  const FX_HOURS = Math.max(1, Number(process.env.FX_REFRESH_HOURS ?? 12));
  await queue.add(
    'fx:refresh',
    { type: 'fx' },
    { repeat: { pattern: `0 */${FX_HOURS} * * *` }, jobId: 'fx:refresh-repeatable', removeOnComplete: true },
  );
  await queue.add('fx:refresh', { type: 'fx', reason: 'initial-boot' }, { delay: 3_000, jobId: `fx-boot-${Date.now()}` });
  log(`💱 Divisas: descarga automática de tipos del BCE cada ${FX_HOURS} h (y al arrancar) · manual con FX_RATES`);

  log(
    `⏰ Planificador cada ${SCHEDULER_MIN} min · frecuencia por plan: ` +
      `Prueba ${planFor('TRIAL').syncIntervalMinutes}min · Starter ${planFor('STARTER').syncIntervalMinutes}min · ` +
      `Pro ${planFor('PRO').syncIntervalMinutes}min · Enterprise ${planFor('ENTERPRISE').syncIntervalMinutes}min`,
  );

  const graceful = async (signal: string) => {
    log(`Recibido ${signal}: cerrando worker con gracia...`);
    await worker.close();
    await queue.close();
    await shutdown();
    process.exit(0);
  };
  process.on('SIGINT', () => void graceful('SIGINT'));
  process.on('SIGTERM', () => void graceful('SIGTERM'));
}

function nextRunAt() {
  // Próximo latido del planificador (la frecuencia real de cada producto la
  // decide el plan de su dueño dentro del barrido).
  return new Date(Date.now() + SCHEDULER_MIN * 60_000);
}

if (require.main === module) {
  main().catch(async (err) => {
    console.error('Fallo fatal del sync worker:', err);
    await shutdown();
    process.exit(1);
  });
}

export { processProductSync, processSweep };
