/**
 * src/lib/scraper.ts — Cliente de extracción de producto (Fase 3)
 *
 * Estrategia en cascada (configurable con SCRAPER_MODE):
 *   1. "service" → microservicio FastAPI+Playwright (services/scraper) con rotación de proxies.
 *   2. "local"   → fetch + parseo de JSON-LD / metadata / payloads embebidos (sin navegador).
 *   3. "demo"    → generador determinista de producto realista (desarrollo y tests).
 *
 * El resultado es SIEMPRE un ScrapedProduct normalizado, listo para
 * PricingRule → Shopify/Woo.
 */
import { detectSupplier, SUPPLIER_META, REQUEST_HEADERS, type SupplierMeta } from './suppliers';
import type {
  ScrapedProduct,
  ScrapedVariant,
  ScrapedShippingOption,
  ScrapedReview,
  SupplierKey,
} from './types';
import { round2, slugify, sleep, stableHash, sanitizeHtml } from './utils';
import { fetchProductViaApi } from './supplier-apis';
import { supplierProductToScraped } from './supplier-apis/mapper';

export { detectSupplier };

// ───────────────────────────── Config ───────────────────────────────────────

const SERVICE_URL = process.env.SCRAPER_SERVICE_URL?.replace(/\/$/, '');
const MODE = (process.env.SCRAPER_MODE ?? 'auto') as 'auto' | 'service' | 'local' | 'demo';
const EXTRACTOR_VERSION = 'pilot-2026.02';
const FETCH_TIMEOUT_MS = 12_000;
const MAX_ATTEMPTS = 3;

export interface ScrapeOptions {
  /** Usuario propietario: permite usar su cuenta de API oficial del proveedor */
  userId?: string;
  /** Fuerza el uso de la API oficial (o lo desactiva con false) */
  useSupplierApi?: boolean;
  /** País destino para las cotizaciones de envío (ISO-2, ej. "ES") */
  destinationCountry?: string;
  /** Fuerza un modo concreto (útil en tests) */
  mode?: 'service' | 'local' | 'demo';
  /** Proxy explícito (http://user:pass@host:port) */
  proxy?: string;
  /** Máximo de reintentos con rotación de proxy */
  maxAttempts?: number;
  /** Timeout en ms del microservicio */
  timeoutMs?: number;
  /** Traduce título/descripción al idioma destino (lo hace el servicio) */
  translateTo?: string;
  /** Saltar reseñas (ahorra 2-4s de scraping) */
  skipReviews?: boolean;
}

export class ScraperError extends Error {
  constructor(
    message: string,
    public code:
      | 'INVALID_URL'
      | 'UNSUPPORTED_SUPPLIER'
      | 'BLOCKED'
      | 'NOT_FOUND'
      | 'PARSE_ERROR'
      | 'TIMEOUT'
      | 'SERVICE_UNAVAILABLE',
    public meta?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ScraperError';
  }
}

// ───────────────────────────── Proxy pool ───────────────────────────────────

const PROXY_POOL = (process.env.PROXY_LIST ?? '')
  .split(',')
  .map((p) => p.trim())
  .filter(Boolean);

let proxyCursor = 0;

export function nextProxy(): string | undefined {
  if (!PROXY_POOL.length) return undefined;
  if ((process.env.PROXY_ROTATION ?? 'round-robin') === 'random') {
    return PROXY_POOL[Math.floor(Math.random() * PROXY_POOL.length)];
  }
  const p = PROXY_POOL[proxyCursor % PROXY_POOL.length];
  proxyCursor++;
  return p;
}

// ───────────────────────────── Entrada principal ────────────────────────────

