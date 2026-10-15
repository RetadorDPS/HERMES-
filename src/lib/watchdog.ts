/**
 * src/lib/watchdog.ts — Vigilancia del sistema y aviso al operador.
 *
 * Cubre el hueco que quedaba en la auditoría: si el servidor entero se degrada
 * (base de datos caída, Redis sin responder, microservicio de scraping muerto,
 * cola atascada o sync fallando en cadena), **nadie se enteraba** hasta mirar.
 *
 * Qué hace:
 *   1. `runWatchdog()` comprueba en vivo las piezas críticas y devuelve la lista
 *      de problemas con gravedad.
 *   2. `alertOperators()` envía un correo a todos los usuarios con rol ADMIN
 *      (con freno anti-spam por problema, para no inundar).
 *
 * Se ejecuta: en el motor 24/7 (job `health:watch` cada 15 min) y a mano con
 * `npm run watchdog` (útil tras un despliegue o desde un cron externo).
 */
import { prisma, hasDatabase } from './prisma';
import { withSystem } from './tenant-context';
import { sendMail, mailLayout } from './mail';
import { PLANS } from './plans';

export interface WatchdogIssue {
  id: string;
  severity: 'critico' | 'aviso';
  title: string;
  detail: string;
}

export interface WatchdogReport {
  ok: boolean;
  checkedAt: string;
  durationMs: number;
  checks: {
    database: { ok: boolean; latencyMs: number | null; detail: string };
    redis: { ok: boolean; latencyMs: number | null; detail: string };
    queues: { ok: boolean; waiting: number; active: number; failed: number; detail: string };
    scraper: { ok: boolean; configured: boolean; detail: string };
    sync: { ok: boolean; failedLastHour: number; totalLastHour: number; failedRatio: number; detail: string };
    tenants: { users: number; products: number; outOfStock: number };
  };
  issues: WatchdogIssue[];
}

const env = () => ({
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  scraperUrl: process.env.SCRAPER_SERVICE_URL?.replace(/\/$/, ''),
  scraperMode: process.env.SCRAPER_MODE ?? 'auto',
  // Umbrales (configurables)
  queueWarn: Number(process.env.WATCHDOG_QUEUE_WARN ?? 500),
  failedWarn: Number(process.env.WATCHDOG_FAILED_WARN ?? 50),
  ratioWarnPct: Number(process.env.WATCHDOG_FAILED_RATIO_PCT ?? 30),
});

async function pingRedis(url: string): Promise<{ ok: boolean; latencyMs: number | null; detail: string }> {
  const started = Date.now();
  const { default: IORedis } = await import('ioredis');
  // retryStrategy: null = no reintentar en segundo plano. Sin esto, apuntar a un
  // Redis caído deja el proceso vivo reconectando y una comprobación nunca termina.
  const client = new IORedis(url, { lazyConnect: true, connectTimeout: 2500, maxRetriesPerRequest: 1, enableOfflineQueue: false, retryStrategy: () => null });
  try {
    await client.connect();
    const pong = await client.ping();
    return { ok: pong === 'PONG', latencyMs: Date.now() - started, detail: pong === 'PONG' ? 'Responde PONG' : 'Respuesta inesperada' };
  } catch (err) {
    return { ok: false, latencyMs: null, detail: (err as Error).message.split('\n')[0] };
  } finally {
    try {
      client.disconnect();
    } catch {
      /* ya estaba cerrado */
    }
  }
}

async function queueDepth(redisUrl: string) {
  try {
    const { Queue } = await import('bullmq');
    const { default: IORedis } = await import('ioredis');
    const connection = new IORedis(redisUrl, { maxRetriesPerRequest: 1, retryStrategy: () => null });
    const out = { waiting: 0, active: 0, failed: 0 };
    try {
      for (const name of ['sync', 'orders']) {
        const q = new Queue(name, { connection });
        const counts = await q.getJobCounts('waiting', 'active', 'failed');
        out.waiting += counts.waiting ?? 0;
        out.active += counts.active ?? 0;
        out.failed += counts.failed ?? 0;
        await q.close();
      }
      return out;
    } finally {
      try {
        connection.disconnect();
      } catch {
        /* ya cerrado */
      }
    }
  } catch {
    return null;
  }
}

