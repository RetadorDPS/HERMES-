import { Topbar } from '@/components/layout/topbar';
import { getProducts, getStores, dataMode } from '@/lib/data';
import { Suspense } from 'react';
import { ProductTable } from './product-table';
import { ProductTableEstatico } from './product-table-estatico';
import { ESTATICO, parametrosDeServidor } from '@/lib/ruta';
import { demoProducts } from '@/lib/demo-data';

import { withCurrentTenant } from '@/lib/tenant';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Gestión de productos' };

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: { search?: string; status?: string; storeId?: string; sort?: string; problems?: string; page?: string };
}) {
    return withCurrentTenant(async (userId) => {
      // Versión estática (GitHub Pages): no hay servidor, los filtros se aplican en el navegador
      if (ESTATICO) {
        const [todos, tiendas] = await Promise.all([getProducts({ limit: 1000 }), getStores()]);
        const filas = todos.items.map((i) => ({ ...i, storeId: demoProducts.find((p) => p.id === i.id)?.storeId ?? '' }));
        return (
          <>
            <Topbar
              title="Gestión de productos"
              subtitle={`${todos.total} productos importados · estados de sincronización en tiempo real`}
              mode={dataMode()}
            />
            <div data-tour="screen:products" className="py-3">
              <Suspense fallback={null}>
                <ProductTableEstatico items={filas} stores={tiendas.map((s) => ({ id: s.id, name: s.name }))} />
              </Suspense>
            </div>
          </>
        );
      }

      const sp = parametrosDeServidor(searchParams);
      const filters = {
        search: sp.search ?? '',
        status: sp.status ?? 'ALL',
        storeId: sp.storeId ?? '',
        sort: sp.sort ?? 'recent',
        problems: sp.problems === '1',
      };

      const [data, stores] = await Promise.all([
        getProducts({
          search: filters.search || undefined,
          status: filters.status as any,
          storeId: filters.storeId || undefined,
          onlyProblems: filters.problems,
          sort: filters.sort as any,
          page: Number(sp.page ?? 1),
          limit: 12,
        }),
        getStores(),
      ]);

      return (
        <>
          <Topbar
            title="Gestión de productos"
            subtitle={`${data.total} productos importados · estados de sincronización en tiempo real`}
            mode={dataMode()}
          />
          <div data-tour="screen:products" className="py-3">
            <ProductTable
              items={data.items}
              total={data.total}
              page={data.page}
              pages={data.pages}
              stores={stores.map((s) => ({ id: s.id, name: s.name }))}
              filters={filters}
            />
          </div>
        </>
      );

    });
  }
