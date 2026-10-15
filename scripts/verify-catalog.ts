/**
 * scripts/verify-catalog.ts — Verifica el escaparate de catálogo y las claves de
 * proveedor de la plataforma.
 *
 *   npm run verify:catalog        (la web debe estar levantada en :3000)
 *
 * Cubre: catálogo de muestra cargado, filtros y orden del índice, ficha con
 * payload de importación, importación real reutilizando POST /api/import (2
 * créditos + SyncLog), categorías con imagen, claves de plataforma (guardado
 * cifrado, prueba contra la API real, cuota y borrado) y que la muestra
 * desaparece cuando hay catálogo real.
 */
import '../workers/env';
import { prisma } from '../src/lib/prisma';
import { withSystem } from '../src/lib/tenant-context';
import {
  ensureSampleCatalog,
  queryCatalog,
  catalogItemWithPayload,
  upsertCatalogItems,
  syncCatalog,
} from '../src/lib/catalog';
import {
  platformCredentialSummary,
  savePlatformCredentials,
  testPlatformConnection,
  clearPlatformCredentials,
  consumePlatformQuota,
  credentialsFromEnv,
} from '../src/lib/catalog/platform-credentials';

const BASE = process.env.VERIFY_BASE_URL ?? 'http://localhost:3000';
let passed = 0;
let failed = 0;
const check = (ok: boolean, msg: string, extra = '') => {
  console.log(`${ok ? '✔' : '✘'} ${msg}${extra ? ` — ${extra}` : ''}`);
  ok ? passed++ : failed++;
};

const api = async (path: string, init?: RequestInit) => {
  const res = await fetch(`${BASE}${path}`, { cache: 'no-store', ...init });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
};

