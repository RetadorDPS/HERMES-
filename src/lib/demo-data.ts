/**
 * src/lib/demo-data.ts — Dataset en memoria
 *
 * Se usa cuando DATABASE_URL no está configurada, de forma que el dashboard,
 * el importador y el monitor de sync funcionan end-to-end en local/preview.
 * Es determinista (semilla fija) para que la UI no "parpadee" entre renders.
 */
import { ahoraApp, round2, roundPsychological, stableHash } from './utils';
import type { DashboardKpis, FulfillmentState, OrderState, ProductState, ScrapedProduct, SyncState } from './types';

const now = ahoraApp();
const mins = (n: number) => new Date(now - n * 60_000);
const hours = (n: number) => new Date(now - n * 3_600_000);
const days = (n: number) => new Date(now - n * 86_400_000);

function rng(seed: string) {
  let h = parseInt(stableHash(seed).slice(0, 8), 36) || 7;
  return () => {
    h = (h * 1103515245 + 12345) & 0x7fffffff;
    return h / 0x7fffffff;
  };
}

// ─────────────────────────────── Stores ─────────────────────────────────────

export const demoStores = [
  {
    id: 'store_shopify_1',
    platform: 'SHOPIFY' as const,
    name: 'Mi Tienda Gadgets',
    domain: 'gadgets-demo.myshopify.com',
    status: 'CONNECTED' as const,
    currency: 'EUR',
    productsCount: 14,
    ordersCount: 27,
    lastPingAt: mins(3),
    lastError: null as string | null,
    createdAt: days(64),
    storeProductCount: 14,
    settings: { autoImport: true, translate: true, defaultMargin: 40 },
  },
  {
    id: 'store_woo_1',
    platform: 'WOOCOMMERCE' as const,
    name: 'Woo Home & Deco',
    domain: 'woo-home-demo.es',
    status: 'ERROR' as const,
    currency: 'EUR',
    productsCount: 5,
    ordersCount: 6,
    lastPingAt: hours(9),
    lastError: 'HTTP 401 — consumer_secret revocado (rota las claves en WooCommerce → Ajustes → Avanzado → REST API)',
    createdAt: days(21),
    storeProductCount: 5,
    settings: { autoImport: false, translate: true, defaultMargin: 55 },
  },
];

export const demoSuppliers = [
  { id: 'sup_ali', type: 'ALIEXPRESS' as const, name: 'AliExpress', productsCount: 9, avgDelivery: '12-20 días', rateLimitRpm: 40, isEnabled: true },
  { id: 'sup_cj', type: 'CJ_DROPSHIPPING' as const, name: 'CJ Dropshipping', productsCount: 3, avgDelivery: '7-15 días', rateLimitRpm: 120, isEnabled: true },
  { id: 'sup_amz', type: 'AMAZON' as const, name: 'Amazon', productsCount: 2, avgDelivery: '2-5 días', rateLimitRpm: 20, isEnabled: true },
];

export const demoPricingRules = [
  { id: 'rule_global', name: 'Regla global 40%', markupPct: 40, fixedFee: 0.5, minProfit: 2, minPrice: null, maxPrice: null, roundTo: 0.99, includeShipping: true, applyToCategory: null, isDefault: true, isActive: true },
  { id: 'rule_tech', name: 'Electrónica ligera', markupPct: 65, fixedFee: 1, minProfit: 4, minPrice: null, maxPrice: null, roundTo: 0.99, includeShipping: true, applyToCategory: 'Electrónica', isDefault: false, isActive: true },
  { id: 'rule_premium', name: 'Gadgets premium 120%', markupPct: 120, fixedFee: 2, minProfit: 8, minPrice: 39.99, maxPrice: 299, roundTo: 0.99, includeShipping: false, applyToCategory: 'Electrónica', isDefault: false, isActive: true },
];

// ─────────────────────────────── Products ───────────────────────────────────

