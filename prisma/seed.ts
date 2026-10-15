/**
 * prisma/seed.ts — datos de prueba para DropshipPilot
 * Uso: npm run prisma:seed
 */
import { PrismaClient, type Product, PlanTier, SupplierType, StorePlatform, StoreStatus, ProductStatus, OrderStatus, FulfillmentStatus, SyncType, SyncStatus, LogLevel } from '@prisma/client';

const prisma = new PrismaClient();

const MOCK_COFFEE = 'https://es.aliexpress.com/item/1005006123456789.html';

async function main() {
  console.log('🌱 Seeding DropshipPilot...');

  // ── Limpieza (orden inverso a las FK)
  await prisma.syncLog.deleteMany();
  await prisma.syncJob.deleteMany();
  await prisma.webhookEvent.deleteMany();
  await prisma.shippingQuote.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.productReview.deleteMany();
  await prisma.productImage.deleteMany();
  await prisma.productVariant.deleteMany();
  await prisma.product.deleteMany();
  await prisma.pricingRule.deleteMany();
  await prisma.store.deleteMany();
  await prisma.supplier.deleteMany();
  await prisma.subscription.deleteMany();
  await prisma.user.deleteMany();

  // ── Usuario demo
  const user = await prisma.user.create({
    data: {
      email: 'demo@dropshippilot.io',
      name: 'Marcos Delgado',
      role: 'OWNER',
      plan: PlanTier.PRO,
      subscription: {
        create: {
          plan: PlanTier.PRO,
          status: 'ACTIVE',
          stripeCustomerId: 'cus_demo_001',
          stripeSubscriptionId: 'sub_demo_001',
          creditsLimit: 5000,
          creditsUsed: 1284,
        },
      },
      pricingRules: {
        create: [
          { name: 'Regla global 40%', markupPct: 40, fixedFee: 0.5, minProfit: 2, roundTo: 0.99, isDefault: true },
          { name: 'Electrónica ligera', markupPct: 65, fixedFee: 1, minProfit: 4, applyToCategory: 'Electrónica' },
          { name: 'Gadgets premium 120%', markupPct: 120, fixedFee: 2, minProfit: 8, minPrice: 39.99 },
        ],
      },
    },
    include: { pricingRules: true },
  });
  const defaultRule = user.pricingRules.find((r) => r.isDefault)!;
  const techRule = user.pricingRules.find((r) => r.applyToCategory === 'Electrónica')!;

  // ── Proveedores
  const [ali, cj, amz] = await Promise.all([
    prisma.supplier.create({
      data: {
        type: SupplierType.ALIEXPRESS,
        name: 'AliExpress',
        baseUrl: 'https://www.aliexpress.com',
        logoUrl: 'https://cdn.simpleicons.org/aliexpress/FF4747',
        rateLimitRpm: 40,
        scraperConfig: { extractor: 'aliexpress.pdp_v2', needsProxy: true, hdImageRewrite: true },
      },
    }),
    prisma.supplier.create({
      data: {
        type: SupplierType.CJ_DROPSHIPPING,
        name: 'CJ Dropshipping',
        baseUrl: 'https://cjdropshipping.com',
        logoUrl: 'https://cdn.simpleicons.org/cj/1E90FF',
        rateLimitRpm: 120,
        scraperConfig: { extractor: 'cj.open_api', needsProxy: false },
      },
    }),
    prisma.supplier.create({
      data: {
        type: SupplierType.AMAZON,
        name: 'Amazon',
        baseUrl: 'https://www.amazon.es',
        logoUrl: 'https://cdn.simpleicons.org/amazon/FF9900',
        rateLimitRpm: 20,
        scraperConfig: { extractor: 'amazon.pdp_v3', needsProxy: true, captchaSolver: '2captcha' },
      },
    }),
  ]);

  // ── Tiendas
  const shopify = await prisma.store.create({
    data: {
      userId: user.id,
      platform: StorePlatform.SHOPIFY,
      name: 'Mi Tienda Gadgets',
      domain: 'gadgets-demo.myshopify.com',
      accessTokenEnc: 'shpat_demo_encrypted_token',
      apiVersion: '2025-01',
      scopes: ['write_products', 'read_orders', 'write_inventory'],
      status: StoreStatus.CONNECTED,
      lastPingAt: new Date(),
      webhookSecret: 'whsec_demo_secret',
      settings: { currency: 'EUR', autoImport: true, translate: true, marginOverride: null },
    },
  });

  const woo = await prisma.store.create({
    data: {
      userId: user.id,
      platform: StorePlatform.WOOCOMMERCE,
      name: 'Woo Demo Store',
      domain: 'woo-demo.es',
      accessTokenEnc: 'ck_demo',
      consumerSecretEnc: 'cs_demo',
      status: StoreStatus.ERROR,
      lastError: 'HTTP 401 — consumer_secret inválido o revocado',
      settings: { currency: 'EUR', autoImport: false },
    },
  });

  // ── Productos con variantes, imágenes y reseñas
  type Seed = {
    title: string; url: string; supplierId: string; storeId: string; category: string;
    cost: number; ship: number; margin: number; stock: number; orders: number;
    rating: number; reviews: number; images: string[];
    variants: { sku: string; color: string; size: string; cost: number; stock: number }[];
    status?: ProductStatus;
  };

  const seeds: Seed[] = [
    {
      title: 'Auriculares Bluetooth 5.3 TWS con Cancelación Activa de Ruido',
      url: 'https://es.aliexpress.com/item/1005006123456789.html',
      supplierId: ali.id, storeId: shopify.id, category: 'Electrónica',
      cost: 12.4, ship: 1.8, margin: 65, stock: 842, orders: 18234, rating: 4.8, reviews: 3421,
      images: [
        'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=1200&q=80',
        'https://images.unsplash.com/photo-1606220945770-b5b6c2c55bf1?w=1200&q=80',
        'https://images.unsplash.com/photo-1572569511254-d8f925fe2cbb?w=1200&q=80',
      ],
      variants: [
        { sku: 'TWS-BK', color: 'Negro', size: 'Única', cost: 12.4, stock: 410 },
        { sku: 'TWS-WH', color: 'Blanco', size: 'Única', cost: 12.4, stock: 302 },
        { sku: 'TWS-GY', color: 'Gris', size: 'Única', cost: 13.1, stock: 130 },
      ],
    },
    {
      title: 'Reloj Inteligente AMOLED 1.96" IP68 con Llamadas Bluetooth',
      url: 'https://es.aliexpress.com/item/1005005987654321.html',
      supplierId: ali.id, storeId: shopify.id, category: 'Electrónica',
      cost: 21.9, ship: 0, margin: 65, stock: 214, orders: 9210, rating: 4.7, reviews: 1877,
      images: [
        'https://images.unsplash.com/photo-1546868871-7041f2a55e12?w=1200&q=80',
        'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=1200&q=80',
      ],
      variants: [
        { sku: 'SW-BK', color: 'Negro', size: '46mm', cost: 21.9, stock: 120 },
        { sku: 'SW-SL', color: 'Plata', size: '46mm', cost: 23.4, stock: 94 },
      ],
    },
    {
      title: 'Organizador de Cocina Ajustable 4 Niveles Acero Inoxidable',
      url: 'https://www.cjdropshipping.com/product/kitchen-organizer-p12345.html',
      supplierId: cj.id, storeId: woo.id, category: 'Hogar',
      cost: 8.15, ship: 3.2, margin: 40, stock: 0, orders: 412, rating: 4.5, reviews: 219,
      status: ProductStatus.OUT_OF_STOCK,
      images: ['https://images.unsplash.com/photo-1584622650111-993a426fbf0a?w=1200&q=80'],
      variants: [{ sku: 'KO-STD', color: 'Acero', size: 'Estándar', cost: 8.15, stock: 0 }],
    },
    {
      title: 'Lámpara de Escritorio LED con Carga Inalámbrica y Sensor Táctil',
      url: 'https://www.amazon.es/dp/B0C9XYZ123',
      supplierId: amz.id, storeId: shopify.id, category: 'Hogar',
      cost: 18.7, ship: 0, margin: 40, stock: 63, orders: 128, rating: 4.4, reviews: 96,
      images: ['https://images.unsplash.com/photo-1507473885765-e6ed057f782c?w=1200&q=80'],
      variants: [
        { sku: 'LED-DK', color: 'Negro', size: 'Pro', cost: 18.7, stock: 40 },
        { sku: 'LED-WT', color: 'Blanco', size: 'Pro', cost: 18.7, stock: 23 },
      ],
    },
    {
      title: 'Mochila Antirrobo Impermeable USB 30L para Portátil 17"',
      url: 'https://es.aliexpress.com/item/1005004871231199.html',
      supplierId: ali.id, storeId: shopify.id, category: 'Moda',
      cost: 14.2, ship: 2.4, margin: 40, stock: 156, orders: 2140, rating: 4.9, reviews: 802,
      images: ['https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=1200&q=80'],
      variants: [
        { sku: 'BP-BK', color: 'Negro', size: '30L', cost: 14.2, stock: 96 },
        { sku: 'BP-GY', color: 'Gris', size: '30L', cost: 14.9, stock: 60 },
      ],
    },
    {
      title: 'Mini Proyector Portátil 1080P WiFi Bluetooth 8000 Lúmenes',
      url: 'https://es.aliexpress.com/item/1005005337714520.html',
      supplierId: ali.id, storeId: shopify.id, category: 'Electrónica',
      cost: 46.5, ship: 4.1, margin: 120, stock: 27, orders: 653, rating: 4.3, reviews: 311,
      images: ['https://images.unsplash.com/photo-1478720568477-152d9b164e26?w=1200&q=80'],
      variants: [{ sku: 'PJ-1080', color: 'Blanco', size: '1080P', cost: 46.5, stock: 27 }],
    },
  ];

  const createdProducts: Product[] = [];
  for (const s of seeds) {
    const rule = s.category === 'Electrónica' ? techRule : defaultRule;
    const selling = roundPsy(s.cost * (1 + s.margin / 100) + s.ship + Number(rule.fixedFee));
    const product = await prisma.product.create({
      data: {
        userId: user.id,
        storeId: s.storeId,
        supplierId: s.supplierId,
        pricingRuleId: rule.id,
        sourceUrl: s.url,
        supplierProductId: s.url.match(/(\d{10,})/)?.[1] ?? 'cj-p12345',
        title: s.title,
        seoTitle: s.title.slice(0, 60),
        description: `<p>${s.title}. Envío desde almacén internacional con seguimiento.</p><ul><li>Garantía 12 meses</li><li>Devolución 30 días</li></ul>`,
        bullets: ['Envío 24h desde almacén', 'Garantía 12 meses', 'Devolución gratuita 30 días'],
        category: s.category,
        categoryPath: [s.category, 'Dropshipping'],
        tags: [s.category.toLowerCase(), 'dropshipping', 'envio-rapido'],
        brand: 'Generic',
        currency: 'USD',
        costPrice: s.cost,
        shippingCost: s.ship,
        sellingPrice: selling,
        compareAtPrice: roundPsy(selling * 1.35),
        marginPct: s.margin,
        profitAmount: round2(selling - s.cost - s.ship - 0.3),
        stockTotal: s.stock,
        ordersCount: s.orders,
        ratingAvg: s.rating,
        ratingCount: s.reviews,
        status: s.status ?? ProductStatus.ACTIVE,
        storeProductId: `gid://shopify/Product/${Math.floor(Math.random() * 900000 + 100000)}`,
        storeHandle: slugify(s.title),
        lastSyncedAt: new Date(Date.now() - Math.floor(Math.random() * 1000 * 60 * 90)),
        lastSyncStatus: SyncStatus.SUCCESS,
        providerHash: hashish(`${s.cost}:${s.stock}`),
        nextSyncAt: new Date(Date.now() + 1000 * 60 * 30),
        shippingOptions: [
          { method: 'AliExpress Standard Shipping', carrier: '4PX', cost: 1.8, minDays: 12, maxDays: 20, isTracked: true },
          { method: 'Cainiao Super Economy', carrier: 'Cainiao', cost: 0, minDays: 25, maxDays: 40, isTracked: false },
          { method: 'DHL eCommerce', carrier: 'DHL', cost: 6.4, minDays: 5, maxDays: 9, isTracked: true },
        ],
        images: {
          create: s.images.map((url, i) => ({ url, hdUrl: url.replace('w=1200', 'w=2000'), position: i, isMain: i === 0 })),
        },
        variants: {
          create: s.variants.map((v, i) => ({
            supplierVariantId: `sv-${v.sku}`,
            sku: v.sku,
            title: `${v.color} / ${v.size}`,
            option1Name: 'Color',
            option1Value: v.color,
            option2Name: 'Talla',
            option2Value: v.size,
            color: v.color,
            size: v.size,
            costPrice: v.cost,
            shippingCost: s.ship,
            sellingPrice: roundPsy(v.cost * (1 + s.margin / 100) + s.ship + Number(rule.fixedFee)),
            compareAtPrice: roundPsy(v.cost * (1 + s.margin / 100) * 1.35),
            stock: v.stock,
            weightGrams: 320,
            imageUrl: s.images[i % s.images.length],
            position: i,
            storeVariantId: `gid://shopify/ProductVariant/${Math.floor(Math.random() * 9000000 + 1000000)}`,
            lastSyncedAt: new Date(),
          })),
        },
        reviews: {
          create: [
            { supplierReviewId: `${s.url}-r1`, rating: 5, author: 'Lucía M.', authorCountry: 'ES', text: 'Calidad sorprendente para el precio. Llegó en 14 días a Madrid.', reviewedAt: new Date(Date.now() - 6 * 864e5), images: [] },
            { supplierReviewId: `${s.url}-r2`, rating: 4, author: 'Andrés P.', authorCountry: 'MX', text: 'Buen producto, el embalaje llegó algo golpeado pero funciona perfecto.', reviewedAt: new Date(Date.now() - 12 * 864e5), images: [] },
            { supplierReviewId: `${s.url}-r3`, rating: 5, author: 'Karl S.', authorCountry: 'DE', text: 'Exactly as described, fast shipping to Germany.', reviewedAt: new Date(Date.now() - 20 * 864e5), images: [] },
          ],
        },
      },
    });
    createdProducts.push(product);
  }

  // ── Órdenes con items
  const orderSeeds = [
    { num: '#1042', status: OrderStatus.SHIPPED, fulf: FulfillmentStatus.FULFILLED, items: [{ p: 0, qty: 1 }], country: 'ES' },
    { num: '#1043', status: OrderStatus.PAID, fulf: FulfillmentStatus.UNFULFILLED, items: [{ p: 1, qty: 2 }], country: 'FR' },
    { num: '#1044', status: OrderStatus.SUPPLIER_PURCHASED, fulf: FulfillmentStatus.UNFULFILLED, items: [{ p: 4, qty: 1 }], country: 'IT' },
    { num: '#1045', status: OrderStatus.DELIVERED, fulf: FulfillmentStatus.FULFILLED, items: [{ p: 0, qty: 1 }, { p: 3, qty: 1 }], country: 'DE' },
    { num: '#1046', status: OrderStatus.PENDING, fulf: FulfillmentStatus.UNFULFILLED, items: [{ p: 5, qty: 1 }], country: 'PT' },
    { num: '#1047', status: OrderStatus.SUPPLIER_ERROR, fulf: FulfillmentStatus.UNFULFILLED, items: [{ p: 2, qty: 3 }], country: 'NL' },
  ];

  for (const o of orderSeeds) {
    const items = o.items.map((it) => {
      const p = createdProducts[it.p];
      return { p, qty: it.qty };
    });
    const sub = items.reduce((acc, it) => acc + Number(it.p.sellingPrice) * it.qty, 0);
    const cost = items.reduce((acc, it) => acc + Number(it.p.costPrice) * it.qty + Number(it.p.shippingCost), 0);
    await prisma.order.create({
      data: {
        userId: user.id,
        storeId: shopify.id,
        supplierId: items[0].p.supplierId,
        storeOrderId: `gid://shopify/Order/${o.num.replace('#', '')}`,
        storeOrderNumber: o.num,
        status: o.status,
        fulfillmentStatus: o.fulf,
        customerName: 'Cliente Demo ' + o.country,
        customerEmail: `cliente-${o.num.replace('#', '')}@example.com`,
        shippingName: 'Cliente Demo',
        shippingAddress1: 'Calle Gran Vía 12',
        shippingCity: 'Madrid',
        shippingProvince: 'Madrid',
        shippingCountry: o.country,
        shippingZip: '28013',
        currency: 'EUR',
        subtotal: round2(sub),
        shippingTotal: 0,
        total: round2(sub),
        supplierCost: round2(cost),
        profitAmount: round2(sub - cost),
        trackingNumber: o.fulf === 'FULFILLED' ? `LP00${Math.floor(Math.random() * 9000000 + 1000000)}CN` : null,
        trackingCompany: o.fulf === 'FULFILLED' ? '4PX' : null,
        trackingUrl: o.fulf === 'FULFILLED' ? 'https://t.17track.net/es#nums=LP00123456789CN' : null,
        supplierOrderId: o.status === 'SUPPLIER_ERROR' ? null : `AE-${Math.floor(Math.random() * 900000 + 100000)}`,
        errorMessage: o.status === 'SUPPLIER_ERROR' ? 'Proveedor sin stock en la variante seleccionada (SKU KO-STD)' : null,
        autoFulfilled: o.status !== 'PENDING',
        pushedToSupplierAt: o.status === 'PENDING' ? null : new Date(Date.now() - 3600e3 * 6),
        shippedAt: o.fulf === 'FULFILLED' ? new Date(Date.now() - 3600e3 * 40) : null,
        items: {
          create: items.map((it) => ({
            productId: it.p.id,
            title: it.p.title,
            sku: `${slugify(it.p.title).slice(0, 12).toUpperCase()}-01`,
            quantity: it.qty,
            unitPrice: it.p.sellingPrice,
            unitCost: it.p.costPrice,
            totalPrice: Number(it.p.sellingPrice) * it.qty,
            imageUrl: null,
          })),
        },
      },
    });
  }

  // ── Sync logs
  const logTemplates = [
    { type: SyncType.IMPORT, status: SyncStatus.SUCCESS, level: LogLevel.INFO, message: 'Producto importado a Shopify con 3 variantes y 3 imágenes' },
    { type: SyncType.PRICE_UPDATE, status: SyncStatus.SUCCESS, level: LogLevel.INFO, message: 'Precio actualizado por cambio de costo del proveedor', changes: { field: 'sellingPrice', from: 24.99, to: 26.99 } },
    { type: SyncType.STOCK_UPDATE, status: SyncStatus.SUCCESS, level: LogLevel.INFO, message: 'Stock sincronizado: 120 → 94 unidades' },
    { type: SyncType.STOCK_UPDATE, status: SyncStatus.SKIPPED, level: LogLevel.DEBUG, message: 'Sin cambios (hash del proveedor idéntico)' },
    { type: SyncType.FULL_REFRESH, status: SyncStatus.FAILED, level: LogLevel.ERROR, message: 'Bloqueo anti-bot (403) tras 3 reintentos — proxy rotado' },
    { type: SyncType.ORDER_PUSH, status: SyncStatus.SUCCESS, level: LogLevel.INFO, message: 'Pedido #1044 enviado al proveedor (AE-482913)' },
  ];

  for (let i = 0; i < 60; i++) {
    const t = logTemplates[i % logTemplates.length];
    const p = createdProducts[i % createdProducts.length];
    await prisma.syncLog.create({
      data: {
        userId: user.id,
        storeId: i % 5 === 0 ? woo.id : shopify.id,
        supplierId: p.supplierId,
        productId: p.id,
        type: t.type,
        status: t.status,
        level: t.level,
        message: t.message,
        changes: t.changes ?? undefined,
        durationMs: Math.floor(Math.random() * 4200) + 180,
        createdAt: new Date(Date.now() - i * 1000 * 60 * 17),
      },
    });
  }

  await prisma.syncJob.createMany({
    data: [
      { queue: 'sync', jobName: 'sync:product', status: SyncStatus.RUNNING, priority: 1, progress: 45, jobId: 'job-run-1', scheduledFor: new Date(), startedAt: new Date() },
      { queue: 'sync', jobName: 'sync:product', status: SyncStatus.QUEUED, priority: 2, progress: 0, jobId: 'job-q-2', scheduledFor: new Date(Date.now() + 60e3) },
      { queue: 'sync', jobName: 'sync:product', status: SyncStatus.QUEUED, priority: 3, progress: 0, jobId: 'job-q-3', scheduledFor: new Date(Date.now() + 120e3) },
      { queue: 'orders', jobName: 'order:push', status: SyncStatus.SUCCESS, priority: 1, progress: 100, jobId: 'job-o-1', finishedAt: new Date(Date.now() - 300e3) },
    ],
  });

  console.log(`✅ Seed completado:
   • 1 usuario (demo@dropshippilot.io) + suscripción PRO
   • 3 reglas de pricing, 3 proveedores, 2 tiendas (Shopify + Woo)
   • ${createdProducts.length} productos con variantes, imágenes y reseñas
   • ${orderSeeds.length} pedidos, 60 sync logs, 4 jobs en cola`);
}

// ── helpers
const round2 = (n: number) => Math.round(n * 100) / 100;
const roundPsy = (n: number) => round2(Math.round(n) - 0.01);
const slugify = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
const hashish = (s: string) => Buffer.from(s).toString('base64').slice(0, 16);

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
