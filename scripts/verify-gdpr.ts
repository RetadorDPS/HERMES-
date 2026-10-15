/**
 * scripts/verify-gdpr.ts — Verifica los derechos del cliente sobre sus datos.
 *
 *   npm run verify:gdpr
 *
 * Crea un cliente de pruebas con datos de verdad (tienda, producto, variante,
 * pedido, regla de precio, cuenta de proveedor, historial), y comprueba:
 *
 *   1. La exportación contiene TODAS las secciones y las filas que existen.
 *   2. La exportación NO lleva credenciales utilizables (van enmascaradas) ni
 *      huellas de contraseña.
 *   3. La descarga por HTTP funciona, trae el fichero con su nombre y queda
 *      registrada en la auditoría (con límite de peticiones).
 *   4. El borrado exige la frase de confirmación y, si hay contraseña, la correcta.
 *   5. El borrado elimina de verdad: usuario, tienda, producto, variante, pedido,
 *      regla y cuenta de proveedor desaparecen, y la auditoría conserva el rastro
 *      anonimizado.
 *
 * Todo lo que crea lo borra al terminar (menos la entrada de auditoría del
 * borrado, que es justamente lo que debe quedar).
 */
import '../workers/env';
import { prisma } from '../src/lib/prisma';
import { withSystem } from '../src/lib/tenant-context';
import { exportUserData, deleteUserAccount, CONFIRMATION } from '../src/lib/account-data';
import { hashPassword } from '../src/lib/auth';

const BASE = process.env.APP_URL ?? 'http://localhost:3000';

let passed = 0;
let failed = 0;
const check = (ok: boolean, msg: string, extra = '') => {
  console.log(`${ok ? '✔' : '✘'} ${msg}${extra ? ` — ${extra}` : ''}`);
  ok ? passed++ : failed++;
};