interface DemoProductSeed {
  title: string;
  supplierId: string;
  supplier: string;
  category: string;
  cost: number;
  shipping: number;
  margin: number;
  stock: number;
  orders: number;
  rating: number;
  reviews: number;
  img: string;
  storeId: string;
  status?: ProductState;
}

const seeds: DemoProductSeed[] = [
  { title: 'Auriculares Bluetooth 5.3 TWS con Cancelación Activa de Ruido', supplierId: 'sup_ali', supplier: 'ALIEXPRESS', category: 'Electrónica', cost: 12.4, shipping: 1.8, margin: 65, stock: 842, orders: 18234, rating: 4.8, reviews: 3421, img: 'photo-1590658268037-6bf12165a8df', storeId: 'store_shopify_1' },
  { title: 'Reloj Inteligente AMOLED 1.96" IP68 con Llamadas Bluetooth', supplierId: 'sup_ali', supplier: 'ALIEXPRESS', category: 'Electrónica', cost: 21.9, shipping: 0, margin: 65, stock: 214, orders: 9210, rating: 4.7, reviews: 1877, img: 'photo-1546868871-7041f2a55e12', storeId: 'store_shopify_1' },
  { title: 'Mini Proyector Portátil 1080P WiFi Bluetooth 8000 Lúmenes', supplierId: 'sup_ali', supplier: 'ALIEXPRESS', category: 'Electrónica', cost: 46.5, shipping: 4.1, margin: 120, stock: 27, orders: 653, rating: 4.3, reviews: 311, img: 'photo-1478720568477-152d9b164e26', storeId: 'store_shopify_1' },
  { title: 'Teclado Mecánico Inalámbrico 75% RGB Hot-Swap', supplierId: 'sup_ali', supplier: 'ALIEXPRESS', category: 'Electrónica', cost: 28.6, shipping: 2.2, margin: 65, stock: 96, orders: 1874, rating: 4.6, reviews: 629, img: 'photo-1587829741301-dc798b83add3', storeId: 'store_shopify_1' },
  { title: 'Cámara de Seguridad WiFi 4MP Visión Nocturna IP66', supplierId: 'sup_ali', supplier: 'ALIEXPRESS', category: 'Electrónica', cost: 22.7, shipping: 1.4, margin: 65, stock: 0, orders: 2412, rating: 4.5, reviews: 512, img: 'photo-1558002038-1055907df827', storeId: 'store_shopify_1', status: 'OUT_OF_STOCK' },
  { title: 'Mochila Antirrobo Impermeable USB 30L Portátil 17"', supplierId: 'sup_ali', supplier: 'ALIEXPRESS', category: 'Moda', cost: 14.2, shipping: 2.4, margin: 40, stock: 156, orders: 2140, rating: 4.9, reviews: 802, img: 'photo-1553062407-98eeb64c6a62', storeId: 'store_shopify_1' },
  { title: 'Organizador de Cocina Ajustable 4 Niveles Acero Inoxidable', supplierId: 'sup_cj', supplier: 'CJ_DROPSHIPPING', category: 'Hogar', cost: 8.15, shipping: 3.2, margin: 40, stock: 318, orders: 412, rating: 4.5, reviews: 219, img: 'photo-1584622650111-993a426fbf0a', storeId: 'store_woo_1' },
  { title: 'Freidora de Aire 6L Digital Sin Aceite 1800W', supplierId: 'sup_cj', supplier: 'CJ_DROPSHIPPING', category: 'Hogar', cost: 51.3, shipping: 6.8, margin: 40, stock: 41, orders: 388, rating: 4.6, reviews: 176, img: 'photo-1585515320310-259814833e62', storeId: 'store_woo_1' },
  { title: 'Lámpara de Escritorio LED con Carga Inalámbrica y Sensor Táctil', supplierId: 'sup_amz', supplier: 'AMAZON', category: 'Hogar', cost: 18.7, shipping: 0, margin: 40, stock: 63, orders: 128, rating: 4.4, reviews: 96, img: 'photo-1507473885765-e6ed057f782c', storeId: 'store_shopify_1' },
  { title: 'Robot Aspirador 3 en 1 con Mapeo Láser 4000Pa', supplierId: 'sup_cj', supplier: 'CJ_DROPSHIPPING', category: 'Hogar', cost: 62.8, shipping: 9.4, margin: 40, stock: 12, orders: 274, rating: 4.2, reviews: 143, img: 'photo-1589492477829-5e65395b66cc', storeId: 'store_woo_1' },
  { title: 'Cepillo Alisador Iónico Profesional 5 Temperaturas', supplierId: 'sup_ali', supplier: 'ALIEXPRESS', category: 'Belleza', cost: 15.2, shipping: 1.1, margin: 65, stock: 233, orders: 5120, rating: 4.7, reviews: 1204, img: 'photo-1522338140262-f46f5913618a', storeId: 'store_shopify_1' },
  { title: 'Smartwatch Deportivo GPS 1.85" 100 Modos Deportivos', supplierId: 'sup_ali', supplier: 'ALIEXPRESS', category: 'Electrónica', cost: 26.3, shipping: 0, margin: 65, stock: 178, orders: 3480, rating: 4.5, reviews: 917, img: 'photo-1523275335684-37898b6baf30', storeId: 'store_shopify_1' },
  { title: 'Set 4 Sartenes Antiadherentes Cerámica Inducción', supplierId: 'sup_cj', supplier: 'CJ_DROPSHIPPING', category: 'Hogar', cost: 34.9, shipping: 7.2, margin: 40, stock: 58, orders: 196, rating: 4.3, reviews: 88, img: 'photo-1584990347449-ae1b02b8ea6b', storeId: 'store_woo_1' },
  { title: 'Drone Plegable 4K con Cámara Gimbal y GPS', supplierId: 'sup_ali', supplier: 'ALIEXPRESS', category: 'Electrónica', cost: 88.4, shipping: 5.6, margin: 120, stock: 19, orders: 842, rating: 4.4, reviews: 366, img: 'photo-1473968512647-3e447244af8f', storeId: 'store_shopify_1' },
];

