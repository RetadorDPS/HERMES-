'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Boxes,
  ExternalLink,
  Filter,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Search,
  Sparkles,
  Star,
  Trash2,
} from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Switch } from '@/components/ui/primitives';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ProductListItem } from '@/lib/data';
import { cn, formatCurrency, formatNumber, formatRelative, truncate } from '@/lib/utils';

interface Filters {
  search: string;
  status: string;
  storeId: string;
  sort: string;
  problems: boolean;
}

export function ProductTable({
  items,
  total,
  page,
  pages,
  stores,
  filters,
}: {
  items: ProductListItem[];
  total: number;
  page: number;
  pages: number;
  stores: { id: string; name: string }[];
  filters: Filters;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<string[]>([]);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [message, setMessage] = useState<{ variant: 'success' | 'danger' | 'info'; text: string } | null>(null);

  const allSelected = items.length > 0 && selected.length === items.length;
  const localFilters = useMemo<Filters>(() => filters, [filters]);

  const pushQuery = (patch: Partial<Filters & { page: number }>) => {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(patch).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '' || value === false) params.delete(key);
      else params.set(key, String(value));
    });
    if (!('page' in patch)) params.set('page', '1');
    startTransition(() => router.push(`/products?${params.toString()}`));
  };

  const runBulk = async (action: 'sync' | 'monitor-on' | 'monitor-off' | 'pause' | 'activate' | 'delete') => {
    if (!selected.length) return;
    if (action === 'delete' && !confirm(`¿Borrar ${selected.length} producto(s) del panel? Los publicados en la tienda NO se eliminan.`)) return;
    setBusyAction(action);
    setMessage(null);
    try {
      const res = await fetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, productIds: selected }),
      });
      const json = await res.json();
      setMessage({
        variant: json.ok ? 'success' : 'danger',
        text: json.ok
          ? `Acción "${action}" aplicada a ${selected.length} producto(s).`
          : `Falló en ${json.summary?.failed ?? 0} producto(s): ${json.results?.find((r: any) => !r.ok)?.detail ?? ''}`,
      });
      setSelected([]);
      router.refresh();
    } catch (err) {
      setMessage({ variant: 'danger', text: (err as Error).message });
    } finally {
      setBusyAction(null);
    }
  };

  const syncOne = async (id: string) => {
    setBusyAction(id);
    try {
      const res = await fetch(`/api/products/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sync', priority: 1 }),
      });
      const json = await res.json();
      setMessage({ variant: json.ok ? 'success' : 'danger', text: json.message ?? (json.ok ? 'Job de sincronización encolado.' : json.error) });
      setTimeout(() => router.refresh(), 1200);
    } finally {
      setBusyAction(null);
    }
  };

  const toggleMonitor = async (id: string, value: boolean) => {
    await fetch(`/api/products/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isMonitored: value }),
    });
    router.refresh();
  };

  return (
    <div className="space-y-3">
      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            defaultValue={localFilters.search}
            placeholder="Buscar por título, SKU o categoría…"
            className="pl-9"
            onKeyDown={(e) => {
              if (e.key === 'Enter') pushQuery({ search: (e.target as HTMLInputElement).value });
            }}
          />
        </div>
        <Select value={localFilters.status} onChange={(e) => pushQuery({ status: e.target.value })} className="w-[150px]">
          <option value="ALL">Todos los estados</option>
          <option value="ACTIVE">Activos</option>
          <option value="DRAFT">Borradores</option>
          <option value="OUT_OF_STOCK">Agotados</option>
          <option value="PAUSED">Pausados</option>
          <option value="ERROR">Con error</option>
        </Select>
        <Select value={localFilters.storeId} onChange={(e) => pushQuery({ storeId: e.target.value })} className="w-[170px]">
          <option value="">Todas las tiendas</option>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
        <Select value={localFilters.sort} onChange={(e) => pushQuery({ sort: e.target.value })} className="w-[168px]">
          <option value="recent">Sync más reciente</option>
          <option value="profit">Mayor beneficio</option>
          <option value="stock">Menor stock</option>
          <option value="price">Mayor precio</option>
          <option value="title">Título A-Z</option>
        </Select>
        <Button
          variant={localFilters.problems ? 'default' : 'outline'}
          size="sm"
          onClick={() => pushQuery({ problems: !localFilters.problems })}
          className="h-9"
        >
          <Filter className="size-3.5" />
          Sólo problemas
        </Button>
      </div>

      {/* Acciones masivas */}
      {selected.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-indigo-500/25 bg-indigo-500/[0.06] px-3 py-2 animate-in-up">
          <span className="text-[12px] font-medium text-indigo-200">{selected.length} seleccionado(s)</span>
          <Button size="sm" variant="gradient" onClick={() => runBulk('sync')} disabled={busyAction !== null}>
            {busyAction === 'sync' ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            Sincronizar ahora
          </Button>
          <Button size="sm" variant="outline" onClick={() => runBulk('monitor-on')} disabled={busyAction !== null}>
            <Play className="size-3.5" />
            Monitorizar
          </Button>
          <Button size="sm" variant="outline" onClick={() => runBulk('monitor-off')} disabled={busyAction !== null}>
            <Pause className="size-3.5" />
            Dejar de monitorizar
          </Button>
          <Button size="sm" variant="outline" onClick={() => runBulk('pause')} disabled={busyAction !== null}>
            Pausar en tienda
          </Button>
          <Button size="sm" variant="outline" onClick={() => runBulk('activate')} disabled={busyAction !== null}>
            Reactivar
          </Button>
          <Button size="sm" variant="ghost" className="text-rose-400 hover:bg-rose-500/10" onClick={() => runBulk('delete')} disabled={busyAction !== null}>
            <Trash2 className="size-3.5" />
            Borrar
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
            Limpiar selección
          </Button>
        </div>
      )}

      {message && (
        <Alert variant={message.variant} onDismiss={() => setMessage(null)}>
          {message.text}
        </Alert>
      )}

      {/* Tabla */}
      <div className="glass-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-9">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={(e) => setSelected(e.target.checked ? items.map((i) => i.id) : [])}
                  className="size-3.5 accent-indigo-500"
                  aria-label="Seleccionar todos"
                />
              </TableHead>
              <TableHead>Producto</TableHead>
              <TableHead className="text-right">Coste</TableHead>
              <TableHead className="text-right">Venta</TableHead>
              <TableHead className="text-right">Beneficio</TableHead>
              <TableHead className="text-right">Stock</TableHead>
              <TableHead>Última sync</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="w-[150px] text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((p) => (
              <TableRow key={p.id} className={cn(selected.includes(p.id) && 'bg-indigo-500/[0.05]')}>
                <TableCell>
                  <input
                    type="checkbox"
                    checked={selected.includes(p.id)}
                    onChange={(e) => setSelected((prev) => (e.target.checked ? [...prev, p.id] : prev.filter((x) => x !== p.id)))}
                    className="size-3.5 accent-indigo-500"
                    aria-label={`Seleccionar ${p.title}`}
                  />
                </TableCell>
                <TableCell className="max-w-[380px]">
                  <div className="flex items-center gap-2.5">
                    {p.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.image} alt="" className="size-9 shrink-0 rounded-md object-cover" loading="lazy" />
                    ) : (
                      <span className="grid size-9 shrink-0 place-items-center rounded-md bg-white/[0.06]">
                        <Boxes className="size-4 text-muted-foreground" />
                      </span>
                    )}
                    <div className="min-w-0">
                      <Link href={`/products/${p.id}`} className="block truncate text-[13px] font-medium hover:text-indigo-300">
                        {truncate(p.title, 62)}
                      </Link>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {p.supplierName} · {p.storeName} · {p.variantsCount} var. · ⭐ {p.ratingAvg.toFixed(1)} ·{' '}
                        {formatNumber(p.ordersCount)} vendidos
                      </p>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-right text-[12px] tabular-nums text-muted-foreground">{formatCurrency(p.costPrice, 'USD')}</TableCell>
                <TableCell className="text-right text-[13px] font-medium tabular-nums">{formatCurrency(p.sellingPrice)}</TableCell>
                <TableCell className="text-right">
                  <span className="text-[13px] font-semibold tabular-nums text-emerald-400">+{formatCurrency(p.profitAmount)}</span>
                  <span className="block text-[10px] text-muted-foreground">{p.marginPct.toFixed(0)}% margen</span>
                </TableCell>
                <TableCell className="text-right">
                  <span
                    className={cn(
                      'text-[13px] font-medium tabular-nums',
                      p.stockTotal === 0 ? 'text-rose-400' : p.stockTotal < 30 ? 'text-amber-400' : 'text-emerald-400',
                    )}
                  >
                    {formatNumber(p.stockTotal)}
                  </span>
                </TableCell>
                <TableCell>
                  <p className="text-[12px]">{formatRelative(p.lastSyncedAt)}</p>
                  <p className="text-[10px] text-muted-foreground">próxima {formatRelative(p.nextSyncAt)}</p>
                </TableCell>
                <TableCell>
                  <div className="flex flex-col items-start gap-1">
                    <StatusBadge status={p.status} />
                    {p.lastSyncStatus && <StatusBadge status={p.lastSyncStatus} />}
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Switch
                      checked={p.isMonitored}
                      onCheckedChange={(v) => toggleMonitor(p.id, v)}
                      aria-label="Monitorizar 24/7"
                      title={p.isMonitored ? 'Monitorización 24/7 activa' : 'Monitorización desactivada'}
                    />
                    <Button variant="ghost" size="icon" onClick={() => syncOne(p.id)} disabled={busyAction === p.id} title="Sincronizar ahora">
                      {busyAction === p.id ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                    </Button>
                    <Button variant="ghost" size="icon" asChild title="Abrir producto en el proveedor">
                      <a href={p.id ? '/products/' + p.id : '#'} target="_self">
                        <ExternalLink className="size-3.5" />
                      </a>
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {items.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="py-12 text-center">
                  <Sparkles className="mx-auto mb-2 size-6 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Sin productos que mostrar con estos filtros.</p>
                  <Button asChild variant="gradient" size="sm" className="mt-3">
                    <Link href="/import">Importar el primer producto</Link>
                  </Button>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Paginación */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-muted-foreground">
        <span>
          {formatNumber(total)} producto(s) · página {page} de {pages}
          {pending && <Loader2 className="ml-2 inline size-3 animate-spin" />}
        </span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => pushQuery({ page: page - 1 })}>
            Anterior
          </Button>
          <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => pushQuery({ page: page + 1 })}>
            Siguiente
          </Button>
        </div>
      </div>

      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Star className="size-3 text-amber-400" />
        El worker 24/7 revisa cada producto monitorizado cada hora: si cambia el coste recalcula el precio; si el stock llega a 0 lo despublica
        automáticamente.
      </p>
      <Badge variant="outline" className="w-fit">
        Los cambios de estado tardan hasta 60 s en reflejarse (intervalo del worker)
      </Badge>
    </div>
  );
}
