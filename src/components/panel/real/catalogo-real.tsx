'use client';

import { useEffect, useState } from 'react';
import { LayoutGrid, Search } from 'lucide-react';
import { CatalogBrowser } from '@/app/(dashboard)/catalog/catalog-browser';
import { consultarCatalogoSupabase, obtenerPerfil, reglaPredeterminada } from '@/lib/real/datos';
import { cn } from '@/lib/utils';
import { BuscarProveedores } from './buscar-proveedores';
import { PantallaReal, useCarga } from './comun';
import { guardarRecienAnadidos, leerRecienAnadidos, RecienAnadidos } from './recien-anadidos';
import { PublicarVariosEnRetador } from './publicar-varios-retador';
import { cupoBusqueda, TANDA_POR_DEFECTO } from '@/lib/real/buscar';
import type { CatalogRow } from '@/lib/catalog';

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
  // Lo que se acaba de añadir desde el buscador: se enseña junto y arriba en «Mi catálogo» hasta que el usuario lo oculte
  const [recien, setRecien] = useState<string[]>([]);
  // Productos elegidos para publicar en Retador de una vez (desde «Acabas de añadir» o desde «Elegir varios»)
  const [publicarVarios, setPublicarVarios] = useState<CatalogRow[] | null>(null);
  // Cuántos productos se manejan a la vez: lo dice el plan
  const [tanda, setTanda] = useState(TANDA_POR_DEFECTO);
  useEffect(() => {
    cupoBusqueda().then((c) => setTanda(c.tanda)).catch(() => undefined);
  }, []);
  useEffect(() => setRecien(leerRecienAnadidos()), []);
  const irAlCatalogo = () => {
    setPestana('catalogo');
    if (pendiente) {
      setPendiente(false);
      setVersion((v) => v + 1);
    }
  };
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
            onClick={() => (id === 'catalogo' ? irAlCatalogo() : setPestana(id))}
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
        <BuscarProveedores
          alAnadir={(ids) => {
            setPendiente(true);
            setRecien((prev) => {
              const lista = [...ids, ...prev.filter((x) => !ids.includes(x))];
              guardarRecienAnadidos(lista);
              return lista;
            });
          }}
          alVerAnadidos={() => {
            irAlCatalogo();
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
        />
      </div>

      {datos && c && (
        <div className={pestana === 'catalogo' ? 'space-y-3' : 'hidden'}>
        {recien.length > 0 && (
          <RecienAnadidos
            key={`${version}-${recien.length}`}
            ids={recien}
            alPublicar={setPublicarVarios}
            alOcultar={() => {
              setRecien([]);
              guardarRecienAnadidos([]);
            }}
          />
        )}
        <CatalogBrowser
          key={version}
          alPublicarVarios={setPublicarVarios}
          maxElegir={tanda}
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
      {publicarVarios && <PublicarVariosEnRetador items={publicarVarios} maximo={tanda} onClose={() => setPublicarVarios(null)} />}
    </PantallaReal>
  );
}