export interface DemoProduct {
  id: string;
  title: string;
  seoTitle: string;
  description: string;
  category: string;
  supplierId: string;
  supplier: string;
  supplierName: string;
  storeId: string;
  storeName: string;
  sourceUrl: string;
  supplierProductId: string;
  currency: string;
  costPrice: number;
  shippingCost: number;
  sellingPrice: number;
  compareAtPrice: number;
  marginPct: number;
  profitAmount: number;
  stockTotal: number;
  ordersCount: number;
  ratingAvg: number;
  ratingCount: number;
  status: ProductState;
  isMonitored: boolean;
  storeProductId: string | null;
  lastSyncedAt: Date | null;
  lastSyncStatus: SyncState | null;
  nextSyncAt: Date | null;
  images: { url: string; hdUrl: string; isMain: boolean }[];
  variants: {
    id: string;
    sku: string;
    title: string;
    color: string | null;
    size: string | null;
    costPrice: number;
    sellingPrice: number;
    stock: number;
    storeVariantId: string | null;
    imageUrl: string | null;
  }[];
  reviews: { id: string; rating: number; author: string; country: string; text: string; date: Date; images: string[] }[];
  shippingOptions: { method: string; carrier: string; cost: number; minDays: number; maxDays: number; isTracked: boolean }[];
  createdAt: Date;
  tags: string[];
}

