/**
 * src/lib/catalog/index.ts — Motor del catálogo.
 *
 * Qué hace:
 *   • `ensureSampleCatalog()`  → carga (una vez) el catálogo de muestra, para que
 *     la pantalla nunca aparezca vacía.
 *   • `syncCatalog()`          → trae el catálogo real del proveedor con las
 *     claves de la plataforma (CJ por defecto; AliExpress como refuerzo) y lo
 *     guarda en nuestro índice.
 *   • `queryCatalog()`         → sirve la pantalla: filtros, orden, facetas y
 *     estadísticas. Nunca llama al proveedor: siempre responde desde el índice.
 *   • `catalogItemWithPayload()`→ devuelve el producto del índice convertido al
 *     formato de importación, para publicarlo sin volver a extraerlo.
 *
 * Regla de visibilidad: mientras un proveedor no tenga catálogo real, se muestran
 * sus artículos de muestra (marcados como tales). En cuanto hay artículos reales
 * de ese proveedor, la muestra desaparece sola: nadie ve datos de relleno cuando
 * ya hay datos de verdad.
 */
import { prisma, hasDatabase } from '../prisma';
import { withSystem } from '../tenant-context';
import { resolveProviderClient, consumePlatformQuota } from './platform-credentials';
import { SAMPLE_CATEGORIES, sampleCatalogItems } from './sample';
import { consultarCatalogoMemoria, detalleMuestra, sugerenciasMemoria } from './memoria';
import { supplierProductToScraped } from '../supplier-apis/mapper';
import { computeSellingPrice } from '../pricing';
import { fxInfo, toEur } from '../fx';
import type { PricingRuleLike } from '../types';
import type { SupplierProduct } from '../supplier-apis/types';
import type { ScrapedProduct } from '../types';
import type { Prisma, SupplierType } from '@prisma/client';

export type CatalogSort = 'relevance' | 'price-asc' | 'price-desc' | 'newest' | 'trending' | 'rating' | 'orders';

export interface CatalogQuery {
  provider?: SupplierType | 'ALL';
  search?: string;
  category?: string; // categoryName exacto o slug
  minPrice?: number;
  maxPrice?: number;
  shipFrom?: string;
  freeShipping?: boolean;
  trending?: boolean;
  minRating?: number;
  sort?: CatalogSort;
  page?: number;
  pageSize?: number;
  /**
   * Regla de margen del usuario que consulta. Es lo que permite mostrar en cada
   * tarjeta el «precio final» y el beneficio que ÉL ganaría, calculados con el
   * mismo motor que luego usa la importación (nada de cuentas paralelas).
   */
  pricingRule?: (PricingRuleLike & { id?: string; name?: string }) | null;
}

export interface CatalogFacet {
  name: string;
  slug: string;
  count: number;
  imageUrl: string | null;
}

/** Registro del índice tal y como lo consume la interfaz. */
export interface CatalogRow {
  id: string;
  provider: SupplierType;
  externalId: string;
  title: string;
  categoryName: string | null;
  imageUrl: string | null;
  images: string[];
  currency: string;
  costPrice: number;
  stock: number;
  rating: number | null;
  ordersCount: number | null;
  shippingCost: number | null;
  shippingMinDays: number | null;
  shippingMaxDays: number | null;
  /** Coste de envío convertido a euros */
  shippingCostEur?: number;
  shipFrom: string | null;
  freeShipping: boolean;
  isTrending: boolean;
  source: string;
  lastSyncedAt: Date;
  importedCount?: number;
  /** Coste convertido a euros (la divisa de la tienda) */
  costPriceEur?: number;
  /** Tipo de cambio aplicado, si se convirtió */
  fx?: { currency: string; rate: number; converted: boolean; unknown?: boolean };
  /** Precio de venta y beneficio con la regla del usuario (si se pasó) */
  sellingPrice?: number;
  compareAtPrice?: number | null;
  profit?: number;
  profitMarginPct?: number;
}

const CATEGORY_IMAGES: Record<string, string> = Object.fromEntries(SAMPLE_CATEGORIES.map((c) => [c.name, c.imageUrl]));

/* ────────────────────────────── MUESTRA ────────────────────────────── */

