/**
 * src/lib/data.ts — Capa de acceso a datos única para UI y API.
 *
 * Con DATABASE_URL → PostgreSQL vía Prisma.
 * Sin DATABASE_URL → dataset en memoria (src/lib/demo-data.ts), de modo que el
 * dashboard es totalmente navegable en local/preview sin infraestructura.
 */
import { hasDatabase, prisma } from './prisma';
import { getQueueStats, listQueueJobs, getSchedulerInfo } from './queue';
import {
  demoKpis,
  demoOrders,
  demoPricingRules,
  demoProducts,
  demoSyncLogs,
  demoStores,
  demoSuppliers,
  type DemoProduct,
} from './demo-data';
import { computeSellingPrice } from './pricing';
import { BASE_CURRENCY, toEur } from './fx';
import { SUPPLIER_LABEL } from './suppliers';
import type { DashboardKpis, ProductState } from './types';
import { round2 } from './utils';

// ─────────────────────────────── Config ────────────────────────────────────

export const dataMode = () => (hasDatabase() ? 'postgres' : 'demo');

// ─────────────────────────────── Tiendas ───────────────────────────────────

export interface StoreView {
  id: string;
  platform: 'SHOPIFY' | 'WOOCOMMERCE';
  name: string;
  domain: string;
  status: 'PENDING' | 'CONNECTED' | 'ERROR' | 'DISCONNECTED';
  currency: string;
  productsCount: number;
  ordersCount: number;
  lastPingAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  settings: Record<string, any> | null;
}

