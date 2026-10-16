/**
 * src/lib/simulador-api.ts — «Servidor de demostración» que vive en el NAVEGADOR.
 *
 * En la versión estática (GitHub Pages) no existe servidor: las rutas /api/*
 * no están. Para que las pantallas funcionen igual que en la demostración con
 * servidor, este módulo intercepta las llamadas `fetch('/api/…')` del navegador
 * y las contesta con los datos de ejemplo (los mismos de src/lib/demo-data.ts).
 *
 * Importante y honesto:
 *   • Nada se guarda: al recargar, todo vuelve al estado inicial.
 *   • Las acciones que en producción tocarían un proveedor, una tienda o un
 *     cobro responden con un aviso claro de «modo demostración».
 *   • Solo se activa con ESTATICO=1. En el servidor normal NO se carga.
 */
import { consultarCatalogoMemoria, detalleMuestra, filasDeMuestra, sugerenciasMemoria } from './catalog/memoria';
import { SAMPLE_CATEGORIES } from './catalog/sample';
import { demoPricingRules, demoQueueJobs, demoQueueStats, demoProducts, demoSyncLogs } from './demo-data';
import { computeSellingPrice } from './pricing';
import { round2 } from './utils';
import { ESTATICO, sinBase as sinRutaBase } from './ruta';

const AVISO = 'Modo demostración: esta acción no se guarda. Se activará cuando conectemos la base de datos y los proveedores.';
const ESPERA_MS = 180;

const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } });

const reglaPorDefecto = () => (demoPricingRules.find((r) => r.isDefault) ?? demoPricingRules[0]) as any;

const tiendasDemo = [
  { id: 'store_shopify_1', name: 'Mi Tienda Gadgets', platform: 'SHOPIFY', status: 'CONNECTED' },
  { id: 'store_woo_1', name: 'Woo Home & Deco', platform: 'WOOCOMMERCE', status: 'ERROR' },
];

function salud() {
  return {
    ok: false,
    mode: 'demo',
    at: new Date().toISOString(),
    checks: {
      postgres: { ok: false, detail: 'Sin base de datos: la versión de demostración usa datos de ejemplo en el navegador' },
      redis: { ok: false, detail: 'Sin cola de tareas: se activa al conectar el servidor' },
      scraper: { ok: false, detail: 'Sin lector de proveedores: se sustituirá por las APIs oficiales de CJ y AliExpress' },
      fx: { ok: true, detail: 'Tasas de ejemplo · 1 USD = 0,92 €' },
      stripe: { ok: false, detail: 'Cobros sin configurar' },
    },
  };
}

function sync() {
  const ahora = Date.now();
  return {
    ok: true,
    dataMode: 'demo',
    stats: { ...demoQueueStats, paused: false, mode: 'memory' },
    jobs: demoQueueJobs.map((j) => ({ ...j, productId: null })),
    scheduler: { enabled: true, intervalMinutes: 60, nextRun: new Date(ahora + 37 * 60_000).toISOString(), patterns: ['*/60 * * * *'], mode: 'demo' },
    logs: demoSyncLogs.slice(0, 30),
  };
}