/** Comprobación completa. Nunca lanza: devuelve el informe con los problemas. */
export async function runWatchdog(opts: { redisUrlOverride?: string } = {}): Promise<WatchdogReport> {
  const started = Date.now();
  const cfg = env();
  const issues: WatchdogIssue[] = [];

  // ── Base de datos ────────────────────────────────────────────────────────
  let database: WatchdogReport['checks']['database'] = { ok: false, latencyMs: null, detail: 'DATABASE_URL sin definir (modo demo: no hay nada que vigilar)' };
  let tenants = { users: 0, products: 0, outOfStock: 0 };
  if (hasDatabase()) {
    const t0 = Date.now();
    try {
      await prisma.$queryRaw`SELECT 1`;
      const [users, products, outOfStock] = await withSystem('watchdog: contar datos', () =>
        Promise.all([prisma.user.count(), prisma.product.count(), prisma.product.count({ where: { status: 'OUT_OF_STOCK' } })]),
      );
      database = { ok: true, latencyMs: Date.now() - t0, detail: `Responde en ${Date.now() - t0} ms` };
      tenants = { users, products, outOfStock };
      if (Date.now() - t0 > 2000) issues.push({ id: 'db-lenta', severity: 'aviso', title: 'La base de datos responde muy lenta', detail: `Una consulta trivial tardó ${Date.now() - t0} ms.` });
    } catch (err) {
      database = { ok: false, latencyMs: null, detail: (err as Error).message.split('\n')[0] };
      issues.push({ id: 'db-caida', severity: 'critico', title: 'La base de datos no responde', detail: `PostgreSQL no contesta: ${database.detail}. Sin ella la app sirve datos de ejemplo y los workers dejan de escribir.` });
    }
  }

  // ── Redis ────────────────────────────────────────────────────────────────
  const redis = await pingRedis(opts.redisUrlOverride ?? cfg.redisUrl);
  if (!redis.ok) {
    issues.push({ id: 'redis-caido', severity: 'critico', title: 'Redis no responde', detail: `Los workers 24/7 no pueden funcionar sin Redis: ${redis.detail} (${opts.redisUrlOverride ?? cfg.redisUrl})` });
  }

  // ── Colas ────────────────────────────────────────────────────────────────
  let queues: WatchdogReport['checks']['queues'] = { ok: redis.ok, waiting: 0, active: 0, failed: 0, detail: 'Sin datos (Redis no responde)' };
  if (redis.ok) {
    const depth = await queueDepth(opts.redisUrlOverride ?? cfg.redisUrl);
    if (depth) {
      queues = { ok: true, ...depth, detail: `${depth.waiting} en espera · ${depth.active} en proceso · ${depth.failed} fallidos` };
      if (depth.waiting > cfg.queueWarn) {
        issues.push({ id: 'cola-atascada', severity: 'aviso', title: 'La cola de trabajos se está atascando', detail: `Hay ${depth.waiting} trabajos en espera (umbral ${cfg.queueWarn}). Revisa la concurrencia y si el proveedor está bloqueando.` });
      }
      if (depth.failed > cfg.failedWarn) {
        issues.push({ id: 'cola-fallos', severity: 'aviso', title: 'Muchos trabajos fallidos en la cola', detail: `${depth.failed} trabajos fallidos acumulados. Abre el monitor de sincronización para ver el motivo y reintentarlos.` });
      }
    } else {
      queues = { ok: false, waiting: 0, active: 0, failed: 0, detail: 'No se pudo consultar la cola' };
    }
  }

  // ── Microservicio de scraping ────────────────────────────────────────────
  let scraper: WatchdogReport['checks']['scraper'] = { ok: true, configured: false, detail: 'No configurado (extracción por API de proveedor o modo demo)' };
  if (cfg.scraperMode !== 'demo' && cfg.scraperUrl) {
    try {
      const res = await fetch(`${cfg.scraperUrl}/health`, { signal: AbortSignal.timeout(4000) });
      scraper = { ok: res.ok, configured: true, detail: res.ok ? `Responde en ${cfg.scraperUrl}` : `HTTP ${res.status} en ${cfg.scraperUrl}` };
      if (!res.ok) issues.push({ id: 'scraper-caido', severity: 'aviso', title: 'El microservicio de extracción no responde bien', detail: `HTTP ${res.status} en ${cfg.scraperUrl}` });
    } catch (err) {
      scraper = { ok: false, configured: true, detail: `Sin respuesta en ${cfg.scraperUrl}: ${(err as Error).message.split('\n')[0]}` };
      issues.push({ id: 'scraper-caido', severity: 'aviso', title: 'El microservicio de extracción está caído', detail: `Sin respuesta en ${cfg.scraperUrl}. Las extracciones caerán al extractor local o al modo demo.` });
    }
  }

  // ── Salud de la sincronización (última hora) ─────────────────────────────
  let sync: WatchdogReport['checks']['sync'] = { ok: true, failedLastHour: 0, totalLastHour: 0, failedRatio: 0, detail: 'Sin datos' };
  if (database.ok) {
    try {
      const since = new Date(Date.now() - 3600_000);
      const [totalLastHour, failedLastHour] = await withSystem('watchdog: salud de sync', () =>
        Promise.all([
          prisma.syncLog.count({ where: { createdAt: { gte: since } } }),
          prisma.syncLog.count({ where: { createdAt: { gte: since }, status: 'FAILED' } }),
        ]),
      );
      const failedRatio = totalLastHour ? Math.round((failedLastHour / totalLastHour) * 100) : 0;
      sync = { ok: true, failedLastHour, totalLastHour, failedRatio, detail: `${failedLastHour}/${totalLastHour} fallidos en la última hora (${failedRatio} %)` };
      if (totalLastHour >= 10 && failedRatio >= cfg.ratioWarnPct) {
        issues.push({
          id: 'sync-fallando',
          severity: 'aviso',
          title: 'La sincronización está fallando en cadena',
          detail: `${failedLastHour} de ${totalLastHour} trabajos fallaron en la última hora (${failedRatio} %, umbral ${cfg.ratioWarnPct} %). Suele ser un proveedor bloqueando o un token caducado.`,
        });
      }
    } catch {
      sync = { ok: false, failedLastHour: 0, totalLastHour: 0, failedRatio: 0, detail: 'No se pudo consultar' };
    }
  }

  return {
    ok: issues.every((i) => i.severity !== 'critico'),
    checkedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    checks: { database, redis, queues, scraper, sync, tenants },
    issues,
  };
}

