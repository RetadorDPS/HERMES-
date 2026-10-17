/**
 * src/lib/catalog/memoria.ts — Catálogo de muestra servido DESDE MEMORIA.
 *
 * Se usa cuando no hay base de datos (modo demostración, y la versión estática
 * de GitHub Pages). Es código puro: no toca servidor, así que corre igual en
 * el servidor y en el navegador.
 *
 * Mismas reglas que el catálogo real: filtros, orden, facetas, estadísticas y
 * precio final con la regla de margen del usuario.
 */
import { SAMPLE_CATEGORIES, sampleCatalogItems } from './sample';
import { computeSellingPrice } from '../pricing';
import { supplierProductToScraped } from '../supplier-apis/mapper';
import type { SupplierProduct } from '../supplier-apis/types';
import type { PricingRuleLike, ScrapedProduct } from '../types';
import type { CatalogFacet, CatalogQuery, CatalogResult, CatalogRow } from './index';

const redondear = (n: number) => Math.round(n * 100) / 100;

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60);

const FECHA_BASE = new Date('2026-10-01T09:00:00.000Z');

export const idMuestra = (externalId: string) => `muestra-${externalId}`;

/** Todas las filas de muestra, con la forma que consume la interfaz. */
export function filasDeMuestra(): CatalogRow[] {
  return sampleCatalogItems().map((s) => ({
    id: idMuestra(s.externalId),
    provider: s.provider,
    externalId: s.externalId,
    title: s.title,
    categoryName: s.categoryName,
    imageUrl: s.imageUrl,
    images: [s.imageUrl],
    currency: 'EUR',
    costPrice: s.costPrice,
    stock: s.stock,
    rating: s.rating,
    ordersCount: s.ordersCount,
    shippingCost: s.shippingCost,
    shippingMinDays: s.shippingMinDays,
    shippingMaxDays: s.shippingMaxDays,
    shipFrom: s.shipFrom,
    freeShipping: s.freeShipping,
    isTrending: s.isTrending,
    source: 'sample',
    lastSyncedAt: FECHA_BASE,
    importedCount: 0,
  }));
}

function coincide(f: CatalogRow, q: CatalogQuery, etiquetas: string[]): boolean {
  if (q.provider && q.provider !== 'ALL' && !String(q.provider).split(',').includes(f.provider)) return false;
  if (q.search) {
    const s = q.search.trim().toLowerCase();
    const texto = `${f.title} ${f.categoryName ?? ''}`.toLowerCase();
    if (!texto.includes(s) && !etiquetas.includes(s)) return false;
  }
  if (q.category && q.category !== 'ALL' && f.categoryName !== q.category) return false;
  if (q.minPrice !== undefined && f.costPrice < q.minPrice) return false;
  if (q.maxPrice !== undefined && f.costPrice > q.maxPrice) return false;
  if (q.shipFrom && !String(q.shipFrom).split(',').includes(f.shipFrom ?? '')) return false;
  if (q.freeShipping && !f.freeShipping) return false;
  if (q.trending && !f.isTrending) return false;
  if (q.minRating !== undefined && (f.rating ?? 0) < q.minRating) return false;
  return true;
}

function ordenar(filas: CatalogRow[], sort: CatalogQuery['sort']) {
  const pedidos = (f: CatalogRow) => f.ordersCount ?? 0;
  const nota = (f: CatalogRow) => f.rating ?? 0;
  const copia = [...filas];
  switch (sort) {
    case 'price-asc':
      return copia.sort((a, b) => a.costPrice - b.costPrice || pedidos(b) - pedidos(a));
    case 'price-desc':
      return copia.sort((a, b) => b.costPrice - a.costPrice || pedidos(b) - pedidos(a));
    case 'trending':
      return copia.sort((a, b) => Number(b.isTrending) - Number(a.isTrending) || pedidos(b) - pedidos(a));
    case 'rating':
      return copia.sort((a, b) => nota(b) - nota(a) || pedidos(b) - pedidos(a));
    case 'orders':
      return copia.sort((a, b) => pedidos(b) - pedidos(a));
    case 'newest':
      return copia;
    case 'relevance':
    default:
      return copia.sort((a, b) => pedidos(b) - pedidos(a) || nota(b) - nota(a));
  }
}

/** Añade el precio final y el beneficio con la regla de margen del usuario. */
export function conPrecios(filas: CatalogRow[], q: Pick<CatalogQuery, 'pricingRule'>): CatalogRow[] {
  return filas.map((f) => {
    const envio = f.freeShipping ? 0 : f.shippingCost ?? 0;
    const base: CatalogRow = {
      ...f,
      costPriceEur: f.costPrice,
      shippingCostEur: envio,
      fx: { currency: 'EUR', rate: 1, converted: false },
    };
    if (!q.pricingRule) return base;
    const b = computeSellingPrice(f.costPrice, envio, q.pricingRule as PricingRuleLike, q.pricingRule.name ?? 'default');
    const beneficio = b.sellingPrice - f.costPrice - envio;
    return {
      ...base,
      sellingPrice: b.sellingPrice,
      compareAtPrice: b.compareAtPrice ?? null,
      profit: redondear(beneficio),
      profitMarginPct: redondear((beneficio / Math.max(b.sellingPrice, 0.01)) * 100),
    };
  });
}

