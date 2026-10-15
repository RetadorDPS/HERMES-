/**
 * scripts/verify-ops.ts — Verifica la vigilancia del sistema y la frecuencia
 * de sincronización por plan.
 *
 *   npm run verify:ops
 *
 * Cubre: comprobación sana, detección de Redis caído (puerto muerto), aviso al
 * operador con freno anti-spam y auditoría, y las reglas de «qué toca
 * re-verificar» según el plan de cada dueño.
 */
import '../workers/env';
import { prisma } from '../src/lib/prisma';
import { withSystem } from '../src/lib/tenant-context';
import { alertOperators, runWatchdog } from '../src/lib/watchdog';
import { filterDueProducts } from '../workers/lib';
import { PLANS, planFor } from '../src/lib/plans';

let passed = 0;
let failed = 0;
const check = (ok: boolean, msg: string, extra = '') => {
  console.log(`${ok ? '✔' : '✘'} ${msg}${extra ? ` — ${extra}` : ''}`);
  ok ? passed++ : failed++;
};

async function main() {
  console.log(`\n\u001b[1mVigilancia del sistema y sync por plan — verificación\u001b[0m\n`);

  // ── 1. Sistema sano ──────────────────────────────────────────────────────
  const healthy = await runWatchdog();
  check(healthy.checks.database.ok, 'La base de datos se comprueba', healthy.checks.database.detail);
  check(healthy.checks.redis.ok, 'Redis se comprueba', healthy.checks.redis.detail);
  check(healthy.checks.queues.ok, 'Las colas se leen', healthy.checks.queues.detail);
  check(healthy.ok, 'Sin problemas graves en el estado actual', `avisos=${healthy.issues.length}`);
  check(healthy.checks.sync.totalLastHour >= 0, 'Se mide la salud de la sincronización', healthy.checks.sync.detail);

  // ── 2. Detección de caída (Redis en un puerto muerto) ────────────────────
  const broken = await runWatchdog({ redisUrlOverride: 'redis://localhost:6999' });
  const redisIssue = broken.issues.find((i) => i.id === 'redis-caido');
  check(Boolean(redisIssue), 'Detecta Redis caído', redisIssue?.title ?? 'no detectado');
  check(redisIssue?.severity === 'critico', 'Lo marca como crítico', redisIssue?.severity ?? '—');
  check(broken.ok === false, 'El informe global pasa a «no sano»', `ok=${broken.ok}`);

  // ── 3. Aviso al operador (con freno y auditoría) ─────────────────────────
  const admins = await withSystem('verify-ops: contar operadores', () => prisma.user.count({ where: { role: 'ADMIN' } }));
  check(admins >= 1, 'Hay al menos un operador para avisar', `${admins} ADMIN`);

  const first = await alertOperators(broken.issues, { report: broken, force: true, minIntervalMinutes: 1 });
  check(first.sent, 'El aviso al operador se envía', `destinatarios=${first.recipients} transporte=${first.transport}`);

  const second = await alertOperators(broken.issues, { report: broken, minIntervalMinutes: 60 });
  check(second.sent === false && second.reason === 'frenado', 'El segundo aviso seguido se frena', `reason=${second.reason}`);

  const audited = await withSystem('verify-ops: leer auditoría', () => prisma.auditLog.count({ where: { action: 'alert.operator' } }));
  check(audited >= 1, 'El aviso queda auditado', `${audited} entradas`);

  const none = await alertOperators([], { report: healthy });
  check(none.sent === false && none.reason === 'sin-problemas', 'Sin problemas no se envía nada', `reason=${none.reason}`);

  // ── 4. Frecuencia de sync por plan (función que usa el barrido) ──────────
  const now = Date.now();
  const min = (n: number) => new Date(now - n * 60_000);
  const intervals = new Map([
    ['u-prueba', planFor('TRIAL').syncIntervalMinutes],
    ['u-starter', planFor('STARTER').syncIntervalMinutes],
    ['u-pro', planFor('PRO').syncIntervalMinutes],
    ['u-ent', planFor('ENTERPRISE').syncIntervalMinutes],
  ]);
  check(PLANS.TRIAL.syncIntervalMinutes === 360 && PLANS.STARTER.syncIntervalMinutes === 120 && PLANS.PRO.syncIntervalMinutes === 60 && PLANS.ENTERPRISE.syncIntervalMinutes === 30, 'Los planes prometen 360/120/60/30 minutos');

  const sample = [
    { id: 'nunca', userId: 'u-prueba', lastSyncedAt: null },
    { id: 'prueba-hace-1h', userId: 'u-prueba', lastSyncedAt: min(60) },
    { id: 'prueba-hace-7h', userId: 'u-prueba', lastSyncedAt: min(420) },
    { id: 'starter-hace-90min', userId: 'u-starter', lastSyncedAt: min(90) },
    { id: 'starter-hace-3h', userId: 'u-starter', lastSyncedAt: min(180) },
    { id: 'pro-hace-30min', userId: 'u-pro', lastSyncedAt: min(30) },
    { id: 'pro-hace-62min', userId: 'u-pro', lastSyncedAt: min(62) },
    { id: 'enterprise-hace-20min', userId: 'u-ent', lastSyncedAt: min(20) },
    { id: 'enterprise-hace-31min', userId: 'u-ent', lastSyncedAt: min(31) },
  ];
  const due = filterDueProducts(sample, intervals).map((p) => p.id);
  const shouldBeDue = ['nunca', 'prueba-hace-7h', 'starter-hace-3h', 'pro-hace-62min', 'enterprise-hace-31min'];
  const shouldSkip = ['prueba-hace-1h', 'starter-hace-90min', 'pro-hace-30min', 'enterprise-hace-20min'];
  check(
    shouldBeDue.every((id) => due.includes(id)) && shouldSkip.every((id) => !due.includes(id)),
    'Cada plan respeta su frecuencia (30/60/120/360)',
    `vencidos: ${due.join(', ')}`,
  );
  check(due.length === 5, 'El filtro deja pasar exactamente los vencidos', `${due.length}/9`);

  // ── 5. Datos reales: cómo queda el barrido ahora mismo ───────────────────
  const { total, fresh, dueNow } = await withSystem('verify-ops: estado real del barrido', async () => {
    const products = await prisma.product.findMany({
      where: { isMonitored: true, status: { in: ['ACTIVE', 'OUT_OF_STOCK', 'ERROR'] as any } },
      select: { id: true, userId: true, lastSyncedAt: true },
    });
    const users = await prisma.user.findMany({ where: { id: { in: [...new Set(products.map((p) => p.userId))] } }, select: { id: true, plan: true } });
    const map = new Map(users.map((u) => [u.id, planFor(u.plan).syncIntervalMinutes]));
    const due = filterDueProducts(products, map);
    return { total: products.length, fresh: products.length - due.length, dueNow: due.length };
  });
  check(total > 0, 'Hay productos monitorizados sobre los que decidir', `${total}`);
  console.log(`   · ahora mismo: ${dueNow} toca re-verificar y ${fresh} están frescos según su plan`);

  console.log(`\n${passed} comprobaciones superadas · ${failed} fallidas\n`);
  if (failed > 0) {
    console.log('\u001b[41m\u001b[37m  VIGILANCIA CON FALLOS  \u001b[0m\n');
    process.exitCode = 1;
  } else {
    console.log('\u001b[42m\u001b[30m  VIGILANCIA Y FRECUENCIA POR PLAN VERIFICADAS  \u001b[0m\n');
  }
}

main()
  .catch((err) => {
    console.error('\n✘ Error:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