/** Carga el catálogo de muestra si aún no está (idempotente). */
export async function ensureSampleCatalog(): Promise<{ inserted: boolean; items: number }> {
  if (!hasDatabase()) return { inserted: false, items: 0 };

  const existing = await withSystem('catálogo: comprobar muestra', () =>
    prisma.catalogItem.count({ where: { source: 'sample' } }),
  ).catch(() => 0);
  if (existing > 0) return { inserted: false, items: existing };

  const items = sampleCatalogItems();

  await withSystem('catálogo: cargar muestra', async () => {
    // Categorías (una fila por categoría de muestra, en ambos proveedores)
    for (const [i, cat] of SAMPLE_CATEGORIES.entries()) {
      for (const provider of ['CJ_DROPSHIPPING', 'ALIEXPRESS'] as SupplierType[]) {
        await prisma.catalogCategory.upsert({
          where: { provider_externalId: { provider, externalId: `sample-${cat.slug}` } },
          update: { name: cat.name, slug: cat.slug, imageUrl: cat.imageUrl, sortOrder: i },
          create: {
            provider,
            externalId: `sample-${cat.slug}`,
            name: cat.name,
            slug: cat.slug,
            imageUrl: cat.imageUrl,
            sortOrder: i,
          },
        });
      }
    }

    for (const item of items) {
      const payload = sampleToSupplierProduct(item);
      await prisma.catalogItem.upsert({
        where: { provider_externalId: { provider: item.provider, externalId: item.externalId } },
        update: {},
        create: {
          provider: item.provider,
          externalId: item.externalId,
          title: item.title,
          description: `<p>${item.title}</p>`,
          categoryName: item.categoryName,
          imageUrl: item.imageUrl,
          images: [item.imageUrl],
          currency: 'EUR',
          costPrice: item.costPrice,
          stock: item.stock,
          rating: item.rating,
          ordersCount: item.ordersCount,
          shippingCost: item.shippingCost,
          shippingMinDays: item.shippingMinDays,
          shippingMaxDays: item.shippingMaxDays,
          shipFrom: item.shipFrom,
          freeShipping: item.freeShipping,
          isTrending: item.isTrending,
          tags: item.tags,
          rawPayload: payload as unknown as Prisma.InputJsonValue,
          sourceUrl: `https://${item.provider === 'ALIEXPRESS' ? 'es.aliexpress.com/item' : 'cjdropshipping.com/product/-p-'}${item.externalId}.html`,
          source: 'sample',
        },
      });
    }
  });

  return { inserted: true, items: items.length };
}

function sampleToSupplierProduct(item: ReturnType<typeof sampleCatalogItems>[number]): SupplierProduct {
  return {
    provider: item.provider,
    supplierProductId: item.externalId,
    sourceUrl: `https://${item.provider === 'ALIEXPRESS' ? 'es.aliexpress.com/item' : 'cjdropshipping.com/product/-p-'}${item.externalId}.html`,
    title: item.title,
    description: `<p>${item.title}</p>`,
    category: item.categoryName,
    currency: 'EUR',
    costPrice: item.costPrice,
    stock: item.stock,
    images: [item.imageUrl],
    variants: item.variantTitles.map((title, i) => ({
      supplierVariantId: `${item.externalId}-v${i + 1}`,
      sku: `${item.externalId}-${i + 1}`,
      title,
      color: item.variantTitles.length > 1 ? title : undefined,
      costPrice: item.costPrice,
      stock: Math.round(item.stock / item.variantTitles.length),
      imageUrl: item.imageUrl,
    })),
    shipping: {
      cost: item.shippingCost,
      minDays: item.shippingMinDays,
      maxDays: item.shippingMaxDays,
      country: 'ES',
      methods: [{ name: item.freeShipping ? 'Envío gratis' : 'Envío estándar', cost: item.shippingCost, minDays: item.shippingMinDays, maxDays: item.shippingMaxDays }],
    },
    rating: item.rating,
    orders: item.ordersCount,
    source: 'simulated',
  };
}

/* ────────────────────────────── SINCRONIZACIÓN REAL ────────────────────────────── */

export interface SyncCatalogOptions {
  provider?: SupplierType;
  /** Palabras clave (si se omite, se traen los más vendidos/listados) */
  keyword?: string;
  /** Cuántas páginas descargar (50-100 productos por página) */
  pages?: number;
  /** Sincronizar también categorías */
  categories?: boolean;
  /** Id de categoría del proveedor */
  categoryId?: string;
  pageSize?: number;
}

