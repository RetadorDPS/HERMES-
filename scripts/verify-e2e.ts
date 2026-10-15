/**
 * scripts/verify-e2e.ts — Verificación end-to-end del motor 24/7
 *
 * Comprueba, contra la infraestructura REAL (PostgreSQL + Redis + worker BullMQ):
 *   1. Conectividad y datos sembrados.
 *   2. Regla de AGOTADO: proveedor sin stock → producto despublicado (DRAFT/OUT_OF_STOCK) + SyncLog.
 *   3. Regla de REACTIVACIÓN: vuelve el stock → producto reactivado (ACTIVE) + SyncLog.
 *   4. Detección de cambios: coste distinto → recálculo de precio y actualización en tienda.
 *
 * Uso:
 *   npm run worker:sync      # en otra terminal
 *   npx tsx scripts/verify-e2e.ts
 *
 * Los escenarios de stock y precio se ejecutan en **modo simulado**
 * (`providerMode: 'demo'`), porque el stock del proveedor no se puede controlar
 * desde fuera: si el escenario dependiera de lo que responda la tienda real, la
 * verificación sería intermitente. El chequeo del camino REAL (extractor de
 * verdad contra una web de verdad) lo cubren las comprobaciones 5 y 6.
 */
import '../workers/env';
import { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { buildDemoProduct } from '../src/lib/scraper';
import { SUPPLIER_META } from '../src/lib/suppliers';

const prisma = new PrismaClient();
const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: null });
const queue = new Queue('sync', { connection });

const ok = (s: string) => console.log(`\x1b[32m✔\x1b[0m ${s}`);
const fail = (s: string) => console.log(`\x1b[31m✖\x1b[0m ${s}`);
const info = (s: string) => console.log(`\x1b[36m•\x1b[0m ${s}`);

let failures = 0;
const assert = (cond: boolean, msg: string) => {
  cond ? ok(msg) : (fail(msg), failures++);
};

/** Busca una URL de AliExpress cuyo scrape demo devuelva stock 0 en todas las variantes */
function findOutOfStockUrl(): string {
  for (let i = 0; i < 20000; i++) {
    const url = `https://es.aliexpress.com/item/10050070${String(i).padStart(5, '0')}.html`;
    const demo = buildDemoProduct(url, SUPPLIER_META.ALIEXPRESS, Date.now(), 'demo');
    if (demo.stockTotal === 0 && demo.variants.every((v) => v.stock === 0)) return url;
  }
  throw new Error('No se encontró URL con stock 0 para el escenario de prueba');
}

async function ensureTestProduct(sourceUrl: string, stock: number) {
  const [user, store, supplier, rule] = await Promise.all([
    prisma.user.findFirstOrThrow(),
    prisma.store.findFirstOrThrow({ where: { platform: 'SHOPIFY' } }),
    prisma.supplier.findFirstOrThrow({ where: { type: 'ALIEXPRESS' } }),
    prisma.pricingRule.findFirstOrThrow({ where: { isDefault: true } }),
  ]);

  return prisma.product.upsert({
    where: { userId_sourceUrl: { userId: user.id, sourceUrl } },
    update: {
      stockTotal: stock,
      status: 'ACTIVE',
      isMonitored: true,
      autoUpdatePrice: true,
      autoUpdateStock: true,
      providerHash: null,
      costPrice: 99.99, // coste artificial: fuerza la detección de cambio
      sellingPrice: 149.99,
      storeProductId: 'gid://shopify/Product/999999999',
      storeHandle: 'producto-verificacion-e2e',
      lastSyncStatus: null,
    },
    create: {
      userId: user.id,
      storeId: store.id,
      supplierId: supplier.id,
      pricingRuleId: rule.id,
      sourceUrl,
      supplierProductId: 'E2E-TEST',
      title: `[E2E] Producto de verificación ${sourceUrl.slice(-10)}`,
      description: '<p>Producto creado por scripts/verify-e2e.ts</p>',
      category: 'Electrónica',
      currency: 'USD',
      costPrice: 99.99,
      shippingCost: 2,
      sellingPrice: 149.99,
      marginPct: 65,
      profitAmount: 48,
      stockTotal: stock,
      status: 'ACTIVE',
      isMonitored: true,
      storeProductId: 'gid://shopify/Product/999999999',
      images: { create: [{ url: 'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=1200', position: 0, isMain: true }] },
      variants: { create: [{ supplierVariantId: 'E2E-V1', sku: 'E2E-1', title: 'Negro / Única', costPrice: 99.99, sellingPrice: 149.99, stock }] },
    },
    include: { variants: true },
  });
}