// ─────────────────────────── Aviso al operador ──────────────────────────────

const operatorThrottle = new Map<string, number>();

/**
 * Envía un correo a los ADMIN de la plataforma con los problemas detectados.
 * Freno por problema (por defecto 60 min) en memoria y persistido en AuditLog,
 * para que un problema persistente no mande un correo cada 15 minutos.
 */
export async function alertOperators(
  issues: WatchdogIssue[],
  opts: { minIntervalMinutes?: number; force?: boolean; report?: WatchdogReport } = {},
): Promise<{ sent: boolean; reason?: string; recipients: number; transport?: string }> {
  if (issues.length === 0) return { sent: false, reason: 'sin-problemas', recipients: 0 };
  const minutes = opts.minIntervalMinutes ?? 60;
  const key = issues.map((i) => i.id).sort().join('|');

  if (!opts.force) {
    const last = operatorThrottle.get(key) ?? 0;
    if (Date.now() - last < minutes * 60_000) return { sent: false, reason: 'frenado', recipients: 0 };
    try {
      const recent = await withSystem('watchdog: comprobar último aviso al operador', () =>
        prisma.auditLog.findFirst({ where: { action: 'alert.operator', metadata: { path: ['key'], equals: key } }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
      );
      if (recent && Date.now() - recent.createdAt.getTime() < minutes * 60_000) return { sent: false, reason: 'frenado', recipients: 0 };
    } catch {
      /* si no se puede comprobar, se envía igualmente */
    }
    operatorThrottle.set(key, Date.now());
  }

  const admins = await withSystem('watchdog: buscar operadores', () =>
    prisma.user.findMany({ where: { role: 'ADMIN' }, select: { id: true, email: true } }),
  ).catch(() => [] as { id: string; email: string }[]);
  if (admins.length === 0) return { sent: false, reason: 'sin-operadores', recipients: 0 };

  const criticos = issues.filter((i) => i.severity === 'critico');
  const avisos = issues.filter((i) => i.severity === 'aviso');
  const title = criticos.length ? `Atención: ${criticos.length} problema(s) grave(s) en el sistema` : `${avisos.length} aviso(s) del sistema`;
  const list = [...criticos, ...avisos]
    .map((i) => `<li style="margin-bottom:8px"><strong>${i.severity === 'critico' ? '🔴' : '🟠'} ${i.title}</strong><br><span style="color:#8b93a7">${i.detail}</span></li>`)
    .join('');
  const t = opts.report?.checks.tenants;
  const body = `
    <p>La vigilancia automática ha detectado esto:</p>
    <ul style="padding-left:18px">${list}</ul>
    ${t ? `<p style="color:#8b93a7;font-size:12px">Estado: ${t.users} cliente(s) · ${t.products} producto(s) · ${t.outOfStock} agotado(s) · comprobado ${new Date(opts.report!.checkedAt).toLocaleString('es-ES')}</p>` : ''}
    <p style="color:#8b93a7;font-size:12px">Se reenvía como mucho una vez por hora mientras el problema continúe.</p>`;

  const appUrl = (process.env.NEXTAUTH_URL ?? process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  let transport = 'console';
  for (const admin of admins) {
    const result = await sendMail({ to: admin.email, subject: `[DropshipPilot · operador] ${title}`, html: mailLayout(title, body, { label: 'Abrir el panel', url: `${appUrl}/admin` }) });
    transport = result.transport;
  }

  try {
    await withSystem('watchdog: registrar aviso al operador', () =>
      prisma.auditLog.create({
        data: {
          userId: admins[0].id,
          action: 'alert.operator',
          metadata: { key, issues: issues.map((i) => ({ id: i.id, severity: i.severity })), recipients: admins.length, transport },
        },
      }),
    );
  } catch {
    /* el registro es secundario */
  }

  return { sent: true, recipients: admins.length, transport };
}

/** Resumen de una línea (para logs del worker y `npm run preflight`). */
export function reportLine(report: WatchdogReport) {
  if (report.issues.length === 0) return `sistema sano (${report.durationMs} ms) · db ${report.checks.database.latencyMs ?? '—'} ms · cola ${report.checks.queues.detail} · sync ${report.checks.sync.detail}`;
  return report.issues.map((i) => `${i.severity === 'critico' ? '🔴' : '🟠'} ${i.title}`).join(' · ');
}

/** Frecuencias de sync prometidas por plan (para documentar y para /setup). */
export function planFrequencies() {
  return Object.values(PLANS).map((p) => ({ tier: p.tier, name: p.name, minutes: p.syncIntervalMinutes }));
}
