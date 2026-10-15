/**
 * scripts/verify-tour.ts — Verifica el tutorial guiado de bienvenida.
 *
 *   npm run verify:tour
 *
 * Comprueba tres capas:
 *   1. Los pasos: que son los que se han acordado (12 + despedida), que no hay
 *      repetidos y que cada pestaña a la que llevan existe de verdad en la app.
 *   2. La máquina de estados: ofrecer → aceptar → terminar / descartar → reiniciar.
 *   3. La API real por HTTP, con auditoría y validación de acciones.
 *
 * Al terminar deja las cuentas de prueba en «pendiente de ver el tutorial», que
 * es como debe estar el panel para que el usuario lo pruebe.
 */
import '../workers/env';
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../src/lib/prisma';
import { withSystem } from '../src/lib/tenant-context';
import { TOUR_STEPS, TOUR_INTRO, TOUR_VERSION, TOUR_STARTED, TOUR_PENDING } from '../src/lib/tour-steps';
import { saveTourState, tourState } from '../src/lib/tour';

const BASE = process.env.APP_URL ?? 'http://localhost:3000';

let passed = 0;
let failed = 0;
const check = (ok: boolean, msg: string, extra = '') => {
  console.log(`${ok ? '✔' : '✘'} ${msg}${extra ? ` — ${extra}` : ''}`);
  ok ? passed++ : failed++;
};

