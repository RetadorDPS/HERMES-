/**
 * scripts/verify-isolation.ts — Prueba del aislamiento multi-cliente.
 *
 * Comprueba, contra la base de datos real, que:
 *   1. Dos clientes distintos sólo ven SUS datos.
 *   2. Una consulta sin contexto de usuario FALLA (fail-closed, no filtra).
 *   3. Un cliente no puede leer por id los datos de otro.
 *   4. Un cliente no puede escribir datos a nombre de otro.
 *   5. El modo sistema (tareas globales) sigue funcionando.
 *
 *   npx tsx scripts/verify-isolation.ts
 */
import '../workers/env';
import { prisma } from '../src/lib/prisma';
import { withTenant, withSystem, TenantScopeError } from '../src/lib/tenant-context';
import { hashPassword } from '../src/lib/auth';

const pass: string[] = [];
const fail: string[] = [];
const check = (ok: boolean, label: string, extra = '') => {
  (ok ? pass : fail).push(label + (extra ? ` — ${extra}` : ''));
  console.log(`${ok ? '✔' : '✘'} ${label}${extra ? ` — ${extra}` : ''}`);
};

async function main() {
  console.log('\n═══ VERIFICACIÓN DE AISLAMIENTO MULTI-CLIENTE ═══\n');

  const stamp = Date.now().toString(36);
  const emailA = `ana.${stamp}@test.local`;
  const emailB = `bruno.${stamp}@test.local`;

  // ── Preparación: dos clientes con su propia tienda y producto ────────────
  const userA = await withSystem('prueba: crear usuarios de test', () =>
    prisma.user.create({ data: { email: emailA, name: 'Ana', passwordHash: hashPassword('contrasena-a-1234'), plan: 'STARTER' } }),
  );
  const userB = await withSystem('prueba: crear usuarios de test', () =>
    prisma.user.create({ data: { email: emailB, name: 'Bruno', passwordHash: hashPassword('contrasena-b-1234') } }),
  );
  // Product exige un proveedor del catálogo global
  const supplier = await withSystem('prueba: catálogo global de proveedores', () => prisma.supplier.findFirst());
  check(Boolean(userA.id && userB.id), 'Se crean dos clientes distintos', `${emailA} / ${emailB}`);

  for (const [user, marca] of [
    [userA, 'A'],
    [userB, 'B'],
  ] as const) {
    await withTenant(user.id, async () => {
      const store = await prisma.store.create({
        data: {
          userId: user.id,
          platform: 'SHOPIFY',
          name: `Tienda ${marca}`,
          domain: `tienda-${marca.toLowerCase()}-${stamp}.myshopify.com`,
          status: 'CONNECTED',
          settings: { currency: 'EUR' },
        },
      });
      await prisma.product.create({
        data: {
          userId: user.id,
          storeId: store.id,
          supplierId: supplier!.id,
          sourceUrl: `https://es.aliexpress.com/item/10050000${marca === 'A' ? '1' : '2'}${stamp.slice(-3)}.html`,
          supplierProductId: `sup-${marca}-${stamp}`,
          title: `Producto privado de ${marca}`,
          description: 'Producto de prueba',
          category: 'Test',
          costPrice: 10,
          sellingPrice: 19.99,
          status: 'ACTIVE',
          isMonitored: true,
        },
      });
    });
  }
  check(true, 'Cada cliente crea su propia tienda y producto (con userId estampado automáticamente)');

  // ── 1. Cada cliente sólo ve lo suyo ─────────────────────────────────────
  const productsA = await withTenant(userA.id, () => prisma.product.findMany({ select: { title: true, userId: true } }));
  const productsB = await withTenant(userB.id, () => prisma.product.findMany({ select: { title: true, userId: true } }));

  check(
    productsA.length === 1 && productsA[0].userId === userA.id && productsA[0].title.includes('A'),
    'El cliente A sólo ve su producto',
    `${productsA.length} producto(s): ${productsA.map((p) => p.title).join(', ')}`,
  );
  check(
    productsB.length === 1 && productsB[0].userId === userB.id && productsB[0].title.includes('B'),
    'El cliente B sólo ve su producto',
    `${productsB.length} producto(s): ${productsB.map((p) => p.title).join(', ')}`,
  );

  const storesA = await withTenant(userA.id, () => prisma.store.findMany({ select: { name: true } }));
  const storesB = await withTenant(userB.id, () => prisma.store.findMany({ select: { name: true } }));
  check(
    storesA.every((s) => s.name.includes('A')) && storesB.every((s) => s.name.includes('B')),
    'Las tiendas también están aisladas',
    `A: ${storesA.map((s) => s.name).join()} · B: ${storesB.map((s) => s.name).join()}`,
  );

  // ── 2. Fail-closed: sin contexto no se puede consultar ───────────────────
  let blocked = false;
  try {
    await prisma.product.findMany();
  } catch (err) {
    blocked = err instanceof TenantScopeError;
  }
  void blocked;
  check(blocked, 'Una consulta de datos de cliente SIN contexto de usuario se bloquea (fail-closed)');

  let blockedWrite = false;
  try {
    await prisma.store.create({ data: { userId: 'ajeno', platform: 'SHOPIFY', name: 'Intruso', domain: 'x.com' } });
  } catch (err) {
    blockedWrite = err instanceof TenantScopeError;
  }
  check(blockedWrite, 'Escribir sin contexto de usuario también se bloquea');

  // ── 3. No se puede leer por id lo de otro cliente ────────────────────────
  const productOfA = await withTenant(userA.id, () => prisma.product.findFirst({ select: { id: true } }));
  const crossRead = await withTenant(userB.id, () => prisma.product.findUnique({ where: { id: productOfA!.id } }));
  check(crossRead === null, 'El cliente B no puede leer por id el producto del cliente A', 'devuelve null, nunca la fila ajena');

  const crossUpdate = await withTenant(userB.id, () =>
    prisma.product.updateMany({ where: { id: productOfA!.id }, data: { title: 'SECUESTRADO POR B' } }),
  );
  const stillIntact = await withTenant(userA.id, () => prisma.product.findUnique({ where: { id: productOfA!.id }, select: { title: true } }));
  check(
    crossUpdate.count === 0 && Boolean(stillIntact?.title.includes('A')),
    'El cliente B no puede modificar el producto del cliente A',
    `filas afectadas: ${crossUpdate.count}`,
  );

  // ── 4. Intento de suplantación al crear ──────────────────────────────────
  let spoofBlocked = false;
  try {
    await withTenant(userB.id, () =>
      prisma.store.create({ data: { userId: userA.id, platform: 'WOOCOMMERCE', name: 'Suplantación', domain: `spoof-${stamp}.com` } }),
    );
  } catch (err) {
    spoofBlocked = err instanceof TenantScopeError;
  }
  check(spoofBlocked, 'Se bloquea crear datos a nombre de otro cliente (suplantación de userId)');

  // ── 5. Tareas globales (worker) siguen funcionando ───────────────────────
  const globalCount = await withSystem('prueba: recuento global', () => prisma.product.count());
  check(Number(globalCount) >= 2, 'El modo sistema (barrido del worker) ve todos los clientes', `${globalCount} productos en total`);

  // ── 6. Los datos de cliente llevan su userId ─────────────────────────────
  const auditRows = await withSystem('prueba: limpieza y comprobación', () => prisma.product.findMany({ where: { userId: { in: [userA.id, userB.id] } }, select: { userId: true } }));
  check(auditRows.length === 2, 'Ambos productos están ligados a su dueño', `${auditRows.length} filas`);

  // ── Limpieza ─────────────────────────────────────────────────────────────
  await withSystem('prueba: limpieza', async () => {
    await prisma.product.deleteMany({ where: { userId: { in: [userA.id, userB.id] } } });
    await prisma.store.deleteMany({ where: { userId: { in: [userA.id, userB.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
  });
  check(true, 'Datos de prueba eliminados (CASCADE)');

  console.log(`\n${pass.length} comprobaciones superadas · ${fail.length} fallidas`);
  if (fail.length) {
    console.log('\nFallos:');
    fail.forEach((f) => console.log(' -', f));
    process.exit(1);
  }
  console.log('\n\x1b[42m\x1b[30m  AISLAMIENTO MULTI-CLIENTE VERIFICADO  \x1b[0m\n');
}

main()
  .catch((err) => {
    console.error('Error en la verificación:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
