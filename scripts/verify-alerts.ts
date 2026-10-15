/**
 * scripts/verify-alerts.ts — Verifica los avisos por correo.
 *
 *   npm run verify:alerts
 *
 * Comprueba: envío (transporte de consola en desarrollo), freno anti-spam,
 * respeto de las preferencias del cliente y la ruta HTTP de prueba.
 */
import '../workers/env';
import { prisma } from '../src/lib/prisma';
import { withSystem } from '../src/lib/tenant-context';
import { alertUser, alertSettings, updateAlertSettings } from '../src/lib/alerts';

const BASE = process.env.APP_URL ?? 'http://localhost:3000';

let passed = 0;
let failed = 0;
const check = (ok: boolean, msg: string, extra = '') => {
  console.log(`${ok ? '✔' : '✘'} ${msg}${extra ? ` — ${extra}` : ''}`);
  ok ? passed++ : failed++;
};

async function main() {
  console.log(`\n\u001b[1mAvisos por correo — verificación\u001b[0m\n`);

  const user = await withSystem('verify-alerts: elegir cliente', () =>
    prisma.user.findFirst({ where: { role: { not: 'ADMIN' } }, select: { id: true, email: true } }),
  );
  if (!user) {
    console.error('✘ No hay ningún cliente de prueba');
    process.exitCode = 1;
    return;
  }
  console.log(`  Cliente de prueba: ${user.email}\n`);

  const settings = await alertSettings(user.id);
  check(settings.prefs.sync && settings.prefs.stock && settings.prefs.webhooks && settings.prefs.billing, 'Todas las preferencias vienen activadas por defecto');
  check(settings.transport === 'console' || settings.transport === 'resend' || settings.transport === 'webhook', 'Se detecta el transporte de correo', settings.transport);

  // ── Envío forzado (ignora el freno) ──────────────────────────────────────
  const first = await alertUser(user.id, 'sync', { title: 'Prueba de aviso', body: 'Cuerpo de prueba', link: '/monitor' }, { force: true });
  check(first.sent, 'El aviso se envía con éxito', `transporte=${first.transport}${first.error ? ` error=${first.error}` : ''}`);

  // ── Freno anti-spam ──────────────────────────────────────────────────────
  const second = await alertUser(user.id, 'sync', { title: 'Repetido', body: 'No debería enviarse' });
  check(second.sent === false && second.reason === 'throttled', 'El segundo aviso seguido se frena (anti-spam)', `reason=${second.reason}`);

  // ── Preferencias ─────────────────────────────────────────────────────────
  const before = await alertSettings(user.id);
  await updateAlertSettings(user.id, { sync: false });
  const off = await alertUser(user.id, 'sync', { title: 'Con la preferencia apagada', body: 'No debe enviarse' }, { force: true });
  check(off.sent === false && off.reason === 'preference-off', 'Con la preferencia apagada no se envía', `reason=${off.reason}`);
  await updateAlertSettings(user.id, { sync: before.prefs.sync });
  const restored = await alertSettings(user.id);
  check(restored.prefs.sync === before.prefs.sync, 'La preferencia se restaura');

  // ── Ruta HTTP ────────────────────────────────────────────────────────────
  const get = await fetch(`${BASE}/api/alerts`);
  const getJson: any = await get.json().catch(() => null);
  check(get.status === 200 && getJson?.ok === true, 'GET /api/alerts responde', `HTTP ${get.status}`);

  const patch = await fetch(`${BASE}/api/alerts`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ billing: true }),
  });
  check(patch.status === 200, 'PATCH /api/alerts guarda preferencias', `HTTP ${patch.status}`);

  const post = await fetch(`${BASE}/api/alerts`, { method: 'POST' });
  const postJson: any = await post.json().catch(() => null);
  check(postJson?.ok === true, 'POST /api/alerts envía el correo de prueba', `HTTP ${post.status} transporte=${postJson?.transport}`);

  // ── Registro de auditoría (freno persistente) ────────────────────────────
  const logged = await withSystem('verify-alerts: leer rastro', () =>
    prisma.auditLog.count({ where: { userId: user.id, action: { startsWith: 'alert.' } } }),
  );
  check(logged >= 1, 'Cada aviso deja rastro en auditoría', `${logged} registros`);

  console.log(`\n${passed} comprobaciones superadas · ${failed} fallidas\n`);
  if (failed > 0) {
    console.log('\u001b[41m\u001b[37m  AVISOS POR CORREO CON FALLOS  \u001b[0m\n');
    process.exitCode = 1;
  } else {
    console.log('\u001b[42m\u001b[30m  AVISOS POR CORREO VERIFICADOS  \u001b[0m\n');
  }
}

main()
  .catch((err) => {
    console.error('\n✘ Error:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
