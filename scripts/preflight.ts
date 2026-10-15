/**
 * scripts/preflight.ts — Comprobación de puesta en marcha desde la terminal.
 *
 * Misma información que el «Centro de conexión» del panel, pero en consola:
 * señala en rojo lo que impide operar y da el comando o el valor exacto que
 * falta. Pensado para ejecutarlo en el servidor justo después de cada despliegue:
 *
 *   npm run preflight
 *
 * Sale con código 1 si hay algún bloqueante (útil en CI o en scripts de deploy).
 */
import '../workers/env';
import fs from 'node:fs';
import { fxStatus, toEur } from '../src/lib/fx';

let ok = 0;
let warn = 0;
let blockers = 0;

const line = (status: 'ok' | 'warn' | 'fail' | 'info', label: string, detail = '') => {
  const icon = status === 'ok' ? '✔' : status === 'warn' ? '▲' : status === 'fail' ? '✘' : '·';
  const color = status === 'ok' ? '\u001b[32m' : status === 'warn' ? '\u001b[33m' : status === 'fail' ? '\u001b[31m' : '\u001b[90m';
  console.log(`${color}${icon}\u001b[0m ${label}${detail ? ` — ${detail}` : ''}`);
  if (status === 'ok') ok++;
  if (status === 'warn') warn++;
  if (status === 'fail') blockers++;
};

async function pingRedis(): Promise<string | null> {
  if (process.env.DISABLE_REDIS === 'true') return 'Deshabilitado (DISABLE_REDIS=true)';
  const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
  try {
    const { default: IORedis } = await import('ioredis');
    const client = new IORedis(url, { lazyConnect: true, connectTimeout: 2500, maxRetriesPerRequest: 1, enableOfflineQueue: false, retryStrategy: () => null });
    try {
      await client.connect();
      const pong = await client.ping();
      return pong === 'PONG' ? null : 'Sin respuesta válida';
    } finally {
      try {
        client.disconnect();
      } catch {
        /* ya cerrado */
      }
    }
  } catch {
    return `No responde en ${url}`;
  }
}