export async function getStores(userId?: string): Promise<StoreView[]> {
  if (!hasDatabase()) return demoStores as StoreView[];
  const rows = await prisma.store.findMany({
    where: userId ? { userId } : undefined,
    include: { _count: { select: { products: true, orders: true } } },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((s) => ({
    id: s.id,
    platform: s.platform === 'SHOPIFY' ? 'SHOPIFY' : 'WOOCOMMERCE',
    name: s.name,
    domain: s.domain,
    status: s.status as StoreView['status'],
    currency: (s.settings as any)?.currency ?? 'EUR',
    productsCount: s._count.products,
    ordersCount: s._count.orders,
    lastPingAt: s.lastPingAt,
    lastError: s.lastError,
    createdAt: s.createdAt,
    settings: (s.settings as Record<string, any>) ?? null,
  }));
}

export async function getSuppliers() {
  if (!hasDatabase()) return demoSuppliers;
  const rows = await prisma.supplier.findMany({ include: { _count: { select: { products: true } } }, orderBy: { name: 'asc' } });
  return rows.map((s) => ({
    id: s.id,
    type: s.type,
    name: s.name,
    productsCount: s._count.products,
    avgDelivery: '—',
    rateLimitRpm: s.rateLimitRpm,
    isEnabled: s.isEnabled,
  }));
}

// ─────────────────────────────── Productos ─────────────────────────────────

export interface ProductFilters {
  search?: string;
  status?: ProductState | 'ALL';
  storeId?: string;
  supplierId?: string;
  onlyProblems?: boolean;
  limit?: number;
  page?: number;
  sort?: 'recent' | 'title' | 'stock' | 'profit' | 'price';
}

export interface ProductListItem {
  id: string;
  title: string;
  image: string | null;
  category: string;
  supplierName: string;
  storeName: string;
  costPrice: number;
  sellingPrice: number;
  profitAmount: number;
  marginPct: number;
  stockTotal: number;
  variantsCount: number;
  status: ProductState;
  isMonitored: boolean;
  lastSyncedAt: Date | null;
  lastSyncStatus: string | null;
  nextSyncAt: Date | null;
  ordersCount: number;
  ratingAvg: number;
  currency: string;
}

export async function getProducts(filters: ProductFilters = {}): Promise<{ items: ProductListItem[]; total: number; page: number; pages: number }> {
  const limit = filters.limit ?? 12;
  const page = filters.page ?? 1;

  if (!hasDatabase()) {
    let rows = [...demoProducts];
    if (filters.search) {
      const q = filters.search.toLowerCase();
      rows = rows.filter((p) => p.title.toLowerCase().includes(q) || p.supplierProductId.includes(q) || p.category.toLowerCase().includes(q));
    }
    if (filters.status && filters.status !== 'ALL') rows = rows.filter((p) => p.status === filters.status);
    if (filters.storeId) rows = rows.filter((p) => p.storeId === filters.storeId);
    if (filters.supplierId) rows = rows.filter((p) => p.supplierId === filters.supplierId);
    if (filters.onlyProblems) rows = rows.filter((p) => p.stockTotal === 0 || p.status === 'ERROR' || p.lastSyncStatus === 'FAILED');

    const sorters: Record<string, (a: DemoProduct, b: DemoProduct) => number> = {
      recent: (a, b) => (b.lastSyncedAt?.getTime() ?? 0) - (a.lastSyncedAt?.getTime() ?? 0),
      title: (a, b) => a.title.localeCompare(b.title),
      stock: (a, b) => a.stockTotal - b.stockTotal,
      profit: (a, b) => b.profitAmount - a.profitAmount,
      price: (a, b) => b.sellingPrice - a.sellingPrice,
    };
    rows.sort(sorters[filters.sort ?? 'recent']);

    const total = rows.length;
    const paged = rows.slice((page - 1) * limit, page * limit);
    return {
      items: paged.map((p) => ({
        id: p.id,
        title: p.title,
        image: p.images[0]?.url ?? null,
        category: p.category,
        supplierName: p.supplierName,
        storeName: p.storeName,
        costPrice: p.costPrice,
        sellingPrice: p.sellingPrice,
        profitAmount: p.profitAmount,
        marginPct: p.marginPct,
        stockTotal: p.stockTotal,
        variantsCount: p.variants.length,
        status: p.status,
        isMonitored: p.isMonitored,
        lastSyncedAt: p.lastSyncedAt,
        lastSyncStatus: p.lastSyncStatus,
        nextSyncAt: p.nextSyncAt,
        ordersCount: p.ordersCount,
        ratingAvg: p.ratingAvg,
        currency: p.currency,
      })),
      total,
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  const where: any = {};
  if (filters.search) {
    where.OR = [
      { title: { contains: filters.search, mode: 'insensitive' } },
      { supplierProductId: { contains: filters.search } },
      { category: { contains: filters.search, mode: 'insensitive' } },
    ];
  }
  if (filters.status && filters.status !== 'ALL') where.status = filters.status;
  if (filters.storeId) where.storeId = filters.storeId;
  if (filters.supplierId) where.supplierId = filters.supplierId;
  if (filters.onlyProblems) {
    where.OR = [...(where.OR ?? []), { stockTotal: 0 }, { status: 'ERROR' }, { lastSyncStatus: 'FAILED' }];
  }

  const orderBy: any =
    filters.sort === 'title'
      ? { title: 'asc' }
      : filters.sort === 'stock'
        ? { stockTotal: 'asc' }
        : filters.sort === 'profit'
          ? { profitAmount: 'desc' }
          : filters.sort === 'price'
            ? { sellingPrice: 'desc' }
            : { updatedAt: 'desc' };

  const [rows, total] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
      include: { images: { take: 1, orderBy: { position: 'asc' } }, _count: { select: { variants: true } }, store: true, supplier: true },
    }),
    prisma.product.count({ where }),
  ]);

  return {
    items: rows.map((p) => ({
      id: p.id,
      title: p.title,
      image: p.images[0]?.url ?? null,
      category: p.category ?? 'General',
      supplierName: p.supplier?.name ?? '—',
      storeName: p.store?.name ?? 'Sin tienda',
      costPrice: Number(p.costPrice),
      sellingPrice: Number(p.sellingPrice),
      profitAmount: Number(p.profitAmount),
      marginPct: Number(p.marginPct),
      stockTotal: p.stockTotal,
      variantsCount: p._count.variants,
      status: p.status as ProductState,
      isMonitored: p.isMonitored,
      lastSyncedAt: p.lastSyncedAt,
      lastSyncStatus: p.lastSyncStatus,
      nextSyncAt: p.nextSyncAt,
      ordersCount: p.ordersCount,
      ratingAvg: p.ratingAvg,
      currency: p.currency,
    })),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
  };
}