function consultaCatalogo(p: URLSearchParams) {
  const num = (k: string) => {
    const v = p.get(k);
    if (v === null || v === '') return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  const verdad = (k: string) => p.get(k) === '1' || p.get(k) === 'true';
  return consultarCatalogoMemoria({
    search: p.get('q') ?? undefined,
    provider: (p.get('provider') as any) ?? 'ALL',
    category: p.get('category') ?? undefined,
    minPrice: num('min'),
    maxPrice: num('max'),
    shipFrom: p.get('shipFrom') ?? undefined,
    freeShipping: verdad('freeShipping'),
    trending: verdad('trending'),
    minRating: num('minRating'),
    sort: (p.get('sort') as any) ?? 'relevance',
    page: num('page') ?? 1,
    pageSize: num('pageSize') ?? 24,
    pricingRule: reglaPorDefecto(),
  });
}

function fichaCatalogo(id: string, pais: string) {
  const d = detalleMuestra(id, pais);
  if (!d) return json({ ok: false, error: 'Producto del catálogo no encontrado' }, 404);
  const regla = reglaPorDefecto();
  const envio = d.item.freeShipping ? 0 : d.item.shippingCost ?? 0;
  const b = computeSellingPrice(d.item.costPrice, envio, regla, regla.name);
  const beneficio = b.sellingPrice - d.item.costPrice - envio;
  return json({
    ok: true,
    item: d.item,
    description: d.description,
    tags: d.tags,
    scrapedPayload: d.scraped,
    pricing: {
      ruleId: regla.id,
      ruleName: regla.name,
      rule: {
        id: regla.id,
        name: regla.name,
        markupPct: Number(regla.markupPct),
        fixedFee: Number(regla.fixedFee ?? 0),
        minProfit: Number(regla.minProfit ?? 0),
        roundTo: Number(regla.roundTo ?? 0.99),
        minPrice: regla.minPrice ?? null,
        maxPrice: regla.maxPrice ?? null,
        includeShipping: regla.includeShipping ?? true,
      },
      markupPct: Number(regla.markupPct),
      costPrice: round2(d.item.costPrice),
      costPriceEur: round2(d.item.costPrice),
      shipping: round2(envio),
      fx: { currency: 'EUR', rate: 1, converted: false },
      sellingPrice: b.sellingPrice,
      compareAtPrice: b.compareAtPrice ?? null,
      profit: round2(beneficio),
      marginPct: round2((beneficio / Math.max(b.sellingPrice, 0.01)) * 100),
    },
    stores: tiendasDemo,
    variants: d.scraped.variants.length,
    credits: 2,
  });
}

function importar(cuerpo: any) {
  const fila = filasDeMuestra().find((f) => f.id === cuerpo?.catalogItemId);
  const titulo: string = cuerpo?.scrapedPayload?.title ?? fila?.title ?? 'Producto importado';
  const regla = { ...reglaPorDefecto() };
  if (cuerpo?.marginPct !== undefined && cuerpo.marginPct !== '') regla.markupPct = Number(cuerpo.marginPct);
  const coste = fila?.costPrice ?? 10;
  const envio = fila ? (fila.freeShipping ? 0 : fila.shippingCost ?? 0) : 0;
  const b = computeSellingPrice(coste, envio, regla, regla.name);
  return json({
    ok: true,
    demo: true,
    product: { id: demoProducts[0].id, title: titulo, sellingPrice: b.sellingPrice, profit: round2(b.sellingPrice - coste - envio) },
    publish: { ok: false, error: 'Modo demostración: no se publica en ninguna tienda real' },
    message: AVISO,
  });
}

function puestaEnMarcha() {
  const c = (id: string, label: string, zone: string, status: string, required: boolean, detail: string, howTo?: string, link?: string) => ({ id, label, zone, status, required, detail, howTo, link });
  const checks = [
    c('database', 'Base de datos', 'sistema', 'missing', true, 'Sin base de datos: la versión de demostración usa datos de ejemplo', 'Se conectará con Supabase en la siguiente fase.'),
    c('redis', 'Cola de tareas', 'sistema', 'missing', false, 'Sin cola de tareas', 'Se sustituirá por tareas programadas de Supabase.'),
    c('scraper', 'Lector de proveedores', 'proveedores', 'missing', false, 'No conectado', 'Se usarán las APIs oficiales de CJ y AliExpress.', '/suppliers'),
    c('suppliers', 'Claves de proveedores', 'proveedores', 'missing', true, 'Ningún proveedor conectado', 'Añade las claves de CJ y AliExpress en Administración.', '/admin'),
    c('stores', 'Tiendas', 'tiendas', 'warning', false, '2 tiendas de ejemplo (una con error de conexión)', 'Conecta tu Shopify o WooCommerce.', '/stores'),
    c('catalog', 'Catálogo', 'tiendas', 'ok', false, '36 productos de muestra listos para importar', 'Explora el catálogo.', '/catalog'),
    c('stripe', 'Cobros', 'facturación', 'missing', false, 'Sin configurar', 'Se conectará Stripe o Lemon Squeezy.', '/billing'),
    c('mail', 'Correo de salida', 'sistema', 'missing', false, 'Sin servicio de correo', 'Se conectará Resend o Brevo.'),
  ];
  const bloqueos = checks.filter((x) => x.required && x.status !== 'ok');
  const pendientes = checks.filter((x) => !x.required && x.status !== 'ok');
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    ready: false,
    summary: { total: checks.length, ok: checks.filter((x) => x.status === 'ok').length, blockers: bloqueos.length, pending: pendientes.length },
    checks,
    links: { stores: '/stores', suppliers: '/suppliers', billing: '/billing', proxies: '/proxies', import: '/import', settings: '/settings' },
  };
}