function buildProduct(seed: DemoProductSeed, i: number): DemoProduct {
  const r = rng(seed.title);
  const shipping = seed.shipping;
  const selling = roundPsychological(seed.cost * (1 + seed.margin / 100) + shipping + (seed.category === 'Electrónica' ? 1 : 0.5));
  const slug = seed.title.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').slice(0, 50);
  const variantCount = seed.category === 'Moda' ? 4 : seed.category === 'Hogar' ? 2 : 3;
  const colors = ['Negro', 'Blanco', 'Azul', 'Rosa'];

  return {
    id: `prod_${i + 1}`,
    title: seed.title,
    seoTitle: seed.title.slice(0, 60),
    description: `<p><strong>${seed.title}</strong>. Producto verificado con envío internacional y seguimiento.</p><ul><li>Garantía 12 meses</li><li>Devolución 30 días</li><li>Preparación 24-48h</li></ul>`,
    category: seed.category,
    supplierId: seed.supplierId,
    supplier: seed.supplier,
    supplierName: demoSuppliers.find((s) => s.id === seed.supplierId)?.name ?? seed.supplier,
    storeId: seed.storeId,
    storeName: demoStores.find((s) => s.id === seed.storeId)?.name ?? '—',
    sourceUrl:
      seed.supplier === 'AMAZON'
        ? `https://www.amazon.es/dp/B0C${(i * 37).toString().padStart(6, '0')}`
        : seed.supplier === 'CJ_DROPSHIPPING'
          ? `https://www.cjdropshipping.com/product/${slug}-p${10000 + i}.html`
          : `https://es.aliexpress.com/item/100500${(6123456 + i * 137).toString()}.html`,
    supplierProductId: `100500${(6123456 + i * 137).toString()}`,
    currency: 'USD',
    costPrice: round2(seed.cost),
    shippingCost: round2(shipping),
    sellingPrice: selling,
    compareAtPrice: roundPsychological(selling * 1.35),
    marginPct: seed.margin,
    profitAmount: round2(selling - seed.cost - shipping - 0.3),
    stockTotal: seed.stock,
    ordersCount: seed.orders,
    ratingAvg: seed.rating,
    ratingCount: seed.reviews,
    status: seed.status ?? 'ACTIVE',
    isMonitored: seed.status !== 'DRAFT',
    storeProductId: `gid://shopify/Product/${Math.floor(r() * 900000 + 100000)}`,
    lastSyncedAt: mins(Math.floor(r() * 55) + 2),
    lastSyncStatus: seed.status === 'OUT_OF_STOCK' ? 'SKIPPED' : r() > 0.08 ? 'SUCCESS' : 'FAILED',
    nextSyncAt: mins(-Math.floor(60 - r() * 55)), // en el futuro (próxima sincronización)
    images: [
      { url: `https://images.unsplash.com/${seed.img}?w=1200&q=80`, hdUrl: `https://images.unsplash.com/${seed.img}?w=2000&q=90`, isMain: true },
      { url: `https://images.unsplash.com/${seed.img}?w=1200&q=80&sat=-40`, hdUrl: `https://images.unsplash.com/${seed.img}?w=2000&q=90`, isMain: false },
      { url: `https://images.unsplash.com/${seed.img}?w=1200&q=80&bri=10`, hdUrl: `https://images.unsplash.com/${seed.img}?w=2000&q=90`, isMain: false },
    ],
    variants: Array.from({ length: variantCount }).map((_, vi) => {
      const color = colors[vi % colors.length];
      const size = seed.category === 'Moda' ? ['S', 'M', 'L', 'XL'][vi] : vi === 0 ? 'Estándar' : 'Pro';
      const vCost = round2(seed.cost * (1 + vi * 0.03));
      const vSell = roundPsychological(vCost * (1 + seed.margin / 100) + shipping);
      const split = Math.max(1, Math.round(seed.stock / variantCount));
      return {
        id: `var_${i + 1}_${vi + 1}`,
        sku: `${slug.slice(0, 10).toUpperCase()}-${color.slice(0, 2).toUpperCase()}${size.slice(0, 1)}`,
        title: `${color} / ${size}`,
        color,
        size,
        costPrice: vCost,
        sellingPrice: vSell,
        stock: seed.stock === 0 ? 0 : Math.max(0, split + Math.floor(r() * 20 - 8)),
        storeVariantId: `gid://shopify/ProductVariant/${Math.floor(r() * 9000000 + 1000000)}`,
        imageUrl: `https://images.unsplash.com/${seed.img}?w=600&q=75`,
      };
    }),
    reviews: [
      { id: `rev_${i}_1`, rating: 5, author: 'Lucía M.', country: 'ES', text: 'Calidad sorprendente para el precio. Llegó en 14 días a Madrid con seguimiento.', date: days(6), images: [] },
      { id: `rev_${i}_2`, rating: 4, author: 'Andrés P.', country: 'MX', text: 'Buen producto, el embalaje llegó algo golpeado pero funciona perfecto.', date: days(12), images: [] },
      { id: `rev_${i}_3`, rating: 5, author: 'Karl S.', country: 'DE', text: 'Exactly as described, fast shipping to Germany.', date: days(20), images: [] },
      { id: `rev_${i}_4`, rating: 3, author: 'Sofía R.', country: 'IT', text: 'Tardó 22 días en llegar, pero el vendedor respondió rápido a mis dudas.', date: days(27), images: [] },
    ],
    shippingOptions: [
      { method: 'AliExpress Selection Standard', carrier: '4PX', cost: 1.8, minDays: 12, maxDays: 20, isTracked: true },
      { method: 'Cainiao Super Economy Global', carrier: 'Cainiao', cost: 0, minDays: 25, maxDays: 40, isTracked: false },
      { method: 'DHL eCommerce', carrier: 'DHL', cost: 6.4, minDays: 5, maxDays: 9, isTracked: true },
      { method: 'Correos Express (almacén ES)', carrier: 'Correos', cost: 3.9, minDays: 3, maxDays: 6, isTracked: true },
    ],
    createdAt: days(70 - i * 3),
    tags: [seed.category.toLowerCase(), 'dropshipping', 'envio-rapido'],
  };
}