/** Consulta completa del catálogo de muestra (misma forma que la consulta real). */
export function consultarCatalogoMemoria(q: CatalogQuery = {}): CatalogResult {
  const todas = filasDeMuestra();
  const etiquetasPorId = new Map(sampleCatalogItems().map((s) => [idMuestra(s.externalId), s.tags.map((t) => t.toLowerCase())]));

  const filtradas = todas.filter((f) => coincide(f, q, etiquetasPorId.get(f.id) ?? []));
  const ordenadas = ordenar(filtradas, q.sort);

  const pagina = Math.max(1, Number(q.page ?? 1));
  const tamano = Math.min(Math.max(Number(q.pageSize ?? 24), 4), 96);
  const trozo = ordenadas.slice((pagina - 1) * tamano, pagina * tamano);

  const conteo = new Map<string, number>();
  for (const f of filtradas) if (f.categoryName) conteo.set(f.categoryName, (conteo.get(f.categoryName) ?? 0) + 1);
  const facetas: CatalogFacet[] = SAMPLE_CATEGORIES.map((c) => ({
    name: c.name,
    slug: slug(c.name),
    count: conteo.get(c.name) ?? 0,
    imageUrl: c.imageUrl,
  })).sort((a, b) => b.count - a.count);

  const porProveedor = new Map<string, number>();
  for (const f of todas) porProveedor.set(f.provider, (porProveedor.get(f.provider) ?? 0) + 1);

  const precios = filtradas.map((f) => f.costPrice);

  return {
    items: conPrecios(trozo, q),
    total: filtradas.length,
    page: pagina,
    pages: Math.max(1, Math.ceil(filtradas.length / tamano)),
    facets: facetas,
    providers: [...porProveedor.entries()].map(([provider, count]) => ({ provider: provider as CatalogRow['provider'], count, hasReal: false })),
    stats: {
      total: todas.length,
      real: 0,
      sample: todas.length,
      lastSyncedAt: null,
      freeShipping: filtradas.filter((f) => f.freeShipping).length,
      trending: filtradas.filter((f) => f.isTrending).length,
    },
    priceRange: { min: precios.length ? Math.min(...precios) : 0, max: precios.length ? Math.max(...precios) : 0 },
    warehouses: [...todas.reduce((m, f) => (f.shipFrom ? m.set(f.shipFrom, (m.get(f.shipFrom) ?? 0) + 1) : m), new Map<string, number>()).entries()].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count),
  };
}

/** Sugerencias del buscador (a partir de 2 letras). */
export function sugerenciasMemoria(term: string, limite = 8) {
  const t = term.trim().toLowerCase();
  if (t.length < 2) return [];
  return ordenar(filasDeMuestra().filter((f) => f.title.toLowerCase().includes(t)), 'orders')
    .slice(0, limite)
    .map((f) => ({ id: f.id, title: f.title, imageUrl: f.imageUrl, costPrice: f.costPrice, provider: f.provider }));
}

function aProductoProveedor(s: ReturnType<typeof sampleCatalogItems>[number]): SupplierProduct {
  return {
    provider: s.provider,
    supplierProductId: s.externalId,
    sourceUrl: `https://${s.provider === 'ALIEXPRESS' ? 'es.aliexpress.com/item' : 'cjdropshipping.com/product/-p-'}${s.externalId}.html`,
    title: s.title,
    description: `<p>${s.title}</p>`,
    category: s.categoryName,
    currency: 'EUR',
    costPrice: s.costPrice,
    stock: s.stock,
    images: [s.imageUrl],
    variants: s.variantTitles.map((title, i) => ({
      supplierVariantId: `${s.externalId}-v${i + 1}`,
      sku: `${s.externalId}-${i + 1}`,
      title,
      color: s.variantTitles.length > 1 ? title : undefined,
      costPrice: s.costPrice,
      stock: Math.round(s.stock / s.variantTitles.length),
      imageUrl: s.imageUrl,
    })),
    shipping: {
      cost: s.shippingCost,
      minDays: s.shippingMinDays,
      maxDays: s.shippingMaxDays,
      country: 'ES',
      methods: [{ name: s.freeShipping ? 'Envío gratis' : 'Envío estándar', cost: s.shippingCost, minDays: s.shippingMinDays, maxDays: s.shippingMaxDays }],
    },
    rating: s.rating,
    orders: s.ordersCount,
    source: 'simulated',
  };
}

/** Detalle de un artículo de muestra, listo para importar. */
export function detalleMuestra(id: string, destino = 'ES') {
  const s = sampleCatalogItems().find((x) => idMuestra(x.externalId) === id);
  if (!s) return null;
  const fila = filasDeMuestra().find((f) => f.id === id)!;
  const scraped: ScrapedProduct = supplierProductToScraped(aProductoProveedor(s), { destinationCountry: destino });
  return { item: conPrecios([fila], {})[0], scraped, description: `<p>${s.title}</p>`, tags: s.tags };
}