export async function syncCatalog(opts: SyncCatalogOptions = {}) {
  const providers: SupplierType[] = opts.provider ? [opts.provider] : ['CJ_DROPSHIPPING', 'ALIEXPRESS'];
  const report: { provider: SupplierType; ok: boolean; items: number; categories: number; message: string; source?: string }[] = [];

  for (const provider of providers) {
    const resolved = await resolveProviderClient(null, provider);
    if (!resolved) {
      report.push({ provider, ok: false, items: 0, categories: 0, message: `Sin claves para ${provider}: configura las de la plataforma o las variables de entorno` });
      continue;
    }

    const client: any = resolved.client;
    let items: SupplierProduct[] = [];
    let categories = 0;
    let message = '';

    try {
      if (opts.categories && typeof client.listCategories === 'function') {
        const list = await client.listCategories().catch(() => []);
        const now = new Date();
        for (const [i, cat] of list.slice(0, 120).entries()) {
          const slug = slugifyCatalog(cat.name);
          await withSystem('catálogo: guardar categoría', () =>
            prisma.catalogCategory.upsert({
              where: { provider_externalId: { provider, externalId: String(cat.id) } },
              update: { name: cat.name, slug, parentName: cat.parentName ?? null, sortOrder: i, updatedAt: now },
              create: { provider, externalId: String(cat.id), name: cat.name, slug, parentName: cat.parentName ?? null, sortOrder: i },
            }),
          );
          categories += 1;
        }
      }

      const pages = Math.max(1, Math.min(opts.pages ?? 1, 10));
      // CJ permite 1 petición por segundo: se descarga con calma a propósito,
      // así no se gasta el límite ni se recibe un 429 a mitad de la descarga.
      const pauseMs = provider === 'CJ_DROPSHIPPING' ? Number(process.env.CATALOG_QPS_DELAY_MS ?? 1_200) : 0;
      for (let page = 1; page <= pages; page += 1) {
        if (page > 1 && pauseMs > 0) await new Promise((r) => setTimeout(r, pauseMs));

        // Cuota de la plataforma: si el operador puso un tope mensual, se respeta
        // aquí (antes de gastar la llamada, no después).
        const quota = await consumePlatformQuota(provider, 1);
        if (!quota.ok) {
          message = `Cuota mensual de ${provider} agotada (${quota.used}/${quota.limit}): la descarga se detiene aquí`;
          break;
        }
        let batch: SupplierProduct[] = [];
        if (provider === 'CJ_DROPSHIPPING' && typeof client.listProducts === 'function') {
          batch = await client.listProducts({
            keyword: opts.keyword,
            page,
            size: opts.pageSize ?? 50,
            categoryId: opts.categoryId,
            countryCode: 'ES',
            orderBy: opts.keyword ? 0 : 2,
          });
        } else if (provider === 'ALIEXPRESS' && typeof client.fetchFeed === 'function') {
          batch = await client.fetchFeed({ page, pageSize: opts.pageSize ?? 50, categoryId: opts.categoryId });
        } else {
          message = `El cliente de ${provider} no soporta listado de catálogo`;
          break;
        }
        items = items.concat(batch);
        if (batch.length === 0) break;
      }

      const saved = await upsertCatalogItems(provider, items, 'api');
      message = message || `${items.length} recibidos · ${saved} guardados`;
      report.push({ provider, ok: true, items: saved, categories, message, source: resolved.source });
    } catch (err) {
      report.push({ provider, ok: false, items: 0, categories, message: (err as Error).message, source: resolved.source });
    }
  }

  return { ok: report.some((r) => r.ok), report, at: new Date() };
}

