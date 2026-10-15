/**
 * GET /api/health — Estado de la plataforma: BD, Redis, scraper service, proveedores.
 * Útil para el widget "Estado del sistema" del dashboard y para readiness probes.
 */
import { NextResponse } from 'next/server';
import { getQueueStats } from '@/lib/queue';
import { dbStatus, hasDatabase } from '@/lib/prisma';
import { fxStatus, toEur } from '@/lib/fx';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const checks: Record<string, { ok: boolean; detail: string; latencyMs?: number }> = {};

  // PostgreSQL (con estado del circuit breaker)
  const dbStart = Date.now();
  const db = dbStatus();
  if (hasDatabase()) {
    try {
      const { prisma } = await import('@/lib/prisma');
      await prisma.$queryRaw`SELECT 1`;
      checks.postgres = { ok: true, detail: 'Conectado', latencyMs: Date.now() - dbStart };
    } catch (err) {
      checks.postgres = { ok: false, detail: (err as Error).message };
    }
  } else if (db.circuitOpen) {
    checks.postgres = { ok: false, detail: `Circuito ABIERTO por fallo de consulta (${db.lastError}) — sirviendo datos demo; reintento automático en <60 s` };
  } else {
    checks.postgres = { ok: false, detail: 'DATABASE_URL no configurada — la app funciona en MODO DEMO con datos en memoria' };
  }

  // Redis / BullMQ
  try {
    const stats = await getQueueStats();
    checks.redis = stats.mode === 'redis'
      ? { ok: true, detail: `Cola activa · ${stats.waiting} en espera · ${stats.active} en proceso · ${stats.failed} fallidos` }
      : { ok: false, detail: 'REDIS_URL no configurada — cola en memoria (los jobs no persisten)' };
  } catch (err) {
    checks.redis = { ok: false, detail: (err as Error).message };
  }

  // Scraper service (FastAPI + Playwright)
  const scraperUrl = process.env.SCRAPER_SERVICE_URL;
  if (scraperUrl) {
    const t = Date.now();
    try {
      const res = await fetch(`${scraperUrl.replace(/\/$/, '')}/health`, { cache: 'no-store', signal: AbortSignal.timeout(4000) });
      const json: any = await res.json();
      checks.scraper = {
        ok: res.ok,
        detail: `v${json.version} · navegador ${json.browser_ready ? 'listo' : 'no iniciado'} · ${json.proxies_configured} proxies · ${json.active_jobs} jobs`,
        latencyMs: Date.now() - t,
      };
    } catch (err) {
      checks.scraper = { ok: false, detail: `No responde (${(err as Error).message}) — src/lib/scraper.ts usará el extractor local o el modo demo` };
    }
  } else {
    checks.scraper = { ok: false, detail: 'SCRAPER_SERVICE_URL no configurada — extrayendo en modo local/demo' };
  }

  // Stripe (facturación SaaS)
  // Cambio de divisa: de dónde salen las tasas y cuánto hace que se descargaron
  const fx = fxStatus();
  const fxDetail =
    fx.source === 'manual'
      ? `Tasas fijadas a mano (FX_RATES) · 1 USD = ${toEur(1, 'USD')} €`
      : fx.source === 'default'
        ? `Tasas de reserva (sin descargar todavía): el worker las trae del BCE cada ${fx.refreshHours} h · 1 USD = ${toEur(1, 'USD')} €`
        : `Tipos del BCE de hace ${fx.ageHours} h${fx.stale ? ' (toca refrescar)' : ''} · 1 USD = ${toEur(1, 'USD')} € · 1 GBP = ${toEur(1, 'GBP')} €`;
  checks.fx = { ok: fx.source !== 'default', detail: fxDetail };

  checks.stripe = process.env.STRIPE_SECRET_KEY
    ? { ok: true, detail: 'STRIPE_SECRET_KEY configurada (suscripciones activas)' }
    : { ok: false, detail: 'Stripe sin configurar — el plan se gestiona manualmente' };

  const allOk = Object.values(checks).every((c) => c.ok);
  return NextResponse.json({ ok: allOk, checks, mode: hasDatabase() ? 'production' : 'demo', at: new Date().toISOString() });
}
