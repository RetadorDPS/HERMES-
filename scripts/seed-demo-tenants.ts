/**
 * scripts/seed-demo-tenants.ts — Datos de demostración multi-cliente.
 *
 * Deja la base de datos en un estado presentable para enseñar el SaaS:
 *   1. Elimina las cuentas creadas por las pruebas automáticas.
 *   2. Se asegura de que existen DOS clientes independientes con datos propios,
 *      para poder entrar con cada uno y comprobar que sólo ve lo suyo.
 *
 * Es idempotente: ejecutarlo dos veces no duplica nada.
 *
 *   npx tsx scripts/seed-demo-tenants.ts
 */
import '../workers/env';

import { prisma } from '../src/lib/prisma';
import { withSystem } from '../src/lib/tenant-context';
import { hashPassword } from '../src/lib/auth';
import { planFor } from '../src/lib/plans';

/** Cuentas generadas por las pruebas (scripts/verify-isolation.ts, /tmp/dbg.ts…) */
const TEST_SUFFIXES = ['@test.local', '@t.local', '@prueba.local', '@autods.local'];

const DEMO_EMAIL = 'demo@dropshippilot.io';
// La cuenta demo es también el OPERADOR de la plataforma (panel /admin).
const DEMO_IS_ADMIN = true;
const DEMO_PASSWORD = 'DemoPanel123';
const SECOND_EMAIL = 'cliente@dropshippilot.io';
const SECOND_PASSWORD = 'ClienteDemo123';

async function cleanupTestAccounts() {
  const removed = await withSystem('limpieza de cuentas de prueba', () =>
    prisma.user.deleteMany({
      where: { OR: TEST_SUFFIXES.map((suffix) => ({ email: { endsWith: suffix } })) },
    }),
  );
  console.log(`[demo] cuentas de prueba eliminadas: ${removed.count}`);
}

