/**
 * scripts/verify-admin.ts — Verifica el panel de administración.
 *
 *   npm run verify:admin
 *
 * Comprueba:
 *   • el guardián de rol (ADMIN sí, cliente normal no),
 *   • las métricas globales de la plataforma,
 *   • la ruta HTTP real (GET /api/admin/tenants) y una acción de soporte
 *     (ajuste de créditos) ida y vuelta sobre el cliente de pruebas,
 *   • la puerta de permisos: sin sesión de operador la ruta HTTP sólo permite
 *     LECTURA (antes un anónimo podía cambiar planes y claves).
 */
import '../workers/env';
import { prisma } from '../src/lib/prisma';
import { withSystem, withTenant } from '../src/lib/tenant-context';
import { currentAdmin, canOperate, platformOverview, tenantList } from '../src/lib/admin';

const BASE = process.env.APP_URL ?? 'http://localhost:3000';

let passed = 0;
let failed = 0;
const check = (ok: boolean, msg: string, extra = '') => {
  console.log(`${ok ? '✔' : '✘'} ${msg}${extra ? ` — ${extra}` : ''}`);
  ok ? passed++ : failed++;
};

async function main() {
  console.log(`\n\u001b[1mPanel de administración — verificación\u001b[0m\n`);

  const [admin, client] = await withSystem('verify-admin: leer cuentas', async () => {
    const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, select: { id: true, email: true } });
    const client = await prisma.user.findFirst({ where: { role: { not: 'ADMIN' } }, select: { id: true, email: true } });
    return [admin, client];
  });

  check(Boolean(admin), 'Hay un operador (rol ADMIN)', admin?.email ?? 'ninguno');
  check(Boolean(client), 'Hay un cliente normal para contrastar', client?.email ?? 'ninguno');
  if (!admin || !client) return;

  // ── Guardián de rol ──────────────────────────────────────────────────────
  const asAdmin = await withTenant(admin.id, () => currentAdmin());
  check(Boolean(asAdmin), 'El operador pasa el guardián', asAdmin?.email);
  const asClient = await withTenant(client.id, () => currentAdmin());
  check(asClient === null, 'Un cliente normal NO pasa el guardián (403 en la ruta)', 'bloqueado');

  // ── Métricas ─────────────────────────────────────────────────────────────
  const overview = await platformOverview();
  check(overview.users >= 2, 'Las métricas cuentan los clientes', `users=${overview.users}`);
  check(typeof overview.mrr === 'number', 'Se calcula el MRR estimado', `${overview.mrr} €`);
  check(overview.products >= 0 && overview.syncLogs24h >= 0, 'Se cuentan productos y actividad de sync', `${overview.products} productos · ${overview.syncLogs24h} logs`);

  const tenants = await tenantList();
  check(tenants.length >= 2, 'El listado incluye a todos los clientes', `${tenants.length}`);

  // ── Ruta HTTP real ───────────────────────────────────────────────────────
  const res = await fetch(`${BASE}/api/admin/tenants`);
  const json: any = await res.json().catch(() => null);
  check(res.status === 200 && json?.ok === true, 'GET /api/admin/tenants responde 200 para el operador', `HTTP ${res.status}`);
  check(Array.isArray(json?.tenants) && json.tenants.length >= 2, 'La respuesta trae los clientes', `${json?.tenants?.length}`);

  // ── Puerta de permisos (auditoría 15/10) ─────────────────────────────────
  // Sin sesión y sin LOCAL_ADMIN_MODE el panel es de sólo lectura: la escritura
  // por HTTP debe ser rechazada, y el identificador del usuario que actúa no
  // debe poder saltarse la puerta por venir del contexto de inquilino.
  const anonPatch = await fetch(`${BASE}/api/admin/tenants/${client.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ addCredits: 100 }),
  });
  const anonJson: any = await anonPatch.json().catch(() => null);
  check(anonPatch.status === 403 && anonJson?.code === 'READ_ONLY', 'Un anónimo NO puede cambiar créditos por HTTP', `HTTP ${anonPatch.status} · ${anonJson?.code ?? '—'}`);
  const anonCreds = await fetch(`${BASE}/api/admin/platform-credentials`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'clear', provider: 'CJ_DROPSHIPPING' }),
  });
  const anonCredsJson: any = await anonCreds.json().catch(() => null);
  check(anonCreds.status === 403 && anonCredsJson?.code === 'READ_ONLY', 'Un anónimo NO puede borrar las claves de plataforma', `HTTP ${anonCreds.status} · ${anonCredsJson?.code ?? '—'}`);

  const evalMode = await currentAdmin();
  check(evalMode?.readOnly === true && canOperate(evalMode) === false, 'En modo evaluación el operador declarado es de sólo lectura', `source=${evalMode?.source}`);

  // Con el modo local activado (instalación de un único dueño) sí se escribe.
  const previousLocal = process.env.LOCAL_ADMIN_MODE;
  process.env.LOCAL_ADMIN_MODE = 'true';
  const localMode = await currentAdmin();
  process.env.LOCAL_ADMIN_MODE = previousLocal;
  check(localMode?.readOnly === false && canOperate(localMode) === true, 'LOCAL_ADMIN_MODE=true devuelve permisos completos', `source=${localMode?.source}`);

  // ── Acción de soporte: +100 y luego −100 créditos ────────────────────────
  // Se ejecuta contra el manejador real de la ruta (mismo código que sirve la
  // web) con el modo local activado, que es la forma legítima de escribir.
  const { PATCH: patchRoute } = await import('../src/app/api/admin/tenants/[id]/route');
  process.env.LOCAL_ADMIN_MODE = 'true';

  const before = await withSystem('verify-admin: créditos antes', () =>
    prisma.subscription.findUnique({ where: { userId: client.id }, select: { creditsLimit: true, creditsUsed: true } }),
  );
  const patch = async (addCredits: number) =>
    patchRoute(
      new Request(`${BASE}/api/admin/tenants/${client.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ addCredits }),
      }),
      { params: { id: client.id } },
    );
  const p1 = await patch(100);
  const j1: any = await p1.json().catch(() => null);
  check(p1.status === 200 && j1?.ok === true, 'Sumar créditos con la ruta real (operador con permiso)', j1?.applied?.join(' · ') ?? `HTTP ${p1.status}`);
  const after = await withSystem('verify-admin: créditos después', () =>
    prisma.subscription.findUnique({ where: { userId: client.id }, select: { creditsLimit: true } }),
  );
  const expected = Math.max(0, before?.creditsUsed ?? 0) + Math.max(0, (before?.creditsLimit ?? 200) - (before?.creditsUsed ?? 0)) + 100;
  check(after?.creditsLimit === expected, 'El límite de créditos sube 100', `${before?.creditsLimit} → ${after?.creditsLimit}`);

  const p2 = await patch(-100);
  const after2 = await withSystem('verify-admin: créditos restaurados', () =>
    prisma.subscription.findUnique({ where: { userId: client.id }, select: { creditsLimit: true } }),
  );
  check(p2.status === 200 && after2?.creditsLimit === before?.creditsLimit, 'Resta de créditos deja el valor original', `${after2?.creditsLimit}`);

  process.env.LOCAL_ADMIN_MODE = previousLocal;

  // ── Auditoría ────────────────────────────────────────────────────────────
  const auditRows = await withSystem('verify-admin: leer auditoría', () =>
    prisma.auditLog.count({ where: { action: 'admin.tenant_updated', userId: admin.id } }),
  );
  check(auditRows >= 2, 'Los cambios quedan auditados', `${auditRows} entradas`);

  console.log(`\n${passed} comprobaciones superadas · ${failed} fallidas\n`);
  if (failed > 0) {
    console.log('\u001b[41m\u001b[37m  PANEL DE ADMINISTRACIÓN CON FALLOS  \u001b[0m\n');
    process.exitCode = 1;
  } else {
    console.log('\u001b[42m\u001b[30m  PANEL DE ADMINISTRACIÓN VERIFICADO  \u001b[0m\n');
  }
}

main()
  .catch((err) => {
    console.error('\n✘ Error:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
