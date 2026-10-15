/**
 * workers/lib.ts — Utilidades compartidas por los workers.
 *
 * • Acceso Prisma tolerante a modo demo.
 * • Re-comprobación de proveedor (scraper service → fallback simulado).
 * • Escritura de SyncLog.
 * • Publicación/actualización en la tienda destino (Shopify o Woo).
 */
import './env';
import { PrismaClient, Prisma } from '@prisma/client';
import { scrapeProduct, ScraperError } from '../src/lib/scraper';
import { computeSellingPrice, shouldUpdatePrice } from '../src/lib/pricing';
import { BASE_CURRENCY, fxInfo, fxLine, toEur } from '../src/lib/fx';
import * as shopify from '../src/lib/shopify';
import * as woo from '../src/lib/woocommerce';
import { round2, stableHash } from '../src/lib/utils';
import type { ScrapedProduct } from '../src/lib/types';

import { prisma as sharedPrisma } from '../src/lib/prisma';
import { withTenant, withSystem } from '../src/lib/tenant-context';

/**
 * Cliente Prisma compartido con la app: incluye el aislamiento multi-cliente
 * (toda consulta queda filtrada por el userId del contexto). Los workers deben
 * envolver cada job en `runForUser(userId, fn)` para que el filtro se aplique.
 */
export function getPrisma(): PrismaClient {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL no configurada: los workers requieren PostgreSQL (o arranca en modo demo desde la UI).');
  }
  return sharedPrisma as PrismaClient;
}

/**
 * Ejecuta el trabajo de un job dentro del contexto de su cliente.
 * Si el job no trae userId (jobs antiguos o tareas globales), se ejecuta en
 * modo sistema con un motivo explícito.
 */
export function runForUser<T>(userId: string | null | undefined, fn: () => Promise<T> | T): Promise<T> | T {
  if (userId) return withTenant(userId, fn, 'worker');
  return withSystem('worker: job sin userId (tarea global)', fn);
}

/**
 * Proxy a Prisma que difiere la conexión hasta el primer uso real, de modo que
 * importar este módulo desde las API routes de Next (sin BD, modo demo) no falla.
 */
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const client = getPrisma();
    const value = Reflect.get(client as object, prop, client);
    return typeof value === 'function' ? (value as Function).bind(client) : value;
  },
  has(_target, prop) {
    return prop in getPrisma();
  },
}) as PrismaClient;

export const log = (...args: unknown[]) => console.log(`[${new Date().toISOString()}]`, ...args);

// ───────────────────────── Barrido: qué toca ahora ─────────────────────────

/**
 * Cada plan promete una frecuencia distinta (Enterprise 30 min, Pro 60,
// Starter 120, Prueba 360). El barrido se ejecuta a menudo (cada
// SYNC_SCHEDULER_MINUTES, 15 por defecto) y aquí se decide qué productos toca
// re-verificar AHORA: los que llevan más tiempo sin sincronizarse que lo que
// permite el plan de su dueño.
 *
 * `graceMs` resta un minuto al umbral para que un producto de plan «cada 60
 * min» con último sync de hace 59 min no se salte un ciclo entero.
 */
export function filterDueProducts<T extends { userId: string; lastSyncedAt: Date | null }>(
  products: T[],
  intervalMinutesByUser: Map<string, number>,
  now = Date.now(),
  opts: { graceMs?: number; defaultIntervalMinutes?: number } = {},
): T[] {
  const grace = opts.graceMs ?? 60_000;
  const fallback = opts.defaultIntervalMinutes ?? 60;
  return products.filter((p) => {
    if (!p.lastSyncedAt) return true; // nunca sincronizado: se procesa ya
    const minutes = intervalMinutesByUser.get(p.userId) ?? fallback;
    return now - p.lastSyncedAt.getTime() >= minutes * 60_000 - grace;
  });
}

// ───────────────────────────── SyncLog ─────────────────────────────────────