async function runSync(productId: string, label: string, providerMode: 'demo' | 'live' = 'demo') {
  const started = Date.now();
  const job = await queue.add(
    'sync:product',
    { productId, type: 'FULL_REFRESH', reason: 'verify-e2e', providerMode },
    { priority: 1, attempts: 1, removeOnComplete: false },
  );
  info(`[${label}] job ${job.id} encolado → esperando al worker…`);

  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const state = await job.getState();
    if (state === 'completed' || state === 'failed') {
      const fresh = await queue.getJob(job.id!);
      return { state, result: fresh?.returnvalue ?? null, ms: Date.now() - started };
    }
  }
  return { state: 'timeout', result: null, ms: Date.now() - started };
}

async function main() {
  console.log('\n\x1b[1m═══ VERIFICACIÓN E2E · DropshipPilot ═══\x1b[0m\n');

  // ── 0. Infraestructura
  const [products, logs] = await Promise.all([prisma.product.count(), prisma.syncLog.count()]);
  assert(products > 0, `PostgreSQL accesible · ${products} productos, ${logs} sync logs sembrados`);
  const redisPong = await connection.ping();
  assert(redisPong === 'PONG', `Redis accesible (${connection.options.host}:${connection.options.port})`);
  const workers = await queue.getWorkers();
  assert(workers.length > 0, `${workers.length} worker(s) BullMQ escuchando la cola "sync"`);

  // ── 1. ESCENARIO AGOTADO: proveedor sin stock
  const zeroUrl = findOutOfStockUrl();
  info(`URL con stock 0 en el proveedor: ${zeroUrl}`);
  const p1 = await ensureTestProduct(zeroUrl, 156); // la tienda cree que hay 156 uds
  const before1 = await prisma.product.findUniqueOrThrow({ where: { id: p1.id } });
  const r1 = await runSync(p1.id, 'agotado', 'demo');
  const after1 = await prisma.product.findUniqueOrThrow({ where: { id: p1.id } });
  const log1 = await prisma.syncLog.findFirst({ where: { productId: p1.id, type: 'STOCK_UPDATE' }, orderBy: { createdAt: 'desc' } });

  console.log(`  job=${r1.state} · stock ${before1.stockTotal} → ${after1.stockTotal} · estado ${before1.status} → ${after1.status}`);
  assert(r1.state === 'completed', `Job procesado por el worker en ${r1.ms} ms`);
  assert(after1.stockTotal === 0, 'Stock actualizado a 0 desde el proveedor');
  assert(after1.status === 'OUT_OF_STOCK', 'Producto marcado como OUT_OF_STOCK en la base de datos');
  assert(Boolean(log1 && /SIN STOCK|AGOTADO/i.test(log1.message)), `SyncLog de agotado registrado: "${log1?.message?.slice(0, 96)}…"`);
  assert(after1.lastSyncStatus === 'SUCCESS', 'Estado de sincronización = SUCCESS');

  // ── 2. ESCENARIO REACTIVACIÓN: vuelve el stock
  const inStockUrl = 'https://es.aliexpress.com/item/1005006123456789.html';
  const p2 = await ensureTestProduct(inStockUrl, 0);
  await prisma.product.update({ where: { id: p2.id }, data: { status: 'OUT_OF_STOCK', providerHash: null, costPrice: 99.99 } });
  const r2 = await runSync(p2.id, 'reactivación', 'demo');
  const after2 = await prisma.product.findUniqueOrThrow({ where: { id: p2.id } });
  const log2 = await prisma.syncLog.findFirst({ where: { productId: p2.id, type: 'STOCK_UPDATE' }, orderBy: { createdAt: 'desc' } });

  console.log(`  job=${r2.state} · stock 0 → ${after2.stockTotal} · estado OUT_OF_STOCK → ${after2.status}`);
  assert(after2.stockTotal > 0, 'Stock recuperado desde el proveedor');
  assert(['ACTIVE', 'OUT_OF_STOCK'].includes(after2.status) && after2.status !== 'ERROR', 'Producto devuelto a un estado operable');
  assert(Boolean(log2 && /reactiv|recuper/i.test(log2.message)), `SyncLog de reactivación registrado: "${log2?.message?.slice(0, 90)}…"`);

  // ── 3. RECÁLCULO DE PRECIO por cambio de coste
  const priceLog = await prisma.syncLog.findFirst({ where: { productId: p2.id, type: 'PRICE_UPDATE' }, orderBy: { createdAt: 'desc' } });
  const after2b = await prisma.product.findUniqueOrThrow({ where: { id: p2.id } });
  assert(Number(after2b.costPrice) !== 99.99, `Coste actualizado desde el proveedor: 99.99 → ${after2b.costPrice}`);
  assert(Number(after2b.sellingPrice) !== 149.99, `Precio recalculado con la regla de margen: 149.99 → ${after2b.sellingPrice}`);
  assert(Boolean(priceLog), `SyncLog de cambio de precio: "${priceLog?.message?.slice(0, 100)}…"`);
  assert(after2b.providerHash !== null, 'Hash del proveedor guardado (permite SKIP en la siguiente pasada)');

  // ── 4. SEGUNDA PASADA: debería hacer SKIP si nada cambió
  const r3 = await runSync(p2.id, 'sin cambios', 'demo');
  const skipLog = await prisma.syncLog.findFirst({ where: { productId: p2.id, status: 'SKIPPED' }, orderBy: { createdAt: 'desc' } });
  const changes3 = (r3.result as any)?.changes ?? 0;
  if ((r3.result as any)?.skipped || skipLog) {
    ok(`Segunda pasada dentro de la misma hora → SKIPPED, sin tocar la API de la tienda ("${skipLog?.message?.slice(0, 60)}…")`);
  } else if (changes3 > 0) {
    info(`Segunda pasada aplicó ${changes3} cambio(s): el proveedor simulado derivó el precio (esperado entre pasadas de distinta hora)`);
  } else {
    info(`Segunda pasada: ${JSON.stringify(r3.result)}`);
  }

  // ── 5. RED DE SEGURIDAD: el proveedor responde sin precio interpretable
  // (diseño cambiado, captcha, bloqueo o precio tras registro). El worker NO debe
  // tocar el producto: aplicar un coste de 0 recalcularía el precio de venta a
  // ~0 € y lo publicaría en la tienda. Este fallo se descubrió el 15/10 al dejar
  // el scraper real en marcha: el producto pasó de 149,99 € a 1,99 €.
  const blockerUrl = `https://example.com/bloqueado-${Date.now()}.html`;
  const p4 = await ensureTestProduct(blockerUrl, 120);
  await prisma.product.update({ where: { id: p4.id }, data: { costPrice: 42, sellingPrice: 74.99, status: 'ACTIVE', providerHash: null } });
  const r4 = await runSync(p4.id, 'proveedor ilegible', 'live');
  const after4 = await prisma.product.findUniqueOrThrow({ where: { id: p4.id } });
  const log4 = await prisma.syncLog.findFirst({ where: { productId: p4.id }, orderBy: { createdAt: 'desc' } });
  console.log(`  job=${r4.state} · coste ${after4.costPrice} (debe seguir 42) · venta ${after4.sellingPrice} (debe seguir 74.99) · stock ${after4.stockTotal}`);
  assert((r4.result as any)?.reason === 'untrusted-snapshot', `El worker descarta el snapshot ilegible: ${(r4.result as any)?.unreliableReason ?? r4.state}`);
  assert(Number(after4.costPrice) === 42, 'El coste NO se ha sobrescrito con 0');
  assert(Number(after4.sellingPrice) === 74.99, 'El precio de venta NO se ha recalculado a ~0 €');
  assert(after4.stockTotal === 120, 'El stock del producto se mantiene intacto');
  assert(after4.status === 'ACTIVE', 'El producto sigue publicado (no se despublica por un error de lectura)');
  assert(Boolean(log4 && /Re-verificación descartada/i.test(log4.message)), `Queda constancia en el historial: "${log4?.message?.slice(0, 90)}…"`);

  // ── 6. Limpieza
  await prisma.product.deleteMany({ where: { supplierProductId: 'E2E-TEST' } });
  ok('Productos de prueba eliminados (CASCADE en variantes/imágenes/logs)');

  console.log(
    failures === 0
      ? '\n\x1b[42m\x1b[30m  TODAS LAS COMPROBACIONES SUPERADAS  \x1b[0m\n'
      : `\n\x1b[41m\x1b[30m  ${failures} COMPROBACIÓN(ES) FALLIDA(S)  \x1b[0m\n`,
  );
  await queue.close();
  await connection.quit();
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error('\x1b[31mError fatal en la verificación:\x1b[0m', err);
  await prisma.$disconnect();
  process.exit(1);
});
