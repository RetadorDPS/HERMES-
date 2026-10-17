'use client';

import { CatalogBrowser } from '@/app/(dashboard)/catalog/catalog-browser';
import { consultarCatalogoSupabase, obtenerPerfil, reglaPredeterminada } from '@/lib/real/datos';
import { PantallaReal, useCarga } from './comun';

export function CatalogoReal() {
  const { datos, error, cargando, recargar } = useCarga(async () => {
    const [catalogo, regla, cuenta] = await Promise.all([consultarCatalogoSupabase({ pageSize: 24, sort: 'relevance' }), reglaPredeterminada(), obtenerPerfil()]);
    return { catalogo, regla, esAdmin: cuenta.perfil?.role === 'ADMIN' };
  });
  const c = datos?.catalogo;
  return (
    <PantallaReal
      titulo="Catálogo de productos"
      subtitulo={c ? (c.stats.total > 0 ? `${c.stats.total} productos de proveedor` : 'Todavía no hay productos en el catálogo') : 'Catálogo común'}
      cargando={cargando}
      error={error}
      alRecargar={recargar}
      tour="screen:catalog"
    >
      {datos && c && (
        <CatalogBrowser
          initial={{
            items: c.items,
            total: c.total,
            page: c.page,
            pages: c.pages,
            facets: c.facets,
            stats: c.stats,
            priceRange: c.priceRange,
            providers: ['CJ_DROPSHIPPING', 'ALIEXPRESS'].map((provider) => ({
              provider,
              count: c.providers.find((p) => p.provider === provider)?.count ?? 0,
              hasReal: Boolean(c.providers.find((p) => p.provider === provider)?.hasReal),
            })),
          }}
          credentials={[]}
          isAdmin={datos.esAdmin}
          ruleName={datos.regla?.name ?? 'sin regla (40 % por defecto)'}
          totalCatalog={c.stats.total}
        />
      )}
    </PantallaReal>
  );
}
