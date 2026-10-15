/**
 * Tipos de dominio compartidos entre scraper, workers, API y UI.
 * No dependen de @prisma/client para poder usarse también en scripts sueltos.
 */

export type SupplierKey = 'ALIEXPRESS' | 'CJ_DROPSHIPPING' | 'AMAZON' | 'ALIBABA' | 'TEMU' | 'OTHER';

export type StorePlatformKey = 'SHOPIFY' | 'WOOCOMMERCE';

export type ProductState =
  | 'DRAFT'
  | 'ACTIVE'
  | 'PAUSED'
  | 'OUT_OF_STOCK'
  | 'ERROR'
  | 'ARCHIVED';

export type SyncState = 'QUEUED' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'SKIPPED';

export type OrderState =
  | 'PENDING'
  | 'PAID'
  | 'SUPPLIER_PURCHASED'
  | 'SUPPLIER_ERROR'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'CANCELED'
  | 'REFUNDED';

export type FulfillmentState = 'UNFULFILLED' | 'PARTIAL' | 'FULFILLED' | 'RESTOCKED';

export interface ScrapedVariant {
  /** ID de variante en el proveedor (AliExpress skuAttr / Amazon ASIN+size) */
  supplierVariantId: string;
  sku: string;
  title: string;
  color?: string;
  size?: string;
  material?: string;
  option1Name?: string;
  option1Value?: string;
  option2Name?: string;
  option2Value?: string;
  price: number;
  compareAtPrice?: number;
  stock: number;
  imageUrl?: string;
  weightGrams?: number;
}

export interface ScrapedShippingOption {
  method: string;
  carrier?: string;
  cost: number;
  currency: string;
  minDays?: number;
  maxDays?: number;
  isTracked: boolean;
  destinationCountry?: string;
}

export interface ScrapedReview {
  supplierReviewId?: string;
  rating: number;
  author?: string;
  authorCountry?: string;
  text?: string;
  date?: string;
  images: string[];
  helpfulCount?: number;
  variantSku?: string;
}

export interface ScrapedProduct {
  sourceUrl: string;
  supplier: SupplierKey;
  supplierProductId?: string;
  title: string;
  seoTitle?: string;
  description: string;
  bullets: string[];
  category?: string;
  categoryPath: string[];
  tags: string[];
  brand?: string;
  currency: string;
  images: { url: string; hdUrl?: string; alt?: string }[];
  variants: ScrapedVariant[];
  shipping: {
    options: ScrapedShippingOption[];
    /** Tarifa más barata (base del cálculo de coste total) */
    cheapestCost: number;
    /** Opción con seguimiento más rápida */
    fastest?: ScrapedShippingOption;
    shipsTo: string[];
  };
  reviews: ScrapedReview[];
  ratingAvg: number;
  ratingCount: number;
  ordersCount: number;
  stockTotal: number;
  specs: Record<string, string>;
  /** Avisos no fatales: campos que no se pudieron extraer, captchas, etc. */
  warnings: string[];
  extractionMeta: {
    mode: 'api' | 'service' | 'local' | 'demo';
    durationMs: number;
    proxyUsed?: string;
    extractorVersion: string;
    extractedAt: string;
    attempts: number;
  };
}

export interface PricingRuleLike {
  markupPct: number | string;
  fixedFee?: number | string | null;
  minProfit?: number | string | null;
  minPrice?: number | string | null;
  maxPrice?: number | string | null;
  roundTo?: number | string | null;
  includeShipping?: boolean;
}

export interface PriceBreakdown {
  cost: number;
  shipping: number;
  sellingPrice: number;
  compareAtPrice: number;
  profit: number;
  marginPct: number;
  ruleApplied: string;
}

export interface DashboardKpis {
  revenue: number;
  revenueTrend: number;
  profit: number;
  profitTrend: number;
  orders: number;
  ordersTrend: number;
  monitored: number;
  inStock: number;
  outOfStock: number;
  errors: number;
  syncedLast24h: number;
  failedLast24h: number;
  avgSyncMs: number;
  queue: { waiting: number; active: number; completed: number; failed: number; delayed: number };
  revenueSeries: { date: string; revenue: number; profit: number; orders: number }[];
}

export interface QueueStats {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: boolean;
  mode: 'redis' | 'demo';
}
