/**
 * GET /api/setup/status — Centro de conexión: qué está conectado y qué falta.
 *
 * Devuelve, comprobado EN VIVO (no por presencia de variables), el estado de
 * cada pieza del sistema, de modo que lo único que quede por hacer sea pegar
 * credenciales. Cada elemento indica la variable de entorno exacta, dónde se
 * obtiene y en qué página del panel se configura lo que no son claves.
 *
 *   Zonas:
 *     • infra      → base de datos, Redis, microservicio de scraping
 *     • cobros     → Stripe (claves, precios, webhook)
 *     • correo     → Resend / webhook / consola
 *     • seguridad  → cifrado, sesión, verificación de email, 2FA
 *     • tiendas    → por cliente: Shopify / WooCommerce conectadas
 *     • proveedores→ por cliente: APIs oficiales (AliExpress, CJ, Amazon)
 *     • scraping   → proxies y modo de extracción
 */
import { NextResponse } from 'next/server';
import { apiTenant } from '@/lib/tenant';
import { hasDatabase, prisma } from '@/lib/prisma';
import { stripeConfigured } from '@/lib/stripe';
import { lemonStatusSummary } from '@/lib/lemon';
import { shopifyOAuthConfigured } from '@/lib/shopify-oauth';
import { PLANS } from '@/lib/plans';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Status = 'ok' | 'warning' | 'missing' | 'error' | 'optional';

interface Check {
  id: string;
  label: string;
  zone: string;
  status: Status;
  required: boolean;
  detail: string;
  env?: string[];
  howTo?: string;
  link?: string;
}

const env = (...names: string[]) => names.every((n) => Boolean(process.env[n]));
const publicUrlForHelp = () => process.env.NEXTAUTH_URL ?? process.env.APP_URL ?? null;
const anyEnv = (...names: string[]) => names.some((n) => Boolean(process.env[n]));

/** Ping a Redis sin dejarlo conectado (el worker usa la misma URL). */
async function pingRedis(): Promise<{ ok: boolean; detail: string }> {
  const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
  if (process.env.DISABLE_REDIS === 'true') return { ok: false, detail: 'Deshabilitado con DISABLE_REDIS=true (los workers no arrancarán)' };
  try {
    const { default: IORedis } = await import('ioredis');
    const client = new IORedis(url, { lazyConnect: true, connectTimeout: 2500, maxRetriesPerRequest: 1, enableOfflineQueue: false, retryStrategy: () => null });
    try {
      await client.connect();
      const pong = await client.ping();
      return { ok: pong === 'PONG', detail: `Responde PONG en ${url.replace(/\/\/.*@/, '//***@')}` };
    } finally {
      try {
        client.disconnect();
      } catch {
        /* ya cerrado */
      }
    }
  } catch (err) {
    return { ok: false, detail: `No responde en ${url} (${(err as Error).message.split('\n')[0]}). Los workers 24/7 no pueden arrancar sin Redis.` };
  }
}

async function pingScraper(): Promise<{ ok: boolean; detail: string; proxies?: number }> {
  const mode = process.env.SCRAPER_MODE ?? 'auto';
  const url = process.env.SCRAPER_SERVICE_URL?.replace(/\/$/, '');

  if (mode === 'demo') return { ok: false, detail: 'SCRAPER_MODE=demo: las extracciones son simuladas' };
  if (!url) return { ok: false, detail: 'SCRAPER_SERVICE_URL sin definir' };

  try {
    const res = await fetch(`${url}/health`, { cache: 'no-store', signal: AbortSignal.timeout(3500) });
    const data: any = await res.json().catch(() => ({}));
    return { ok: res.ok, detail: `Microservicio respondiendo en ${url}${data?.proxies !== undefined ? ` · ${data.proxies} proxies` : ''}`, proxies: data?.proxies };
  } catch {
    return { ok: false, detail: `El microservicio no responde en ${url}. Arráncalo con «npm run scraper:dev» o con Docker (make scraper).` };
  }
}

