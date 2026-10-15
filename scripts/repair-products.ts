/**
 * scripts/repair-products.ts — Repara los productos dañados por un snapshot no fiable.
 *
 * Contexto (auditoría del 15/10): antes de la red de seguridad, el worker de sync
 * aplicaba snapshots con **coste 0** (páginas que no se pudieron interpretar). Dos
 * productos de ejemplo quedaron con coste 0, precio 2,99 € y despublicados. Este
 * script los devuelve a los valores de `prisma/seed.ts`.
 *
 *   npx tsx scripts/repair-products.ts            # informa, no cambia nada
 *   npx tsx scripts/repair-products.ts --apply    # aplica la reparación
 */
import '../workers/env';
import { prisma } from '../src/lib/prisma';
import { withSystem } from '../src/lib/tenant-context';

const APPLY = process.argv.includes('--apply');
const roundPsy = (n: number) => Math.round((Math.round(n) - 0.01) * 100) / 100;
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Valores originales tomados de prisma/seed.ts */
const FIX = [
  {
    match: 'Organizador de Cocina Ajustable',
    cost: 8.15,
    ship: 3.2,
    margin: 40,
    stock: 0,
    status: 'OUT_OF_STOCK' as const,
    variants: [
      { sku: 'KO-STD', cost: 8.15, stock: 0 },
    ],
  },
  {
    match: 'Mochila Antirrobo',
    cost: 14.2,
    ship: 2.4,
    margin: 40,
    stock: 156,
    status: 'ACTIVE' as const,
    variants: [
      { sku: 'BP-BK', cost: 14.2, stock: 96 },
      { sku: 'BP-GY', cost: 14.9, stock: 60 },
    ],
  },
];

async function main() {
  console.log(`\n\u001b[1mReparación de productos con datos de proveedor no fiables\u001b[0m (${APPLY ? 'APLICANDO' : 'simulación'})\n`);

  // Las lecturas de datos de cliente van dentro de un contexto global declarado.
  const products = await withSystem('reparación: localizar productos', () =>
    prisma.product.findMany({ select: { id: true, title: true, costPrice: true, sellingPrice: true, stockTotal: true, status: true, userId: true } }),
  );

  for (const f of FIX) {
    const product = products.find((p) => p.title.includes(f.match));
    if (!product) {
      console.log(`· no encontrado: ${f.match}`);
      continue;
    }
    const selling = roundPsy(f.cost * (1 + f.margin / 100) + f.ship);
    const damaged = Number(product.costPrice) < 0.01 || Number(product.sellingPrice) < 5;
    console.log(
      `${damaged ? '▲' : '✔'} ${product.title.slice(0, 46)}\n   ahora:  coste ${product.costPrice} € · venta ${product.sellingPrice} € · stock ${product.stockTotal} · ${product.status}` +
        `\n   correcto: coste ${f.cost} € · venta ${selling} € · stock ${f.stock} · ${f.status}`,
    );
    if (!APPLY) continue;

    await withSystem(`reparación: producto ${product.title.slice(0, 30)}`, async () => {
      const variants = await prisma.productVariant.findMany({ where: { productId: product.id } });
      await prisma.product.update({
        where: { id: product.id },
        data: {
          costPrice: f.cost,
          shippingCost: f.ship,
          sellingPrice: selling,
          compareAtPrice: roundPsy(selling * 1.35),
          marginPct: f.margin,
          profitAmount: round2(selling - f.cost - f.ship - 0.3),
          stockTotal: f.stock,
          status: f.status,
          lastSyncStatus: 'SUCCESS',
          lastSyncError: null,
          providerHash: null, // se recalcula en el próximo chequeo que sí sea fiable
        },
      });
      for (const v of f.variants) {
        const variant = variants.find((x) => x.sku === v.sku);
        if (!variant) continue;
        await prisma.productVariant.update({
          where: { id: variant.id },
          data: { costPrice: v.cost, shippingCost: f.ship, sellingPrice: roundPsy(v.cost * (1 + f.margin / 100) + f.ship), stock: v.stock },
        });
      }
    });
    console.log('   ↳ reparado');
  }

  console.log(APPLY ? '\nListo: vuelve a mirar /products.\n' : '\nNada cambiado. Ejecuta con --apply para aplicar.\n');
}

main()
  .catch((err) => {
    console.error('✘', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