export const demoProducts: DemoProduct[] = seeds.map(buildProduct);

// ─────────────────────────────── Orders ────────────────────────────────────

export interface DemoOrder {
  id: string;
  number: string;
  storeId: string;
  storeName: string;
  status: OrderState;
  fulfillmentStatus: FulfillmentState;
  customerName: string;
  customerEmail: string;
  shippingCity: string;
  shippingCountry: string;
  total: number;
  supplierCost: number;
  profitAmount: number;
  currency: string;
  trackingNumber: string | null;
  trackingCompany: string | null;
  trackingUrl: string | null;
  supplierOrderId: string | null;
  autoFulfilled: boolean;
  errorMessage: string | null;
  orderedAt: Date;
  items: { title: string; sku: string; quantity: number; unitPrice: number; productId: string; imageUrl: string }[];
}

const orderStatuses: { status: OrderState; fulf: FulfillmentState }[] = [
  { status: 'SHIPPED', fulf: 'FULFILLED' },
  { status: 'PAID', fulf: 'UNFULFILLED' },
  { status: 'SUPPLIER_PURCHASED', fulf: 'UNFULFILLED' },
  { status: 'DELIVERED', fulf: 'FULFILLED' },
  { status: 'PENDING', fulf: 'UNFULFILLED' },
  { status: 'SUPPLIER_ERROR', fulf: 'UNFULFILLED' },
  { status: 'SHIPPED', fulf: 'FULFILLED' },
  { status: 'DELIVERED', fulf: 'FULFILLED' },
];

const countries = ['ES', 'FR', 'DE', 'IT', 'PT', 'NL', 'BE'];
const cities: Record<string, string> = { ES: 'Madrid', FR: 'Lyon', DE: 'Múnich', IT: 'Milán', PT: 'Lisboa', NL: 'Utrecht', BE: 'Gante' };