export async function getProduct(id: string): Promise<DemoProduct | null> {
  if (!hasDatabase()) return demoProducts.find((p) => p.id === id) ?? null;
  const p = await prisma.product.findUnique({
    where: { id },
    include: {
      images: { orderBy: { position: 'asc' } },
      variants: { orderBy: { position: 'asc' } },
      reviews: { orderBy: { reviewedAt: 'desc' }, take: 20 },
      store: true,
      supplier: true,
      pricingRule: true,
      syncLogs: { orderBy: { createdAt: 'desc' }, take: 20 },
    },
  });
  if (!p) return null;
  return {
    id: p.id,
    title: p.title,
    seoTitle: p.seoTitle ?? p.title,
    description: p.description,
    category: p.category ?? 'General',
    supplierId: p.supplierId,
    supplier: p.supplier?.type ?? 'ALIEXPRESS',
    supplierName: p.supplier?.name ?? '—',
    storeId: p.storeId ?? '',
    storeName: p.store?.name ?? 'Sin tienda',
    sourceUrl: p.sourceUrl,
    supplierProductId: p.supplierProductId ?? '',
    currency: p.currency,
    costPrice: Number(p.costPrice),
    shippingCost: Number(p.shippingCost),
    sellingPrice: Number(p.sellingPrice),
    compareAtPrice: Number(p.compareAtPrice ?? 0),
    marginPct: Number(p.marginPct),
    profitAmount: Number(p.profitAmount),
    stockTotal: p.stockTotal,
    ordersCount: p.ordersCount,
    ratingAvg: p.ratingAvg,
    ratingCount: p.ratingCount,
    status: p.status as ProductState,
    isMonitored: p.isMonitored,
    storeProductId: p.storeProductId,
    lastSyncedAt: p.lastSyncedAt,
    lastSyncStatus: p.lastSyncStatus as any,
    nextSyncAt: p.nextSyncAt,
    images: p.images.map((i) => ({ url: i.url, hdUrl: i.hdUrl ?? i.url, isMain: i.isMain })),
    variants: p.variants.map((v) => ({
      id: v.id,
      sku: v.sku ?? '—',
      title: v.title,
      color: v.color,
      size: v.size,
      costPrice: Number(v.costPrice),
      sellingPrice: Number(v.sellingPrice),
      stock: v.stock,
      storeVariantId: v.storeVariantId,
      imageUrl: v.imageUrl,
    })),
    reviews: p.reviews.map((r) => ({
      id: r.id,
      rating: r.rating,
      author: r.author ?? 'Anónimo',
      country: r.authorCountry ?? '—',
      text: r.text ?? '',
      date: r.reviewedAt ?? r.createdAt,
      images: r.images,
    })),
    shippingOptions: ((p.shippingOptions as any[]) ?? []).map((o) => ({
      method: o.method ?? '—',
      carrier: o.carrier ?? '—',
      cost: Number(o.cost ?? 0),
      minDays: o.minDays ?? 0,
      maxDays: o.maxDays ?? 0,
      isTracked: Boolean(o.isTracked),
    })),
    createdAt: p.createdAt,
    tags: p.tags,
  } as DemoProduct;
}