export async function writeSyncLog(entry: {
  userId?: string | null;
  storeId?: string | null;
  supplierId?: string | null;
  productId?: string | null;
  variantId?: string | null;
  type: 'IMPORT' | 'PRICE_UPDATE' | 'STOCK_UPDATE' | 'FULL_REFRESH' | 'ORDER_PUSH' | 'DELETE';
  status: 'QUEUED' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'SKIPPED';
  level?: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';
  message: string;
  changes?: Prisma.InputJsonValue | null;
  durationMs?: number;
  attempt?: number;
  jobId?: string;
  errorStack?: string;
}) {
  try {
    return await prisma.syncLog.create({
      data: {
        userId: entry.userId ?? undefined,
        storeId: entry.storeId ?? undefined,
        supplierId: entry.supplierId ?? undefined,
        productId: entry.productId ?? undefined,
        variantId: entry.variantId ?? undefined,
        type: entry.type,
        status: entry.status,
        level: entry.level ?? 'INFO',
        message: entry.message,
        changes: entry.changes ?? undefined,
        durationMs: entry.durationMs,
        attempt: entry.attempt ?? 1,
        jobId: entry.jobId,
        errorStack: entry.errorStack,
      },
    });
  } catch (err) {
    // La telemetría NUNCA debe tumbar el motor 24/7: si la BD falla, lo
    // registramos en consola y el job sigue su curso.
    console.error('[syncLog] no se pudo persistir la entrada:', (err as Error).message, '|', entry.type, entry.status, entry.message);
    return null;
  }
}

// ─────────────────────── Re-comprobación del proveedor ─────────────────────

export interface ProviderSnapshot {
  currency: string;
  minPrice: number;
  maxPrice: number;
  stockTotal: number;
  shippingCost: number;
  variants: { supplierVariantId: string; sku: string; price: number; stock: number }[];
  source: 'scraper-service' | 'local-fetch' | 'simulated';
  warnings: string[];
  /**
   * ¿Se puede aplicar este snapshot a un producto en venta?
   *
   * Un precio de 0 casi nunca es real: significa que la página no se ha podido
   * interpretar (cambió el diseño, un captcha, un bloqueo, precio tras registro).
   * Aplicarlo sería catastrófico: el producto se recalcularía a ~0 € y se
   * publicaría ese precio en la tienda. Con `reliable: false` el worker deja el
   * producto tal como está, avisa y reintenta en el próximo chequeo.
   */
  reliable: boolean;
  unreliableReason: string | null;
}

/** Snapshot tal y como sale del proveedor, antes de juzgar si es fiable. */
type RawSnapshot = Omit<ProviderSnapshot, 'reliable' | 'unreliableReason'>;

/** Señales de que la página se ha leído pero SIN precio: el dato no sirve. */
const PRICE_MISSING_HINTS = [/no se ha encontrado el precio/i, /no price/i, /price not found/i];

/**
 * Comprueba precio/stock actuales del proveedor.
 * Intenta el microservicio (vía scrapeProduct) y, sólo si el modo demo está
 * activo de forma intencionada (`SCRAPER_MODE=demo` o `mode: 'demo'`), genera una
 * deriva realista para poder demostrar el pipeline completo.
 *
 * Regla de oro: **en modo real nunca se aplica un snapshot inventado**. Si el
 * proveedor no responde o la página no se puede interpretar, el worker deja el
 * producto como está y lo registra (ver `reliable`).
 */
export async function checkProvider(
  sourceUrl: string,
  supplier: ScrapedProduct['supplier'],
  options: { productId: string; previousHash?: string | null; mode?: 'live' | 'demo' } = { productId: '' },
): Promise<ProviderSnapshot> {
  // `mode` lo usan las verificaciones y las demos para forzar un camino concreto:
  // 'demo' = snapshot simulado determinista, 'live' = proveedor de verdad.
  const forcedMode = options.mode ?? (process.env.SCRAPER_MODE === 'demo' ? 'demo' : undefined);
  // Lo simulado sólo vale si el modo demo es INTENCIONADO. En modo real
  // (`auto`/`service`) un snapshot simulado jamás debe tocar un producto en venta:
  // un proveedor caído o una página ilegible no puede convertirse en «precio
  // nuevo» inventado. Antes sí se aplicaba, y así quedaron dos productos con
  // coste 0 € y precio 2,99 €.
  const allowSimulated = forcedMode === 'demo' || (!forcedMode && process.env.SCRAPER_MODE === 'demo');
  try {
    const scraped = await scrapeProduct(sourceUrl, { mode: forcedMode === 'demo' ? 'demo' : undefined, skipReviews: true });
    if (!scraped.extractionMeta.mode.includes('demo')) {
      return judgeReliability(toEurSnapshot({
        currency: scraped.currency,
        minPrice: Math.min(...scraped.variants.map((v) => v.price)),
        maxPrice: Math.max(...scraped.variants.map((v) => v.price)),
        stockTotal: scraped.stockTotal,
        shippingCost: scraped.shipping.cheapestCost,
        variants: scraped.variants.map((v) => ({ supplierVariantId: v.supplierVariantId, sku: v.sku, price: v.price, stock: v.stock })),
        source: scraped.extractionMeta.mode === 'service' ? 'scraper-service' : 'local-fetch',
        warnings: scraped.warnings,
      }));
    }
    return simulateDrift(options.productId, scraped, allowSimulated);
  } catch (err) {
    if (err instanceof ScraperError && err.code === 'UNSUPPORTED_SUPPLIER') throw err;
    log(`  ↳ proveedor inaccesible (${(err as Error).message.slice(0, 70)}): usando snapshot simulado`);
    const scraped = await scrapeProduct(sourceUrl, { mode: 'demo', skipReviews: true });
    return simulateDrift(options.productId, scraped, allowSimulated);
  }
}