export const demoOrders: DemoOrder[] = Array.from({ length: 34 }).map((_, i) => {
  const r = rng(`order-${i}`);
  const product = demoProducts[Math.floor(r() * demoProducts.length)];
  const st = orderStatuses[i % orderStatuses.length];
  const qty = r() > 0.8 ? 2 : 1;
  const total = round2(product.sellingPrice * qty);
  const cost = round2(product.costPrice * qty + product.shippingCost);
  const country = countries[Math.floor(r() * countries.length)];
  const shipped = st.fulf === 'FULFILLED';

  return {
    id: `order_${i + 1}`,
    number: `#${1042 + i}`,
    storeId: product.storeId,
    storeName: product.storeName,
    status: st.status,
    fulfillmentStatus: st.fulf,
    customerName: ['Laura Fernández', 'Pierre Dubois', 'Hans Müller', 'Giulia Rossi', 'João Silva', 'Emma Visser', 'Lucas Peeters'][i % 7],
    customerEmail: `cliente${1042 + i}@example.com`,
    shippingCity: cities[country],
    shippingCountry: country,
    total,
    supplierCost: cost,
    profitAmount: round2(total - cost - round2(total * 0.029 + 0.3)),
    currency: 'EUR',
    trackingNumber: shipped ? `LP00${(4812334 + i * 7919).toString()}CN` : null,
    trackingCompany: shipped ? ['4PX', 'Cainiao', 'DHL', 'Correos'][i % 4] : null,
    trackingUrl: shipped ? `https://t.17track.net/es#nums=LP00${(4812334 + i * 7919).toString()}CN` : null,
    supplierOrderId: st.status === 'SUPPLIER_ERROR' || st.status === 'PENDING' ? null : `AE-${482000 + i * 13}`,
    autoFulfilled: st.status !== 'PENDING',
    errorMessage: st.status === 'SUPPLIER_ERROR' ? 'Proveedor sin stock en la variante seleccionada (SKU agotado en AliExpress)' : null,
    orderedAt: hours(i * 7 + 1),
    items: [
      {
        title: product.title,
        sku: product.variants[0].sku,
        quantity: qty,
        unitPrice: product.sellingPrice,
        productId: product.id,
        imageUrl: product.images[0].url,
      },
    ],
  };
});

// ─────────────────────────────── Sync logs ─────────────────────────────────

export interface DemoSyncLog {
  id: string;
  type: string;
  status: SyncState;
  level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';
  message: string;
  productId: string | null;
  productTitle: string | null;
  storeName: string | null;
  changes: { field: string; from: string | number; to: string | number } | null;
  durationMs: number;
  createdAt: Date;
}

const logTemplates: { type: string; status: SyncState; level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG'; message: (p: DemoProduct) => string; changes?: (p: DemoProduct) => { field: string; from: number; to: number } }[] = [
  { type: 'PRICE_UPDATE', status: 'SUCCESS', level: 'INFO', message: (p) => `Precio actualizado por cambio de costo del proveedor (${p.supplierName})`, changes: (p) => ({ field: 'sellingPrice', from: round2(p.sellingPrice - 2.4), to: p.sellingPrice }) },
  { type: 'STOCK_UPDATE', status: 'SUCCESS', level: 'INFO', message: (p) => `Stock sincronizado en ${p.storeName}: ${p.stockTotal} unidades disponibles` },
  { type: 'IMPORT', status: 'SUCCESS', level: 'INFO', message: (p) => `Producto importado con ${p.variants.length} variantes y ${p.images.length} imágenes HD` },
  { type: 'FULL_REFRESH', status: 'SKIPPED', level: 'DEBUG', message: () => 'Sin cambios (hash del proveedor idéntico) — no se llama a la API de la tienda' },
  { type: 'STOCK_UPDATE', status: 'SUCCESS', level: 'WARN', message: () => 'Proveedor sin stock → producto marcado como AGOTADO en la tienda' },
  { type: 'FULL_REFRESH', status: 'FAILED', level: 'ERROR', message: () => 'Bloqueo anti-bot (403) tras 3 intentos — proxy rotado automáticamente' },
  { type: 'ORDER_PUSH', status: 'SUCCESS', level: 'INFO', message: () => 'Pedido enviado al proveedor y tracking registrado' },
  { type: 'PRICE_UPDATE', status: 'SUCCESS', level: 'INFO', message: (p) => `Margen recalculado (regla ${p.marginPct}%): ${p.profitAmount} € de beneficio neto` },
];

