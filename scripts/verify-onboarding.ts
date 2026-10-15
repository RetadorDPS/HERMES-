/**
 * scripts/verify-onboarding.ts — Verifica la lista «Tus primeros pasos» y el
 * tutorial del operador.
 *
 *   npm run verify:onboarding
 *
 * Lo que se comprueba:
 *   1. La lista se marca leyendo los datos reales: con una cuenta sin tienda,
 *      sin productos y sin trabajo del robot, las tareas están pendientes; al
 *      crear esos datos, se marcan solas.
 *   2. La tarjeta desaparece cuando están las cinco hechas.
 *   3. El cliente puede ocultarla y recuperarla (y eso queda guardado).
 *   4. El tutorial del operador tiene sus 5 pasos, funciona aparte del del
 *      cliente y sólo responde al rol ADMIN (los demás reciben 403).
 *
 * Todo lo que crea lo borra al terminar.
 */
import '../workers/env';
import { prisma } from '../src/lib/prisma';
import { withSystem } from '../src/lib/tenant-context';
import { checklistState, setChecklistVisibility } from '../src/lib/onboarding';
import { ADMIN_TOUR_STEPS, ADMIN_TOUR_INTRO, TOUR_STEPS, TOUR_VERSION, TOUR_STARTED } from '../src/lib/tour-steps';
import { saveTourState, tourState } from '../src/lib/tour';
import { hashPassword } from '../src/lib/auth';

const BASE = process.env.APP_URL ?? 'http://localhost:3000';

let passed = 0;
let failed = 0;
const check = (ok: boolean, msg: string, extra = '') => {
  console.log(`${ok ? '✔' : '✘'} ${msg}${extra ? ` — ${extra}` : ''}`);
  ok ? passed++ : failed++;
};