function simulateDrift(productId: string, scraped: ScrapedProduct, allowSimulated = true): ProviderSnapshot {
  const seed = stableHash(`${productId}:${new Date().getHours()}`);
  const r = () => (parseInt(seed.split('').map((c) => c.charCodeAt(0)).join('').slice(0, 9)) % 1000) / 1000;
  const drift = (r() - 0.42) * 0.12; // -5%..+7%
  const stockWipe = r() > 0.93;

  const variants = scraped.variants.map((v, i) => ({
    supplierVariantId: v.supplierVariantId,
    sku: v.sku,
    price: round2(Math.max(v.price * (1 + drift + i * 0.004), v.price * 0.6)),
    stock: stockWipe && i === 0 ? 0 : Math.max(0, v.stock - Math.floor(r() * 12)),
  }));

  return judgeReliability(
    toEurSnapshot({
      currency: scraped.currency,
      minPrice: Math.min(...variants.map((v) => v.price)),
      maxPrice: Math.max(...variants.map((v) => v.price)),
      stockTotal: variants.reduce((a, v) => a + v.stock, 0),
      shippingCost: scraped.shipping.cheapestCost,
      variants,
      source: 'simulated',
      warnings: ['Snapshot simulado (sin acceso al proveedor): válido sólo para demo/dev'],
    }),
    allowSimulated,
  );
}

/**
 * Decide si un snapshot del proveedor se puede aplicar. Los snapshots simulados
 * (demo) se aceptan siempre —son intencionados y van etiquetados—; los reales
 * sólo si traen un precio coherente.
 */
function judgeReliability(
  snapshot: Omit<ProviderSnapshot, 'reliable' | 'unreliableReason'>,
  trustSimulated = false,
): ProviderSnapshot {
  if (snapshot.source === 'simulated') {
    return trustSimulated
      ? { ...snapshot, reliable: true, unreliableReason: null }
      : {
          ...snapshot,
          reliable: false,
          unreliableReason:
            'no se ha podido leer el proveedor y el snapshot simulado NO se aplica en modo real (la plataforma no inventa precios)',
        };
  }

  if (!(snapshot.minPrice > 0) || snapshot.variants.every((v) => !(v.price > 0))) {
    return {
      ...snapshot,
      reliable: false,
      unreliableReason: 'el proveedor no ha devuelto un precio válido (0 o sin datos de precio)',
    };
  }
  const missing = snapshot.warnings.find((w) => PRICE_MISSING_HINTS.some((re) => re.test(w)));
  if (missing) return { ...snapshot, reliable: false, unreliableReason: missing };

  return { ...snapshot, reliable: true, unreliableReason: null };
}

/**
 * Pasa el snapshot del proveedor a euros. La ficha del producto guarda el coste
 * en EUR (divisa de la tienda), así que el worker debe comparar y escribir en la
 * misma unidad: si no, cada hora vería un «cambio de precio» que no existe y
 * sobrescribiría el coste con un valor en dólares.
 */
function toEurSnapshot(snapshot: RawSnapshot): RawSnapshot {
  const info = fxInfo(snapshot.currency);
  if (!info.converted && !info.unknown) return snapshot;
  const warn = fxLine(info, snapshot.minPrice);
  return {
    ...snapshot,
    currency: BASE_CURRENCY,
    minPrice: toEur(snapshot.minPrice, snapshot.currency),
    maxPrice: toEur(snapshot.maxPrice, snapshot.currency),
    shippingCost: toEur(snapshot.shippingCost, snapshot.currency),
    variants: snapshot.variants.map((v) => ({ ...v, price: toEur(v.price, snapshot.currency) })),
    warnings: [...snapshot.warnings, warn || `Divisa ${snapshot.currency} sin tasa configurada: se usa 1:1`],
  };
}

export const snapshotHash = (s: ProviderSnapshot) =>
  stableHash(`${s.minPrice}:${s.stockTotal}:${s.variants.map((v) => `${v.sku}=${v.price}/${v.stock}`).join('|')}`);