export const demoSyncLogs: DemoSyncLog[] = Array.from({ length: 140 }).map((_, i) => {
  const r = rng(`log-${i}`);
  const product = demoProducts[Math.floor(r() * demoProducts.length)];
  const t = logTemplates[i % logTemplates.length];
  return {
    id: `log_${i + 1}`,
    type: t.type,
    status: t.status,
    level: t.level,
    message: t.message(product),
    productId: product.id,
    productTitle: product.title,
    storeName: product.storeName,
    changes: t.changes ? t.changes(product) : null,
    durationMs: Math.floor(r() * 4200) + 180,
    createdAt: mins(i * 7 + Math.floor(r() * 6)),
  };
});

// ─────────────────────────────── Queue ─────────────────────────────────────

export const demoQueueJobs = [
  { id: 'job_1', name: 'sync:product', status: 'RUNNING' as SyncState, progress: 62, productTitle: demoProducts[0].title, priority: 1, scheduledFor: mins(0), startedAt: mins(1), finishedAt: null, attempts: 1, maxAttempts: 3, lastError: null },
  { id: 'job_2', name: 'sync:product', status: 'QUEUED' as SyncState, progress: 0, productTitle: demoProducts[3].title, priority: 2, scheduledFor: mins(-1), startedAt: null, finishedAt: null, attempts: 0, maxAttempts: 3, lastError: null },
  { id: 'job_3', name: 'sync:product', status: 'QUEUED' as SyncState, progress: 0, productTitle: demoProducts[5].title, priority: 2, scheduledFor: mins(-2), startedAt: null, finishedAt: null, attempts: 0, maxAttempts: 3, lastError: null },
  { id: 'job_4', name: 'sync:product', status: 'QUEUED' as SyncState, progress: 0, productTitle: demoProducts[7].title, priority: 3, scheduledFor: mins(-4), startedAt: null, finishedAt: null, attempts: 0, maxAttempts: 3, lastError: null },
  { id: 'job_5', name: 'order:push', status: 'SUCCESS' as SyncState, progress: 100, productTitle: null, priority: 1, scheduledFor: mins(6), startedAt: mins(6), finishedAt: mins(5), attempts: 1, maxAttempts: 5, lastError: null },
  { id: 'job_6', name: 'sync:product', status: 'FAILED' as SyncState, progress: 100, productTitle: demoProducts[4].title, priority: 1, scheduledFor: mins(18), startedAt: mins(18), finishedAt: mins(17), attempts: 3, maxAttempts: 3, lastError: 'Timeout al consultar AliExpress (proxy 91.214.x.x en cooldown)' },
  { id: 'job_7', name: 'sync:product', status: 'SUCCESS' as SyncState, progress: 100, productTitle: demoProducts[1].title, priority: 1, scheduledFor: mins(22), startedAt: mins(22), finishedAt: mins(21), attempts: 1, maxAttempts: 3, lastError: null },
  { id: 'job_8', name: 'sync:product', status: 'SUCCESS' as SyncState, progress: 100, productTitle: demoProducts[2].title, priority: 1, scheduledFor: mins(34), startedAt: mins(34), finishedAt: mins(33), attempts: 2, maxAttempts: 3, lastError: null },
];

export const demoQueueStats: DashboardKpis['queue'] = { waiting: 3, active: 1, completed: 1842, failed: 12, delayed: 0 };

// ─────────────────────────────── KPIs ──────────────────────────────────────

export const demoRevenueSeries = Array.from({ length: 7 }).map((_, i) => {
  const dayOrders = [12, 18, 15, 24, 21, 31, 27][i];
  const aov = [34.2, 36.8, 33.1, 39.4, 37.9, 41.2, 38.6][i];
  const revenue = round2(dayOrders * aov);
  return {
    date: days(6 - i).toISOString().slice(0, 10),
    revenue,
    profit: round2(revenue * (0.34 + i * 0.01)),
    orders: dayOrders,
  };
}).map((d) => ({ ...d }));