const PROVEEDORES_PLATAFORMA = [
  { provider: 'CJ_DROPSHIPPING', name: 'CJ Dropshipping', fields: [{ key: 'email', label: 'Email de la cuenta CJ' }, { key: 'apiKey', label: 'API Key', hint: 'CJ → Autorización → API Key', secret: true }] },
  { provider: 'ALIEXPRESS', name: 'AliExpress', fields: [{ key: 'appKey', label: 'App Key' }, { key: 'appSecret', label: 'App Secret', secret: true }, { key: 'accessToken', label: 'Access Token (OAuth)', secret: true }, { key: 'apiRegion', label: 'Región del gateway', hint: 'sg (por defecto) o eu' }] },
];

function clavesPlataforma() {
  const muestra = filasDeMuestra();
  return {
    ok: true,
    admin: { source: 'evaluation', readOnly: true },
    providers: PROVEEDORES_PLATAFORMA.map((p) => ({
      ...p,
      configured: false,
      source: null,
      enabled: false,
      status: null,
      lastTestAt: null,
      lastError: null,
      masked: [],
      quota: null,
      catalogItems: muestra.filter((m) => m.provider === p.provider).length,
      catalogReal: 0,
      lastSync: null,
    })),
    catalog: { total: muestra.length, real: 0, sample: muestra.length, lastSync: null },
    envFallback: { CJ_DROPSHIPPING: false, ALIEXPRESS: false, AMAZON: false },
  };
}

function inquilinos() {
  const hace = (dias: number) => new Date(Date.now() - dias * 86_400_000).toISOString();
  const tenants = [
    { id: 'u1', email: 'demo@dropshippilot.io', name: 'Cliente de ejemplo', role: 'OWNER', plan: 'PRO', createdAt: hace(40), lastLoginAt: hace(0), verified: true, twoFactor: true, stores: 2, products: 14, orders: 34, supplierAccounts: 0, status: 'ACTIVE', provider: 'stripe', creditsUsed: 42, creditsLimit: 500, renewsAt: hace(-12) },
    { id: 'u2', email: 'tienda.sol@ejemplo.es', name: 'Tienda Sol', role: 'OWNER', plan: 'STARTER', createdAt: hace(18), lastLoginAt: hace(2), verified: true, twoFactor: false, stores: 1, products: 6, orders: 9, supplierAccounts: 0, status: 'TRIALING', provider: null, creditsUsed: 11, creditsLimit: 100, renewsAt: hace(-5) },
    { id: 'u3', email: 'luna.shop@ejemplo.es', name: 'Luna Shop', role: 'OWNER', plan: 'PRO', createdAt: hace(75), lastLoginAt: hace(9), verified: true, twoFactor: false, stores: 3, products: 41, orders: 120, supplierAccounts: 0, status: 'ACTIVE', provider: 'lemon', creditsUsed: 260, creditsLimit: 500, renewsAt: hace(-20) },
  ];
  return {
    ok: true,
    admin: { email: 'operador@dropshippilot.io', source: 'evaluation', readOnly: true },
    fx: { source: 'default', fetchedAt: null, ageHours: null, stale: false, refreshHours: 24, usd: 1.09, gbp: 0.85, usdEur: 0.92 },
    overview: { users: tenants.length, stores: 6, products: 61, orders: 163, supplierAccounts: 0, syncLogs24h: 105, failed24h: 17, paying: 2, mrr: 158, creditsUsed: 313, creditsLimit: 1100 },
    tenants,
  };
}

