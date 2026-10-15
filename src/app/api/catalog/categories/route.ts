/**
 * GET /api/catalog/categories — Categorías, proveedores y estado del índice.
 *
 * Alimenta la cabecera del catálogo («X productos · actualizado hace…») y el
 * carrusel de categorías con imagen, que es lo que hace que al entrar se vea un
 * escaparate ya montado y no una caja de búsqueda vacía.
 */
import { NextResponse } from 'next/server';
import { queryCatalog, ensureSampleCatalog } from '@/lib/catalog';
import { platformCredentialSummary } from '@/lib/catalog/platform-credentials';
import { apiTenant } from '@/lib/tenant';
import { hasDatabase, prisma } from '@/lib/prisma';
import { withSystem } from '@/lib/tenant-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return apiTenant(async () => {
    await ensureSampleCatalog();

    const [overview, credentials, dbCategories] = await Promise.all([
      queryCatalog({ pageSize: 4 }),
      platformCredentialSummary(),
      hasDatabase()
        ? withSystem('catálogo: categorías propias', () =>
            prisma.catalogCategory.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], take: 200 }),
          ).catch(() => [])
        : Promise.resolve([]),
    ]);

    // Carpetas del proveedor (reales) + facetas del índice (incluyen las de muestra)
    const realCategories = (dbCategories as any[])
      .filter((c) => !String(c.externalId).startsWith('sample-'))
      .map((c) => ({ name: c.name, slug: c.slug, provider: c.provider, externalId: c.externalId, parentName: c.parentName, imageUrl: c.imageUrl }));

    return NextResponse.json({
      ok: true,
      categories: overview.facets,
      providerCategories: realCategories.slice(0, 80),
      providers: overview.providers,
      stats: overview.stats,
      credentials: credentials.map((c) => ({
        provider: c.provider,
        name: c.name,
        configured: c.configured,
        source: c.source,
        status: c.status,
        lastTestAt: c.lastTestAt,
        catalogReady: overview.providers.find((p) => p.provider === c.provider)?.hasReal ?? false,
      })),
      budget: overview.priceRange,
    });
  });
}
