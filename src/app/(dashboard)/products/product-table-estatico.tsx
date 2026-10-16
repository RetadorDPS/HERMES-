'use client';

/**
 * Tabla de productos para la versión ESTÁTICA (GitHub Pages).
 *
 * En el servidor normal los filtros se aplican en el servidor (la página se
 * vuelve a generar con cada búsqueda). En la versión estática no hay servidor,
 * así que se filtran, ordenan y paginan aquí, en el navegador, con las mismas
 * reglas que la consulta de demostración (getProducts).
 */
import { useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import type { ProductListItem } from '@/lib/data';
import { ProductTable } from './product-table';

type Fila = ProductListItem & { storeId: string };

const TAMANO_PAGINA = 12;

export function ProductTableEstatico({ items, stores }: { items: Fila[]; stores: { id: string; name: string }[] }) {
  const params = useSearchParams();

  const filtros = useMemo(
    () => ({
      search: params.get('search') ?? '',
      status: params.get('status') ?? 'ALL',
      storeId: params.get('storeId') ?? '',
      sort: params.get('sort') ?? 'recent',
      problems: params.get('problems') === '1',
    }),
    [params],
  );
  const pagina = Math.max(1, Number(params.get('page') ?? 1) || 1);

  const { pagina: filas, total, paginas } = useMemo(() => {
    let rows = [...items];
    if (filtros.search) {
      const q = filtros.search.toLowerCase();
      rows = rows.filter((p) => p.title.toLowerCase().includes(q) || p.category.toLowerCase().includes(q));
    }
    if (filtros.status !== 'ALL') rows = rows.filter((p) => p.status === filtros.status);
    if (filtros.storeId) rows = rows.filter((p) => p.storeId === filtros.storeId);
    if (filtros.problems) rows = rows.filter((p) => p.stockTotal === 0 || p.status === 'ERROR' || p.lastSyncStatus === 'FAILED');

    const hora = (d: Date | string | null) => (d ? new Date(d).getTime() : 0);
    const orden: Record<string, (a: Fila, b: Fila) => number> = {
      recent: (a, b) => hora(b.lastSyncedAt) - hora(a.lastSyncedAt),
      title: (a, b) => a.title.localeCompare(b.title),
      stock: (a, b) => a.stockTotal - b.stockTotal,
      profit: (a, b) => b.profitAmount - a.profitAmount,
      price: (a, b) => b.sellingPrice - a.sellingPrice,
    };
    rows.sort(orden[filtros.sort] ?? orden.recent);

    const total = rows.length;
    const paginas = Math.max(1, Math.ceil(total / TAMANO_PAGINA));
    const actual = Math.min(pagina, paginas);
    return { pagina: rows.slice((actual - 1) * TAMANO_PAGINA, actual * TAMANO_PAGINA), total, paginas };
  }, [items, filtros, pagina]);

  return <ProductTable items={filas} total={total} page={Math.min(pagina, paginas)} pages={paginas} stores={stores} filters={filtros} />;
}
