/**
 * /catalog — Escaparate de productos listos para importar.
 *
 * El servidor entrega la primera pantalla ya llena (categorías con imagen,
 * productos ordenados por más vendidos y precios con LA regla de margen del
 * usuario). A partir de ahí, los filtros y el buscador funcionan contra
 * `/api/catalog`, que responde desde el índice propio de la plataforma.
 */
import { Topbar } from '@/components/layout/topbar';
import { getPricingRules, dataMode } from '@/lib/data';
import { queryCatalog, ensureSampleCatalog } from '@/lib/catalog';
import { platformCredentialSummary } from '@/lib/catalog/platform-credentials';
import { currentAdmin } from '@/lib/admin';
import { CatalogBrowser } from './catalog-browser';

import { withCurrentTenant } from '@/lib/tenant';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Catálogo de productos' };

export default async function CatalogPage() {
  return withCurrentTenant(async () => {
    await ensureSampleCatalog();

    const [rules, credentials, admin] = await Promise.all([
      getPricingRules(),
      platformCredentialSummary(),
      currentAdmin().catch(() => null),
    ]);
    const rule = rules.find((r: any) => r.isDefault) ?? rules[0] ?? null;

    const catalog = await queryCatalog({ pageSize: 24, sort: 'relevance', pricingRule: rule as any });

    const providers = [
      { provider: 'CJ_DROPSHIPPING', count: catalog.providers.find((p) => p.provider === 'CJ_DROPSHIPPING')?.count ?? 0, hasReal: Boolean(catalog.providers.find((p) => p.provider === 'CJ_DROPSHIPPING')?.hasReal) },
      { provider: 'ALIEXPRESS', count: catalog.providers.find((p) => p.provider === 'ALIEXPRESS')?.count ?? 0, hasReal: Boolean(catalog.providers.find((p) => p.provider === 'ALIEXPRESS')?.hasReal) },
    ];

    const subtitle =
      catalog.stats.real > 0
        ? `${catalog.stats.total} productos de proveedor listos para importar · precios con tu regla de margen`
        : `${catalog.stats.total} productos de muestra (las claves de la plataforma activan el catálogo real) · precios con tu regla de margen`;

    return (
      <>
        <Topbar title="Catálogo de productos" subtitle={subtitle} mode={dataMode()} />
        <div data-tour="screen:catalog" className="py-5">
          <CatalogBrowser
            initial={{
              items: catalog.items,
              total: catalog.total,
              page: catalog.page,
              pages: catalog.pages,
              facets: catalog.facets,
              stats: catalog.stats,
              priceRange: catalog.priceRange,
              providers,
            }}
            credentials={credentials.map((c) => ({
              provider: c.provider,
              name: c.name,
              configured: c.configured,
              source: c.source,
              catalogReady: Boolean(catalog.providers.find((p) => p.provider === c.provider)?.hasReal),
              status: c.status,
            }))}
            isAdmin={Boolean(admin)}
            ruleName={rule?.name ?? 'sin regla (40 % por defecto)'}
            totalCatalog={catalog.stats.total}
          />
        </div>
      </>
    );
  });
}