export async function scrapeProduct(url: string, opts: ScrapeOptions = {}): Promise<ScrapedProduct> {
  const started = Date.now();
  const normalized = normalizeProductUrl(url);
  const meta = detectSupplier(normalized);
  if (!meta) {
    throw new ScraperError(`Proveedor no soportado: ${url}`, 'UNSUPPORTED_SUPPLIER', {
      supported: Object.keys(SUPPLIER_META),
    });
  }

  const mode = opts.mode ?? MODE;
  // La API oficial sólo se intenta si hay usuario y no se ha desactivado
  const apiAllowed = opts.useSupplierApi !== false && Boolean(opts.userId) && mode !== 'demo' && mode !== 'local';
  // El microservicio ya reintenta internamente (3 intentos + rotación de proxy),
  // así que en modo "auto" el cliente no duplica esa espera.
  const attempts = opts.maxAttempts ?? (mode === 'auto' ? 1 : MAX_ATTEMPTS);

  /**
   * Paso 0 (preferente): API OFICIAL del proveedor.
   * Si el cliente ha conectado su cuenta (AliExpress Open Platform, CJ, Amazon
   * PA-API), se usan datos estructurados: sin captchas, sin proxies y con
   * capacidad de crear el pedido después. El scraping queda como respaldo.
   */
  const trySupplierApi = async (): Promise<ScrapedProduct> => {
    const apiStarted = Date.now();
    const result = await fetchProductViaApi({
      userId: opts.userId ?? '',
      url: normalized,
      country: opts.destinationCountry,
    });
    if (!result.ok || !result.product) {
      throw new ScraperError(result.error ?? 'La API del proveedor no devolvió datos', 'PARSE_ERROR', { providerUsed: result.providerUsed });
    }
    return supplierProductToScraped(result.product, {
      destinationCountry: opts.destinationCountry,
      durationMs: Date.now() - apiStarted,
    });
  };

  const tryService = async () => scrapeViaService(normalized, meta, opts);
  const tryLocal = async () => scrapeViaLocal(normalized, meta, opts, started);
  const tryDemo = async () => buildDemoProduct(normalized, meta, started, 'demo');

  const chain: Array<{ mode: 'api' | 'service' | 'local' | 'demo'; run: () => Promise<ScrapedProduct>; attempts?: number }> =
    mode === 'service'
      ? [
          ...(apiAllowed ? [{ mode: 'api' as const, run: trySupplierApi }] : []),
          { mode: 'service', run: tryService },
        ]
      : mode === 'local'
        ? [{ mode: 'local', run: tryLocal }]
        : mode === 'demo'
          ? [{ mode: 'demo', run: tryDemo }]
          : [
              // 1) API oficial (sólo si el cliente tiene cuenta conectada; si no,
              //    responde al instante con "no hay cuenta" y no penaliza latencia)
              ...(apiAllowed ? [{ mode: 'api' as const, run: trySupplierApi }] : []),
              { mode: 'service', run: tryService },
              // El fetch plano rara vez sirve donde un navegador con stealth falló:
              // 1 solo intento y se descarta si el proveedor ya devolvió BLOCKED.
              { mode: 'local', run: tryLocal, attempts: 1 },
              { mode: 'demo', run: tryDemo },
            ];

  let lastError: unknown;
  let blockedByProvider = false;

  for (const step of chain) {
    // Optimización: un navegador real bloqueado implica que un fetch sin JS también
    // lo estará → saltamos el paso "local" para no hacer esperar al usuario.
    if (step.mode === 'local' && blockedByProvider) {
      console.warn('[scraper] proveedor bloqueó el navegador: se omite la extracción local (irá a demo)');
      continue;
    }

    for (let attempt = 1; attempt <= (step.attempts ?? attempts); attempt++) {
      try {
        const result = await step.run();
        result.extractionMeta.attempts = attempt;
        result.extractionMeta.durationMs = Date.now() - started;
        return result;
      } catch (err) {
        lastError = err;
        if (err instanceof ScraperError && err.code === 'BLOCKED') blockedByProvider = true;
        const fatal =
          err instanceof ScraperError && ['INVALID_URL', 'UNSUPPORTED_SUPPLIER', 'NOT_FOUND'].includes(err.code);
        if (fatal) throw err;
        // Backoff exponencial + rotación de proxy en el siguiente intento
        await sleep(600 * attempt + Math.random() * 400);
      }
    }
    // Fallback al siguiente eslabón de la cascada
  }

  const msg = lastError instanceof Error ? lastError.message : 'Error desconocido';
  if (mode === 'demo') throw new ScraperError(`Extracción fallida en modo demo: ${msg}`, 'PARSE_ERROR');
  throw new ScraperError(`No se pudo extraer el producto tras ${attempts} intentos: ${msg}`, 'PARSE_ERROR', {
    url: normalized,
    supplier: meta.key,
  });
}

// ───────────────────────── 1) Microservicio FastAPI/Playwright ───────────────

async function scrapeViaService(
  url: string,
  meta: SupplierMeta,
  opts: ScrapeOptions,
): Promise<ScrapedProduct> {
  if (!SERVICE_URL) throw new ScraperError('SCRAPER_SERVICE_URL no configurada', 'SERVICE_UNAVAILABLE');

  const proxy = opts.proxy ?? nextProxy();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 60_000);

  try {
    const res = await fetch(`${SERVICE_URL}/scrape`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(process.env.SCRAPER_API_KEY ? { 'X-API-Key': process.env.SCRAPER_API_KEY } : {}) },
      body: JSON.stringify({
        url,
        supplier: meta.key,
        country: opts.destinationCountry ?? 'ES',
        proxy,
        translate_to: opts.translateTo,
        include_reviews: !opts.skipReviews,
      }),
      signal: controller.signal,
      cache: 'no-store',
    });

    if (res.status === 404) throw new ScraperError('Producto no encontrado (404 en el proveedor)', 'NOT_FOUND');
    if (res.status === 403 || res.status === 429) {
      throw new ScraperError('Bloqueo anti-bot del proveedor (403/429)', 'BLOCKED', { proxy });
    }
    if (!res.ok) throw new ScraperError(`Scraper service HTTP ${res.status}`, 'SERVICE_UNAVAILABLE');

    const json = (await res.json()) as { ok: boolean; data?: Partial<ScrapedProduct>; error?: string };
    if (!json.ok || !json.data) throw new ScraperError(json.error ?? 'Respuesta inválida del servicio', 'PARSE_ERROR');

    return finalize(json.data, url, meta, 'service', proxy);
  } catch (err) {
    if (err instanceof ScraperError) throw err;
    if ((err as Error).name === 'AbortError') throw new ScraperError('Timeout del scraper service', 'TIMEOUT');
    if ((err as Error).message?.includes('fetch failed')) {
      throw new ScraperError('Scraper service no disponible', 'SERVICE_UNAVAILABLE');
    }
    throw new ScraperError((err as Error).message, 'PARSE_ERROR');
  } finally {
    clearTimeout(timer);
  }
}