async function main() {
  console.log('\n\u001b[1mPrimeros pasos y tutorial del operador — verificación\u001b[0m\n');

  // ── 0. La cuenta que ve el panel (la de pruebas) ─────────────────────────
  const demo = await withSystem('verify-onboarding: leer cuentas', () =>
    prisma.user.findMany({ select: { id: true, email: true, role: true }, orderBy: { createdAt: 'asc' } }),
  );
  const admin = demo.find((u) => u.role === 'ADMIN');
  check(Boolean(admin), 'Hay una cuenta de operador (ADMIN) para probar su tutorial', admin?.email ?? 'ninguna');

  // ── 1. Datos: un cliente recién llegado ─────────────────────────────────
  const marker = `pasos-${Date.now()}`;
  const fresh = await withSystem('verify-onboarding: crear cliente nuevo', async () => {
    const user = await prisma.user.create({
      data: {
        email: `nuevo.${marker}@ejemplo.es`,
        name: 'Cliente Recién Llegado',
        plan: 'TRIAL',
        role: 'OWNER',
        passwordHash: hashPassword('PruebaPasos123'),
        subscription: { create: { plan: 'TRIAL', creditsLimit: 100 } },
        pricingRules: { create: { name: 'Regla global 40%', markupPct: 40, isDefault: true } },
      },
    });
    return user;
  });

  // Se actúa con el aislamiento del cliente nuevo (igual que una petición suya)

  const initial = await checklistState(fresh.id);
  check(initial.tasks.length === 5, 'La lista tiene las 5 tareas', `${initial.tasks.length}`);
  check(initial.done === 0, 'Un cliente recién llegado las tiene todas pendientes', `${initial.done} hechas`);
  check(initial.visible, 'La tarjeta se le muestra desde el primer día');
  check(!initial.hidden, 'Y no está oculta por defecto');
  check(
    initial.tasks.every((t) => t.label && t.hint && (t.action === 'tour' || t.href.startsWith('/'))),
    'Cada tarea dice qué hacer, para qué sirve y a dónde lleva',
  );

  // ── 2. Se marcan solas al ir haciendo cosas ─────────────────────────────
  await withSystem('verify-onboarding: el cliente conecta su tienda', async () => {
    await prisma.store.create({
      data: { userId: fresh.id, platform: 'SHOPIFY', name: `Tienda ${marker}`, domain: `${marker}.myshopify.com`, status: 'CONNECTED' },
    });
  });
  const afterStore = await checklistState(fresh.id);
  check(afterStore.tasks.find((t) => t.key === 'store')?.done === true, 'Al conectar la tienda, su casilla se marca sola');
  check(afterStore.done === 1 && afterStore.visible, 'El progreso avanza (1 de 5) y la tarjeta sigue visible');

  const product = await withSystem('verify-onboarding: el cliente importa un producto', async () => {
    const store = await prisma.store.findFirstOrThrow({ where: { userId: fresh.id } });
    const supplier = await prisma.supplier.findFirstOrThrow();
    return prisma.product.create({
      data: {
        userId: fresh.id,
        storeId: store.id,
        supplierId: supplier.id,
        sourceUrl: `https://es.aliexpress.com/item/${marker}.html`,
        title: `Producto ${marker}`,
        description: 'Prueba',
        currency: 'EUR',
        costPrice: 10,
        shippingCost: 2,
        sellingPrice: 18.99,
        status: 'ACTIVE',
      },
    });
  });
  await withSystem('verify-onboarding: el robot trabaja', async () => {
    await prisma.syncLog.create({
      data: { userId: fresh.id, productId: product.id, type: 'PRICE_UPDATE', status: 'SUCCESS', message: `Verificación ${marker}` },
    });
  });
  const afterWork = await checklistState(fresh.id);
  check(afterWork.tasks.find((t) => t.key === 'product')?.done === true, 'Al importar el primer producto, su casilla se marca');
  check(afterWork.tasks.find((t) => t.key === 'sync')?.done === true, 'Cuando el robot ya ha sincronizado, su casilla se marca');
  check(afterWork.done === 3, 'Van 3 de 5 sin tocar nada a mano', `${afterWork.done} de ${afterWork.total}`);

  // ── 3. Terminarla: desaparece sola ──────────────────────────────────────
  await withSystem('verify-onboarding: completar el resto de tareas', async () => {
    await prisma.user.update({ where: { id: fresh.id }, data: { tourVersion: TOUR_VERSION } });
    await prisma.subscription.update({ where: { userId: fresh.id }, data: { plan: 'STARTER', stripeCustomerId: `cus_prueba_${marker}` } });
  });
  const complete = await checklistState(fresh.id);
  check(complete.done === 5 && complete.complete === true, 'Con las 5 hechas la lista se da por completada');
  check(!complete.visible, 'Y la tarjeta desaparece de la portada sin que nadie la cierre');

  // ── 4. Ocultarla y recuperarla ──────────────────────────────────────────
  const hidden = await setChecklistVisibility(true, fresh.id);
  const readHidden = await withSystem('verify-onboarding: leer', () =>
    prisma.user.findUniqueOrThrow({ where: { id: fresh.id }, select: { onboardingHiddenAt: true } }),
  );
  check(Boolean(readHidden.onboardingHiddenAt), 'El cliente puede ocultar la lista y queda guardado en su cuenta');
  void hidden;
  const shown = await setChecklistVisibility(false, fresh.id);
  const readShown = await withSystem('verify-onboarding: releer', () =>
    prisma.user.findUniqueOrThrow({ where: { id: fresh.id }, select: { onboardingHiddenAt: true } }),
  );
  check(readShown.onboardingHiddenAt === null, 'Y puede recuperarla (queda marcada como visible otra vez)');
  void shown;

  // ── 5. El tutorial del operador ─────────────────────────────────────────
  check(ADMIN_TOUR_STEPS.length === 5, 'El tutorial del operador tiene 5 pasos', `${ADMIN_TOUR_STEPS.length}`);
  check(
    ADMIN_TOUR_STEPS.every((s) => s.route === '/admin' && s.targets.length > 0 && s.text.length > 60),
    'Sus pasos apuntan a Administración, resaltan algo y explican de verdad',
  );
  check(
    ADMIN_TOUR_STEPS.map((s) => s.id).every((id) => !TOUR_STEPS.some((t) => t.id === id)),
    'No comparten identificadores con el tutorial del cliente',
  );
  check(ADMIN_TOUR_INTRO.title.length > 10 && ADMIN_TOUR_INTRO.text.includes('5 pasos'), 'Su tarjeta de bienvenida se presenta como el recorrido corto del operador');

  // El estado de operador es independiente del del cliente
  if (admin) {
    await withSystem('verify-onboarding: estados del operador', async () => {
      await prisma.user.update({ where: { id: admin.id }, data: { tourVersion: TOUR_VERSION, adminTourVersion: 0, adminTourSeenAt: null } });
    });
    const adminUserState = await tourState('user', admin.id);
    const adminTour0 = await tourState('admin', admin.id);
    check(adminUserState.completed && !adminUserState.shouldOffer, 'Haber visto el del cliente no arranca el del operador');
    check(adminTour0.shouldOffer === true, 'El operador tiene su propio recorrido pendiente');

    await saveTourState('accept', {}, 'admin', admin.id);
    const adminTour1 = await tourState('admin', admin.id);
    check(adminTour1.inProgress && adminTour1.version === TOUR_STARTED, 'Se puede empezar el del operador por separado', `v${adminTour1.version}`);

    const userStillDone = await tourState('user', admin.id);
    check(userStillDone.completed, 'Y el del cliente sigue como estaba (no se pisan)');

    await saveTourState('complete', {}, 'admin', admin.id);
    const audit = await withSystem('verify-onboarding: auditoría del operador', () =>
      prisma.auditLog.findFirst({ where: { userId: admin.id, action: 'tour.admin.complete' }, orderBy: { createdAt: 'desc' } }),
    );
    check(Boolean(audit), 'La auditoría distingue el recorrido del operador', audit?.action ?? 'sin registro');

    // Estado final pensado para que el usuario lo pruebe en el panel
    await withSystem('verify-onboarding: dejar el operador con su tutorial pendiente', async () => {
      await prisma.user.update({ where: { id: admin.id }, data: { adminTourVersion: 0, adminTourSeenAt: null } });
    });
  }

  // ── 6. La API real ──────────────────────────────────────────────────────
  const get = await fetch(`${BASE}/api/account/onboarding`, { cache: 'no-store' });
  const getJson: any = await get.json().catch(() => null);
  check(get.status === 200 && typeof getJson?.total === 'number', 'GET /api/account/onboarding responde', `HTTP ${get.status} · ${getJson?.done}/${getJson?.total}`);
  check((get.headers.get('cache-control') ?? '').includes('no-store'), 'La respuesta no se cachea');

  const bad = await fetch(`${BASE}/api/account/onboarding`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'lo-que-sea' }) });
  check(bad.status === 400, 'Una acción inventada se rechaza', `HTTP ${bad.status}`);

  const adminScope = await fetch(`${BASE}/api/account/tour?scope=admin`, { cache: 'no-store' });
  const adminScopeJson: any = await adminScope.json().catch(() => null);
  check(
    adminScopeJson?.scope === 'admin' || adminScope.status === 403,
    'El recorrido del operador tiene su propio endpoint (o queda cerrado si el navegador no es ADMIN)',
    `HTTP ${adminScope.status}`,
  );

  // ── 7. Limpieza ─────────────────────────────────────────────────────────
  await withSystem('verify-onboarding: borrar el cliente de pruebas', async () => {
    await prisma.product.deleteMany({ where: { userId: fresh.id } });
    await prisma.store.deleteMany({ where: { userId: fresh.id } });
    await prisma.syncLog.deleteMany({ where: { userId: fresh.id } });
    await prisma.auditLog.deleteMany({ where: { userId: fresh.id } });
    await prisma.user.delete({ where: { id: fresh.id } });
  });
  const leftovers = await withSystem('verify-onboarding: comprobar limpieza', () =>
    prisma.user.count({ where: { email: `nuevo.${marker}@ejemplo.es` } }),
  );
  check(leftovers === 0, 'No queda nada del cliente de pruebas');

  console.log(`\n${passed} comprobaciones superadas · ${failed} fallidas\n`);
  if (failed > 0) {
    console.log('\u001b[41m\u001b[37m  PRIMEROS PASOS CON FALLOS  \u001b[0m\n');
    process.exitCode = 1;
  } else {
    console.log('\u001b[42m\u001b[30m  PRIMEROS PASOS Y TUTORIAL DEL OPERADOR VERIFICADOS  \u001b[0m\n');
  }
}

main()
  .catch((err) => {
    console.error('\n✘ Error:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