/** Guarda/actualiza artículos del proveedor en el índice. */
export async function upsertCatalogItems(provider: SupplierType, items: SupplierProduct[], source: 'api' | 'sample'): Promise<number> {
  let saved = 0;
  for (const item of items) {
    if (!item.supplierProductId) continue;
    const images = (item.images ?? []).filter(Boolean).slice(0, 8);
    const data = {
      title: item.title?.slice(0, 250) ?? 'Producto',
      description: (item.description ?? '').slice(0, 5000),
      categoryName: item.category ?? null,
      imageUrl: images[0] ?? null,
      images,
      currency: item.currency ?? 'EUR',
      costPrice: Number(item.costPrice ?? 0),
      stock: Number(item.stock ?? 0),
      rating: item.rating ?? null,
      ordersCount: item.orders ?? null,
      shippingCost: item.shipping?.cost ?? null,
      shippingMinDays: item.shipping?.minDays ?? null,
      shippingMaxDays: item.shipping?.maxDays ?? null,
      shipFrom: item.shipping?.country ?? null,
      freeShipping: (item.shipping?.cost ?? 0) === 0,
      isTrending: (item.orders ?? 0) > 5000,
      tags: [] as string[],
      rawPayload: item as unknown as Prisma.InputJsonValue,
      sourceUrl: item.sourceUrl,
      source,
      lastSyncedAt: new Date(),
    };

    await withSystem('catálogo: guardar artículo', () =>
      prisma.catalogItem.upsert({
        where: { provider_externalId: { provider, externalId: item.supplierProductId } },
        update: data,
        create: { provider, externalId: item.supplierProductId, ...data },
      }),
    ).catch(() => undefined);
    saved += 1;
  }
  return saved;
}

function slugifyCatalog(s: string) {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60);
}

/* ────────────────────────────── CONSULTA ────────────────────────────── */

/** Fuentes visibles por proveedor: real si la hay, muestra mientras no la haya. */
async function visibleSources(): Promise<Record<string, string[]>> {
  const grouped = await withSystem('catálogo: calcular visibilidad', () =>
    prisma.catalogItem.groupBy({ by: ['provider', 'source'], _count: { _all: true } }),
  ).catch(() => [] as any[]);

  const byProvider: Record<string, string[]> = {};
  for (const g of grouped as any[]) {
    const provider = String(g.provider);
    byProvider[provider] = byProvider[provider] ?? [];
    byProvider[provider].push(String(g.source));
  }

  const result: Record<string, string[]> = {};
  for (const [provider, sources] of Object.entries(byProvider)) {
    // En cuanto un proveedor tiene catálogo REAL, su muestra desaparece por
    // completo: así nunca se mezclan productos de verdad con datos de relleno.
    result[provider] = sources.includes('api') ? ['api'] : sources;
  }
  return result;
}

function buildWhere(q: CatalogQuery, sources: Record<string, string[]>, onlyCounts = false) {
  const and: any[] = [];

  // `provider` puede traer varios proveedores separados por comas (por ejemplo «CJ_DROPSHIPPING,ALIEXPRESS»)
  const providerFilter = q.provider && q.provider !== 'ALL' ? String(q.provider).split(',').filter(Boolean) : Object.keys(sources);
  const providerClauses = providerFilter
    .filter((p) => sources[p]?.length)
    .map((p) => ({ provider: p as SupplierType, source: { in: sources[p] } }));
  if (providerClauses.length) and.push({ OR: providerClauses });

  if (q.search) {
    const s = q.search.trim();
    and.push({
      OR: [
        { title: { contains: s, mode: 'insensitive' } },
        { categoryName: { contains: s, mode: 'insensitive' } },
        { description: { contains: s, mode: 'insensitive' } },
        { tags: { has: s.toLowerCase() } },
      ],
    });
  }
  if (q.category && q.category !== 'ALL') and.push({ categoryName: q.category });
  if (q.minPrice !== undefined) and.push({ costPrice: { gte: q.minPrice } });
  if (q.maxPrice !== undefined) and.push({ costPrice: { lte: q.maxPrice } });
  if (q.shipFrom) and.push({ shipFrom: q.shipFrom });
  if (q.freeShipping) and.push({ freeShipping: true });
  if (q.trending) and.push({ isTrending: true });
  if (q.minRating !== undefined) and.push({ rating: { gte: q.minRating } });

  if (onlyCounts) return and.length ? { AND: and } : {};
  return and.length ? { AND: and } : {};
}

function orderFor(sort: CatalogSort | undefined): Prisma.CatalogItemOrderByWithRelationInput[] {
  switch (sort) {
    case 'price-asc':
      return [{ costPrice: 'asc' }, { ordersCount: 'desc' }];
    case 'price-desc':
      return [{ costPrice: 'desc' }, { ordersCount: 'desc' }];
    case 'newest':
      return [{ createdAt: 'desc' }];
    case 'trending':
      return [{ isTrending: 'desc' }, { ordersCount: 'desc' }];
    case 'rating':
      return [{ rating: 'desc' }, { ordersCount: 'desc' }];
    case 'orders':
      return [{ ordersCount: 'desc' }];
    case 'relevance':
    default:
      return [{ ordersCount: 'desc' }, { rating: 'desc' }, { views: 'desc' }];
  }
}

