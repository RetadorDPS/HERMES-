/**
 * scripts/seed-catalog.ts — Carga el catálogo de muestra y, si hay claves de la
 * plataforma configuradas, descarga también el catálogo real.
 *
 *   npx tsx scripts/seed-catalog.ts                 # muestra + real si hay claves
 *   npx tsx scripts/seed-catalog.ts --pages 4       # más páginas por proveedor
 *   npx tsx scripts/seed-catalog.ts --provider CJ_DROPSHIPPING --keyword "led"
 */
import '../workers/env';
import { prisma } from '../src/lib/prisma';
import { ensureSampleCatalog, syncCatalog } from '../src/lib/catalog';
import { platformCredentialSummary } from '../src/lib/catalog/platform-credentials';

async function main() {
  const args = process.argv.slice(2);
  const read = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };

  const sample = await ensureSampleCatalog();
  console.log(`🖼️  Catálogo de muestra: ${sample.items} artículos${sample.inserted ? ' (cargados ahora)' : ' (ya estaban)'}`);

  const creds = await platformCredentialSummary();
  const configured = creds.filter((c) => c.configured && c.enabled);
  if (configured.length === 0) {
    console.log('ℹ️  Sin claves de plataforma configuradas: se queda el catálogo de muestra.');
    console.log('   Configúralas en Administración → Claves de proveedor o en el .env (CJ_EMAIL/CJ_API_KEY, ALIEXPRESS_APP_KEY/…).');
  } else {
    const result = await syncCatalog({
      provider: read('--provider') as any,
      keyword: read('--keyword'),
      pages: Number(read('--pages') ?? 2),
      categories: true,
    });
    for (const r of result.report) console.log(`${r.ok ? '✅' : '⚠️ '} ${r.provider}: ${r.message}${r.categories ? ` · ${r.categories} categorías` : ''}`);
  }

  const [items, real, cats] = await Promise.all([
    prisma.catalogItem.count(),
    prisma.catalogItem.count({ where: { source: 'api' } }),
    prisma.catalogCategory.count(),
  ]);
  console.log(`📦 Índice: ${items} artículos (${real} reales) · ${cats} categorías`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('✘', err);
  process.exitCode = 1;
  void prisma.$disconnect();
});