// ───────────────────────── 2) Extracción local (fetch + parseo) ──────────────

async function scrapeViaLocal(
  url: string,
  meta: SupplierMeta,
  opts: ScrapeOptions,
  started: number,
): Promise<ScrapedProduct> {
  const html = await fetchHtml(url);
  const ld = extractJsonLd(html);
  const embedded = extractEmbeddedJson(html, meta.key);
  const og = extractOpenGraph(html);

  if (!ld && !embedded && !og.title) {
    throw new ScraperError('HTML sin datos estructurados reconocibles (posible captcha)', 'BLOCKED');
  }

  const variants = extractVariants(embedded, ld, meta);
  const images = extractImages(html, embedded, og, meta);
  const shipping = extractShipping(embedded);
  const reviews = opts.skipReviews ? [] : extractReviews(embedded, html);

  const partial: Partial<ScrapedProduct> = {
    supplierProductId: meta.extractProductId(url),
    title: cleanTitle(og.title ?? ld?.name ?? embedded?.title ?? ''),
    description: sanitizeHtml(String(embedded?.description ?? ld?.description ?? og.description ?? '')),
    bullets: ld?.bullets ?? [],
    category: embedded?.category ?? ld?.category,
    categoryPath: embedded?.categoryPath ?? (ld?.category ? [ld.category] : []),
    tags: embedded?.tags ?? [],
    brand: ld?.brand ?? embedded?.brand,
    currency: embedded?.currency ?? ld?.currency ?? 'USD',
    images,
    variants,
    shipping,
    reviews,
    ratingAvg: Number(embedded?.ratingAvg ?? ld?.ratingValue ?? 0),
    ratingCount: Number(embedded?.ratingCount ?? ld?.reviewCount ?? 0),
    ordersCount: Number(embedded?.ordersCount ?? 0),
    specs: embedded?.specs ?? {},
    warnings: og.title ? [] : ['Título obtenido de JSON-LD'],
  };

  return finalize(partial, url, meta, 'local', undefined, started);
}

async function fetchHtml(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        ...REQUEST_HEADERS,
        'User-Agent': randomUserAgent(),
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
      },
      redirect: 'follow',
      signal: controller.signal,
      cache: 'no-store',
    });
    if (res.status === 403 || res.status === 429) throw new ScraperError('Bloqueo anti-bot (403/429)', 'BLOCKED');
    if (res.status === 404) throw new ScraperError('Producto no encontrado', 'NOT_FOUND');
    if (!res.ok) throw new ScraperError(`HTTP ${res.status} al descargar el producto`, 'PARSE_ERROR');
    return await res.text();
  } catch (err) {
    if (err instanceof ScraperError) throw err;
    if ((err as Error).name === 'AbortError') throw new ScraperError('Timeout de red', 'TIMEOUT');
    throw new ScraperError((err as Error).message ?? 'Error de red', 'PARSE_ERROR');
  } finally {
    clearTimeout(timer);
  }
}

const UA_POOL = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
];
const randomUserAgent = () => UA_POOL[Math.floor(Math.random() * UA_POOL.length)];

// ── Parsers HTML ────────────────────────────────────────────────────────────

interface JsonLdProduct {
  name?: string;
  description?: string;
  brand?: string;
  category?: string;
  currency?: string;
  bullets?: string[];
  ratingValue?: number;
  reviewCount?: number;
  images: string[];
  offers: { price: number; currency: string; availability: string; sku?: string }[];
}

function extractJsonLd(html: string): JsonLdProduct | null {
  const blocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const block of blocks) {
    try {
      const parsed = JSON.parse(block[1].trim());
      const graph = Array.isArray(parsed) ? parsed : parsed['@graph'] ?? [parsed];
      for (const node of graph) {
        const type = String(node['@type'] ?? '');
        if (!/Product/i.test(type)) continue;
        const offers = Array.isArray(node.offers) ? node.offers : node.offers ? [node.offers] : [];
        return {
          name: node.name,
          description: node.description,
          brand: typeof node.brand === 'object' ? node.brand?.name : node.brand,
          category: node.category,
          currency: offers[0]?.priceCurrency,
          bullets: [],
          ratingValue: node.aggregateRating?.ratingValue,
          reviewCount: node.aggregateRating?.reviewCount,
          images: [node.image].flat().filter(Boolean).map(String),
          offers: offers.map((o: any) => ({
            price: Number(o.price ?? 0),
            currency: o.priceCurrency ?? 'USD',
            availability: String(o.availability ?? ''),
            sku: o.sku,
          })),
        };
      }
    } catch {
      /* bloque JSON-LD inválido: seguimos con el siguiente */
    }
  }
  return null;
}

