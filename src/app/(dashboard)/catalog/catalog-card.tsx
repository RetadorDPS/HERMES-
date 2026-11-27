'use client';

/**
 * Tarjeta de producto del catálogo.
 *
 * Muestra lo que de verdad decide una importación: cuánto cuesta traerlo, a
 * cuánto se venderá con la regla de margen DEL USUARIO y cuánto gana por unidad.
 * Si el artículo viene del catálogo de muestra, se dice con una etiqueta.
 */
import { Foto } from '@/components/panel/real/foto';
import { Star, TrendingUp, Truck } from 'lucide-react';
import { Badge as UiBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatCurrency, formatNumber, cn } from '@/lib/utils';
import type { CatalogRow } from '@/lib/catalog';
import { nombreAlmacen, nombrePais, textoPopularidad } from '@/lib/paises';

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
  etiquetaImportar = 'Importar',
}: {
  item: CatalogRow;
  onOpen: (item: CatalogRow) => void;
  onImport: (item: CatalogRow) => void;
  /** Texto del botón principal (en «Importar por enlace», donde el producto ya está importado, dice «Publicar»). */
  etiquetaImportar?: string;
}) {
  const sales = item.ordersCount ?? 0;
  const estrellas = item.rating ? Math.round(item.rating * 10) / 10 : null;

  return (
    <div data-tour="catalog:card" className="group relative flex flex-col overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.02] transition-all hover:border-indigo-400/30 hover:bg-white/[0.04] hover:shadow-xl hover:shadow-indigo-500/5">
      <button type="button" onClick={() => onOpen(item)} className="relative block aspect-[5/4] w-full overflow-hidden bg-black/30 text-left sm:aspect-square">
        {item.imageUrl ? (
          <Foto src={item.imageUrl} alt={item.title} ancho={480} perezosa className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" />
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
              Gratis a algún destino
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
          {sales > 0 && <span title="Cifra de popularidad que informa el proveedor">{textoPopularidad(item.provider, sales, formatNumber)}</span>}
          {item.shipFrom && <span className="hidden sm:inline">desde {nombreAlmacen(item.shipFrom)}</span>}
          {item.envio ? (
            <span className="inline-flex items-center gap-1" title={`Envío cotizado a ${nombrePais(item.envio.destino)}${item.envio.origen ? ` desde ${nombreAlmacen(item.envio.origen)}` : ''}`}>
              <Truck className="size-3" />
              {item.envio.diasMin !== null && item.envio.diasMax !== null ? (item.envio.diasMin === item.envio.diasMax ? `${item.envio.diasMin} d` : `${item.envio.diasMin}-${item.envio.diasMax} d`) : 'plazo sin dato'}
              {' · '}
              {item.envio.precioEur === null ? 'precio sin dato' : item.envio.precioEur === 0 ? 'envío gratis' : formatCurrency(item.envio.precioEur)}
            </span>
          ) : item.envioEnFicha ? (
            <span className="inline-flex items-center gap-1" title="El envío a Cuba tiene dos tramos; el desglose está en la ficha del producto">
              <Truck className="size-3" /> envío a Cuba: ver ficha
            </span>
          ) : item.envioSinCotizar ? (
            <span className="inline-flex items-center gap-1 text-amber-300/80" title="Todavía no se ha pedido la cotización de envío a este país para este producto">
              <Truck className="size-3" /> envío sin cotizar
            </span>
          ) : item.shippingMinDays !== null && item.shippingMinDays !== undefined ? (
            <span className="inline-flex items-center gap-1">
              <Truck className="size-3" />
              {item.shippingMinDays}-{item.shippingMaxDays ?? item.shippingMinDays + 7} d
            </span>
          ) : null}
        </div>

        <div className="mt-auto space-y-2">
          <div className="flex items-end justify-between gap-2">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground"><span className="sm:hidden">Coste</span><span className="hidden sm:inline">Coste proveedor</span></div>
              <div className="text-sm font-semibold tabular-nums">{formatCurrency(item.costPrice, item.currency)}</div>
              {item.fx?.unknown && (
                <div className="text-[10px] text-amber-400">Sin tipo de cambio: no se calcula el precio de venta</div>
              )}
              {item.fx?.converted && item.costPriceEur !== undefined && (
                <div className="text-[10px] text-muted-foreground" title={`Tipo de cambio del Banco Central Europeo${item.fx.date ? ` del ${item.fx.date}` : ''}: 1 ${item.currency} = ${item.fx.rate} €`}>
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
              <span className="text-emerald-300/90">
                {item.beneficioConEnvio ? (
                  <><span className="sm:hidden">Beneficio (con envío)</span><span className="hidden sm:inline">Beneficio por unidad (con el envío cotizado)</span></>
                ) : (
                  <><span className="sm:hidden">Beneficio (sin envío)</span><span className="hidden sm:inline">Beneficio por unidad (antes del envío)</span></>
                )}
              </span>
              <span className="font-semibold tabular-nums text-emerald-300">
                +{formatCurrency(item.profit)} · {Math.round(item.profitMarginPct ?? 0)}%
              </span>
            </div>
          )}

          <div className="flex items-center gap-2">
            <Button size="sm" variant="gradient" className="flex-1" onClick={() => onImport(item)}>
              {etiquetaImportar}
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

/** Proveedor en pocas letras para la tarjeta compacta (el nombre completo va en la ficha). */
const SIGLA: Record<string, { texto: string; className: string }> = {
  CJ_DROPSHIPPING: { texto: 'CJ', className: 'border-sky-400/60 text-sky-200' },
  ALIEXPRESS: { texto: 'AliExpress', className: 'border-orange-400/60 text-orange-200' },
};
const DIAS_NUEVO = 7;

/**
 * Tarjeta COMPACTA del catálogo: tres por fila en el móvil sin perder datos. Toda la tarjeta abre la ficha.
 * Enseña lo mismo que la grande en letra pequeña: precio de venta con tu regla, coste, beneficio, envío al destino y stock.
 */
/** `elegida` (opcional): modo «elegir varios»; la tarjeta se marca y el toque elige en vez de abrir la ficha. */
export function CatalogCardCompact({ item, onOpen, elegida }: { item: CatalogRow; onOpen: (item: CatalogRow) => void; elegida?: boolean }) {
  const sigla = SIGLA[item.provider] ?? { texto: item.provider, className: 'border-white/30 text-foreground' };
  const creado = item.createdAt ? new Date(item.createdAt).getTime() : null;
  const nuevo = creado !== null && Number.isFinite(creado) && Date.now() - creado < DIAS_NUEVO * 86_400_000;
  const estrellas = item.rating ? Math.round(item.rating * 10) / 10 : null;
  const ventas = item.ordersCount ?? 0;
  const envio = item.envio
    ? `${item.envio.diasMin !== null && item.envio.diasMax !== null ? (item.envio.diasMin === item.envio.diasMax ? `${item.envio.diasMin} d` : `${item.envio.diasMin}-${item.envio.diasMax} d`) : ''}${item.envio.precioEur === null ? '' : item.envio.precioEur === 0 ? ' · gratis' : ` · ${formatCurrency(item.envio.precioEur)}`}`.replace(/^ · /, '')
    : item.envioEnFicha
      ? 'envío: ver ficha'
      : item.envioSinCotizar
        ? 'envío sin cotizar'
        : null;

  return (
    <button
      type="button"
      data-tour="catalog:card"
      onClick={() => onOpen(item)}
      aria-pressed={elegida === undefined ? undefined : elegida}
      className={cn(
        'group relative flex min-w-0 flex-col overflow-hidden rounded-lg border text-left transition',
        elegida ? 'border-indigo-400 bg-indigo-500/[0.10] ring-2 ring-indigo-400/60' : 'border-white/[0.07] bg-white/[0.02] hover:border-indigo-400/40 hover:bg-white/[0.04]',
      )}
    >
      {elegida !== undefined && (
        <span className={cn('absolute bottom-1 right-1 z-10 grid size-5 place-items-center rounded-full border text-[11px] font-bold', elegida ? 'border-indigo-300 bg-indigo-500 text-white' : 'border-white/40 bg-black/60 text-transparent')} aria-hidden>
          ✓
        </span>
      )}
      <span className="relative block aspect-square w-full overflow-hidden bg-black/30">
        <Foto src={item.imageUrl} alt={item.title} ancho={240} perezosa className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" />
        <span className={cn('absolute left-1 top-1 rounded border bg-black/75 px-1 py-px text-[8.5px] font-semibold leading-tight', sigla.className)}>{sigla.texto}</span>
        <span className="absolute right-1 top-1 flex flex-col items-end gap-0.5">
          {nuevo && <span className="rounded bg-indigo-500/90 px-1 py-px text-[8.5px] font-semibold leading-tight text-white">Nuevo</span>}
          {item.isTrending && (
            <span className="inline-flex items-center rounded bg-emerald-500/85 px-0.5 py-px text-white" title="Top ventas">
              <TrendingUp className="size-2.5" />
            </span>
          )}
        </span>
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 p-1.5">
        <span className="line-clamp-2 text-[10.5px] leading-tight text-foreground/90">{item.title}</span>
        <span className="mt-auto flex items-baseline justify-between gap-1">
          {item.sellingPrice !== undefined ? (
            <span className="text-[12px] font-semibold tabular-nums text-indigo-200">{formatCurrency(item.sellingPrice)}</span>
          ) : (
            <span className="text-[12px] font-semibold tabular-nums">{formatCurrency(item.costPrice, item.currency)}</span>
          )}
          {estrellas !== null && (
            <span className="inline-flex items-center gap-0.5 text-[9px] text-amber-300">
              <Star className="size-2.5 fill-current" />
              {estrellas.toFixed(1)}
            </span>
          )}
        </span>
        {item.sellingPrice !== undefined && (
          <span className="text-[9px] leading-tight text-muted-foreground">coste {formatCurrency(item.costPrice, item.currency)}</span>
        )}
        {item.profit !== undefined && (
          <span className="text-[9.5px] font-medium leading-tight tabular-nums text-emerald-300" title={item.beneficioConEnvio ? 'Beneficio por unidad con el envío cotizado' : 'Beneficio por unidad antes del envío'}>
            +{formatCurrency(item.profit)} {item.beneficioConEnvio ? 'con envío' : 'sin envío'}
          </span>
        )}
        {item.fx?.unknown && <span className="text-[9px] leading-tight text-amber-400">sin tipo de cambio</span>}
        <span className="flex flex-wrap gap-x-1 text-[9px] leading-tight text-muted-foreground">
          {envio && (
            <span className={cn('inline-flex items-center gap-0.5', item.envioSinCotizar && 'text-amber-300/80')}>
              <Truck className="size-2.5" />
              {envio}
            </span>
          )}
          {ventas > 0 && <span title={item.provider === 'CJ_DROPSHIPPING' ? 'CJ no informa ventas: es el número de tiendas que lo han añadido a su catálogo' : 'Unidades vendidas según AliExpress'}>{textoPopularidad(item.provider, ventas, formatNumber)}</span>}
          {item.stock !== null && item.stock !== undefined && item.stock <= 0 && <span className="text-amber-400">sin stock</span>}
        </span>
      </span>
    </button>
  );
}

export default CatalogCard;