async function responder(metodo: string, ruta: string, params: URLSearchParams, cuerpo: any): Promise<Response> {
  const get = metodo === 'GET';
  if (get && ruta === '/api/health') return json(salud());
  if (ruta === '/api/sync') return get ? json(sync()) : json({ ok: true, mode: 'demo', message: `${AVISO}` });
  if (get && ruta === '/api/catalog') return json({ ok: true, ...consultaCatalogo(params) });
  if (get && ruta === '/api/catalog/categories') {
    const r = consultarCatalogoMemoria({ pageSize: 4 });
    return json({ ok: true, categories: r.facets, providerCategories: [], providers: r.providers, stats: r.stats, credentials: [], categoriesBase: SAMPLE_CATEGORIES.map((c) => c.name) });
  }
  const ficha = ruta.match(/^\/api\/catalog\/([^/]+)$/);
  if (get && ficha) return fichaCatalogo(decodeURIComponent(ficha[1]), params.get('country') ?? 'ES');
  if (get && ruta === '/api/catalog/suggest') return json({ ok: true, suggestions: sugerenciasMemoria(params.get('q') ?? '') });
  if (ruta === '/api/import') return importar(cuerpo);
  if (ruta === '/api/billing/checkout' || ruta === '/api/billing/portal')
    return json({ ok: false, error: 'Modo demostración: aquí no se puede iniciar un pago real. Los cobros se conectarán más adelante.' }, 503);
  if (ruta === '/api/scrape') return json({ ok: false, error: 'En la versión de demostración no se puede leer una dirección web real. Prueba a importar desde el Catálogo.' }, 503);
  if (get && ruta === '/api/setup/status') return json(puestaEnMarcha());
  if (get && ruta === '/api/supplier-accounts') return json({ ok: true, providers: [], plan: { tier: 'PRO', name: 'Pro', maxSupplierAccounts: 5, used: 0 }, accounts: [] });
  if (get && ruta === '/api/proxies') return json({ ok: false, serviceUp: false, hint: 'El validador de proxies se conectará con el servidor. En la versión de demostración no está disponible.' });
  if (get && ruta === '/api/alerts')
    return json({ ok: true, email: 'demo@dropshippilot.io', prefs: { sync: true, stock: true, webhooks: true, billing: true, onboarding: true }, transport: 'console', deliverable: false, labels: {} });
  if (get && ruta === '/api/admin/tenants') return json(inquilinos());
  if (get && ruta === '/api/admin/platform-credentials') return json(clavesPlataforma());
  if (get && ruta === '/api/security/totp') return json({ ok: false, error: 'Sin base de datos' }, 503);
  if (get && ruta === '/api/account/export') return json({ ok: true, demo: true, nota: 'Exportación de ejemplo: en la versión real incluye tu cuenta, tiendas, productos y pedidos.' });
  if (ruta.startsWith('/api/auth/')) {
    if (ruta.endsWith('/2fa-check')) return json({ required: false });
    return json({ ok: true, demo: true });
  }
  // Cualquier otra acción: respuesta correcta con aviso claro
  return json({ ok: true, demo: true, message: AVISO, summary: { failed: 0 } });
}

let instalado = false;

/** Sustituye window.fetch para contestar las rutas /api/* desde el navegador. */
export function instalarSimuladorApi() {
  if (!ESTATICO || instalado || typeof window === 'undefined') return;
  instalado = true;
  const original = window.fetch.bind(window);

  window.fetch = async (entrada: RequestInfo | URL, opciones?: RequestInit) => {
    const texto = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.pathname + entrada.search : entrada.url;
    const url = new URL(texto, window.location.origin);
    // Solo las rutas de nuestra API (la subcarpeta de GitHub Pages se ignora)
    const sinBase = sinRutaBase(url.pathname);
    if (url.origin !== window.location.origin || !sinBase.startsWith('/api/')) return original(entrada as any, opciones);

    const metodo = (opciones?.method ?? (entrada instanceof Request ? entrada.method : 'GET')).toUpperCase();
    let cuerpo: any = undefined;
    try {
      if (typeof opciones?.body === 'string') cuerpo = JSON.parse(opciones.body);
    } catch {
      cuerpo = undefined;
    }
    await new Promise((r) => setTimeout(r, ESPERA_MS));
    return responder(metodo, sinBase.replace(/\/$/, ''), url.searchParams, cuerpo);
  };
}

// Se instala en cuanto se carga el módulo en el navegador (antes de que las pantallas pidan datos)
instalarSimuladorApi();