export async function updateProduct(
  id: string,
  patch: Partial<{
    title: string;
    description: string;
    sellingPrice: number;
    compareAtPrice: number;
    marginPct: number;
    status: ProductState;
    isMonitored: boolean;
    autoUpdatePrice: boolean;
    autoUpdateStock: boolean;
    category: string;
    tags: string[];
  }>,
) {
  if (!hasDatabase()) {
    const p = demoProducts.find((x) => x.id === id);
    if (!p) return null;
    if (patch.title !== undefined) p.title = patch.title;
    if (patch.description !== undefined) p.description = patch.description;
    if (patch.sellingPrice !== undefined) {
      p.sellingPrice = round2(patch.sellingPrice);
      p.profitAmount = round2(p.sellingPrice - p.costPrice - p.shippingCost - 0.3);
      p.marginPct = p.sellingPrice > 0 ? round2((p.profitAmount / p.sellingPrice) * 100) : p.marginPct;
    }
    if (patch.marginPct !== undefined) {
      p.marginPct = patch.marginPct;
      const b = computeSellingPrice(p.costPrice, p.shippingCost, { markupPct: patch.marginPct });
      p.sellingPrice = b.sellingPrice;
      p.profitAmount = b.profit;
    }
    if (patch.status !== undefined) p.status = patch.status;
    if (patch.isMonitored !== undefined) p.isMonitored = patch.isMonitored;
    if (patch.category !== undefined) p.category = patch.category;
    if (patch.tags !== undefined) p.tags = patch.tags;
    return p;
  }

  return prisma.product.update({
    where: { id },
    data: {
      ...patch,
      ...(patch.sellingPrice !== undefined
        ? { profitAmount: round2(patch.sellingPrice) }
        : {}),
    },
  });
}

export async function deleteProduct(id: string) {
  if (!hasDatabase()) {
    const idx = demoProducts.findIndex((p) => p.id === id);
    if (idx >= 0) demoProducts.splice(idx, 1);
    return { ok: idx >= 0 };
  }
  await prisma.product.delete({ where: { id } });
  return { ok: true };
}

export async function toggleMonitor(id: string, isMonitored: boolean) {
  return updateProduct(id, { isMonitored });
}

export async function createProductFromScraped(
  scraped: import('./types').ScrapedProduct,
  opts: { userId: string; storeId: string; sellingPrice: number; marginPct: number; status?: ProductState },
) {
  if (!hasDatabase()) {
    const { demoProductFromScraped } = await import('./demo-data');
    const store = demoStores.find((s) => s.id === opts.storeId) ?? demoStores[0];
    const product = demoProductFromScraped(scraped, {
      storeId: store.id,
      storeName: store.name,
      supplierName: demoSuppliers.find((s) => s.type === scraped.supplier)?.name ?? scraped.supplier,
      sellingPrice: opts.sellingPrice,
      marginPct: opts.marginPct,
    });
    product.status = opts.status ?? 'DRAFT';
    demoProducts.unshift(product);
    return product;
  }

  // El proveedor se busca por tipo y, si es la primera vez que aparece ese tipo
  // (por ejemplo una tienda genérica), se crea: nunca se atribuye el producto al
  // proveedor equivocado por no existir la fila.
  const supplierLabel = SUPPLIER_LABEL[scraped.supplier] ?? scraped.supplier;
  const supplier =
    (await prisma.supplier.findFirst({ where: { type: scraped.supplier } })) ??
    (await prisma.supplier.create({
      data: {
        type: scraped.supplier,
        name: supplierLabel,
        baseUrl: scraped.sourceUrl ? new URL(scraped.sourceUrl).origin : 'https://example.com',
        isEnabled: true,
      },
    }));
  const rule = await prisma.pricingRule.findFirst({ where: { userId: opts.userId, isDefault: true } });

  // ── Cambio de divisa ──────────────────────────────────────────────────────
  // La tienda vende en euros: el coste y el envío del proveedor se convierten
  // antes de guardarlos. Sin esto, un producto de 57 $ quedaba registrado como
  // 57 €, el beneficio salía inflado y el worker de sync comparaba peras con
  // manzanas cada hora. Si el llamante ya trae el valor convertido
  // (`costPriceEur`), se usa tal cual.
  const supplierCurrency = scraped.currency ?? BASE_CURRENCY;
  const costEur = Number((scraped.variants[0] as any)?.costPriceEur ?? toEur(scraped.variants[0]?.price ?? 0, supplierCurrency));
  const shippingEur = Number((scraped as any).shippingCostEur ?? toEur(scraped.shipping.cheapestCost ?? 0, supplierCurrency));

  return prisma.product.create({
    data: {
      userId: opts.userId,
      storeId: opts.storeId,
      supplierId: supplier?.id ?? (await prisma.supplier.findFirst())!.id,
      pricingRuleId: rule?.id,
      sourceUrl: scraped.sourceUrl,
      supplierProductId: scraped.supplierProductId,
      title: scraped.title,
      seoTitle: scraped.seoTitle,
      description: scraped.description,
      bullets: scraped.bullets,
      category: scraped.category,
      categoryPath: scraped.categoryPath,
      tags: scraped.tags,
      brand: scraped.brand,
      currency: BASE_CURRENCY,
      costPrice: costEur,
      shippingCost: shippingEur,
      sellingPrice: opts.sellingPrice,
      marginPct: opts.marginPct,
      profitAmount: round2(opts.sellingPrice - costEur - shippingEur),
      stockTotal: scraped.stockTotal,
      ordersCount: scraped.ordersCount,
      ratingAvg: scraped.ratingAvg,
      ratingCount: scraped.ratingCount,
      status: opts.status ?? 'DRAFT',
      shippingOptions: scraped.shipping.options as any,
      rawPayload: scraped as any,
      nextSyncAt: new Date(Date.now() + 3_600_000),
      images: { create: scraped.images.map((img, i) => ({ url: img.hdUrl ?? img.url, hdUrl: img.hdUrl, alt: img.alt, position: i, isMain: i === 0 })) },
      variants: {
        create: scraped.variants.map((v, i) => ({
          supplierVariantId: v.supplierVariantId,
          sku: v.sku,
          title: v.title,
          option1Name: v.option1Name,
          option1Value: v.option1Value,
          option2Name: v.option2Name,
          option2Value: v.option2Value,
          color: v.color,
          size: v.size,
          material: v.material,
          costPrice: Number((v as any).costPriceEur ?? toEur(v.price, supplierCurrency)),
          shippingCost: shippingEur,
          sellingPrice: opts.sellingPrice,
          stock: v.stock,
          weightGrams: v.weightGrams,
          imageUrl: v.imageUrl,
          position: i,
        })),
      },
      reviews: {
        create: scraped.reviews.slice(0, 40).map((r) => ({
          supplierReviewId: r.supplierReviewId,
          rating: r.rating,
          author: r.author,
          authorCountry: r.authorCountry,
          text: r.text,
          images: r.images,
          helpfulCount: r.helpfulCount ?? 0,
          reviewedAt: r.date ? new Date(r.date) : undefined,
        })),
      },
    },
  });
}