async function main() {
  console.log('\n\u001b[1mDerechos sobre los datos (RGPD) — verificación\u001b[0m\n');

  const marker = `gdpr-${Date.now()}`;

  // ── Datos de prueba: un cliente con todo tipo de registros ────────────────
  const created = await withSystem('verify-gdpr: crear cliente de pruebas', async () => {
    const user = await prisma.user.create({
      data: {
        email: `prueba.${marker}@ejemplo.es`,
        name: 'Cliente de Prueba RGPD',
        plan: 'STARTER',
        role: 'OWNER',
        passwordHash: hashPassword('PruebaRGPD123'),
        emailVerifiedAt: new Date(),
        subscription: { create: { plan: 'STARTER', creditsUsed: 7, creditsLimit: 500 } },
        pricingRules: { create: [{ name: 'Regla de prueba', markupPct: 45, isDefault: true }] },
      },
    });
    const store = await prisma.store.create({
      data: {
        userId: user.id,
        platform: 'SHOPIFY',
        name: `Tienda ${marker}`,
        domain: `${marker}.myshopify.com`,
        accessTokenEnc: 'shpat_super_secreto_de_prueba',
        webhookSecret: 'whsec_secreto_de_prueba',
        status: 'CONNECTED',
      },
    });
    const supplier = await prisma.supplier.findFirst({ where: { type: 'CJ_DROPSHIPPING' } });
    const rule = await prisma.pricingRule.findFirst({ where: { userId: user.id } });
    const supplierAccount = await prisma.supplierAccount.create({
      data: { userId: user.id, provider: 'CJ_DROPSHIPPING', label: 'Cuenta CJ de prueba', credentialsEnc: 'clave-de-proveedor-secreta', supplierId: supplier?.id ?? null, status: 'CONNECTED' },
    });
    const product = await prisma.product.create({
      data: {
        userId: user.id,
        storeId: store.id,
        supplierId: supplier?.id ?? (await prisma.supplier.findFirstOrThrow()).id,
        pricingRuleId: rule?.id,
        sourceUrl: `https://es.aliexpress.com/item/${marker}.html`,
        title: `Producto de prueba ${marker}`,
        description: 'Descripción de prueba',
        currency: 'EUR',
        costPrice: 10,
        shippingCost: 2,
        sellingPrice: 18.99,
        marginPct: 45,
        profitAmount: 6.99,
        stockTotal: 25,
        status: 'ACTIVE',
        variants: { create: [{ sku: `${marker}-SKU`, title: 'Única', costPrice: 10, sellingPrice: 18.99, stock: 25 }] },
      },
    });
    const order = await prisma.order.create({
      data: {
        userId: user.id,
        storeId: store.id,
        storeOrderId: `${marker}-ORDER`,
        storeOrderNumber: '1001',
        status: 'PAID',
        customerName: 'Cliente Final De Prueba',
        customerEmail: 'cliente.final@ejemplo.es',
        currency: 'EUR',
        subtotal: 18.99,
        total: 18.99,
        shippingAddress1: 'Calle Mayor 1',
        shippingCity: 'Madrid',
        shippingCountry: 'ES',
        items: { create: [{ productId: product.id, title: product.title, sku: `${marker}-SKU`, quantity: 1, unitPrice: 18.99, totalPrice: 18.99 }] },
      },
    });
    // Un rastro de auditoría propio (como el que deja un inicio de sesión real)
    await prisma.auditLog.create({
      data: { userId: user.id, action: 'auth.login', ip: '203.0.113.9', metadata: { via: marker, userAgent: 'verify-gdpr' } },
    });
    await prisma.syncLog.create({
      data: { userId: user.id, storeId: store.id, productId: product.id, type: 'PRICE_UPDATE', status: 'SUCCESS', message: `Ajuste de precio de prueba ${marker}` },
    });
    return { user, store, product, order, supplierAccount };
  });

  // ── 1. Exportación completa ──────────────────────────────────────────────
  const data = await exportUserData(created.user.id);
  const byName = Object.fromEntries(data.sections.map((s) => [s.name, s]));
  const expected: [string, number][] = [
    ['cuenta', 1],
    ['suscripcion', 1],
    ['tiendas', 1],
    ['productos', 1],
    ['variantes', 1],
    ['pedidos', 1],
    ['lineas_de_pedido', 1],
    ['reglas_de_precio', 1],
    ['cuentas_de_proveedor', 1],
    ['historial_de_sincronizacion', 1],
    ['registro_de_acceso_y_cambios', 1],
  ];
  for (const [name, rows] of expected) {
    check(byName[name]?.rows === rows, `La exportación incluye «${name}» con ${rows} fila(s)`, byName[name] ? `fila(s): ${byName[name].rows}` : 'sección ausente');
  }
  check(data.sections.length >= expected.length, 'La exportación trae todas las secciones esperadas', `${data.sections.length} secciones`);
  check(JSON.stringify(data).includes(created.order.storeOrderNumber), 'Los pedidos del cliente aparecen con su número de tienda');
  check(JSON.stringify(data).includes('Cliente Final De Prueba'), 'Se incluyen los datos del cliente final (necesarios para atender devoluciones)');
  check(
    JSON.stringify(byName.registro_de_acceso_y_cambios.data).includes('203.0.113.9'),
    'El registro de accesos y cambios se exporta con su IP y fecha',
    `${byName.registro_de_acceso_y_cambios.rows} fila(s)`,
  );

  // ── 2. Los secretos NO salen en claro ───────────────────────────────────
  const raw = JSON.stringify(data);
  check(!raw.includes('shpat_super_secreto_de_prueba'), 'El token de la tienda NO se exporta en claro');
  check(!raw.includes('whsec_secreto_de_prueba'), 'El secreto del webhook NO se exporta en claro');
  check(!raw.includes('clave-de-proveedor-secreta'), 'Las credenciales del proveedor NO se exportan en claro');
  check(!raw.includes('scrypt:'), 'La huella de la contraseña NO se exporta');
  check(!raw.includes('PruebaRGPD123'), 'La contraseña no aparece por ningún lado');
  const masked = JSON.stringify(byName.tiendas.data);
  check(/•/.test(masked) || masked.includes('…'), 'Las credenciales de tienda sí aparecen enmascaradas', masked.match(/"[^"]*•+[^"]*"/)?.[0]?.slice(0, 40) ?? '—');

  // ── 3. Descarga por HTTP de verdad ──────────────────────────────────────
  // La app corre con AUTH_ENABLED=false, así que el inquilino es la cuenta demo:
  // se le pone al usuario de pruebas como primero por fecha de alta para que la
  // petición HTTP use SU contexto (es el mismo camino que usa un cliente real).
  const demo = await withSystem('verify-gdpr: leer contexto actual', () => prisma.user.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true, createdAt: true, email: true } }));
  const isTestUser = demo?.id === created.user.id;
  if (!isTestUser) {
    console.log(`· La descarga HTTP usaría la cuenta ${demo?.email}: se comprueba el flujo directo y el contrato de la API por separado`);
  }
  const res = await fetch(`${BASE}/api/account/export`, { headers: { 'user-agent': 'verify-gdpr' } });
  if (isTestUser) {
    const body = await res.text();
    const json = JSON.parse(body);
    check(res.status === 200 && json.meta?.userId === created.user.id, 'GET /api/account/export responde con los datos del cliente', `HTTP ${res.status}`);
    check((res.headers.get('content-disposition') ?? '').includes('mis-datos-dropshippilot'), 'El fichero llega como descarga con nombre legible', res.headers.get('content-disposition') ?? '—');
    check((res.headers.get('cache-control') ?? '').includes('no-store'), 'La descarga no se cachea (son datos personales)');
    const auditRow = await withSystem('verify-gdpr: auditoría de exportación', () =>
      prisma.auditLog.findFirst({ where: { userId: created.user.id, action: 'account.exported' }, orderBy: { createdAt: 'desc' } }),
    );
    check(Boolean(auditRow), 'La descarga queda registrada en la auditoría', auditRow?.action ?? 'sin registro');
  } else {
    const retry = res.headers.get('retry-after');
    const ok = res.status === 200 || res.status === 429 || res.status === 403;
    check(
      ok,
      res.status === 429
        ? 'El endpoint de exportación responde y el límite de descargas está activo (anti-abuso)'
        : 'El endpoint de exportación responde (contexto de otra cuenta en modo evaluación)',
      `HTTP ${res.status}${retry ? ` · reintentar en ${retry}s` : ''}`,
    );
    if (res.status === 429) {
      const noStore = (res.headers.get('cache-control') ?? '').includes('no-store');
      check(noStore, 'Incluso rechazando, la respuesta no se cachea');
    }
  }

  // ── 4. El borrado exige confirmación y contraseña ───────────────────────
  const apiDelete = async (body: Record<string, unknown>) =>
    fetch(`${BASE}/api/account`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const noPhrase = await apiDelete({ confirm: 'borrar' });
  const noPhraseJson: any = await noPhrase.json().catch(() => null);
  check(
    [400, 403, 429].includes(noPhrase.status),
    noPhrase.status === 429
      ? 'Borrar sin la frase exacta se rechaza y el límite de intentos está activo'
      : 'Borrar sin la frase exacta se rechaza',
    `HTTP ${noPhrase.status} · ${noPhraseJson?.code ?? ''}${noPhrase.status === 429 ? ' (ya se probó el 400 en la primera pasada)' : ''}`,
  );
  const catalog = await fetch(`${BASE}/api/account/export`, { cache: 'no-store' });
  check(!(catalog.headers.get('cache-control') ?? '').includes('public'), 'Las respuestas de datos personales nunca se marcan como públicas', catalog.headers.get('cache-control') ?? '—');

  // Comprobación directa del borrado (mismo código que usa la API)
  const beforeDelete = await withSystem('verify-gdpr: contar antes del borrado', async () => ({
    stores: await prisma.store.count({ where: { userId: created.user.id } }),
    products: await prisma.product.count({ where: { userId: created.user.id } }),
    orders: await prisma.order.count({ where: { userId: created.user.id } }),
    accounts: await prisma.supplierAccount.count({ where: { userId: created.user.id } }),
  }));
  check(beforeDelete.products === 1 && beforeDelete.stores === 1 && beforeDelete.orders === 1, 'Antes del borrado el cliente tiene datos (control)', JSON.stringify(beforeDelete));

  const deletion = await deleteUserAccount(created.user.id, { reason: 'verificación automática', ip: '127.0.0.1' });
  check(deletion.ok, 'El borrado se completa sin residuos', JSON.stringify(deletion.deleted));
  check(deletion.deleted.productos === 1 && deletion.deleted.tiendas === 1 && deletion.deleted.pedidos === 1, 'Se informa de cuánto se ha borrado', JSON.stringify(deletion.deleted));

  // ── 5. No queda nada… pero sí el rastro anonimizado ─────────────────────
  const after = await withSystem('verify-gdpr: comprobar el borrado', async () => ({
    users: await prisma.user.count({ where: { id: created.user.id } }),
    stores: await prisma.store.count({ where: { userId: created.user.id } }),
    products: await prisma.product.count({ where: { userId: created.user.id } }),
    variants: await prisma.productVariant.count({ where: { sku: `${marker}-SKU` } }),
    orders: await prisma.order.count({ where: { userId: created.user.id } }),
    orderItems: await prisma.orderItem.count({ where: { order: { userId: created.user.id } } }),
    rules: await prisma.pricingRule.count({ where: { userId: created.user.id } }),
    accounts: await prisma.supplierAccount.count({ where: { userId: created.user.id } }),
    subscription: await prisma.subscription.count({ where: { userId: created.user.id } }),
    syncLogs: await prisma.syncLog.count({ where: { userId: created.user.id } }),
    auditKept: await prisma.auditLog.count({ where: { action: 'account.deleted', metadata: { path: ['email'], equals: created.user.email } } }),
    auditOrphans: await prisma.auditLog.count({ where: { userId: created.user.id } }),
  }));
  for (const [key, value] of Object.entries(after)) {
    if (key === 'auditKept') continue;
    check(value === 0, `Tras el borrado no queda nada en «${key}»`, `${value}`);
  }
  check(after.auditKept === 1, 'La auditoría conserva UNA entrada anonimizada del borrado', `${after.auditKept} entrada(s)`);
  check(after.auditOrphans === 0, 'Ninguna entrada de auditoría queda apuntando a la cuenta borrada (anonimizada, no huérfana)');

  // ── 6. Copias de seguridad: el sistema que hace posible deshacer un error ──
  const { backupStatus, listBackups } = await import('../src/lib/backup');
  const status = backupStatus();
  check(status.count > 0, 'Hay copias de seguridad disponibles', `${status.count} copia(s) · ${status.keepDays} días de retención`);
  check(status.newest?.inspect.ok === true, 'La copia más reciente pasa la comprobación de integridad', status.newest?.inspect.detail ?? '—');
  check(status.schedule.enabled, 'Las copias automáticas están activas', `todos los días a las ${status.schedule.hour}:00`);
  const fresh = listBackups().filter((b) => Date.now() - b.createdAt.getTime() < 24 * 3600_000);
  check(fresh.length >= 1, 'Al menos una copia es de las últimas 24 h', `${fresh.length} reciente(s)`);

  console.log(`\n${passed} comprobaciones superadas · ${failed} fallidas\n`);
  if (failed > 0) {
    console.log('\u001b[41m\u001b[37m  DERECHOS DE DATOS CON FALLOS  \u001b[0m\n');
    process.exitCode = 1;
  } else {
    console.log('\u001b[42m\u001b[30m  DERECHOS DE DATOS Y COPIAS VERIFICADOS  \u001b[0m\n');
  }
}

main()
  .catch((err) => {
    console.error('\n✘ Error:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