export async function GET() {
  return apiTenant(async (userId) => {
    // ── Infraestructura ──────────────────────────────────────────────────────
    const checks: Check[] = [];

    let dbDetail = 'Sin DATABASE_URL: la app funciona en modo demo (datos en memoria)';
    let dbOk = false;
    if (hasDatabase()) {
      try {
        await prisma.$queryRaw`SELECT 1`;
        const [users, products] = await Promise.all([prisma.user.count(), prisma.product.count()]);
        dbOk = true;
        dbDetail = `PostgreSQL respondiendo · ${users} cliente(s), ${products} producto(s)`;
      } catch (err) {
        dbDetail = `DATABASE_URL definida pero la base no responde: ${(err as Error).message.split('\n')[0]}`;
      }
    }
    checks.push({
      id: 'database',
      label: 'Base de datos PostgreSQL',
      zone: 'infra',
      status: dbOk ? 'ok' : process.env.DATABASE_URL ? 'error' : 'missing',
      required: true,
      detail: dbDetail,
      env: ['DATABASE_URL'],
      howTo: 'Crea la base (Docker: docker compose up -d db) y pega su URL: postgresql://usuario:clave@host:5432/autods',
    });

    const redis = await pingRedis();
    checks.push({
      id: 'redis',
      label: 'Redis (colas de trabajo)',
      zone: 'infra',
      status: redis.ok ? 'ok' : 'missing',
      required: true,
      detail: redis.detail,
      env: ['REDIS_URL'],
      howTo: 'Levanta Redis (docker compose up -d redis) y define REDIS_URL=redis://localhost:6379',
    });

    const scraper = await pingScraper();
    const scraperMode = process.env.SCRAPER_MODE ?? 'auto';
    checks.push({
      id: 'scraper',
      label: 'Microservicio de extracción (FastAPI + Playwright)',
      zone: 'infra',
      status: scraper.ok ? 'ok' : scraperMode === 'demo' ? 'optional' : 'missing',
      required: false,
      detail: scraper.detail,
      env: ['SCRAPER_SERVICE_URL', 'SCRAPER_MODE'],
      howTo: 'Arranca services/scraper (uvicorn) y define SCRAPER_SERVICE_URL. Con SCRAPER_API_KEY si lo expones fuera del servidor.',
      link: '/proxies',
    });

    // ── Cobros ───────────────────────────────────────────────────────────────
    const priceEnvs = Object.values(PLANS)
      .flatMap((p) => (p.stripePriceEnv ? [p.stripePriceEnv.monthly, p.stripePriceEnv.yearly] : []));
    const pricesPresent = priceEnvs.filter((name) => Boolean(process.env[name]));
    const stripeKeys = stripeConfigured();
    checks.push({
      id: 'stripe',
      label: 'Cobros con Stripe',
      zone: 'cobros',
      status: stripeKeys && pricesPresent.length === priceEnvs.length ? 'ok' : 'missing',
      required: false,
      detail: stripeKeys
        ? `Claves OK · ${pricesPresent.length}/${priceEnvs.length} precios configurados`
        : 'Sin claves: el cobro está desactivado y los planes se asignan a mano',
      env: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', ...priceEnvs],
      howTo: 'Ejecuta «npm run stripe:setup --key=sk_test_…»: crea los 6 precios por API y escribe el .env.local. Después registra el webhook (el script te da la URL).',
      link: '/billing',
    });

    const lemon = lemonStatusSummary();
    checks.push({
      id: 'lemon',
      label: 'Cobros alternativos con Lemon Squeezy (sin alta de autónomo)',
      zone: 'cobros',
      status: lemon.checkoutReady && lemon.variantsPresent === lemon.variantsTotal ? 'ok' : 'missing',
      required: false,
      detail: lemon.configured
        ? `Webhooks OK · checkout ${lemon.checkoutReady ? 'listo' : 'sin API key'} · ${lemon.variantsPresent}/${lemon.variantsTotal} variantes configuradas`
        : 'Sin configurar: Lemon Squeezy actúa como vendedor legal y liquida el IVA por ti (ver PAGOS.md)',
      env: ['LEMON_API_KEY', 'LEMON_STORE_ID', 'LEMON_WEBHOOK_SECRET', 'LEMON_VARIANT_STARTER_MONTHLY', 'LEMON_VARIANT_PRO_MONTHLY', 'LEMON_VARIANT_ENTERPRISE_MONTHLY'],
      howTo: 'Crea la cuenta y los productos en lemonsqueezy.com, copia la API key, el id de tienda y las 6 variantes (mensual y anual de cada plan) y registra el webhook apuntando a /api/webhooks/lemon.',
      link: '/billing',
    });

    checks.push({
      id: 'shopify-oauth',
      label: 'Instalación de Shopify con un clic (OAuth)',
      zone: 'tiendas',
      status: shopifyOAuthConfigured() ? 'ok' : 'warning',
      required: false,
      detail: shopifyOAuthConfigured()
        ? 'App de Shopify configurada: los clientes conectan su tienda autorizando, sin crear tokens'
        : 'Sin configurar: se puede conectar igual pegando un token Admin API, pero OAuth es mucho más cómodo',
      env: ['SHOPIFY_API_KEY', 'SHOPIFY_API_SECRET'],
      howTo: 'Crea una app gratis en partners.shopify.com, pon la URL de redirección ' + (publicUrlForHelp() ?? 'https://tu-dominio') + '/api/shopify/callback y copia Client ID y Client secret.',
      link: '/stores',
    });

    // ── Correo ───────────────────────────────────────────────────────────────
    const mailTransport = process.env.RESEND_API_KEY ? 'resend' : process.env.MAIL_WEBHOOK_URL ? 'webhook' : 'console';
    checks.push({
      id: 'mail',
      label: 'Correo transaccional (verificación y recuperación)',
      zone: 'correo',
      status: mailTransport === 'resend' ? 'ok' : 'warning',
      required: false,
      detail:
        mailTransport === 'console'
          ? 'Sin servidor de correo: los enlaces de verificación se muestran por consola y en pantalla (suficiente para pruebas, no para clientes)'
          : `Transporte activo: ${mailTransport}`,
      env: ['RESEND_API_KEY', 'MAIL_FROM'],
      howTo: 'Crea una cuenta en Resend (gratis hasta 3.000 correos/mes), verifica tu dominio y pega RESEND_API_KEY + MAIL_FROM.',
    });

    // ── Seguridad ────────────────────────────────────────────────────────────
    const encryption = Boolean(process.env.ENCRYPTION_KEY && process.env.ENCRYPTION_KEY.length >= 32);
    checks.push({
      id: 'encryption',
      label: 'Cifrado de credenciales (AES-256-GCM)',
      zone: 'seguridad',
      status: encryption ? 'ok' : 'missing',
      required: true,
      detail: encryption
        ? 'ENCRYPTION_KEY presente: las claves de tiendas y proveedores se guardan cifradas'
        : 'Falta ENCRYPTION_KEY: sin ella no se pueden guardar credenciales de forma segura',
      env: ['ENCRYPTION_KEY'],
      howTo: 'Genera una con: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    });

    const authOn = process.env.AUTH_ENABLED === 'true';
    checks.push({
      id: 'auth',
      label: 'Autenticación y sesiones',
      zone: 'seguridad',
      status: authOn && Boolean(process.env.NEXTAUTH_SECRET) ? 'ok' : authOn ? 'error' : 'warning',
      required: false,
      detail: authOn
        ? `AUTH_ENABLED=true · sesiones ${process.env.NEXTAUTH_SECRET ? 'firmadas' : 'SIN secreto (define NEXTAUTH_SECRET)'}`
        : 'AUTH_ENABLED=false: cualquiera con la URL entra al panel (modo pruebas)',
      env: ['AUTH_ENABLED', 'NEXTAUTH_SECRET', 'NEXTAUTH_URL'],
      howTo: 'En producción: AUTH_ENABLED=true, NEXTAUTH_SECRET aleatorio y NEXTAUTH_URL=https://tudominio.com',
    });

    checks.push({
      id: 'verification',
      label: 'Verificación de email obligatoria',
      zone: 'seguridad',
      status: process.env.REQUIRE_EMAIL_VERIFICATION === 'true' ? 'ok' : 'warning',
      required: false,
      detail:
        process.env.REQUIRE_EMAIL_VERIFICATION === 'true'
          ? 'Activa: nadie entra sin confirmar su correo'
          : 'Desactivada: se puede entrar sin verificar el correo (actívala al abrir al público)',
      env: ['REQUIRE_EMAIL_VERIFICATION'],
      howTo: 'REQUIRE_EMAIL_VERIFICATION=true (necesita un transporte de correo funcionando)',
    });

    // ── Webhooks públicos ────────────────────────────────────────────────────
    const publicUrl = process.env.NEXTAUTH_URL ?? process.env.APP_URL ?? '';
    const hasPublicDomain = /^https:\/\//.test(publicUrl) && !/localhost|127\.0\.0\.1/.test(publicUrl);
    checks.push({
      id: 'webhooks',
      label: 'Webhooks públicos (tiendas y Stripe)',
      zone: 'seguridad',
      status: hasPublicDomain ? 'ok' : 'warning',
      required: false,
      detail: hasPublicDomain
        ? `Dominio público configurado: ${publicUrl} · secretos ${anyEnv('SHOPIFY_WEBHOOK_SECRET', 'WOO_WEBHOOK_SECRET', 'STRIPE_WEBHOOK_SECRET') ? 'presentes' : 'pendientes'}`
        : 'Sin dominio público: los webhooks de tiendas y Stripe no pueden llegar hasta que despliegues con HTTPS',
      env: ['NEXTAUTH_URL', 'SHOPIFY_WEBHOOK_SECRET', 'WOO_WEBHOOK_SECRET', 'STRIPE_WEBHOOK_SECRET'],
      howTo: 'Apunta los webhooks a https://tudominio.com/api/webhooks/{shopify|woocommerce|stripe}. GET /api/webhooks/stripe te dice la URL exacta.',
    });

    // ── Scraping ─────────────────────────────────────────────────────────────
    const proxyCount = (process.env.PROXY_LIST ?? '').split(',').map((s) => s.trim()).filter(Boolean).length;
    checks.push({
      id: 'proxies',
      label: 'Proxies para extracción',
      zone: 'scraping',
      status: proxyCount > 0 ? 'ok' : scraperMode === 'demo' ? 'optional' : 'warning',
      required: false,
      detail:
        proxyCount > 0
          ? `${proxyCount} proxy(s) configurados`
          : 'Sin proxies: AliExpress bloquea las IPs de servidor (usa la API oficial del proveedor o proxies residenciales)',
      env: ['PROXY_LIST'],
      howTo: 'Contrata proxies residenciales (Bright Data, Oxylabs, Smartproxy) y pega la lista separada por comas en PROXY_LIST.',
      link: '/proxies',
    });

    // ── Por cliente ──────────────────────────────────────────────────────────
    const [stores, supplierAccounts, products, rules] = await Promise.all([
      prisma.store.findMany({
        where: { userId },
        select: { id: true, name: true, domain: true, platform: true, status: true, lastError: true, lastPingAt: true },
      }),
      prisma.supplierAccount.findMany({
        where: { userId },
        select: { id: true, provider: true, label: true, status: true, lastError: true },
      }),
      prisma.product.count({ where: { userId } }),
      prisma.pricingRule.count({ where: { userId } }),
    ]);

    const connectedStores = stores.filter((s) => s.status === 'CONNECTED' || s.lastPingAt);
    const providers = [
      ...stores.filter((s) => s.platform === 'SHOPIFY').map((s) => `Shopify ${s.domain}`),
      ...stores.filter((s) => s.platform === 'WOOCOMMERCE').map((s) => `Woo ${s.domain}`),
    ];
    checks.push({
      id: 'stores',
      label: 'Tiendas conectadas (Shopify / WooCommerce)',
      zone: 'tiendas',
      status: connectedStores.length > 0 ? 'ok' : 'missing',
      required: true,
      detail:
        stores.length === 0
          ? 'Ninguna tienda conectada: sin tienda no se pueden publicar productos ni recibir pedidos'
          : stores.map((s) => `${s.name} (${s.platform}) · ${s.status}${s.lastError ? ` · ⚠ ${s.lastError.slice(0, 60)}` : ''}`).join(' | '),
      howTo: 'Crea una tienda de desarrollo de Shopify (gratis) o una WooCommerce, y conéctala con su token en la página Tiendas.',
      link: '/stores',
    });

    // Claves compartidas de la plataforma (lo que evita que cada cliente tenga
    // que solicitar su propia app a AliExpress o pegar claves).
    let platformKeys: { name: string; configured: boolean; status: string | null }[] = [];
    try {
      const { platformCredentialSummary } = await import('@/lib/catalog/platform-credentials');
      platformKeys = (await platformCredentialSummary()).map((c) => ({ name: c.name, configured: c.configured && c.enabled, status: c.status }));
    } catch {
      /* sin base de datos no hay claves que leer */
    }
    const platformReady = platformKeys.filter((c) => c.configured);

    checks.push({
      id: 'suppliers',
      label: 'APIs oficiales de proveedor',
      zone: 'proveedores',
      status: supplierAccounts.some((a) => a.status === 'CONNECTED') || platformReady.length > 0 ? 'ok' : 'warning',
      required: false,
      detail:
        platformReady.length > 0
          ? `Gestionado por la plataforma: ${platformReady.map((c) => c.name).join(', ')}${supplierAccounts.length ? ` · cuentas propias del cliente: ${supplierAccounts.length}` : ''} · los clientes no configuran claves`
          : supplierAccounts.length === 0
            ? 'Ninguna API conectada: las extracciones irán por scraping (necesita proxies) y los pedidos por el canal genérico'
            : supplierAccounts.map((a) => `${a.provider} (${a.label}) · ${a.status}${a.lastError ? ` · ⚠ ${a.lastError.slice(0, 50)}` : ''}`).join(' | '),
      howTo:
        platformReady.length > 0
          ? 'Nada que hacer por cliente: las claves de la plataforma ya sirven el catálogo y las importaciones. Aquí sólo se conectan cuentas propias (opcional).'
          : 'Pega tus claves UNA vez en Administración → Claves de proveedor: todos los clientes las usarán sin verlas.',
      link: platformReady.length > 0 ? '/catalog' : '/admin',
    });

    // ── Catálogo servido por la plataforma ──────────────────────────────────
    try {
      const { platformCredentialSummary } = await import('@/lib/catalog/platform-credentials');
      const [summary, sampleItems, realItems, categories] = await Promise.all([
        platformCredentialSummary(),
        prisma.catalogItem.count({ where: { source: 'sample' } }),
        prisma.catalogItem.count({ where: { source: 'api' } }),
        prisma.catalogCategory.count(),
      ]);
      const withKeys = summary.filter((c) => c.configured && c.enabled);
      const errored = withKeys.find((c) => c.status === 'ERROR');

      checks.push({
        id: 'platform-catalog',
        label: 'Catálogo servido por la plataforma (claves compartidas)',
        zone: 'proveedores',
        status: errored ? 'error' : withKeys.length > 0 && realItems > 0 ? 'ok' : withKeys.length > 0 ? 'warning' : 'missing',
        required: false,
        detail:
          withKeys.length === 0
            ? `Sin claves de plataforma: los clientes ven el catálogo de muestra (${sampleItems} artículos · ${categories} categorías)`
            : `${withKeys.map((c) => c.name).join(', ')} configurado(s)${errored ? ` · ⚠ ${errored.lastError?.slice(0, 60)}` : ''} · ${realItems} producto(s) reales en el índice`,
        howTo:
          withKeys.length === 0
            ? 'Pega UNA vez tus claves de AliExpress y CJ en Administración → Claves de proveedor (o define ALIEXPRESS_APP_KEY / CJ_EMAIL… en el .env). Todos los clientes las usan sin verlas; nadie más configura nada.'
            : realItems === 0
              ? 'Lanza la descarga: Administración → Claves de proveedor → «Descargar catálogo» (o npx tsx scripts/seed-catalog.ts).'
              : 'El worker de catálogo refresca solo cada CATALOG_SYNC_MINUTES (360 por defecto).',
        link: '/admin',
      });
    } catch {
      /* sin base de datos no hay catálogo que comprobar */
    }

    checks.push({
      id: 'catalog',
      label: 'Catálogo y reglas de precio',
      zone: 'tiendas',
      status: products > 0 && rules > 0 ? 'ok' : 'warning',
      required: false,
      detail: `${products} producto(s) · ${rules} regla(s) de margen`,
      howTo: 'Importa un producto (Importar) y revisa la regla de margen en Precios: el worker recalcula el precio final con ella.',
      link: '/import',
    });

    // ── Resumen ──────────────────────────────────────────────────────────────
    const blockers = checks.filter((c) => c.required && c.status !== 'ok');
    const pending = checks.filter((c) => !c.required && (c.status === 'missing' || c.status === 'error' || c.status === 'warning'));

    return NextResponse.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      ready: blockers.length === 0,
      summary: {
        total: checks.length,
        ok: checks.filter((c) => c.status === 'ok').length,
        blockers: blockers.length,
        pending: pending.length,
      },
      checks,
      links: { stores: '/stores', suppliers: '/suppliers', billing: '/billing', proxies: '/proxies', import: '/import', settings: '/settings' },
    });
  });
}