// ─────────────────────────────── Órdenes ───────────────────────────────────

export async function getOrders(filters: { status?: string; fulfillment?: string; search?: string; limit?: number } = {}) {
  const limit = filters.limit ?? 50;
  if (!hasDatabase()) {
    let rows = [...demoOrders];
    if (filters.status && filters.status !== 'ALL') rows = rows.filter((o) => o.status === filters.status);
    if (filters.fulfillment && filters.fulfillment !== 'ALL') rows = rows.filter((o) => o.fulfillmentStatus === filters.fulfillment);
    if (filters.search) {
      const q = filters.search.toLowerCase();
      rows = rows.filter((o) => o.number.toLowerCase().includes(q) || o.customerName.toLowerCase().includes(q) || (o.trackingNumber ?? '').toLowerCase().includes(q));
    }
    return rows.slice(0, limit);
  }

  const rows = await prisma.order.findMany({
    where: {
      ...(filters.status && filters.status !== 'ALL' ? { status: filters.status as any } : {}),
      ...(filters.fulfillment && filters.fulfillment !== 'ALL' ? { fulfillmentStatus: filters.fulfillment as any } : {}),
      ...(filters.search
        ? {
            OR: [
              { storeOrderNumber: { contains: filters.search, mode: 'insensitive' } },
              { customerName: { contains: filters.search, mode: 'insensitive' } },
              { trackingNumber: { contains: filters.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    include: { items: true, store: true },
    orderBy: { orderedAt: 'desc' },
    take: limit,
  });

  return rows.map((o) => ({
    id: o.id,
    number: o.storeOrderNumber,
    storeId: o.storeId,
    storeName: o.store.name,
    status: o.status,
    fulfillmentStatus: o.fulfillmentStatus,
    customerName: o.customerName ?? '—',
    customerEmail: o.customerEmail ?? '',
    shippingCity: o.shippingCity ?? '',
    shippingCountry: o.shippingCountry ?? '',
    total: Number(o.total),
    supplierCost: Number(o.supplierCost),
    profitAmount: Number(o.profitAmount),
    currency: o.currency,
    trackingNumber: o.trackingNumber,
    trackingCompany: o.trackingCompany,
    trackingUrl: o.trackingUrl,
    supplierOrderId: o.supplierOrderId,
    autoFulfilled: o.autoFulfilled,
    errorMessage: o.errorMessage,
    orderedAt: o.orderedAt,
    items: o.items.map((i) => ({
      title: i.title,
      sku: i.sku ?? '—',
      quantity: i.quantity,
      unitPrice: Number(i.unitPrice),
      productId: i.productId ?? '',
      imageUrl: i.imageUrl,
    })),
  }));
}

export async function getOrdersSummary() {
  if (!hasDatabase()) {
    return {
      total: demoOrders.length,
      pending: demoOrders.filter((o) => o.status === 'PENDING').length,
      toFulfill: demoOrders.filter((o) => o.fulfillmentStatus === 'UNFULFILLED').length,
      shipped: demoOrders.filter((o) => o.fulfillmentStatus === 'FULFILLED').length,
      errors: demoOrders.filter((o) => o.status === 'SUPPLIER_ERROR').length,
      revenue: round2(demoOrders.reduce((a, o) => a + o.total, 0)),
      profit: round2(demoOrders.reduce((a, o) => a + o.profitAmount, 0)),
    };
  }
  const [total, pending, toFulfill, shipped, errors, agg] = await Promise.all([
    prisma.order.count(),
    prisma.order.count({ where: { status: 'PENDING' } }),
    prisma.order.count({ where: { fulfillmentStatus: 'UNFULFILLED' } }),
    prisma.order.count({ where: { fulfillmentStatus: 'FULFILLED' } }),
    prisma.order.count({ where: { status: 'SUPPLIER_ERROR' } }),
    prisma.order.aggregate({ _sum: { total: true, profitAmount: true } }),
  ]);
  return {
    total,
    pending,
    toFulfill,
    shipped,
    errors,
    revenue: Number(agg._sum.total ?? 0),
    profit: Number(agg._sum.profitAmount ?? 0),
  };
}

// ─────────────────────────────── Sync logs ─────────────────────────────────

export async function getSyncLogs(filters: { limit?: number; productId?: string; status?: string; type?: string; level?: string } = {}) {
  const limit = filters.limit ?? 60;
  if (!hasDatabase()) {
    let rows = [...demoSyncLogs];
    if (filters.productId) rows = rows.filter((l) => l.productId === filters.productId);
    if (filters.status && filters.status !== 'ALL') rows = rows.filter((l) => l.status === filters.status);
    if (filters.type && filters.type !== 'ALL') rows = rows.filter((l) => l.type === filters.type);
    if (filters.level && filters.level !== 'ALL') rows = rows.filter((l) => l.level === filters.level);
    return rows.slice(0, limit);
  }
  const rows = await prisma.syncLog.findMany({
    where: {
      ...(filters.productId ? { productId: filters.productId } : {}),
      ...(filters.status && filters.status !== 'ALL' ? { status: filters.status as any } : {}),
      ...(filters.type && filters.type !== 'ALL' ? { type: filters.type as any } : {}),
      ...(filters.level && filters.level !== 'ALL' ? { level: filters.level as any } : {}),
    },
    include: { product: { select: { title: true } }, store: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  return rows.map((l) => ({
    id: l.id,
    type: l.type,
    status: l.status,
    level: l.level,
    message: l.message,
    productId: l.productId,
    productTitle: l.product?.title ?? null,
    storeName: l.store?.name ?? null,
    changes: (l.changes as any) ?? null,
    durationMs: l.durationMs ?? 0,
    createdAt: l.createdAt,
  }));
}

// ─────────────────────────────── KPIs / queue ──────────────────────────────

export async function getKpis(): Promise<DashboardKpis> {
  const [queue, scheduler] = await Promise.all([getQueueStats(), getSchedulerInfo()]);
  if (!hasDatabase()) return { ...demoKpis, queue };

  const since24h = new Date(Date.now() - 86_400_000);
  const [products, ordersAgg, logs, recentOrders, failed, avg] = await Promise.all([
    prisma.product.groupBy({ by: ['status'], _count: true }),
    prisma.order.aggregate({
      where: { orderedAt: { gte: new Date(Date.now() - 7 * 86_400_000) } },
      _sum: { total: true, profitAmount: true },
      _count: true,
    }),
    prisma.syncLog.count({ where: { createdAt: { gte: since24h }, status: 'SUCCESS' } }),
    prisma.order.findMany({
      where: { orderedAt: { gte: new Date(Date.now() - 7 * 86_400_000) } },
      select: { orderedAt: true, total: true, profitAmount: true },
      orderBy: { orderedAt: 'asc' },
    }),
    prisma.syncLog.count({ where: { createdAt: { gte: since24h }, status: 'FAILED' } }),
    prisma.syncLog.aggregate({ where: { createdAt: { gte: since24h } }, _avg: { durationMs: true } }),
  ]);

  const byStatus = Object.fromEntries(products.map((p) => [p.status, p._count])) as Record<string, number>;
  const days = Array.from({ length: 7 }).map((_, i) => {
    const d = new Date(Date.now() - (6 - i) * 86_400_000);
    const key = d.toISOString().slice(0, 10);
    const dayOrders = recentOrders.filter((o) => o.orderedAt.toISOString().slice(0, 10) === key);
    return {
      date: key,
      revenue: round2(dayOrders.reduce((a, o) => a + Number(o.total), 0)),
      profit: round2(dayOrders.reduce((a, o) => a + Number(o.profitAmount), 0)),
      orders: dayOrders.length,
    };
  });

  return {
    revenue: round2(Number(ordersAgg._sum.total ?? 0)),
    revenueTrend: 0,
    profit: round2(Number(ordersAgg._sum.profitAmount ?? 0)),
    profitTrend: 0,
    orders: ordersAgg._count,
    ordersTrend: 0,
    monitored: await prisma.product.count({ where: { isMonitored: true } }),
    inStock: await prisma.product.count({ where: { stockTotal: { gt: 0 } } }),
    outOfStock: await prisma.product.count({ where: { stockTotal: 0 } }),
    errors: byStatus.ERROR ?? 0,
    syncedLast24h: logs,
    failedLast24h: failed,
    avgSyncMs: Math.round(Number(avg._avg.durationMs ?? 0)),
    queue,
    revenueSeries: days,
  };
}

export async function getSyncMonitor() {
  const [stats, jobs, scheduler, logs] = await Promise.all([
    getQueueStats(),
    listQueueJobs(20),
    getSchedulerInfo(),
    getSyncLogs({ limit: 30 }),
  ]);
  return { stats, jobs, scheduler, logs };
}

export async function getPricingRules(userId?: string) {
  if (!hasDatabase()) return demoPricingRules;
  const rows = await prisma.pricingRule.findMany({ where: userId ? { userId } : undefined, orderBy: [{ isDefault: 'desc' }, { name: 'asc' }] });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    markupPct: Number(r.markupPct),
    fixedFee: Number(r.fixedFee),
    minProfit: Number(r.minProfit),
    minPrice: r.minPrice ? Number(r.minPrice) : null,
    maxPrice: r.maxPrice ? Number(r.maxPrice) : null,
    roundTo: r.roundTo ? Number(r.roundTo) : 0.99,
    includeShipping: r.includeShipping,
    applyToCategory: r.applyToCategory,
    isDefault: r.isDefault,
    isActive: r.isActive,
  }));
}

export async function getDefaultUserId() {
  if (!hasDatabase()) return 'user_demo_1';
  const user = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
  return user?.id ?? 'user_demo_1';
}

export async function getActiveDirectory() {
  const [stores, suppliers, rules] = await Promise.all([getStores(), getSuppliers(), getPricingRules()]);
  return { stores, suppliers, rules, mode: dataMode() };
}
