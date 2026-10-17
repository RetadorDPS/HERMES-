'use client';

/**
 * Pantalla del catálogo: escaparate + buscador + filtros + importación.
 *
 * Al entrar ya hay contenido (categorías con imagen, productos, valoraciones y
 * precios con el margen del usuario). La búsqueda por palabras es un añadido,
 * no la única forma de navegar. Todo lo que se ve sale del índice propio de la
 * plataforma: responde al instante y no gasta cuota de las APIs del proveedor.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowDownUp,
  Compass,
  Flame,
  Frown,
  Info,
  Loader2,
  Package,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Truck,
  X,
} from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { cn, formatCurrency, formatNumber, formatRelative } from '@/lib/utils';
import type { CatalogFacet, CatalogRow } from '@/lib/catalog';
import { CatalogCard } from './catalog-card';
import { imageSrc } from './image';
import { CatalogImportDrawer } from './import-dialog';
import { useSesion } from '@/components/auth/sesion';
import { FichaProveedor } from '@/components/panel/real/ficha-proveedor';
import { nombreAlmacen } from '@/lib/paises';

export interface CatalogBrowserProps {
  initial: {
    items: CatalogRow[];
    total: number;
    page: number;
    pages: number;
    facets: CatalogFacet[];
    stats: { total: number; real: number; sample: number; lastSyncedAt: string | Date | null; freeShipping: number; trending: number };
    priceRange: { min: number; max: number };
    providers: { provider: string; count: number; hasReal: boolean }[];
  };
  credentials: { provider: string; name: string; configured: boolean; source: string | null; catalogReady: boolean; status: string | null }[];
  isAdmin: boolean;
  ruleName: string;
  totalCatalog: number;
}

const PROVIDER_LABEL: Record<string, string> = {
  CJ_DROPSHIPPING: 'CJ Dropshipping',
  ALIEXPRESS: 'AliExpress',
  AMAZON: 'Amazon',
  ALL: 'Todos los proveedores',
};

const SORTS = [
  { value: 'relevance', label: 'Más vendidos' },
  { value: 'trending', label: 'Tendencias' },
  { value: 'price-asc', label: 'Precio: de menor a mayor' },
  { value: 'price-desc', label: 'Precio: de mayor a menor' },
  { value: 'rating', label: 'Mejor valorados' },
  { value: 'orders', label: 'Más pedidos' },
  { value: 'newest', label: 'Novedades' },
];

export function CatalogBrowser({ initial, credentials, isAdmin, ruleName, totalCatalog }: CatalogBrowserProps) {
  const [items, setItems] = useState<CatalogRow[]>(initial.items);
  const [meta, setMeta] = useState({ total: initial.total, page: initial.page, pages: initial.pages });
  const [facets, setFacets] = useState<CatalogFacet[]>(initial.facets);
  const [stats, setStats] = useState(initial.stats);
  const [loading, setLoading] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  // Con sesión real se muestra la ficha completa del proveedor (datos reales)
  const { activo, modo } = useSesion();
  const real = activo && modo === 'real';
  const [toast, setToast] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  // Filtros
  const [q, setQ] = useState('');
  const [category, setCategory] = useState<string>('');
  // Proveedores elegidos (vacío = todos). Se pueden marcar varios a la vez.
  const [provider, setProvider] = useState<string[]>([]);
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [shipFrom, setShipFrom] = useState('');
  const [freeShipping, setFreeShipping] = useState(false);
  const [trending, setTrending] = useState(false);
  const [minRating, setMinRating] = useState('');
  const [sort, setSort] = useState('relevance');
  const [page, setPage] = useState(1);
  const [pageSize] = useState(24);

  const [suggestions, setSuggestions] = useState<{ id: string; title: string; imageUrl: string | null; costPrice: number }[]>([]);
  const first = useRef(true);

  const buildQuery = useCallback(
    (over: Partial<{ page: number }> = {}) => {
      const p = new URLSearchParams();
      if (q.trim()) p.set('q', q.trim());
      if (category) p.set('category', category);
      if (provider.length) p.set('provider', provider.join(','));
      if (minPrice) p.set('min', minPrice);
      if (maxPrice) p.set('max', maxPrice);
      if (shipFrom) p.set('shipFrom', shipFrom);
      if (freeShipping) p.set('freeShipping', '1');
      if (trending) p.set('trending', '1');
      if (minRating) p.set('minRating', minRating);
      if (sort !== 'relevance') p.set('sort', sort);
      p.set('page', String(over.page ?? page));
      p.set('pageSize', String(pageSize));
      return p.toString();
    },
    [q, category, provider, minPrice, maxPrice, shipFrom, freeShipping, trending, minRating, sort, page, pageSize],
  );

  const fetchItems = useCallback(
    async (query: string) => {
      setLoading(true);
      try {
        const res = await fetch(`/api/catalog?${query}`, { cache: 'no-store' });
        const json = await res.json();
        if (json.ok) {
          setItems(json.items);
          setMeta({ total: json.total, page: json.page, pages: json.pages });
          setFacets(json.facets);
          setStats(json.stats);
        }
      } catch {
        /* si falla, se mantiene lo que ya había en pantalla */
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // Refresco reactivo con un pequeño retardo (evita una petición por tecla)
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => void fetchItems(buildQuery()), 220);
    return () => clearTimeout(t);
  }, [buildQuery, fetchItems]);

  // Sugerencias del buscador
  useEffect(() => {
    if (q.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/catalog?q=${encodeURIComponent(q.trim())}&pageSize=6`, { cache: 'no-store' });
        const json = await res.json();
        if (json.ok) setSuggestions(json.items.slice(0, 6).map((i: CatalogRow) => ({ id: i.id, title: i.title, imageUrl: i.imageUrl, costPrice: i.costPrice })));
      } catch {
        /* sin sugerencias */
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const reset = () => {
    setQ('');
    setCategory('');
    setProvider([]);
    setMinPrice('');
    setMaxPrice('');
    setShipFrom('');
    setFreeShipping(false);
    setTrending(false);
    setMinRating('');
    setSort('relevance');
    setPage(1);
  };

  const activeFilters = [
    q && { label: `«${q}»`, clear: () => setQ('') },
    category && { label: category, clear: () => setCategory('') },
    provider.length > 0 && { label: provider.map((x) => PROVIDER_LABEL[x] ?? x).join(' + '), clear: () => setProvider([]) },
    (minPrice || maxPrice) && { label: `${minPrice || 0}–${maxPrice || '∞'} €`, clear: () => { setMinPrice(''); setMaxPrice(''); } },
    shipFrom && { label: `almacén: ${nombreAlmacen(shipFrom)}`, clear: () => setShipFrom('') },
    freeShipping && { label: 'envío gratis', clear: () => setFreeShipping(false) },
    trending && { label: 'tendencias', clear: () => setTrending(false) },
    minRating && { label: `≥ ${minRating}★`, clear: () => setMinRating('') },
  ].filter(Boolean) as { label: string; clear: () => void }[];

  // Proveedores del filtro: siempre CJ y AliExpress (aunque aún no tengan productos), más cualquier otro que tenga datos
  const opcionesProveedor = useMemo(() => {
    const cuenta = new Map(initial.providers.map((p) => [p.provider as string, p.count]));
    const claves = [...new Set(['CJ_DROPSHIPPING', 'ALIEXPRESS', ...cuenta.keys(), ...credentials.map((c) => c.provider)])];
    return claves.map((k) => ({ provider: k, count: cuenta.has(k) ? (cuenta.get(k) as number) : null }));
  }, [initial.providers, credentials]);

  const shipFromOptions = useMemo(() => {
    const base = ['ES', 'EU', 'CN', 'US'];
    return [...new Set([...base, ...items.map((i) => i.shipFrom).filter(Boolean) as string[]])];
  }, [items]);

  const sampleOnly = stats.real === 0;
  const configured = credentials.filter((c) => c.configured);

  return (
    <div className="space-y-5">
      {/* Aviso honesto: de dónde salen los datos que se están viendo */}
      {sampleOnly ? (
        <Alert variant="info" title="Catálogo de muestra cargado · listo para las claves reales">
          <p>
            {totalCatalog} productos de ejemplo con precios y envíos realistas para que explores el flujo completo. <span className="font-medium">Ningún
            usuario necesita pegar claves</span>: en cuanto el operador guarde las de la plataforma (CJ y AliExpress), este escaparate se llenará solo
            con productos reales.
          </p>
          {isAdmin && (
            <p className="mt-1">
              <Link className="underline" href="/admin">
                Administración → Claves de proveedor
              </Link>{' '}
              · ahora mismo: {configured.length === 0 ? 'sin claves configuradas' : `${configured.map((c) => c.name).join(', ')} configuradas`}.
            </p>
          )}
        </Alert>
      ) : (
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
          <Badge variant="success">
            <Sparkles className="size-3" /> Catálogo real
          </Badge>
          <span>
            {formatNumber(stats.real)} productos servidos por la plataforma
            {initial.providers.filter((p) => p.hasReal).length > 0 && ` · ${initial.providers.filter((p) => p.hasReal).map((p) => PROVIDER_LABEL[p.provider] ?? p.provider).join(', ')}`}
          </span>
          {stats.lastSyncedAt && <span>· actualizado {formatRelative(stats.lastSyncedAt as any)}</span>}
        </div>
      )}

      {/* Categorías visuales */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Compass className="size-4 text-indigo-300" /> Explora por categoría
          </h2>
          {category && (
            <button type="button" onClick={() => setCategory('')} className="text-[11px] text-muted-foreground hover:text-foreground">
              Ver todas
            </button>
          )}
        </div>
        <div className="flex gap-3 overflow-x-auto pb-2">
          <button
            type="button"
            onClick={() => { setCategory(''); setPage(1); }}
            className={cn(
              'flex w-[132px] shrink-0 flex-col gap-2 rounded-xl border p-2 text-left transition',
              !category ? 'border-indigo-400/40 bg-indigo-500/[0.08]' : 'border-white/[0.07] bg-white/[0.02] hover:border-white/20',
            )}
          >
            <span className="grid h-[72px] place-items-center rounded-lg bg-gradient-to-br from-indigo-500/20 to-sky-500/10">
              <Package className="size-6 text-indigo-300" />
            </span>
            <span className="text-[12px] font-medium leading-tight">Todo el catálogo</span>
            <span className="text-[10px] text-muted-foreground">{formatNumber(totalCatalog)} productos</span>
          </button>

          {facets.map((f) => (
            <button
              key={f.slug}
              type="button"
              onClick={() => { setCategory(f.name === category ? '' : f.name); setPage(1); }}
              className={cn(
                'flex w-[132px] shrink-0 flex-col gap-2 rounded-xl border p-2 text-left transition',
                category === f.name ? 'border-indigo-400/40 bg-indigo-500/[0.08]' : 'border-white/[0.07] bg-white/[0.02] hover:border-white/20',
              )}
            >
              <span className="h-[72px] overflow-hidden rounded-lg bg-black/30">
                {f.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={imageSrc(f.imageUrl)} alt={f.name} className="size-full object-cover" loading="lazy" />
                ) : (
                  <span className="grid size-full place-items-center text-[10px] text-muted-foreground">Sin imagen</span>
                )}
              </span>
              <span className="line-clamp-2 text-[12px] font-medium leading-tight">{f.name}</span>
              <span className="text-[10px] text-muted-foreground">{formatNumber(f.count)} productos</span>
            </button>
          ))}
        </div>
      </section>

      {/* Buscador + orden */}
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div data-tour="catalog:search" className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(1); }}
            placeholder="Busca por producto, categoría o etiqueta (ej. «auriculares», «mascotas», «led»)…"
            className="pl-9 pr-9"
          />
          {q && (
            <button type="button" onClick={() => setQ('')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground">
              <X className="size-3.5" />
            </button>
          )}
          {suggestions.length > 0 && q.trim().length >= 2 && (
            <div className="absolute left-0 right-0 top-[44px] z-30 overflow-hidden rounded-xl border border-white/10 bg-[#0d1016] shadow-2xl">
              {suggestions.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => { setQ(s.title); setSuggestions([]); setPage(1); }}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-white/[0.05]"
                >
                  <span className="size-8 overflow-hidden rounded bg-black/40">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {s.imageUrl && <img src={imageSrc(s.imageUrl)} alt="" className="size-full object-cover" />}
                  </span>
                  <span className="flex-1 truncate text-[12px]">{s.title}</span>
                  <span className="text-[11px] tabular-nums text-muted-foreground">{formatCurrency(s.costPrice)}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button variant={showFilters ? 'secondary' : 'outline'} size="sm" onClick={() => setShowFilters((v) => !v)}>
            <SlidersHorizontal className="size-4" /> Filtros {activeFilters.length > 0 && <span className="ml-1 rounded bg-indigo-500/20 px-1 text-[10px] text-indigo-200">{activeFilters.length}</span>}
          </Button>
          <Select value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }} className="w-[190px]">
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {/* Filtros activos */}
      {activeFilters.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {activeFilters.map((f) => (
            <button
              key={f.label}
              type="button"
              onClick={f.clear}
              className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] hover:border-white/25"
            >
              {f.label} <X className="size-3" />
            </button>
          ))}
          <button type="button" onClick={reset} className="text-[11px] text-muted-foreground hover:text-foreground">
            Limpiar todo
          </button>
        </div>
      )}

      {/* Panel de filtros */}
      {showFilters && (
        <div className="grid gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Proveedor</label>
            <div className="flex flex-wrap gap-2">
              {opcionesProveedor.map((c) => {
                const activo = provider.includes(c.provider);
                return (
                  <button
                    key={c.provider}
                    type="button"
                    aria-pressed={activo}
                    onClick={() => {
                      setProvider((antes) => (antes.includes(c.provider) ? antes.filter((x) => x !== c.provider) : [...antes, c.provider]));
                      setPage(1);
                    }}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-medium transition-colors',
                      activo ? 'border-indigo-400/60 bg-indigo-500/20 text-indigo-100' : 'border-white/10 bg-white/[0.03] text-muted-foreground hover:bg-white/[0.07]',
                    )}
                  >
                    <span className={cn('grid size-3.5 place-items-center rounded-[4px] border text-[9px]', activo ? 'border-indigo-300 bg-indigo-400 text-black' : 'border-white/30')}>{activo ? '✓' : ''}</span>
                    {PROVIDER_LABEL[c.provider] ?? c.provider}
                    {c.count !== null && <span className="text-[10.5px] opacity-70">({formatNumber(c.count)})</span>}
                  </button>
                );
              })}
            </div>
            <p className="text-[10.5px] text-muted-foreground">{provider.length === 0 ? 'Mostrando todos los proveedores. Marca uno o varios para filtrar.' : 'Pulsa de nuevo para quitar el filtro.'}</p>
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Almacén de salida</label>
            <Select value={shipFrom} onChange={(e) => { setShipFrom(e.target.value); setPage(1); }}>
              <option value="">Cualquiera</option>
              {shipFromOptions.map((c) => (
                <option key={c} value={c}>
                  {nombreAlmacen(c)}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Precio de coste (€)</label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                inputMode="decimal"
                placeholder={String(Math.floor(initial.priceRange.min) || 0)}
                value={minPrice}
                onChange={(e) => { setMinPrice(e.target.value); setPage(1); }}
              />
              <span className="text-muted-foreground">—</span>
              <Input
                type="number"
                inputMode="decimal"
                placeholder={String(Math.ceil(initial.priceRange.max) || 100)}
                value={maxPrice}
                onChange={(e) => { setMaxPrice(e.target.value); setPage(1); }}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Valoración mínima</label>
            <Select value={minRating} onChange={(e) => { setMinRating(e.target.value); setPage(1); }}>
              <option value="">Cualquiera</option>
              <option value="4">4★ o más</option>
              <option value="4.5">4,5★ o más</option>
              <option value="4.8">4,8★ o más</option>
            </Select>
          </div>
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-4">
            <label className="inline-flex cursor-pointer items-center gap-2 text-[12px]">
              <input type="checkbox" checked={freeShipping} onChange={(e) => { setFreeShipping(e.target.checked); setPage(1); }} className="size-3.5 accent-indigo-500" />
              <Truck className="size-3.5 text-indigo-300" /> Sólo envío gratis
            </label>
            <label className="inline-flex cursor-pointer items-center gap-2 text-[12px]">
              <input type="checkbox" checked={trending} onChange={(e) => { setTrending(e.target.checked); setPage(1); }} className="size-3.5 accent-indigo-500" />
              <Flame className="size-3.5 text-orange-300" /> Sólo tendencias
            </label>
            <span className="text-[11px] text-muted-foreground">
              Los precios de venta y el beneficio se calculan con tu regla «{ruleName}» (configúrala en <Link className="underline" href="/pricing">Precios y márgenes</Link>).
            </span>
          </div>
        </div>
      )}

      {/* Resultados */}
      <div className="flex items-center justify-between text-[12px] text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          {loading && <Loader2 className="size-3.5 animate-spin text-indigo-300" />}
          {formatNumber(meta.total)} productos {category ? `en «${category}»` : ''} · página {meta.page} de {meta.pages}
        </span>
        <span className="inline-flex items-center gap-2">
          <ArrowDownUp className="size-3.5" />
          {SORTS.find((s) => s.value === sort)?.label}
        </span>
      </div>

      {items.length === 0 && !loading ? (
        <div className="grid place-items-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.02] py-16 text-center">
          <Frown className="size-6 text-muted-foreground" />
          <p className="text-sm font-medium">Ningún producto cumple esos filtros</p>
          <p className="max-w-md text-[12px] text-muted-foreground">
            Prueba a quitar algún filtro o busca otra palabra. Si el catálogo está vacío y eres el operador, lanza una descarga desde{' '}
            <Link className="underline" href="/admin">Administración → Claves de proveedor</Link>.
          </p>
          <Button variant="outline" size="sm" onClick={reset}>
            Limpiar filtros
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2.5 sm:gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
          {items.map((item) => (
            <CatalogCard key={item.id} item={{ ...item, imageUrl: imageSrc(item.imageUrl), images: (item.images ?? []).map(imageSrc) }} onOpen={(i) => setOpenId(i.id)} onImport={(i) => setOpenId(i.id)} />
          ))}
        </div>
      )}

      {/* Paginación */}
      {meta.pages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" disabled={meta.page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            Anterior
          </Button>
          <span className="px-2 text-[12px] text-muted-foreground">
            {meta.page} / {meta.pages}
          </span>
          <Button variant="outline" size="sm" disabled={meta.page >= meta.pages} onClick={() => setPage((p) => Math.min(meta.pages, p + 1))}>
            Siguiente
          </Button>
        </div>
      )}

      {/* Pie con información honesta del origen de los datos */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3 text-[11px] text-muted-foreground">
        <Info className="size-3.5 text-indigo-300" />
        <span>
          Índice propio de la plataforma: {formatNumber(stats.total)} artículos ({formatNumber(stats.real)} reales · {formatNumber(stats.sample)} de muestra) ·
          envío gratis {formatNumber(stats.freeShipping)} · tendencias {formatNumber(stats.trending)}
        </span>
        {stats.lastSyncedAt && (
          <span className="inline-flex items-center gap-1">
            <RefreshCw className="size-3" /> última descarga del proveedor {formatRelative(stats.lastSyncedAt as any)}
          </span>
        )}
        <Link href="/import" className="ml-auto underline">
          ¿Tienes la URL de otro producto? Importar por URL
        </Link>
      </div>

      {real ? (
        <FichaProveedor itemId={openId} onClose={() => setOpenId(null)} />
      ) : (
        <CatalogImportDrawer
          itemId={openId}
          onClose={() => setOpenId(null)}
          onImported={(info) => {
            setToast(`«${info.title}» importado a ${info.store}. El worker lo vigilará automáticamente.`);
            void fetchItems(buildQuery());
          }}
        />
      )}

      {toast && (
        <div className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2">
          <div className="flex items-center gap-3 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-2.5 text-[12px] text-emerald-100 shadow-2xl backdrop-blur">
            <Sparkles className="size-4 text-emerald-300" />
            {toast}
            <button type="button" onClick={() => setToast(null)} className="rounded p-0.5 hover:bg-white/10">
              <X className="size-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default CatalogBrowser;