// ─────────────────────── Publicación en la tienda ──────────────────────────

export async function publishToStore(
  store: { id: string; platform: string; domain: string; accessTokenEnc: string | null; consumerSecretEnc?: string | null; apiVersion?: string | null },
  scraped: ScrapedProduct,
  opts: { sellingPrice: number; marginPct: number; status?: 'ACTIVE' | 'DRAFT' },
) {
  if (store.platform === 'SHOPIFY') {
    const input = shopify.mapProductToShopify(
      {
        ...scraped,
        variants: scraped.variants.map((v) => ({
          ...v,
          price: round2(opts.sellingPrice),
          compareAtPrice: round2(opts.sellingPrice * 1.35),
        })),
      },
      { status: opts.status ?? 'DRAFT', handle: shopify.slugHandle(scraped.title) },
    );
    return shopify.publishProduct(store, input);
  }

  const withPrices: ScrapedProduct = {
    ...scraped,
    variants: scraped.variants.map((v) => ({ ...v, price: round2(opts.sellingPrice), compareAtPrice: round2(opts.sellingPrice * 1.35) })),
  };
  const res = await woo.publishProduct(store, withPrices, { status: opts.status === 'ACTIVE' ? 'publish' : 'draft' });
  return { ok: res.ok, error: res.error, data: res.data ? { id: String(res.data.id), handle: String(res.data.id), variants: [] } : undefined, simulated: res.simulated };
}

export async function updateStoreInventory(
  store: { id: string; platform: string; domain: string; accessTokenEnc: string | null; consumerSecretEnc?: string | null; apiVersion?: string | null },
  target: { storeProductId: string | null; storeVariantId: string | null; inventoryItemId?: string | null },
  newStock: number,
  productIdInStore?: string | null,
) {
  if (store.platform === 'SHOPIFY') {
    return shopify.updateInventory(store, {
      storeVariantId: target.storeVariantId,
      inventoryItemId: target.inventoryItemId,
      newStock,
      productId: productIdInStore ?? target.storeProductId,
    });
  }
  return woo.updateInventory(store, target.storeVariantId ?? target.storeProductId ?? '', newStock, Boolean(target.storeVariantId));
}

export async function updateStorePrice(
  store: { id: string; platform: string; domain: string; accessTokenEnc: string | null; consumerSecretEnc?: string | null; apiVersion?: string | null },
  target: { storeProductId: string | null; storeVariantId: string | null; inventoryItemId?: string | null },
  newPrice: number,
  compareAtPrice?: number | null,
) {
  if (store.platform === 'SHOPIFY') {
    return shopify.updatePrice(store, {
      productId: target.storeProductId ?? '',
      storeVariantId: target.storeVariantId,
      newPrice,
      compareAtPrice,
    });
  }
  return woo.updatePrice(store, target.storeProductId ?? '', {
    newPrice,
    compareAtPrice: compareAtPrice ?? undefined,
    variationId: target.storeVariantId ?? undefined,
  });
}

export async function setStoreProductOutOfStock(
  store: { id: string; platform: string; domain: string; accessTokenEnc: string | null; consumerSecretEnc?: string | null; apiVersion?: string | null },
  target: { storeProductId: string | null; storeVariantId: string | null },
) {
  if (store.platform === 'SHOPIFY' && target.storeProductId) {
    return shopify.setProductStatus(store, target.storeProductId, 'DRAFT', true);
  }
  if (store.platform === 'WOOCOMMERCE') {
    return woo.updateInventory(store, target.storeProductId ?? '', 0, false);
  }
  return { ok: true, simulated: true };
}

export { computeSellingPrice, shouldUpdatePrice };

/** Regla efectiva del producto: la suya → la de su categoría → la global */
export async function resolveRule(product: { pricingRuleId: string | null; userId: string; category: string | null }) {
  const rules = await prisma.pricingRule.findMany({ where: { userId: product.userId, isActive: true } });
  const own = product.pricingRuleId ? rules.find((r) => r.id === product.pricingRuleId) : undefined;
  if (own && own.applyToCategory == null) return { rule: own, name: own.name };
  const byCategory = rules.find((r) => r.applyToCategory && product.category && r.applyToCategory.toLowerCase() === product.category.toLowerCase());
  const global = rules.find((r) => r.isDefault) ?? rules[0];
  const chosen = own ?? byCategory ?? global;
  return { rule: chosen, name: chosen?.name ?? 'default' };
}

export async function shutdown() {
  try {
    await sharedPrisma.$disconnect();
  } catch {
    /* nada que cerrar */
  }
}