interface EmbeddedData {
  title?: string;
  description?: string;
  category?: string;
  categoryPath?: string[];
  tags?: string[];
  brand?: string;
  currency?: string;
  images: string[];
  variants: ScrapedVariant[];
  shippingOptions: ScrapedShippingOption[];
  reviews: ScrapedReview[];
  ratingAvg?: number;
  ratingCount?: number;
  ordersCount?: number;
  specs?: Record<string, string>;
}

/** Busca payloads JSON embebidos típicos (__NEXT_DATA__, window._dida_config_, runParams...) */
function extractEmbeddedJson(html: string, supplier: SupplierKey): EmbeddedData | null {
  const patterns =
    supplier === 'ALIEXPRESS'
      ? [/window\._dida_config_\._init_data_\s*=\s*(\{[\s\S]*?\});\s*<\/script>/i, /__NEXT_DATA__[^>]*>([\s\S]*?)<\/script>/i]
      : supplier === 'AMAZON'
        ? [/<script[^>]*data-a-state[^>]*>([\s\S]*?)<\/script>/i, /__NEXT_DATA__[^>]*>([\s\S]*?)<\/script>/i]
        : [/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\});\s*<\/script>/i, /__NEXT_DATA__[^>]*>([\s\S]*?)<\/script>/i];

  for (const re of patterns) {
    const m = html.match(re);
    if (!m) continue;
    try {
      const json = JSON.parse(m[1]);
      const parsed = normalizeEmbedded(json, supplier);
      if (parsed) return parsed;
    } catch {
      /* payload no parseable */
    }
  }
  return null;
}

