import { Topbar } from '@/components/layout/topbar';
import { getProducts, getStores, dataMode } from '@/lib/data';
import { ProductTable } from './product-table';

import { withCurrentTenant } from '@/lib/tenant';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Gestión de productos' };

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: { search?: string; status?: string; storeId?: string; sort?: string; problems?: string; page?: string };
}) {
    return withCurrentTenant(async (userId) => {
      const filters = {
        search: searchParams.search ?? '',
        status: searchParams.status ?? 'ALL',
        storeId: searchParams.storeId ?? '',
        sort: searchParams.sort ?? 'recent',
        problems: searchParams.problems === '1',
      };

      const [data, stores] = await Promise.all([
        getProducts({
          search: filters.search || undefined,
          status: filters.status as any,
          storeId: filters.storeId || undefined,
          onlyProblems: filters.problems,
          sort: filters.sort as any,
          page: Number(searchParams.page ?? 1),
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
          <div data-tour="screen:products" className="py-5">
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
