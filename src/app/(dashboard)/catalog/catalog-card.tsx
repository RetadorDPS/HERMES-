'use client';

/**
 * Tarjeta de producto del catálogo.
 *
 * Muestra lo que de verdad decide una importación: cuánto cuesta traerlo, a
 * cuánto se venderá con la regla de margen DEL USUARIO y cuánto gana por unidad.
 * Si el artículo viene del catálogo de muestra, se dice con una etiqueta.
 */
import { Star, TrendingUp, Truck } from 'lucide-react';
import { Badge as UiBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatCurrency, formatNumber, cn } from '@/lib/utils';
import type { CatalogRow } from '@/lib/catalog';
import { nombreAlmacen } from '@/lib/paises';

export function ProviderBadge({ provider }: { provider: string }) {
  // Fondo oscuro propio para que se lea sobre cualquier foto (antes se perdía sobre imágenes claras)
  const map: Record<string, { label: string; className: string }> = {
    CJ_DROPSHIPPING: { label: 'CJ Dropshipping', className: 'border-sky-400/60 text-sky-200' },
    ALIEXPRESS: { label: 'AliExpress', className: 'border-orange-400/60 text-orange-200' },
    AMAZON: { label: 'Amazon', className: 'border-amber-400/60 text-amber-200' },
  };
  const spec = map[provider] ?? { label: provider, className: 'border-white/30 text-foreground' };
  return (
    <span className={cn('rounded-md border bg-black/75 px-1.5 py-0.5 text-[10.5px] font-semibold leading-none shadow-sm backdrop-blur', spec.className)}>
      {spec.label}
    </span>
  );
}

export function CatalogCard({
  item,
  onOpen,
  onImport,
}: {
  item: CatalogRow;
  onOpen: (item: CatalogRow) => void;
  onImport: (item: CatalogRow) => void;
}) {
  const sales = item.ordersCount ?? 0;
  const estrellas = item.rating ? Math.round(item.rating * 10) / 10 : null;

  return (
    <div data-tour="catalog:card" className="group relative flex flex-col overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.02] transition-all hover:border-indigo-400/30 hover:bg-white/[0.04] hover:shadow-xl hover:shadow-indigo-500/5">
      <button type="button" onClick={() => onOpen(item)} className="relative block aspect-[5/4] w-full overflow-hidden bg-black/30 text-left sm:aspect-square">
        {item.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.imageUrl}
            alt={item.title}
            loading="lazy"
            className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
          />
        ) : (
          <span className="grid size-full place-items-center text-[11px] text-muted-foreground">Sin imagen</span>
        )}

        <span className="absolute left-2 top-2 flex flex-wrap gap-1">
          <ProviderBadge provider={item.provider} />
          {item.source === 'sample' && (
            <span className="hidden rounded-md border border-white/15 bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground backdrop-blur sm:inline">
              MUESTRA
            </span>
          )}
        </span>

        <span className="absolute right-2 top-2 flex flex-col items-end gap-1">
          {item.isTrending && (
            <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/25 bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300 backdrop-blur">
              <TrendingUp className="size-3" /> <span className="hidden min-[420px]:inline">Top ventas</span>
            </span>
          )}
          {item.freeShipping && (
            <span className="hidden rounded-md border border-indigo-500/25 bg-indigo-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-300 backdrop-blur sm:inline">
              Envío gratis
            </span>
          )}
        </span>
      </button>

      <div className="flex flex-1 flex-col gap-1.5 p-2.5 sm:gap-2 sm:p-3">
        <button type="button" onClick={() => onOpen(item)} className="line-clamp-2 text-left text-[12.5px] font-medium leading-snug hover:text-indigo-200 sm:text-[13px]">
          {item.title}
        </button>

        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[10.5px] text-muted-foreground sm:gap-x-3 sm:text-[11px]">
          {estrellas !== null && (
            <span className="inline-flex items-center gap-1 text-amber-300">
              <Star className="size-3 fill-current" /> {estrellas.toFixed(1)}
            </span>
          )}
          {sales > 0 && <span>{formatNumber(sales)}<span className="hidden sm:inline"> pedidos</span><span className="sm:hidden"> ped.</span></span>}
          {item.shipFrom && <span className="hidden sm:inline">desde {nombreAlmacen(item.shipFrom)}</span>}
          {item.shippingMinDays !== null && (
            <span className="inline-flex items-center gap-1">
              <Truck className="size-3" />
              {item.shippingMinDays}-{item.shippingMaxDays ?? item.shippingMinDays + 7} d
            </span>
          )}
        </div>

        <div className="mt-auto space-y-2">
          <div className="flex items-end justify-between gap-2">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground"><span className="sm:hidden">Coste</span><span className="hidden sm:inline">Coste proveedor</span></div>
              <div className="text-sm font-semibold tabular-nums">{formatCurrency(item.costPrice, item.currency)}</div>
              {item.fx?.converted && item.costPriceEur !== undefined && (
                <div className="text-[10px] text-muted-foreground" title={`Tipo de cambio configurado: 1 ${item.currency} = ${item.fx.rate} €`}>
                  ≈ {formatCurrency(item.costPriceEur)} (cambio {item.fx.rate})
                </div>
              )}
            </div>
            {item.sellingPrice !== undefined && (
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground"><span className="sm:hidden">Venta</span><span className="hidden sm:inline">Tu precio de venta</span></div>
                <div className="text-[15px] font-semibold tabular-nums text-indigo-200 sm:text-base">{formatCurrency(item.sellingPrice)}</div>
              </div>
            )}
          </div>

          {item.profit !== undefined && (
            <div className="flex items-center justify-between rounded-lg border border-emerald-500/20 bg-emerald-500/[0.07] px-2 py-1.5 text-[11px]">
              <span className="text-emerald-300/90"><span className="sm:hidden">Beneficio</span><span className="hidden sm:inline">Beneficio por unidad</span></span>
              <span className="font-semibold tabular-nums text-emerald-300">
                +{formatCurrency(item.profit)} · {Math.round(item.profitMarginPct ?? 0)}%
              </span>
            </div>
          )}

          <div className="flex items-center gap-2">
            <Button size="sm" variant="gradient" className="flex-1" onClick={() => onImport(item)}>
              Importar
            </Button>
            <Button size="sm" variant="outline" className="hidden sm:inline-flex" onClick={() => onOpen(item)}>
              Ver ficha
            </Button>
          </div>

          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span className={item.stock === null || item.stock === undefined || item.stock > 0 ? '' : 'text-amber-400'}>
              {item.stock === null || item.stock === undefined ? 'Stock por consultar' : item.stock > 0 ? `${formatNumber(item.stock)} en stock` : 'Sin stock'}
              {item.importedCount ? ` · importado ${item.importedCount}×` : ''}
            </span>
            {item.source === 'sample' && <UiBadge variant="outline" className="hidden px-1.5 py-0 text-[9px] sm:inline-flex">datos de ejemplo</UiBadge>}
          </div>
        </div>
      </div>
    </div>
  );
}

export default CatalogCard;