export interface CatalogResult {
  items: CatalogRow[];
  total: number;
  page: number;
  pages: number;
  facets: CatalogFacet[];
  providers: { provider: SupplierType; count: number; hasReal: boolean }[];
  stats: { total: number; real: number; sample: number; lastSyncedAt: Date | null; freeShipping: number; trending: number };
  priceRange: { min: number; max: number };
}

export async function queryCatalog(q: CatalogQuery = {}): Promise<CatalogResult> {
  const empty: CatalogResult = {
    items: [],
    total: 0,
    page: 1,
    pages: 1,
    facets: [],
    providers: [],
    stats: { total: 0, real: 0, sample: 0, lastSyncedAt: null, freeShipping: 0, trending: 0 },
    priceRange: { min: 0, max: 0 },
  };
  // Sin base de datos: se sirve el catálogo de muestra desde memoria (modo demostración)
  if (!hasDatabase()) return consultarCatalogoMemoria(q) ?? empty;

  await ensureSampleCatalog();
  const sources = await visibleSources();
  const where = buildWhere(q, sources);

  const page = Math.max(1, Number(q.page ?? 1));
  const pageSize = Math.min(Math.max(Number(q.pageSize ?? 24), 4), 96);

  const [rows, total, grouped, aggregate] = await withSystem('catálogo: consultar', async () => {
    return Promise.all([
      prisma.catalogItem.findMany({ where, orderBy: orderFor(q.sort), skip: (page - 1) * pageSize, take: pageSize }),
      prisma.catalogItem.count({ where }),
      prisma.catalogItem.groupBy({ by: ['categoryName'], where, _count: { _all: true }, orderBy: { _count: { categoryName: 'desc' } }, take: 40 }),
      prisma.catalogItem.aggregate({ where, _min: { costPrice: true }, _max: { costPrice: true }, _count: { _all: true } }),
    ]);
  });

  // Facetas de categoría (incluye las de muestra siempre, para que la navegación
  // visual esté completa desde el primer día)
  const counts = new Map<string, number>();
  for (const g of grouped as any[]) if (g.categoryName) counts.set(String(g.categoryName), Number(g._count?._all ?? 0));
  const facetNames = new Set<string>([...SAMPLE_CATEGORIES.map((c) => c.name), ...counts.keys()]);
  const facets: CatalogFacet[] = [...facetNames]
    .map((name) => ({ name, slug: slugifyCatalog(name), count: counts.get(name) ?? 0, imageUrl: CATEGORY_IMAGES[name] ?? null }))
    .sort((a, b) => b.count - a.count);

  // Estadísticas globales (sin filtros) y por proveedor
  const globalGrouped = await withSystem('catálogo: estadísticas', () =>
    prisma.catalogItem.groupBy({ by: ['provider', 'source'], _count: { _all: true }, _max: { lastSyncedAt: true } }),
  ).catch(() => [] as any[]);

  let real = 0;
  let sample = 0;
  let lastSyncedAt: Date | null = null;
  const providersMap = new Map<string, { count: number; hasReal: boolean }>();
  for (const g of globalGrouped as any[]) {
    const p = String(g.provider);
    const n = Number(g._count?._all ?? 0);
    const entry = providersMap.get(p) ?? { count: 0, hasReal: false };
    entry.count += n;
    if (String(g.source) === 'api') entry.hasReal = true;
    providersMap.set(p, entry);
    if (String(g.source) === 'api') real += n;
    if (String(g.source) === 'sample') sample += n;
    const max = g._max?.lastSyncedAt as Date | null;
    if (String(g.source) === 'api' && max && (!lastSyncedAt || max > lastSyncedAt)) lastSyncedAt = max;
  }

  const [freeShippingCount, trendingCount] = await Promise.all([
    withSystem('catálogo: contar envío gratis', () => prisma.catalogItem.count({ where: { freeShipping: true, ...(Object.keys(where).length ? { AND: [where] } : {}) } })).catch(() => 0),
    withSystem('catálogo: contar tendencias', () => prisma.catalogItem.count({ where: { isTrending: true, ...(Object.keys(where).length ? { AND: [where] } : {}) } })).catch(() => 0),
  ]);

  const withPricing = rows.map((row) => {
    const base = toRow(row);
    // Conversión de divisa: CJ y muchas tiendas devuelven USD; el motor de
    // precios trabaja en EUR, así que se convierte ANTES de calcular nada.
    const info = fxInfo(base.currency);
    const costEur = toEur(base.costPrice, base.currency);
    const shippingRaw = base.freeShipping ? 0 : base.shippingCost ?? 0;
    const shippingEur = toEur(shippingRaw, base.currency);
    const converted = { ...base, costPriceEur: costEur, shippingCostEur: shippingEur, fx: info };
    if (!q.pricingRule) return converted;

    const b = computeSellingPrice(costEur, shippingEur, q.pricingRule, q.pricingRule.name ?? 'default');
    return {
      ...converted,
      sellingPrice: b.sellingPrice,
      compareAtPrice: b.compareAtPrice ?? null,
      profit: roundPrice(b.sellingPrice - costEur - shippingEur),
      profitMarginPct: roundPrice(((b.sellingPrice - costEur - shippingEur) / Math.max(b.sellingPrice, 0.01)) * 100),
    };
  });

  return {
    items: withPricing,
    total,
    page,
    pages: Math.max(1, Math.ceil(total / pageSize)),
    facets,
    providers: [...providersMap.entries()].map(([provider, v]) => ({ provider: provider as SupplierType, count: v.count, hasReal: v.hasReal })),
    stats: {
      total: real + sample,
      real,
      sample,
      lastSyncedAt,
      freeShipping: freeShippingCount,
      trending: trendingCount,
    },
    priceRange: { min: Number(aggregate._min.costPrice ?? 0), max: Number(aggregate._max.costPrice ?? 0) },
  };
}