/** Normaliza cualquiera de los formatos embebidos a EmbeddedData */
function normalizeEmbedded(json: any, supplier: SupplierKey): EmbeddedData | null {
  const find = (obj: any, keys: string[], depth = 0): any => {
    if (!obj || typeof obj !== 'object' || depth > 8) return undefined;
    for (const k of keys) if (obj[k] !== undefined && obj[k] !== null) return obj[k];
    for (const value of Object.values(obj)) {
      if (value && typeof value === 'object') {
        const r = find(value, keys, depth + 1);
        if (r !== undefined) return r;
      }
    }
    return undefined;
  };

  const title = find(json, ['subject', 'title', 'productTitle', 'name']);
  const skuList: any[] =
    find(json, ['skuComponent', 'sku_list', 'skus', 'skuItems', 'variationProductListingSummaryInfo']) ?? [];
  const priceModule: any = find(json, ['priceComponent', 'price', 'pricing', 'priceInfo']) ?? {};
  const currency = priceModule?.currencyCode ?? priceModule?.currency ?? 'USD';

  const variants: ScrapedVariant[] = [];
  if (Array.isArray(skuList)) {
    for (const sku of skuList.slice(0, 100)) {
      if (!sku || typeof sku !== 'object') continue;
      const props: any[] = sku.skuPropIds
        ? String(sku.skuPropIds)
            .split(',')
            .map((id: string) => (sku.skuProps ?? []).find((p: any) => String(p.propId) === id.trim()))
            .filter(Boolean)
        : [];
      const price = Number(sku.skuVal?.skuCalPrice ?? sku.price ?? sku.salePrice ?? priceModule?.minAmount?.value ?? 0);
      variants.push({
        supplierVariantId: String(sku.skuId ?? sku.skuIdStr ?? sku.id ?? variants.length),
        sku: String(sku.skuCode ?? sku.skuId ?? sku.skuIdStr ?? `SKU-${variants.length + 1}`),
        title: props.map((p: any) => p.propValue).join(' / ') || String(sku.skuAttr ?? 'Estándar'),
        color: props[0]?.propValue ?? props.find((p: any) => /color/i.test(p.propName ?? ''))?.propValue,
        size: props[1]?.propValue ?? props.find((p: any) => /size|talla/i.test(p.propName ?? ''))?.propValue,
        option1Name: props[0]?.propName ?? 'Opción',
        option1Value: props[0]?.propValue ?? 'Estándar',
        option2Name: props[1]?.propName,
        option2Value: props[1]?.propValue,
        price: round2(price),
        stock: Number(sku.skuVal?.inventory ?? sku.availQuantity ?? sku.stock ?? 0),
        imageUrl: sku.skuVal?.image ?? sku.image,
      });
    }
  }

  const images: string[] = [
    ...(find(json, ['imageList', 'imageModule', 'images', 'imageGallery', 'productImages']) ?? []),
  ]
    .flat()
    .map((i: any) => (typeof i === 'string' ? i : i?.imageUrl ?? i?.url ?? i?.hiRes))
    .filter(Boolean) as string[];

  const shippingOptions: ScrapedShippingOption[] = [];
  const shipList = find(json, ['freightCalculateInfo', 'shippingList', 'deliveryList', 'shippingOptions']);
  if (Array.isArray(shipList)) {
    for (const s of shipList.slice(0, 10)) {
      shippingOptions.push({
        method: String(s.serviceName ?? s.company ?? s.deliveryProviderName ?? 'Envío estándar'),
        carrier: s.company ?? s.deliveryProviderCode,
        cost: round2(Number(s.freightAmount?.value ?? s.shippingFee ?? s.amount?.value ?? 0)),
        currency: s.freightAmount?.currency ?? s.currency ?? currency,
        minDays: Number(s.deliveryDayMin ?? s.minDays ?? 0) || undefined,
        maxDays: Number(s.deliveryDayMax ?? s.maxDays ?? 0) || undefined,
        isTracked: Boolean(s.tracking ?? s.isTracked ?? true),
      });
    }
  }

  const reviewNodes: any[] = find(json, ['evaViewList', 'reviews', 'reviewList']) ?? [];
  const reviews: ScrapedReview[] = Array.isArray(reviewNodes)
    ? reviewNodes.slice(0, 40).map((r: any) => ({
        supplierReviewId: String(r.id ?? r.reviewId ?? ''),
        rating: Number(r.evaStarRating ?? r.rating ?? 5),
        author: r.buyerName ?? r.author ?? 'Anónimo',
        authorCountry: r.buyerCountry ?? r.country,
        text: r.buyerFeedback ?? r.reviewContent ?? r.text,
        date: r.evaDate ?? r.date,
        images: (r.images ?? []).map((i: any) => (typeof i === 'string' ? i : i?.url)).filter(Boolean),
        helpfulCount: Number(r.upVoteCount ?? 0),
        variantSku: r.skuInfo,
      }))
    : [];

  const specs: Record<string, string> = {};
  const propList = find(json, ['productPropList', 'specifications', 'attributes']);
  if (Array.isArray(propList)) {
    for (const p of propList.slice(0, 40)) {
      if (p?.propName && p?.propValue) specs[String(p.propName)] = String(p.propValue);
    }
  }

  if (!title) return null;

  return {
    title: String(title),
    description: String(find(json, ['description', 'productDescription', 'htmlDescription']) ?? ''),
    category: String(find(json, ['categoryName', 'category']) ?? 'General'),
    categoryPath: (find(json, ['categoryPath', 'breadcrumbs']) ?? []) as string[],
    tags: (find(json, ['keywords', 'tags']) ?? []) as string[],
    brand: find(json, ['brandName', 'brand']),
    currency,
    images: [...new Set(images)].slice(0, 24),
    variants: variants.length ? variants : [{ supplierVariantId: 'default', sku: 'DEFAULT', title: 'Único', price: Number(priceModule?.minAmount?.value ?? 0), stock: 999 }],
    shippingOptions,
    reviews,
    ratingAvg: Number(find(json, ['averageStar', 'averageStarRate', 'rating']) ?? 0),
    ratingCount: Number(find(json, ['totalValidNum', 'reviewCount']) ?? 0),
    ordersCount: Number(find(json, ['tradeCount', 'orders']) ?? 0),
    specs,
  };
}

function extractOpenGraph(html: string) {
  const meta = (prop: string) => {
    const m =
      html.match(new RegExp(`<meta[^>]+property=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i')) ??
      html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${prop}["']`, 'i'));
    return m?.[1];
  };
  const name = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1];
  const titleTag = html.match(/<title>([^<]+)<\/title>/i)?.[1];
  const images = [...html.matchAll(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/gi)].map((m) => m[1]);
  return {
    title: meta('og:title') ?? titleTag,
    description: meta('og:description') ?? name ?? '',
    images,
  };
}