async function main() {
  await cleanupTestAccounts();

  const demo = await withSystem('comprobación usuario demo', () =>
    prisma.user.findUnique({ where: { email: DEMO_EMAIL }, select: { id: true, name: true, passwordHash: true } }),
  );

  if (!demo) {
    console.log(`[demo] No existe ${DEMO_EMAIL}: ejecuta antes «npx tsx scripts/seed-if-empty.ts».`);
    process.exitCode = 1;
    return;
  }

  const supplier = await withSystem('catálogo global de proveedores', () =>
    prisma.supplier.findFirst({ where: { name: { contains: 'AliExpress' } }, select: { id: true, name: true } }),
  );
  if (!supplier) {
    console.log('[demo] No hay proveedores en el catálogo global.');
    process.exitCode = 1;
    return;
  }

  // La cuenta demo es el OPERADOR de la plataforma: con ella se abre el panel
  // /admin (métricas globales y gestión de clientes). El segundo cliente sirve
  // para comprobar el aislamiento entre inquilinos.
  await withSystem('rol de operador para la cuenta demo', () =>
    prisma.user.update({ where: { id: demo.id }, data: { role: DEMO_IS_ADMIN ? 'ADMIN' : 'OWNER' } }),
  );
  console.log(`[demo] ${DEMO_EMAIL} → rol ${DEMO_IS_ADMIN ? 'ADMIN (puede abrir /admin)' : 'OWNER'}`);

  // El usuario demo del seed original no trae contraseña (no se podía entrar
  // con él). Se la ponemos una sola vez para poder demostrar el SaaS entrando
  // como dos clientes distintos.
  if (!demo.passwordHash) {
    await withSystem('asignar contraseña al usuario demo', () =>
      prisma.user.update({
        where: { id: demo.id },
        data: { passwordHash: hashPassword(DEMO_PASSWORD), emailVerifiedAt: new Date() },
      }),
    );
    console.log(`[demo] Contraseña asignada a ${DEMO_EMAIL}`);
  }

  const already = await withSystem('comprobación segundo cliente', () =>
    prisma.user.findUnique({
      where: { email: SECOND_EMAIL },
      select: { id: true, _count: { select: { products: true, stores: true } } },
    }),
  );

  if (already) {
    console.log(`[demo] ${SECOND_EMAIL} ya existe (${already._count.products} producto(s), ${already._count.stores} tienda(s)): nada que hacer.`);
    console.log('');
    console.log('  A · demo@dropshippilot.io      PRO     · contraseña ' + DEMO_PASSWORD);
    console.log('  B · cliente@dropshippilot.io   STARTER · contraseña ' + SECOND_PASSWORD);
    return;
  }

  const plan = planFor('STARTER');

  // ── Segundo cliente: datos propios, aislados de los del usuario demo ──────
  const cliente = await withSystem('alta del cliente de demostración', () =>
    prisma.user.create({
      data: {
        email: SECOND_EMAIL,
        name: 'Laura Ferrer',
        plan: 'STARTER',
        emailVerifiedAt: new Date(),
        passwordHash: hashPassword(SECOND_PASSWORD),
        subscription: {
          create: { plan: 'STARTER', status: 'ACTIVE', creditsLimit: plan.creditsPerMonth },
        },
        pricingRules: {
          create: { name: 'Regla global 45%', markupPct: 45, fixedFee: 0.6, minProfit: 1.8, roundTo: 0.99, isDefault: true },
        },
      },
      include: { pricingRules: true },
    }),
  );

  const rule = cliente.pricingRules[0];

  const store = await withSystem('tienda del cliente de demostración', () =>
    prisma.store.create({
      data: {
        userId: cliente.id,
        platform: 'SHOPIFY',
        name: 'Tienda de Laura (demo)',
        domain: 'laura-demo.myshopify.com',
        status: 'PENDING',
        settings: { currency: 'EUR', language: 'es', autoImport: false },
      },
    }),
  );

  const catalog = [
    {
      sourceUrl: 'https://es.aliexpress.com/item/demo-laura-1.html',
      supplierProductId: 'AE-DEMO-L1',
      title: 'Lámpara de escritorio LED plegable',
      description:
        'Lámpara LED de escritorio con brazo plegable, tres temperaturas de color y carga USB-C. ' +
        'Incluye base antideslizante y protección ocular.',
      bullets: ['3 temperaturas de color', 'Carga USB-C', 'Brazo plegable 180º'],
      category: 'Iluminación',
      cost: 9.8,
      selling: 22.9,
      compareAt: 29.9,
      variants: [
        { title: 'Blanco', color: 'Blanco', sku: 'LAURA-LAMP-W', stock: 42, cost: 9.8, selling: 22.9 },
        { title: 'Negro', color: 'Negro', sku: 'LAURA-LAMP-B', stock: 0, cost: 9.8, selling: 22.9 },
      ],
    },
    {
      sourceUrl: 'https://es.aliexpress.com/item/demo-laura-2.html',
      supplierProductId: 'AE-DEMO-L2',
      title: 'Organizador de maleta con 8 piezas',
      description:
        'Set de 8 bolsas de viaje para organizar la maleta: ropa, calzado, cables y aseo. ' +
        'Tejido resistente al agua y cremalleras reforzadas.',
      bullets: ['8 piezas', 'Tejido impermeable', 'Cremalleras reforzadas'],
      category: 'Viaje',
      cost: 12.4,
      selling: 27.5,
      compareAt: 34.0,
      variants: [
        { title: 'Gris', color: 'Gris', sku: 'LAURA-TRAVEL-G', stock: 17, cost: 12.4, selling: 27.5 },
        { title: 'Beige', color: 'Beige', sku: 'LAURA-TRAVEL-B', stock: 6, cost: 12.4, selling: 27.5 },
      ],
    },
  ];

  for (const item of catalog) {
    await withSystem('catálogo del cliente de demostración', () =>
      prisma.product.create({
        data: {
          userId: cliente.id,
          storeId: store.id,
          supplierId: supplier.id,
          pricingRuleId: rule.id,
          supplierProductId: item.supplierProductId,
          sourceUrl: item.sourceUrl,
          title: item.title,
          description: item.description,
          bullets: item.bullets,
          category: item.category,
          currency: 'USD',
          costPrice: item.cost,
          shippingCost: 2.1,
          sellingPrice: item.selling,
          compareAtPrice: item.compareAt,
          marginPct: 45,
          profitAmount: Number((item.selling - item.cost - 2.1).toFixed(2)),
          stockTotal: item.variants.reduce((sum, v) => sum + v.stock, 0),
          status: 'ACTIVE',
          images: {
            create: [
              { url: `https://picsum.photos/seed/${item.supplierProductId}/900/900`, position: 0, isMain: true },
              { url: `https://picsum.photos/seed/${item.supplierProductId}-b/900/900`, position: 1 },
            ],
          },
          variants: {
            create: item.variants.map((v, i) => ({
              supplierVariantId: `${item.supplierProductId}-V${i + 1}`,
              sku: v.sku,
              title: v.title,
              color: v.color,
              costPrice: v.cost,
              shippingCost: 2.1,
              sellingPrice: v.selling,
              compareAtPrice: item.compareAt,
              stock: v.stock,
            })),
          },
          reviews: {
            create: [
              {
                supplierReviewId: `${item.supplierProductId}-R1`,
                rating: 5,
                author: 'Comprador verificado',
                authorCountry: 'ES',
                text: 'Llegó antes de lo previsto y tal cual la descripción.',
                images: [],
                reviewedAt: new Date('2026-08-14'),
              },
              {
                supplierReviewId: `${item.supplierProductId}-R2`,
                rating: 4,
                author: 'Cliente',
                authorCountry: 'ES',
                text: 'Buena calidad por el precio. Repetiría.',
                images: [],
                reviewedAt: new Date('2026-08-02'),
              },
            ],
          },
        },
      }),
    );
  }

  console.log('');
  console.log('┌─────────────────────────────────────────────────────────────────┐');
  console.log('│  Dos clientes independientes listos para la demostración        │');
  console.log('├─────────────────────────────────────────────────────────────────┤');
  console.log(`│  A · ${DEMO_EMAIL.padEnd(45)} PRO      │`);
  console.log(`│      contraseña: ${DEMO_PASSWORD.padEnd(46)} │`);
  console.log(`│  B · ${SECOND_EMAIL.padEnd(45)} STARTER  │`);
  console.log(`│      contraseña: ${SECOND_PASSWORD.padEnd(46)} │`);
  console.log('└─────────────────────────────────────────────────────────────────┘');
}

main()
  .catch((err) => {
    console.error('[demo] error:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