const roundPrice = (n: number) => Math.round(n * 100) / 100;

function toRow(item: any): CatalogRow {
  return {
    id: item.id,
    provider: item.provider,
    externalId: item.externalId,
    title: item.title,
    categoryName: item.categoryName,
    imageUrl: item.imageUrl,
    images: item.images ?? [],
    currency: item.currency,
    costPrice: Number(item.costPrice),
    stock: item.stock,
    rating: item.rating === null ? null : Number(item.rating),
    ordersCount: item.ordersCount,
    shippingCost: item.shippingCost === null ? null : Number(item.shippingCost),
    shippingMinDays: item.shippingMinDays,
    shippingMaxDays: item.shippingMaxDays,
    shipFrom: item.shipFrom,
    freeShipping: item.freeShipping,
    isTrending: item.isTrending,
    source: item.source,
    lastSyncedAt: item.lastSyncedAt,
    importedCount: item.importedCount ?? 0,
  };
}

/** Detalle de un artículo, con vistas incrementadas y el payload de importación. */
export async function catalogItemWithPayload(id: string, opts: { destinationCountry?: string } = {}) {
  if (!hasDatabase()) {
    const d = detalleMuestra(id, opts.destinationCountry ?? 'ES');
    return d ? { item: d.item, scraped: d.scraped, description: d.description, tags: d.tags, raw: null as any } : null;
  }
  const item = await withSystem('catálogo: leer artículo', () => prisma.catalogItem.findUnique({ where: { id } }));
  if (!item) return null;

  withSystem('catálogo: contar vista', () => prisma.catalogItem.update({ where: { id }, data: { views: { increment: 1 } } })).catch(() => undefined);

  const payload = item.rawPayload as unknown as SupplierProduct;
  const scraped: ScrapedProduct = supplierProductToScraped(payload, { destinationCountry: opts.destinationCountry ?? 'ES' });

  return { item: toRow(item), scraped, description: item.description ?? '', tags: item.tags, raw: item };
}

/** Sugerencias de búsqueda a partir del índice (ciudades rápidas del buscador). */
export async function catalogSuggestions(term: string, limit = 8) {
  if (!hasDatabase()) return sugerenciasMemoria(term, limit);
  if (term.trim().length < 2) return [];
  const rows = await withSystem('catálogo: sugerencias', () =>
    prisma.catalogItem.findMany({
      where: { title: { contains: term.trim(), mode: 'insensitive' } },
      orderBy: [{ ordersCount: 'desc' }],
      take: limit,
      select: { id: true, title: true, imageUrl: true, costPrice: true, provider: true },
    }),
  ).catch(() => []);
  return rows.map((r: any) => ({ ...r, costPrice: Number(r.costPrice) }));
}