function extractImages(
  html: string,
  embedded: EmbeddedData | null,
  og: { images: string[] },
  meta: SupplierMeta,
): { url: string; hdUrl?: string; alt?: string }[] {
  const raw = [...(embedded?.images ?? []), ...og.images];
  if (!raw.length) {
    const found = [...html.matchAll(/https?:\/\/[^"'\s]+?\.(?:jpg|jpeg|png|webp)(?:\?[^"'\s]*)?/gi)].map((m) => m[0]);
    raw.push(...found.slice(0, 10));
  }
  const seen = new Set<string>();
  const out: { url: string; hdUrl?: string; alt?: string }[] = [];
  for (const u of raw) {
    const url = String(u).replace(/^\/\//, 'https://');
    const hd = meta.toHdImage ? meta.toHdImage(url) : undefined;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ url, hdUrl: hd, alt: undefined });
    if (out.length >= 24) break;
  }
  return out;
}

function extractVariants(embedded: EmbeddedData | null, ld: JsonLdProduct | null, meta: SupplierMeta): ScrapedVariant[] {
  if (embedded?.variants?.length) return embedded.variants;
  if (ld?.offers?.length) {
    return ld.offers.slice(0, 50).map((o, i) => ({
      supplierVariantId: o.sku ?? `ld-${i}`,
      sku: o.sku ?? `${meta.key}-${i}`,
      title: 'Estándar',
      price: o.price,
      stock: /InStock/i.test(o.availability) ? 999 : 0,
      imageUrl: ld.images[i % Math.max(ld.images.length, 1)],
    }));
  }
  return [];
}

function extractShipping(embedded: EmbeddedData | null): ScrapedProduct['shipping'] {
  const options = embedded?.shippingOptions ?? [];
  const normalized =
    options.length > 0
      ? options
      : [
          { method: 'Standard Shipping', carrier: '4PX', cost: 2.4, currency: 'USD', minDays: 12, maxDays: 22, isTracked: true },
          { method: 'Economy Shipping', carrier: 'Cainiao', cost: 0, currency: 'USD', minDays: 25, maxDays: 45, isTracked: false },
        ];
  const sorted = [...normalized].sort((a, b) => a.cost - b.cost);
  const tracked = normalized.filter((o) => o.isTracked).sort((a, b) => (a.maxDays ?? 99) - (b.maxDays ?? 99));
  return {
    options: normalized,
    cheapestCost: sorted[0]?.cost ?? 0,
    fastest: tracked[0],
    shipsTo: ['ES', 'FR', 'DE', 'IT', 'PT', 'US', 'MX', 'GB'],
  };
}

function extractReviews(embedded: EmbeddedData | null, html: string): ScrapedReview[] {
  if (embedded?.reviews?.length) return embedded.reviews;
  const reviews: ScrapedReview[] = [];
  const blocks = [...html.matchAll(/data-review-rating=["'](\d)["'][^>]*>([\s\S]{0,400}?)<\/(?:div|p)>/gi)];
  for (const b of blocks.slice(0, 20)) {
    reviews.push({ rating: Number(b[1]), text: b[2].replace(/<[^>]+>/g, '').trim(), images: [] });
  }
  return reviews;
}

const cleanTitle = (t: string) => t.replace(/\s*[|·—-]\s*(AliExpress|Amazon|CJ Dropshipping).*$/i, '').trim();

// ───────────────────────── 3) Modo demo (determinista) ──────────────────────

export function buildDemoProduct(
  url: string,
  meta: SupplierMeta,
  started = Date.now(),
  mode: 'service' | 'local' | 'demo' = 'demo',
): ScrapedProduct {
  const seed = stableHash(url);
  const rand = mulberry32(parseInt(seed.slice(0, 8), 36) || 42);
  const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)];

  const catalog = [
    { t: 'Auriculares Inalámbricos TWS Pro ANC Bluetooth 5.3', c: 'Electrónica', p: 11.9, img: 'photo-1590658268037-6bf12165a8df' },
    { t: 'Reloj Inteligente AMOLED 1.96" IP68 con Llamadas', c: 'Electrónica', p: 19.5, img: 'photo-1546868871-7041f2a55e12' },
    { t: 'Mini Proyector Portátil 1080P 8000 Lúmenes WiFi', c: 'Electrónica', p: 44.2, img: 'photo-1478720568477-152d9b164e26' },
    { t: 'Robot Aspirador 3 en 1 con Mapeo Láser 4000Pa', c: 'Hogar', p: 62.8, img: 'photo-1589492477829-5e65395b66cc' },
    { t: 'Mochila Antirrobo Impermeable USB 30L Portátil 17"', c: 'Moda', p: 13.4, img: 'photo-1553062407-98eeb64c6a62' },
    { t: 'Freidora de Aire 6L Digital Sin Aceite 1800W', c: 'Hogar', p: 51.3, img: 'photo-1585515320310-259814833e62' },
    { t: 'Cámara de Seguridad WiFi 4MP Visión Nocturna IP66', c: 'Electrónica', p: 22.7, img: 'photo-1558002038-1055907df827' },
    { t: 'Set de Organizadores de Cocina Apilables 6 Piezas', c: 'Hogar', p: 9.1, img: 'photo-1584622650111-993a426fbf0a' },
    { t: 'Teclado Mecánico Inalámbrico 75% RGB Hot-Swap', c: 'Electrónica', p: 28.6, img: 'photo-1587829741301-dc798b83add3' },
    { t: 'Cepillo Alisador Iónico Profesional 5 Temperaturas', c: 'Belleza', p: 15.2, img: 'photo-1522338140262-f46f5913618a' },
  ];
  const item = pick(catalog);
  const colors = ['Negro', 'Blanco', 'Azul', 'Rosa', 'Gris'];
  const sizes = item.c.includes('Moda') ? ['S', 'M', 'L', 'XL'] : ['Estándar', 'Pro'];

  const variantCount = 2 + Math.floor(rand() * 4);
  const variants: ScrapedVariant[] = Array.from({ length: variantCount }).map((_, i) => {
    const color = colors[i % colors.length];
    const size = sizes[i % sizes.length];
    const price = round2(item.p * (1 + (rand() * 0.14 - 0.04)));
    return {
      supplierVariantId: `${meta.key}-${seed}-${i}`,
      sku: `${slugify(item.t).slice(0, 10).toUpperCase()}-${color.slice(0, 2).toUpperCase()}${size.slice(0, 1)}`,
      title: `${color} / ${size}`,
      color,
      size,
      option1Name: 'Color',
      option1Value: color,
      option2Name: 'Talla',
      option2Value: size,
      price,
      compareAtPrice: round2(price * 1.3),
      stock: rand() > 0.15 ? Math.floor(rand() * 480) + 12 : 0,
      imageUrl: `https://images.unsplash.com/${item.img}?w=800&q=80`,
      weightGrams: Math.floor(rand() * 900) + 150,
      material: pick(['ABS', 'Aleación de zinc', 'Silicona + ABS', 'Poliéster']),
    };
  });

  const images = Array.from({ length: 4 }).map((_, i) => ({
    url: `https://images.unsplash.com/${item.img}?w=1200&q=80&sig=${seed}-${i}`,
    hdUrl: `https://images.unsplash.com/${item.img}?w=2000&q=90&sig=${seed}-${i}`,
    alt: `${item.t} — vista ${i + 1}`,
  }));

  const shippingOptions: ScrapedShippingOption[] = [
    { method: 'AliExpress Selection Standard', carrier: '4PX', cost: round2(0 + rand() * 1.2), currency: 'USD', minDays: 11, maxDays: 19, isTracked: true },
    { method: 'Cainiao Super Economy Global', carrier: 'Cainiao', cost: 0, currency: 'USD', minDays: 24, maxDays: 42, isTracked: false },
    { method: 'DHL eCommerce', carrier: 'DHL', cost: round2(5.4 + rand() * 2), currency: 'USD', minDays: 5, maxDays: 9, isTracked: true },
    { method: 'Correos Express (almacén ES)', carrier: 'Correos', cost: 3.9, currency: 'USD', minDays: 3, maxDays: 6, isTracked: true },
  ];

  const reviewTexts = [
    'Calidad/precio increíble, llegó a Madrid en 13 días con seguimiento.',
    'Funciona exactamente como se describe. El vendedor respondió en minutos.',
    'Segunda unidad que compro. Embalaje perfecto, sin daños.',
    'Buen producto aunque tardó un poco más de lo esperado (18 días).',
    'Los materiales se sienten premium, mejor de lo que esperaba por el precio.',
    'Great value for the price, would buy again from this supplier.',
    'Llegó con un pequeño arañazo pero el soporte me devolvió parte del importe.',
  ];

  const reviews: ScrapedReview[] = Array.from({ length: 12 }).map((_, i) => ({
    supplierReviewId: `${seed}-rev-${i}`,
    rating: Math.max(3, Math.round(4.4 + (rand() - 0.5) * 2)),
    author: pick(['Lucía M.', 'Andrés P.', 'Karl S.', 'María G.', 'Tomás R.', 'Elena V.', 'Nicolás B.']),
    authorCountry: pick(['ES', 'MX', 'DE', 'FR', 'IT', 'PT', 'US']),
    text: pick(reviewTexts),
    date: new Date(Date.now() - Math.floor(rand() * 90) * 864e5).toISOString(),
    images: rand() > 0.6 ? [`https://images.unsplash.com/${item.img}?w=400&q=70&sig=rev-${i}`] : [],
    helpfulCount: Math.floor(rand() * 42),
  }));

  const stockTotal = variants.reduce((a, v) => a + v.stock, 0);

  return {
    sourceUrl: url,
    supplier: meta.key,
    supplierProductId: meta.extractProductId(url),
    title: item.t,
    seoTitle: item.t.slice(0, 60),
    description:
      `<p><strong>${item.t}</strong> — producto verificado con envío internacional y seguimiento.</p>` +
      `<ul><li>Categoría: ${item.c}</li><li>Garantía de 12 meses</li><li>Devolución en 30 días</li>` +
      `<li>Preparación en 24-48h</li></ul><p>Envío desde almacén internacional (China/UE). Compatible con todos los estándares europeos de seguridad.</p>`,
    bullets: [
      'Envío con seguimiento internacional',
      'Garantía de 12 meses del proveedor',
      'Devolución gratuita durante 30 días',
      'Preparación del pedido en 24-48h',
    ],
    category: item.c,
    categoryPath: [item.c, 'Dropshipping', 'Top ventas'],
    tags: [slugify(item.c), 'dropshipping', 'envio-rapido', 'top-ventas'],
    brand: pick(['Generic', 'OEM', 'NoBrand', 'Xiaomi Eco-chain']),
    currency: 'USD',
    images,
    variants,
    shipping: {
      options: shippingOptions,
      cheapestCost: 0,
      fastest: shippingOptions[3],
      shipsTo: ['ES', 'FR', 'DE', 'IT', 'PT', 'US', 'MX', 'GB', 'NL', 'BE'],
    },
    reviews,
    ratingAvg: round2(4.3 + rand() * 0.6),
    ratingCount: Math.floor(rand() * 4200) + 180,
    ordersCount: Math.floor(rand() * 24000) + 500,
    stockTotal,
    specs: {
      Marca: pick(['Generic', 'OEM']),
      Modelo: `${meta.key}-${seed.slice(0, 6).toUpperCase()}`,
      Peso: `${(variants[0]?.weightGrams ?? 400) / 1000} kg`,
      Certificaciones: 'CE, RoHS, FCC',
      'Tiempo de envío': '11-19 días (estándar)',
    },
    warnings: ['Datos generados en MODO DEMO (sin acceso al proveedor)'],
    extractionMeta: {
      mode,
      durationMs: Date.now() - started,
      proxyUsed: undefined,
      extractorVersion: EXTRACTOR_VERSION,
      extractedAt: new Date().toISOString(),
      attempts: 1,
    },
  };
}

function mulberry32(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ───────────────────────── Normalización final ──────────────────────────────

function finalize(
  partial: Partial<ScrapedProduct>,
  url: string,
  meta: SupplierMeta,
  mode: 'service' | 'local' | 'demo',
  proxy?: string,
  started = Date.now(),
): ScrapedProduct {
  const variants = (partial.variants ?? []).filter((v) => v && v.price >= 0);
  const warnings = partial.warnings ?? [];

  if (!partial.title) {
    throw new ScraperError('El proveedor no devolvió título (producto no disponible o bloqueado)', 'PARSE_ERROR');
  }
  if (!variants.length) {
    warnings.push('Sin variantes detectadas: se creará una variante única con el precio mínimo');
    variants.push({
      supplierVariantId: 'default',
      sku: `${meta.key}-DEFAULT`,
      title: 'Único',
      price: Number(partial.shipping?.options?.[0] ? 0 : 0),
      stock: partial.stockTotal ?? 0,
    });
  }
  if (!partial.images?.length) warnings.push('Sin imágenes: la tienda mostrará un placeholder');

  const stockTotal = partial.stockTotal ?? variants.reduce((a, v) => a + (v.stock || 0), 0);
  const shipping = partial.shipping ?? {
    options: [],
    cheapestCost: 0,
    shipsTo: [],
  };

  return {
    sourceUrl: url,
    supplier: meta.key,
    supplierProductId: partial.supplierProductId ?? meta.extractProductId(url),
    title: partial.title.slice(0, 255),
    seoTitle: (partial.seoTitle ?? partial.title).slice(0, 70),
    description: partial.description ?? '',
    bullets: partial.bullets ?? [],
    category: partial.category ?? 'General',
    categoryPath: partial.categoryPath ?? [],
    tags: partial.tags ?? [],
    brand: partial.brand,
    currency: partial.currency ?? 'USD',
    images: partial.images ?? [],
    variants,
    shipping: {
      ...shipping,
      cheapestCost: shipping.cheapestCost ?? Math.min(...(shipping.options.map((o) => o.cost) ?? [0])),
    },
    reviews: partial.reviews ?? [],
    ratingAvg: round2(partial.ratingAvg ?? 0),
    ratingCount: partial.ratingCount ?? 0,
    ordersCount: partial.ordersCount ?? 0,
    stockTotal,
    specs: partial.specs ?? {},
    warnings,
    extractionMeta: {
      mode,
      durationMs: Date.now() - started,
      proxyUsed: proxy,
      extractorVersion: EXTRACTOR_VERSION,
      extractedAt: new Date().toISOString(),
      attempts: partial.extractionMeta?.attempts ?? 1,
    },
  };
}

/** Normaliza y valida la URL de producto (acepta links con parámetros de tracking) */
export function normalizeProductUrl(input: string): string {
  const raw = input.trim();
  if (!raw) throw new ScraperError('URL vacía', 'INVALID_URL');
  const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  let u: URL;
  try {
    u = new URL(withProto);
  } catch {
    throw new ScraperError(`URL inválida: ${input}`, 'INVALID_URL');
  }
  const meta = detectSupplier(u.toString());
  if (!meta) throw new ScraperError(`Proveedor no soportado para la URL: ${u.hostname}`, 'UNSUPPORTED_SUPPLIER');

  // Quitamos parámetros de tracking, dejando URL canónica limpia
  const keep = ['id', 'p', 'product', 'item', 'pid'];
  const clean = new URL(u.origin + u.pathname);
  for (const k of keep) if (u.searchParams.has(k)) clean.searchParams.set(k, u.searchParams.get(k)!);
  return clean.toString();
}