async function main() {
  console.log('\n\u001b[1mDropshipPilot — comprobación de puesta en marcha\u001b[0m');
  console.log(`Entorno: ${process.env.NODE_ENV ?? 'development'} · ${new Date().toLocaleString('es-ES')}\n`);

  // ── 1. Base de datos ─────────────────────────────────────────────────────
  if (!process.env.DATABASE_URL) {
    line('fail', 'Base de datos', 'Falta DATABASE_URL: la app funcionaría en modo demo con datos en memoria');
  } else {
    try {
      const { prisma } = await import('../src/lib/prisma');
      const { withSystem } = await import('../src/lib/tenant-context');
      const counts = await withSystem('preflight', async () => ({
        users: await prisma.user.count(),
        products: await prisma.product.count(),
        stores: await prisma.store.count(),
      }));
      line('ok', 'Base de datos', `PostgreSQL responde · ${counts.users} cliente(s), ${counts.products} producto(s), ${counts.stores} tienda(s)`);
    } catch (err) {
      line('fail', 'Base de datos', `Definida pero no responde: ${(err as Error).message.split('\n')[0]}`);
    }
  }

  // ── 2. Redis ─────────────────────────────────────────────────────────────
  const redisError = await pingRedis();
  if (redisError) line('fail', 'Redis (colas 24/7)', redisError);
  else line('ok', 'Redis (colas 24/7)', 'Responde PONG');

  // ── 3. Microservicio de scraping ─────────────────────────────────────────
  const mode = process.env.SCRAPER_MODE ?? 'auto';
  if (mode === 'demo') {
    line('warn', 'Extracción', 'SCRAPER_MODE=demo: las extracciones son simuladas');
  } else if (!process.env.SCRAPER_SERVICE_URL) {
    line('warn', 'Extracción', 'Sin SCRAPER_SERVICE_URL');
  } else {
    try {
      const res = await fetch(`${process.env.SCRAPER_SERVICE_URL.replace(/\/$/, '')}/health`, { signal: AbortSignal.timeout(3500) });
      line(res.ok ? 'ok' : 'warn', 'Extracción', `Microservicio en ${process.env.SCRAPER_SERVICE_URL} → HTTP ${res.status}`);
    } catch {
      line('warn', 'Extracción', `El microservicio no responde en ${process.env.SCRAPER_SERVICE_URL} (arráncalo con npm run scraper:dev)`);
    }
  }

  // ── 4. Cifrado y sesiones ────────────────────────────────────────────────
  if (process.env.ENCRYPTION_KEY && process.env.ENCRYPTION_KEY.length >= 32) line('ok', 'Cifrado', 'ENCRYPTION_KEY presente');
  else line('fail', 'Cifrado', 'Falta ENCRYPTION_KEY (obligatorio para guardar credenciales de clientes)');

  if (process.env.AUTH_ENABLED === 'true') {
    if (process.env.NEXTAUTH_SECRET && process.env.NEXTAUTH_URL) line('ok', 'Autenticación', 'Activada con NEXTAUTH_SECRET y NEXTAUTH_URL');
    else line('fail', 'Autenticación', 'AUTH_ENABLED=true pero faltan NEXTAUTH_SECRET y/o NEXTAUTH_URL');
  } else {
    line('warn', 'Autenticación', 'AUTH_ENABLED=false: cualquiera con la URL entra al panel (no lo dejes así en producción)');
  }

  if (process.env.REQUIRE_EMAIL_VERIFICATION === 'true') line('ok', 'Verificación de email', 'Obligatoria');
  else line('warn', 'Verificación de email', 'Desactivada (actívala al abrir al público)');

  // ── 5. Correo ────────────────────────────────────────────────────────────
  if (process.env.SMTP_HOST) line('ok', 'Correo', `SMTP propio · ${process.env.SMTP_HOST}:${process.env.SMTP_PORT ?? 587}${process.env.SMTP_TLS === 'false' ? ' (sin cifrar)' : ' (STARTTLS/TLS)'} · desde ${process.env.MAIL_FROM ?? 'remitente por defecto'}`);
  else if (process.env.RESEND_API_KEY && process.env.MAIL_FROM) line('ok', 'Correo', `Resend configurado (${process.env.MAIL_FROM})`);
  else if (process.env.MAIL_WEBHOOK_URL) line('ok', 'Correo', 'Transporte por webhook');
  else line('warn', 'Correo', 'Sin transporte: los enlaces de verificación salen por consola (no sirve para clientes reales)');

  // ── 5b. Cambio de divisa ─────────────────────────────────────────────────
  const fx = fxStatus();
  if (fx.source === 'manual') line('ok', 'Cambio de divisa', `Tasas fijadas a mano en FX_RATES · 1 USD = ${toEur(1, 'USD')} €`);
  else if (fx.source === 'ecb') line('ok', 'Cambio de divisa', `Tipos del BCE de hace ${fx.ageHours} h (automático, gratis) · 1 USD = ${toEur(1, 'USD')} €`);
  else line('warn', 'Cambio de divisa', `Sin tasas descargadas: se usan las de reserva y el worker las traerá del BCE (o ejecuta: npx tsx scripts/refresh-fx.ts)`);

  // ── 6. Stripe ────────────────────────────────────────────────────────────
  const prices = [
    'STRIPE_PRICE_STARTER_MONTHLY', 'STRIPE_PRICE_STARTER_YEARLY',
    'STRIPE_PRICE_PRO_MONTHLY', 'STRIPE_PRICE_PRO_YEARLY',
    'STRIPE_PRICE_ENTERPRISE_MONTHLY', 'STRIPE_PRICE_ENTERPRISE_YEARLY',
  ];
  const present = prices.filter((p) => Boolean(process.env[p]));
  if (process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET && present.length === prices.length) {
    const test = process.env.STRIPE_SECRET_KEY.startsWith('sk_test_');
    line('ok', 'Cobros', `Stripe configurado con los 6 precios${test ? ' (clave de PRUEBAS)' : ' (clave real)'}`);
  } else if (!process.env.STRIPE_SECRET_KEY) {
    line('warn', 'Cobros', 'Sin Stripe: cobro desactivado (ejecuta: npm run stripe:setup --key=sk_test_…)');
  } else {
    line('warn', 'Cobros', `Stripe a medias: ${present.length}/6 precios y ${process.env.STRIPE_WEBHOOK_SECRET ? 'webhook OK' : 'falta STRIPE_WEBHOOK_SECRET'}`);
  }

  // ── 6b. Lemon Squeezy (cobro alternativo sin alta de autónomo) ───────────
  const lemonVariants = ['STARTER', 'PRO', 'ENTERPRISE'].flatMap((t) => [`LEMON_VARIANT_${t}_MONTHLY`, `LEMON_VARIANT_${t}_YEARLY`]);
  const lemonPresent = lemonVariants.filter((v) => Boolean(process.env[v]));
  if (process.env.LEMON_API_KEY && process.env.LEMON_STORE_ID && process.env.LEMON_WEBHOOK_SECRET && lemonPresent.length === lemonVariants.length) {
    line('ok', 'Cobros (Lemon Squeezy)', `Configurado con las ${lemonVariants.length} variantes`);
  } else if (!process.env.LEMON_API_KEY && !process.env.LEMON_WEBHOOK_SECRET) {
    line('info', 'Cobros (Lemon Squeezy)', 'Sin configurar (alternativa a Stripe; ver PAGOS.md)');
  } else {
    line('warn', 'Cobros (Lemon Squeezy)', `A medias: ${lemonPresent.length}/${lemonVariants.length} variantes · ${process.env.LEMON_WEBHOOK_SECRET ? 'webhook OK' : 'falta LEMON_WEBHOOK_SECRET'}`);
  }

  // ── 6c. OAuth de Shopify ─────────────────────────────────────────────────
  if (process.env.SHOPIFY_API_KEY && process.env.SHOPIFY_API_SECRET) {
    line('ok', 'Shopify OAuth', 'App configurada: los clientes conectan su tienda con un clic');
  } else {
    line('info', 'Shopify OAuth', 'Sin configurar (se puede conectar con token manual)');
  }

  // ── 7. Webhooks públicos ─────────────────────────────────────────────────
  const publicUrl = process.env.NEXTAUTH_URL ?? process.env.APP_URL ?? '';
  if (/^https:\/\//.test(publicUrl) && !/localhost|127\.0\.0\.1/.test(publicUrl)) {
    line('ok', 'Webhooks', `Dominio público: ${publicUrl}`);
  } else {
    line('warn', 'Webhooks', 'Sin dominio público HTTPS: las tiendas y Stripe no pueden enviar webhooks');
  }

  // ── 8. Proxies ───────────────────────────────────────────────────────────
  const proxylist = (process.env.PROXY_LIST ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (proxylist.length) line('ok', 'Proxies', `${proxylist.length} configurado(s)`);
  else line('warn', 'Proxies', 'Sin proxies: AliExpress bloquea IPs de servidor (usa API oficial o proxies residenciales)');

  // ── 8b. Vigilancia del sistema ───────────────────────────────────────────
  try {
    const { runWatchdog, reportLine } = await import('../src/lib/watchdog');
    const report = await runWatchdog();
    if (report.issues.length === 0) line('ok', 'Vigilancia del sistema', reportLine(report));
    else {
      for (const issue of report.issues) line(issue.severity === 'critico' ? 'fail' : 'warn', `Vigilancia · ${issue.title}`, issue.detail);
    }
    line('info', 'Vigilancia automática', 'el motor 24/7 la ejecuta cada WATCHDOG_INTERVAL_MINUTES (15 por defecto) y avisa a los ADMIN');
  } catch (err) {
    line('warn', 'Vigilancia del sistema', `no se pudo ejecutar: ${(err as Error).message.split('\n')[0]}`);
  }

  // ── 8c. Catálogo servido por la plataforma ───────────────────────────────
  try {
    const { platformCredentialSummary } = await import('../src/lib/catalog/platform-credentials');
    const { prisma } = await import('../src/lib/prisma');
    const { withSystem } = await import('../src/lib/tenant-context');

    const [summary, sample, real, categories] = await Promise.all([
      platformCredentialSummary(),
      withSystem('preflight: muestra', () => prisma.catalogItem.count({ where: { source: 'sample' } })),
      withSystem('preflight: reales', () => prisma.catalogItem.count({ where: { source: 'api' } })),
      withSystem('preflight: categorías', () => prisma.catalogCategory.count()),
    ]);

    const withKeys = summary.filter((c) => c.configured && c.enabled);
    if (withKeys.length === 0) {
      line('warn', 'Catálogo · claves de la plataforma', 'ningún proveedor configurado: los clientes ven el catálogo de muestra (36 artículos). Añádelas en Administración → Claves de proveedor');
    } else {
      line('ok', 'Catálogo · claves de la plataforma', withKeys.map((c) => `${c.name} (${c.source === 'env' ? 'entorno' : 'panel'}${c.status === 'CONNECTED' ? ', verificada' : ''})`).join(' · '));
      for (const c of withKeys.filter((c) => c.status === 'ERROR')) {
        line('warn', `Catálogo · ${c.name}`, c.lastError ?? 'la última prueba dio error');
      }
    }
    line('info', 'Catálogo · índice', `${real} producto(s) reales · ${sample} de muestra · ${categories} categorías`);
    if (real === 0 && withKeys.length > 0) {
      line('info', 'Catálogo · siguiente paso', 'npx tsx scripts/seed-catalog.ts  (descarga el catálogo real de los proveedores configurados)');
    }
  } catch (err) {
    line('warn', 'Catálogo', `no se pudo comprobar: ${(err as Error).message.split('\n')[0]}`);
  }

  // ── 9. Archivos de entorno ───────────────────────────────────────────────
  for (const file of ['.env.local', '.env']) {
    if (fs.existsSync(file)) line('ok', `Archivo ${file}`, 'presente');
    else line('info', `Archivo ${file}`, 'no existe');
  }

  // ── 10. Clientes y datos por inquilino ───────────────────────────────────
  try {
    const { prisma } = await import('../src/lib/prisma');
    const { withSystem } = await import('../src/lib/tenant-context');
    const tenants = await withSystem('preflight: inquilinos', () =>
      prisma.user.findMany({ select: { email: true, plan: true, _count: { select: { stores: true, products: true, supplierAccounts: true } } } }),
    );
    console.log('');
    console.log('\u001b[1mClientes en la base de datos:\u001b[0m');
    for (const t of tenants) {
      console.log(`  · ${t.email.padEnd(32)} ${t.plan.padEnd(11)} ${t._count.stores} tienda(s) · ${t._count.products} producto(s) · ${t._count.supplierAccounts} API(s)`);
    }
    if (tenants.length === 0) line('warn', 'Clientes', 'No hay ningún cliente: ejecuta npm run seed:demo');
  } catch {
    /* ya se ha reportado el error de base de datos */
  }

  console.log('');
  console.log(`${ok} correctas · ${warn} recomendadas pendientes · ${blockers} bloqueantes`);
  if (blockers > 0) {
    console.log('\n\u001b[41m\u001b[37m  NO ESTÁ LISTO PARA OPERAR: resuelve los bloqueantes  \u001b[0m\n');
    process.exitCode = 1;
  } else if (warn > 0) {
    console.log('\n\u001b[43m\u001b[30m  OPERATIVO PARA PROBAR · quedan recomendadas por conectar  \u001b[0m\n');
  } else {
    console.log('\n\u001b[42m\u001b[30m  TODO CONECTADO  \u001b[0m\n');
  }
}

main().catch((err) => {
  console.error('\n✘ Error en la comprobación:', err);
  process.exitCode = 1;
});