export const demoKpis: DashboardKpis = {
  revenue: round2(demoRevenueSeries.reduce((a, d) => a + d.revenue, 0)),
  revenueTrend: 18.4,
  profit: round2(demoRevenueSeries.reduce((a, d) => a + d.profit, 0)),
  profitTrend: 22.1,
  orders: demoRevenueSeries.reduce((a, d) => a + d.orders, 0),
  ordersTrend: 12.7,
  monitored: demoProducts.filter((p) => p.isMonitored).length,
  inStock: demoProducts.filter((p) => p.stockTotal > 0).length,
  outOfStock: demoProducts.filter((p) => p.stockTotal === 0).length,
  errors: demoProducts.filter((p) => p.status === 'ERROR').length,
  syncedLast24h: demoSyncLogs.filter((l) => l.status === 'SUCCESS').length,
  failedLast24h: demoSyncLogs.filter((l) => l.status === 'FAILED').length,
  avgSyncMs: Math.round(demoSyncLogs.reduce((a, l) => a + l.durationMs, 0) / demoSyncLogs.length),
  queue: demoQueueStats,
  revenueSeries: demoRevenueSeries,
};

// ─────────────────────────────── Helpers ───────────────────────────────────

/** Convierte un ScrapedProduct recién extraído en un DemoProduct persistible */
export function demoProductFromScraped(scraped: ScrapedProduct, extras: { storeId: string; storeName: string; supplierName: string; sellingPrice: number; marginPct: number }): DemoProduct {
  const id = `prod_new_${Date.now().toString(36)}`;
  const supplier = demoSuppliers.find((s) => s.name === extras.supplierName) ?? demoSuppliers[0];
  return {
    id,
    title: scraped.title,
    seoTitle: scraped.seoTitle ?? scraped.title.slice(0, 60),
    description: scraped.description,
    category: scraped.category ?? 'General',
    supplierId: supplier.id,
    supplier: scraped.supplier,
    supplierName: extras.supplierName,
    storeId: extras.storeId,
    storeName: extras.storeName,
    sourceUrl: scraped.sourceUrl,
    supplierProductId: scraped.supplierProductId ?? '',
    currency: scraped.currency,
    costPrice: scraped.variants[0]?.price ?? 0,
    shippingCost: scraped.shipping.cheapestCost,
    sellingPrice: extras.sellingPrice,
    compareAtPrice: roundPsychological(extras.sellingPrice * 1.35),
    marginPct: extras.marginPct,
    profitAmount: round2(extras.sellingPrice - (scraped.variants[0]?.price ?? 0) - scraped.shipping.cheapestCost),
    stockTotal: scraped.stockTotal,
    ordersCount: scraped.ordersCount,
    ratingAvg: scraped.ratingAvg,
    ratingCount: scraped.ratingCount,
    status: 'DRAFT',
    isMonitored: true,
    storeProductId: null,
    lastSyncedAt: null,
    lastSyncStatus: null,
    nextSyncAt: new Date(ahoraApp() + 3_600_000),
    images: scraped.images.map((img, i) => ({ url: img.hdUrl ?? img.url, hdUrl: img.hdUrl ?? img.url, isMain: i === 0 })),
    variants: scraped.variants.map((v, i) => ({
      id: `${id}_v${i}`,
      sku: v.sku,
      title: v.title,
      color: v.color ?? null,
      size: v.size ?? null,
      costPrice: v.price,
      sellingPrice: extras.sellingPrice,
      stock: v.stock,
      storeVariantId: null,
      imageUrl: v.imageUrl ?? scraped.images[0]?.hdUrl ?? null,
    })),
    reviews: scraped.reviews.map((r, i) => ({
      id: `${id}_r${i}`,
      rating: r.rating,
      author: r.author ?? 'Anónimo',
      country: r.authorCountry ?? '—',
      text: r.text ?? '',
      date: r.date ? new Date(r.date) : new Date(),
      images: r.images,
    })),
    shippingOptions: scraped.shipping.options.map((o) => ({
      method: o.method,
      carrier: o.carrier ?? '—',
      cost: o.cost,
      minDays: o.minDays ?? 0,
      maxDays: o.maxDays ?? 0,
      isTracked: o.isTracked,
    })),
    createdAt: new Date(),
    tags: scraped.tags,
  };
}
