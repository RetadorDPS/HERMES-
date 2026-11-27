'use client';

import { useState } from 'react';
import { LayoutGrid, Search } from 'lucide-react';
import { CatalogBrowser } from '@/app/(dashboard)/catalog/catalog-browser';
import { consultarCatalogoSupabase, obtenerPerfil, reglaPredeterminada } from '@/lib/real/datos';
import { cn } from '@/lib/utils';
import { BuscarProveedores } from './buscar-proveedores';
import { PantallaReal, useCarga } from './comun';

/**
 * Catálogo con dos pestañas:
 *  · «Mi catálogo»: lo que ya está en el catálogo común (lo último añadido, primero), con carga continua.
 *  · «Buscar en proveedores»: búsqueda en vivo en CJ o AliExpress; lo que se añade pasa a «Mi catálogo».
 */
export function CatalogoReal() {
  const [pestana, setPestana] = useState<'catalogo' | 'buscar'>('catalogo');
  // Al añadir productos desde el buscador, «Mi catálogo» se recarga al volver a él (así el buscador no pierde sus resultados)
  const [pendiente, setPendiente] = useState(false);
  const [version, setVersion] = useState(0);
  const { datos, error, cargando, recargar } = useCarga(async () => {
    const [catalogo, regla, cuenta] = await Promise.all([consultarCatalogoSupabase({ pageSize: 24, sort: 'newest' }), reglaPredeterminada(), obtenerPerfil()]);
    return { catalogo, regla, esAdmin: cuenta.perfil?.role === 'ADMIN' };
  });
  const c = datos?.catalogo;
  return (
    <PantallaReal
      titulo="Catálogo de productos"
      subtitulo={c && c.stats.total === 0 ? 'Todavía no hay productos: búscalos en «Buscar en proveedores»' : 'Productos de CJ y AliExpress listos para vender'}
      cargando={cargando}
      error={error}
      alRecargar={recargar}
      tour="screen:catalog"
    >
      <div className="flex gap-1 rounded-xl border border-white/[0.07] bg-white/[0.02] p-1" role="tablist">
        {(
          [
            { id: 'catalogo', texto: 'Mi catálogo', icono: LayoutGrid },
            { id: 'buscar', texto: 'Buscar en proveedores', icono: Search },
          ] as const
        ).map(({ id, texto, icono: Icono }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={pestana === id}
            onClick={() => {
              setPestana(id);
              if (id === 'catalogo' && pendiente) {
                setPendiente(false);
                setVersion((v) => v + 1);
              }
            }}
            className={cn(
              'flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[12.5px] font-medium transition',
              pestana === id ? 'bg-indigo-500/80 text-white shadow' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icono className="size-4" />
            {texto}
          </button>
        ))}
      </div>

      {/* Las dos pestañas siguen montadas: cambiar de una a otra no pierde la búsqueda ni lo que ya se cargó */}
      <div className={pestana === 'buscar' ? '' : 'hidden'}>
        <BuscarProveedores alAnadir={() => setPendiente(true)} />
      </div>

      {datos && c && (
        <div className={pestana === 'catalogo' ? '' : 'hidden'}>
        <CatalogBrowser
          key={version}
          refrescarAlMontar={version > 0}
          initial={{
            items: c.items,
            total: c.total,
            page: c.page,
            pages: c.pages,
            facets: c.facets,
            stats: c.stats,
            priceRange: c.priceRange,
            warehouses: c.warehouses ?? [],
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
        </div>
      )}
    </PantallaReal>
  );
}