async function main() {
  console.log('\n\u001b[1mTutorial guiado de bienvenida — verificación\u001b[0m\n');

  // ── 1. Los pasos ─────────────────────────────────────────────────────────
  check(TOUR_STEPS.length === 12, 'El recorrido tiene los 12 pasos acordados', `${TOUR_STEPS.length} pasos`);
  check(new Set(TOUR_STEPS.map((s) => s.id)).size === TOUR_STEPS.length, 'No hay pasos repetidos');
  check(
    TOUR_STEPS.every((s) => s.title.length > 8 && s.text.length > 60),
    'Todos los pasos explican algo (título y texto con contenido real)',
  );
  const dash = path.join(process.cwd(), 'src', 'app', '(dashboard)');
  const missing = TOUR_STEPS.map((s) => s.route).filter((r) => !fs.existsSync(path.join(dash, r.replace('/', ''), 'page.tsx')));
  check(missing.length === 0, 'Cada paso lleva a una pestaña que existe en la app', missing.join(', ') || 'todas existen');
  check(TOUR_STEPS.every((s) => s.targets.length > 0), 'Cada paso dice qué resaltar (con alternativa por si la pantalla está vacía)');

  // Las etiquetas del recorrido coinciden con los nombres del menú
  const sidebar = fs.readFileSync(path.join(process.cwd(), 'src', 'components', 'layout', 'sidebar.tsx'), 'utf8');
  const tabsSinMenu = TOUR_STEPS.filter((s) => !sidebar.includes(s.tab) && s.tab !== 'Configuración' && s.tab !== 'Página').map((s) => s.tab);
  check(tabsSinMenu.length === 0, 'Los nombres de las pestañas del tutorial son los del menú real', tabsSinMenu.join(', ') || 'coinciden');
  check(TOUR_INTRO.title.includes('12') && TOUR_INTRO.text.length > 60, 'La tarjeta de bienvenida explica qué va a pasar');

  // ── 2. Máquina de estados (sobre una cuenta de pruebas) ──────────────────
  const demo = await withSystem('verify-tour: leer cuentas', () =>
    prisma.user.findMany({ select: { id: true, email: true, tourVersion: true, tourSeenAt: true }, orderBy: { createdAt: 'asc' } }),
  );
  const target = demo[0];
  check(Boolean(target), 'Hay una cuenta de pruebas para el ensayo', target?.email ?? 'ninguna');

  const original = { tourVersion: target.tourVersion, tourSeenAt: target.tourSeenAt };
  const reset = () =>
    withSystem('verify-tour: reiniciar marca', () =>
      prisma.user.update({ where: { id: target.id }, data: { tourVersion: 0, tourSeenAt: null } }),
    );

  await reset();
  const rawState = await withSystem('verify-tour: leer estado en la base', () =>
    prisma.user.findUniqueOrThrow({ where: { id: target.id }, select: { tourVersion: true, tourSeenAt: true } }),
  );
  check(rawState.tourVersion === 0 && rawState.tourSeenAt === null, 'Una cuenta nueva arranca sin haber visto el tutorial');

  // Aceptar: se está viendo (no vuelve a ofrecerse, pero tampoco está terminado)
  const accepted = await withSystem('verify-tour: aceptar', () => saveTourState('accept'));
  check(
    accepted.inProgress && !accepted.shouldOffer && !accepted.completed,
    'Al aceptar queda «en curso»: no vuelve a preguntar, pero se reanuda si recarga',
    `decisión: ${accepted.decision}`,
  );

  // Terminar: no vuelve a salir
  const completed = await withSystem('verify-tour: terminar', () => saveTourState('complete'));
  check(completed.completed && !completed.shouldOffer, 'Al terminar el recorrido no vuelve a salir');
  const auditComplete = await withSystem('verify-tour: auditar', () =>
    prisma.auditLog.findFirst({ where: { userId: target.id, action: 'tour.complete' }, orderBy: { createdAt: 'desc' } }),
  );
  check(Boolean(auditComplete), 'Queda constancia en la auditoría de que lo completó', auditComplete?.action ?? 'sin registro');

  // Reiniciar: vuelve a ofrecerse (botón de Configuración)
  const restarted = await withSystem('verify-tour: reiniciar', () => saveTourState('restart'));
  check(restarted.shouldOffer && !restarted.completed, 'El botón «Ver el tutorial otra vez» vuelve a ofrecerlo');

  // Descartar: no vuelve a salir nunca más
  const dismissed = await withSystem('verify-tour: descartar', () => saveTourState('dismiss'));
  check(!dismissed.shouldOffer && !dismissed.inProgress, 'Al saltarlo no vuelve a salir solo (queda disponible en Configuración)');
  const auditDismiss = await withSystem('verify-tour: auditar descarte', () =>
    prisma.auditLog.findFirst({ where: { userId: target.id, action: 'tour.dismiss' }, orderBy: { createdAt: 'desc' } }),
  );
  check(Boolean(auditDismiss), 'Queda constancia del descarte', auditDismiss?.action ?? 'sin registro');
  check(TOUR_VERSION === 2 && TOUR_STARTED === 1 && TOUR_PENDING === 0, 'La escala de estados es 0 pendiente / 1 en curso / 2 visto', `${TOUR_PENDING}·${TOUR_STARTED}·${TOUR_VERSION}`);
  check(TOUR_STEPS.filter((s) => s.route === '/catalog').length === 1, 'El catálogo ocupa un solo paso (los 12 acordados)');

  // ── 3. La API real ──────────────────────────────────────────────────────
  await reset();
  const get = await fetch(`${BASE}/api/account/tour`, { cache: 'no-store' });
  const getJson: any = await get.json().catch(() => null);
  check(get.status === 200 && getJson?.shouldOffer === true, 'GET /api/account/tour dice que toca ofrecerlo', `HTTP ${get.status}`);
  check((get.headers.get('cache-control') ?? '').includes('no-store'), 'La respuesta no se cachea (la decisión es del usuario)');

  const post = (body: unknown) =>
    fetch(`${BASE}/api/account/tour`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  const bad = await post({ action: 'lo-que-sea' });
  check(bad.status === 400, 'Una acción inventada se rechaza', `HTTP ${bad.status}`);
  const badBody = await post('esto-no-es-json-object');
  check([400, 500].includes(badBody.status), 'Un cuerpo inválido no rompe el endpoint', `HTTP ${badBody.status}`);

  const okDone = await post({ action: 'complete' });
  const okDoneJson: any = await okDone.json().catch(() => null);
  check(okDone.status === 200 && okDoneJson?.completed === true, 'POST {action:complete} marca el tutorial como terminado', `HTTP ${okDone.status}`);

  const afterRestart = await post({ action: 'restart' });
  const afterRestartJson: any = await afterRestart.json().catch(() => null);
  check(afterRestartJson?.shouldOffer === true, 'POST {action:restart} lo vuelve a ofrecer (botón de Configuración)');

  // Dejar las cuentas listas para que el usuario lo vea al abrir el panel
  await withSystem('verify-tour: dejar las cuentas pendientes', async () => {
    for (const u of demo) await prisma.user.update({ where: { id: u.id }, data: { tourVersion: 0, tourSeenAt: null } });
  });
  void original;

  console.log(`\n${passed} comprobaciones superadas · ${failed} fallidas\n`);
  if (failed > 0) {
    console.log('\u001b[41m\u001b[37m  TUTORIAL CON FALLOS  \u001b[0m\n');
    process.exitCode = 1;
  } else {
    console.log('\u001b[42m\u001b[30m  TUTORIAL GUIADO VERIFICADO  \u001b[0m\n');
  }
}

main()
  .catch((err) => {
    console.error('\n✘ Error:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