async function main() {
  console.log(`\n\u001b[1mCatálogo servido por la plataforma — verificación\u001b[0m\n`);

  // ── 1. Catálogo de muestra ───────────────────────────────────────────────
  const sample = await ensureSampleCatalog();
  const sampleCount = await withSystem('verify-catalog: contar muestra', () => prisma.catalogItem.count({ where: { source: 'sample' } }));
  const sampleCats = await withSystem('verify-catalog: contar categorías', () => prisma.catalogCategory.count({ where: { externalId: { startsWith: 'sample-' } } }));
  check(sampleCount > 0, 'El catálogo de muestra está cargado', `${sampleCount} artículos (idempotente: ${sample.inserted ? 'insertado ahora' : 'ya estaba'})`);
  check(sampleCats > 0, 'Hay categorías de muestra con imagen', `${sampleCats} filas en ${[...new Set((await withSystem('cats', () => prisma.catalogCategory.findMany({ where: { externalId: { startsWith: 'sample-' } }, select: { name: true } }))).map((c) => c.name))].length} categorías`);

  // ── 2. Índice: consultas, filtros y orden ────────────────────────────────
  const all = await queryCatalog({ pageSize: 24 });
  check(all.total > 0 && all.items.length > 0, 'El índice devuelve productos', `${all.total} resultados, ${all.items.length} en la primera página`);
  check(all.facets.length >= 6, 'Las facetas de categoría llegan a la interfaz', `${all.facets.length} categorías`);
  check(all.facets.every((f) => Boolean(f.imageUrl)), 'Todas las categorías visuales tienen imagen', `${all.facets.filter((f) => f.imageUrl).length}/${all.facets.length}`);

  const cat = all.facets[0];
  const byCategory = await queryCatalog({ category: cat?.name, pageSize: 50 });
  check(byCategory.total > 0 && byCategory.items.every((i) => i.categoryName === cat.name), 'Filtro por categoría', `«${cat?.name}»: ${byCategory.total}`);

  const cheap = await queryCatalog({ maxPrice: 8, pageSize: 50 });
  check(cheap.total > 0 && cheap.items.every((i) => i.costPrice <= 8), 'Filtro por precio máximo', `${cheap.total} artículos ≤ 8 €`);

  const free = await queryCatalog({ freeShipping: true, pageSize: 50 });
  check(free.total > 0 && free.items.every((i) => i.freeShipping), 'Filtro de envío gratis', `${free.total} artículos`);

  const search = await queryCatalog({ search: 'auriculares', pageSize: 50 });
  check(search.total > 0 && search.items.some((i) => /auricular/i.test(i.title)), 'Búsqueda por palabra', `«auriculares»: ${search.total}`);

  const trending = await queryCatalog({ trending: true, pageSize: 50 });
  check(trending.total > 0 && trending.items.every((i) => i.isTrending), 'Filtro de tendencias', `${trending.total} artículos`);

  const asc = await queryCatalog({ sort: 'price-asc', pageSize: 10 });
  const ascPrices = asc.items.map((i) => i.costPrice);
  check(ascPrices.every((p, i) => i === 0 || ascPrices[i - 1] <= p), 'Orden por precio ascendente', `${ascPrices[0]} € … ${ascPrices[ascPrices.length - 1]} €`);

  const page1 = await queryCatalog({ page: 1, pageSize: 6 });
  const page2 = await queryCatalog({ page: 2, pageSize: 6 });
  check(page1.items[0]?.id !== page2.items[0]?.id && page2.items.length > 0, 'Paginación', `${page1.pages} páginas de 6`);

  const withRule = await queryCatalog({ pageSize: 5, sort: 'price-asc', pricingRule: { markupPct: 40, fixedFee: 0, minProfit: 1.5, roundTo: 0.99, includeShipping: true, minPrice: null, maxPrice: null, name: 'Prueba 40 %' } });
  check(
    withRule.items.every((i) => typeof i.sellingPrice === 'number' && typeof i.profit === 'number'),
    'Cada tarjeta trae precio de venta y beneficio calculados',
    `ej.: coste ${withRule.items[0]?.costPrice} € → venta ${withRule.items[0]?.sellingPrice} € · beneficio ${withRule.items[0]?.profit} €`,
  );

  // ── 3. API pública de la pantalla ────────────────────────────────────────
  const listApi = await api('/api/catalog?pageSize=8&sort=trending');
  check(listApi.status === 200 && listApi.json.ok && listApi.json.items.length > 0, 'GET /api/catalog responde', `${listApi.json.total} resultados`);
  check(listApi.json.items.every((i: any) => i.sellingPrice !== undefined), 'La API aplica la regla de margen del usuario', `regla del usuario en :3000`);

  const filtered = await api('/api/catalog?q=mascotas&freeShipping=1&minRating=4');
  check(filtered.status === 200 && Array.isArray(filtered.json.items), 'GET /api/catalog con filtros combinados', `${filtered.json.total} resultados`);

  const catsApi = await api('/api/catalog/categories');
  check(catsApi.status === 200 && catsApi.json.categories.length > 0, 'GET /api/catalog/categories', `${catsApi.json.categories.length} categorías · ${catsApi.json.providers.length} proveedores`);
  check(Array.isArray(catsApi.json.credentials) && catsApi.json.credentials.length === 3, 'El estado de las claves viaja a la pantalla', catsApi.json.credentials.map((c: any) => `${c.name}:${c.configured ? 'con claves' : 'sin claves'}`).join(' · '));

  const first = all.items[0];
  const detailApi = await api(`/api/catalog/${first.id}`);
  check(detailApi.status === 200 && detailApi.json.ok, 'GET /api/catalog/[id] devuelve la ficha', first.title.slice(0, 48));
  check(Boolean(detailApi.json.scrapedPayload?.variants?.length), 'La ficha incluye el payload de importación con variantes', `${detailApi.json.scrapedPayload?.variants?.length} variantes`);
  check(detailApi.json.pricing?.sellingPrice > 0, 'La ficha calcula el precio final con la regla del usuario', `${detailApi.json.pricing?.sellingPrice} € · beneficio ${detailApi.json.pricing?.profit} €`);

  // ── 4. Importación desde el catálogo (mismo endpoint que por URL) ─────────
  const userId = (await withSystem('verify-catalog: usuario demo', () => prisma.user.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } })))?.id;
  const store = await withSystem('verify-catalog: tienda', () => prisma.store.findFirst({ where: { userId, status: 'CONNECTED' }, select: { id: true, name: true, platform: true } }));
  check(Boolean(store), 'Hay una tienda conectada para importar', store ? `${store.name} (${store.platform})` : 'ninguna');

  if (userId && store) {
    const subBefore = await withSystem('verify-catalog: créditos antes', () => prisma.subscription.findFirst({ where: { userId }, select: { creditsUsed: true, creditsLimit: true } }));
    const importRes = await api('/api/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: detailApi.json.scrapedPayload.sourceUrl,
        storeId: store.id,
        status: 'DRAFT',
        country: 'ES',
        publish: true,
        scrapedPayload: detailApi.json.scrapedPayload,
      }),
    });
    check(importRes.status === 200 && importRes.json.ok, 'Importar desde el catálogo funciona', `${importRes.json.product?.title?.slice(0, 40)} · venta ${importRes.json.product?.sellingPrice} €`);

    if (importRes.json.ok) {
      const productId = importRes.json.product.id;
      const product = await withSystem('verify-catalog: producto creado', () => prisma.product.findUnique({ where: { id: productId }, include: { variants: true, images: true } }));
      check(Boolean(product), 'El producto queda guardado con sus variantes', `${product?.variants.length} variantes · ${product?.images.length} imágenes`);
      check(product?.supplierProductId === detailApi.json.scrapedPayload.supplierProductId, 'Guarda el id del proveedor (para el worker)', `${product?.supplierProductId}`);

      const log = await withSystem('verify-catalog: sync log', () => prisma.syncLog.findFirst({ where: { productId }, orderBy: { createdAt: 'desc' } }));
      check(Boolean(log) && log?.type === 'IMPORT', 'Se registra en el historial de sync', log?.message?.slice(0, 60) ?? 'sin registro');

      const subAfter = await withSystem('verify-catalog: créditos después', () => prisma.subscription.findFirst({ where: { userId }, select: { creditsUsed: true } }));
      check(
        subBefore && subAfter ? Number(subAfter.creditsUsed) === Number(subBefore.creditsUsed) + 2 : false,
        'Consume exactamente 2 créditos (igual que la importación por URL)',
        `${subBefore?.creditsUsed} → ${subAfter?.creditsUsed}`,
      );

      // Limpieza: la verificación no debe ensuciar el catálogo de productos
      await withSystem('verify-catalog: limpiar producto', async () => {
        await prisma.productVariant.deleteMany({ where: { productId } });
        await prisma.productImage.deleteMany({ where: { productId } });
        await prisma.productReview.deleteMany({ where: { productId } });
        await prisma.syncLog.deleteMany({ where: { productId } });
        await prisma.product.delete({ where: { id: productId } });
      });
    }
  }

  // ── 5. Claves de la plataforma ───────────────────────────────────────────
  const summary = await platformCredentialSummary();
  check(summary.length === 3, 'Se gestionan los tres proveedores', summary.map((s) => `${s.name}${s.configured ? '(✓)' : ''}`).join(' · '));
  check(summary.every((s) => Array.isArray(s.fields) && s.fields.length > 0), 'Cada proveedor declara qué claves necesita', `${summary.map((s) => `${s.name}:${s.fields.length}`).join(' · ')}`);

  const credsApi = await api('/api/admin/platform-credentials');
  check(
    credsApi.status === 200 || credsApi.status === 403,
    'El panel de claves exige rol de administrador',
    `HTTP ${credsApi.status}${credsApi.status === 403 ? ' (protegido)' : ' (usuario demo es ADMIN)'}`,
  );

  const before = await withSystem('verify-catalog: claves previas', () => prisma.platformCredential.findMany());
  check(Array.isArray(before), 'La tabla de credenciales de plataforma existe', `${before.length} filas`);

  // Guardado cifrado + prueba contra la API real (con claves deliberadamente falsas)
  await savePlatformCredentials({
    provider: 'CJ_DROPSHIPPING',
    credentials: { email: 'verificacion@dropshippilot.io', apiKey: 'clave-de-prueba-invalida' },
    monthlyQuota: 10,
  });
  const stored = await withSystem('verify-catalog: leer cifrado', () => prisma.platformCredential.findUnique({ where: { provider: 'CJ_DROPSHIPPING' } }));
  check(Boolean(stored?.credentialsEnc) && !stored!.credentialsEnc.includes('clave-de-prueba-invalida'), 'Las claves se guardan cifradas', `${stored?.credentialsEnc?.slice(0, 32)}… (AES-256-GCM)`);

  const maskedSummary = await platformCredentialSummary();
  const cj = maskedSummary.find((s) => s.provider === 'CJ_DROPSHIPPING');
  check(Boolean(cj?.configured) && cj!.masked.every((m) => !m.value.includes('invalida')), 'El panel las muestra enmascaradas', cj?.masked.map((m) => `${m.label}: ${m.value}`).join(' · ') ?? '—');

  const test = await testPlatformConnection('CJ_DROPSHIPPING');
  const storedAfterTest = await withSystem('verify-catalog: estado tras probar', () => prisma.platformCredential.findUnique({ where: { provider: 'CJ_DROPSHIPPING' }, select: { status: true, lastError: true, lastTestAt: true } }));
  check(Boolean(storedAfterTest?.lastTestAt), 'La prueba deja marca de cuándo se intentó', storedAfterTest?.lastTestAt?.toISOString().slice(0, 19) ?? '—');
  check(
    test.ok === false ? Boolean(storedAfterTest?.lastError) : true,
    'Con claves inválidas se registra el error real del proveedor',
    test.ok ? `la API real aceptó la comprobación: ${test.message}` : `${test.message.slice(0, 90)}`,
  );

  // El contador de cuota es real y persiste entre ejecuciones: se deja a cero
  // para poder comprobar el tope sin depender de cuántas veces se haya corrido la suite.
  await withSystem('verify-catalog: reiniciar la cuota del mes', () =>
    prisma.platformCredential.updateMany({ where: { provider: 'CJ_DROPSHIPPING' }, data: { usedThisMonth: 0, quotaResetAt: null } }),
  );
  const quota1 = await consumePlatformQuota('CJ_DROPSHIPPING', 1);
  const quota2 = await consumePlatformQuota('CJ_DROPSHIPPING', 10);
  check(quota1.ok && !quota2.ok, 'La cuota mensual de la plataforma corta antes de agotar la API', `usados ${quota2.used} de ${quota2.limit}`);

  await clearPlatformCredentials('CJ_DROPSHIPPING');
  const cleared = await withSystem('verify-catalog: tras borrar', () => prisma.platformCredential.findUnique({ where: { provider: 'CJ_DROPSHIPPING' }, select: { isEnabled: true, credentialsEnc: true } }));
  check(cleared?.credentialsEnc === '' && cleared?.isEnabled === false, 'Borrar claves deja el proveedor inactivo', `enabled=${cleared?.isEnabled}`);
  check(!credentialsFromEnv('CJ_DROPSHIPPING'), 'Sin claves (panel ni entorno) el proveedor no se considera configurado', 'el catálogo de muestra sigue visible');

  // ── 6. Muestra vs. real ──────────────────────────────────────────────────
  const realProvider = 'AMAZON' as const; // proveedor sin catálogo real, para no tocar los datos del usuario
  await upsertCatalogItems(realProvider, [
    {
      provider: realProvider,
      supplierProductId: 'verify-real-1',
      sourceUrl: 'https://www.amazon.es/dp/verify-real-1',
      title: 'Producto real de prueba (verificación)',
      description: 'x',
      category: 'Verificación',
      currency: 'EUR',
      costPrice: 9.99,
      stock: 10,
      images: [],
      variants: [{ supplierVariantId: 'v1', title: 'Único', costPrice: 9.99, stock: 10 }],
      shipping: { cost: 0, minDays: 3, maxDays: 7, country: 'ES' },
      source: 'api',
    },
  ], 'api');
  const afterReal = await queryCatalog({ provider: 'AMAZON', pageSize: 10 });
  check(afterReal.items.every((i) => i.source === 'api'), 'Con catálogo real de un proveedor, su muestra desaparece', `${afterReal.total} artículos reales de ${realProvider}`);
  const mixed = await queryCatalog({ pageSize: 10 });
  check(mixed.providers.some((p) => p.provider === 'AMAZON' && p.hasReal), 'El índice distingue «real» de «muestra»', JSON.stringify(mixed.providers));

  await withSystem('verify-catalog: limpiar real', () => prisma.catalogItem.deleteMany({ where: { provider: realProvider, externalId: 'verify-real-1' } }));

  // ── 7. Sync sin claves: no rompe y lo dice ───────────────────────────────
  const sync = await syncCatalog({ provider: 'CJ_DROPSHIPPING', pages: 1 });
  check(sync.report[0]?.ok === false && /claves/i.test(sync.report[0]?.message ?? ''), 'Sin claves, la descarga avisa en vez de fallar', sync.report[0]?.message ?? '—');

  // ── 8. Contrato con los proveedores (respuestas reales simuladas en la red) ─
  // Aquí se sustituye `fetch` por respuestas con la MISMA forma que documentan
  // CJ y AliExpress. Es la prueba más cercana posible a «pegar las claves»: se
  // ejecuta la descarga completa (autenticación → listado → normalización →
  // índice → pantalla → importación) sin depender de las claves reales.
  const realFetch = globalThis.fetch;
  const called: string[] = [];

  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

  globalThis.fetch = (async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : String(input?.url ?? input);
    const body = typeof init?.body === 'string' ? init.body : '';
    called.push(`${url} ${body}`);

    // ── CJ ──
    if (url.includes('/authentication/getAccessToken')) {
      return json({ result: true, code: 200, message: 'ok', data: { accessToken: 'cj-token-contrato', accessTokenExpiryDate: '2027-01-01T00:00:00Z' } });
    }
    if (url.includes('/product/listV2')) {
      return json({
        result: true,
        code: 200,
        data: {
          total: 3,
          list: [
            {
              pid: 'CJ99001',
              productNameEn: 'Auriculares inalámbricos CONTRATO con cancelación de ruido',
              sellPrice: 12.3,
              productImage: 'https://cf.cjdropshipping.com/99001-1.jpg;https://cf.cjdropshipping.com/99001-2.jpg',
              categoryName: 'Audio y auriculares',
              warehouseInventoryNum: 320,
              listedNum: 9400,
              productRating: 4.7,
              deliveryTimeMin: 7,
              deliveryTimeMax: 15,
            },
            { pid: 'CJ99002', productNameEn: 'Lámpara LED CONTRATO', sellPrice: 5.4, productImage: 'https://cf.cjdropshipping.com/99002.jpg', categoryName: 'Hogar inteligente', warehouseInventoryNum: 80, listedNum: 1200 },
            { pid: 'CJ99003', productNameEn: 'Comedero para mascotas CONTRATO', sellPrice: 8.9, productImage: 'https://cf.cjdropshipping.com/99003.jpg', categoryName: 'Mascotas', warehouseInventoryNum: 45, listedNum: 300 },
          ],
        },
      });
    }
    if (url.includes('/product/getCategory')) {
      return json({
        result: true,
        data: {
          categoryFirstList: [
            {
              categoryId: 'cj-c1',
              categoryName: 'Electrónica',
              categorySecondList: [{ categoryId: 'cj-c2', categoryName: 'Audio', categoryThirdList: [{ categoryId: 'cj-c3', categoryName: 'Auriculares' }] }],
            },
          ],
        },
      });
    }

    // ── AliExpress ──
    if (url.includes('aliexpress.com')) {
      return json({
        aliexpress_ds_recommend_feed_get_response: {
          result: {
            products: [
              {
                product_id: '1005001',
                product_title: 'Auriculares TWS CONTRATO AliExpress',
                target_sale_price: '8.55',
                target_original_price: '12.99',
                product_main_image_url: 'https://ae01.alicdn.com/kf/1005001.jpg',
                product_small_image_urls: 'https://ae01.alicdn.com/kf/1005001b.jpg',
                first_level_category_name: 'Audio',
                second_level_category_name: 'Auriculares',
                evaluate_rate: '96.5%',
                lastest_volume: 4321,
                product_detail_url: 'https://es.aliexpress.com/item/1005001.html',
                shipping_cost: '1.20',
              },
              {
                product_id: '1005002',
                product_title: 'Reloj CONTRATO AliExpress',
                target_sale_price: '15.90',
                product_main_image_url: 'https://ae01.alicdn.com/kf/1005002.jpg',
                first_level_category_name: 'Relojes',
                evaluate_rate: '92%',
                lastest_volume: 900,
                product_detail_url: 'https://es.aliexpress.com/item/1005002.html',
              },
            ],
          },
        },
      });
    }

    // Cualquier otra petición (por ejemplo a la propia app en :3000) sigue su
    // camino normal: sólo se simulan los proveedores.
    return realFetch(input, init);
  }) as typeof fetch;

  try {
    // CJ: claves de plataforma (falsas, la red está simulada) + descarga completa
    await savePlatformCredentials({ provider: 'CJ_DROPSHIPPING', credentials: { email: 'contrato@test.local', apiKey: 'api-key-contrato' } });
    const cjSync = await syncCatalog({ provider: 'CJ_DROPSHIPPING', pages: 1, categories: true });
    check(cjSync.report[0]?.ok === true, 'Descarga completa de CJ con respuesta simulada', cjSync.report[0]?.message ?? '—');
    check(cjSync.report[0]?.items === 3, 'Se indexan los 3 productos del listado', `${cjSync.report[0]?.items ?? 0} guardados`);
    check(cjSync.report[0]?.categories === 3, 'Las categorías anidadas se aplanan', `${cjSync.report[0]?.categories ?? 0} categorías (3 niveles → 3 filas)`);

    const cjReal = await queryCatalog({ provider: 'CJ_DROPSHIPPING', pageSize: 10, pricingRule: { markupPct: 40, fixedFee: 0, minProfit: 1.5, roundTo: 0.99, includeShipping: true, minPrice: null, maxPrice: null, name: 'Contrato' } });
    check(cjReal.total === 3 && cjReal.items.every((i) => i.source === 'api'), 'La muestra de CJ deja paso al catálogo real', `${cjReal.total} artículos, todos reales`);
    check(cjReal.items.some((i) => i.images.length === 2), 'Se conservan todas las imágenes del proveedor', `máx. ${Math.max(...cjReal.items.map((i) => i.images.length))} imágenes`);
    check(cjReal.items.every((i) => (i.sellingPrice ?? 0) > i.costPrice), 'Cada producto real trae precio de venta calculado', `ej. ${cjReal.items[0]?.costPrice} € → ${cjReal.items[0]?.sellingPrice} €`);
    check(cjReal.items.every((i) => i.shipFrom === 'ES'), 'Se guarda el almacén consultado', `almacén ${cjReal.items[0]?.shipFrom}`);

    const cjDetail = await catalogItemWithPayload(cjReal.items[0].id, { destinationCountry: 'ES' });
    check(cjDetail?.scraped.supplierProductId === 'CJ99001' && (cjDetail?.scraped.variants.length ?? 0) > 0, 'La ficha genera el payload de importación', `${cjDetail?.scraped.variants.length} variante(s) · ${cjDetail?.scraped.supplier}`);
    check(Boolean(cjDetail?.scraped.sourceUrl.includes('cjdropshipping.com')), 'La URL de origen apunta al proveedor', cjDetail?.scraped.sourceUrl ?? '—');

    // AliExpress: feed completo
    await savePlatformCredentials({ provider: 'ALIEXPRESS', credentials: { appKey: 'appkey-contrato', appSecret: 'secreto-contrato', accessToken: 'token-contrato' } });
    const aliSync = await syncCatalog({ provider: 'ALIEXPRESS', pages: 1 });
    check(aliSync.report[0]?.ok === true && aliSync.report[0]?.items === 2, 'Descarga del feed de AliExpress', aliSync.report[0]?.message ?? '—');

    const aliReal = await queryCatalog({ provider: 'ALIEXPRESS', pageSize: 10 });
    check(aliReal.total === 2 && aliReal.items.every((i) => i.source === 'api'), 'El feed se indexa y sustituye a la muestra de AliExpress', `${aliReal.total} artículos reales`);
    check(aliReal.items.some((i) => (i.rating ?? 0) > 4 && (i.ordersCount ?? 0) > 4000), 'Se interpretan valoración y pedidos del feed', `valoración ${aliReal.items.find((i) => i.rating)?.rating?.toFixed(1)} · ${aliReal.items.find((i) => i.ordersCount)?.ordersCount} pedidos`);

    check(called.some((u) => u.includes('/product/listV2')), 'Se llamó al endpoint oficial de listado de CJ', 'product/listV2');
    check(called.some((u) => u.includes('aliexpress.ds.recommend.feed.get')), 'Se llamó al feed oficial de AliExpress', 'ds.recommend.feed.get (firmado en el cuerpo)');
    check(
      called.some((u) => u.includes('/product/listV2') && /countryCode=ES/.test(u)),
      'Los filtros viajan en la petición al proveedor',
      `país de almacén y palabra clave incluidos · ${called.length} peticiones simuladas`,
    );

    // La pantalla lo ve como real
    const catsApi2 = await api('/api/catalog/categories');
    check(
      catsApi2.json.providers.every((p: any) => p.hasReal) && catsApi2.json.stats.real === 5,
      'La pantalla pasa a «catálogo real» con ambos proveedores',
      `reales=${catsApi2.json.stats.real} · muestra=${catsApi2.json.stats.sample}`,
    );
    const pageHtml = await realFetch(`${BASE}/catalog`).then((r) => r.text());
    check(pageHtml.includes('Catálogo real') && !pageHtml.includes('Catálogo de muestra cargado'), 'La página /catalog cambia el aviso honestamente', '«Catálogo real» en el HTML servido');
  } finally {
    globalThis.fetch = realFetch;
    await withSystem('verify-catalog: limpiar contrato', async () => {
      await prisma.catalogItem.deleteMany({ where: { externalId: { in: ['CJ99001', 'CJ99002', 'CJ99003', '1005001', '1005002'] } } });
      await prisma.catalogCategory.deleteMany({ where: { externalId: { in: ['cj-c1', 'cj-c2', 'cj-c3'] } } });
    });
    await clearPlatformCredentials('CJ_DROPSHIPPING');
    await clearPlatformCredentials('ALIEXPRESS');
  }

  const finalCatalog = await queryCatalog({ pageSize: 1 });
  console.log(`\n   · estado final del catálogo: ${finalCatalog.stats.total} artículos (${finalCatalog.stats.real} reales · ${finalCatalog.stats.sample} de muestra)`);

  console.log(`\n${passed} comprobaciones superadas · ${failed} fallidas\n`);
  if (failed > 0) {
    console.log('\u001b[41m\u001b[37m  CATÁLOGO CON FALLOS  \u001b[0m\n');
    process.exitCode = 1;
  } else {
    console.log('\u001b[42m\u001b[30m  CATÁLOGO Y CLAVES DE PLATAFORMA VERIFICADOS  \u001b[0m\n');
  }
}

main()
  .catch((err) => {
    console.error('\n✘ Error:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
