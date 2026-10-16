'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Copy, ExternalLink, Loader2, Package, Send, Truck } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn, formatCurrency, formatNumber, formatRelative, truncate } from '@/lib/utils';

interface OrderRow {
  id: string;
  number: string;
  storeName: string;
  status: string;
  fulfillmentStatus: string;
  customerName: string;
  shippingCity: string;
  shippingCountry: string;
  total: number;
  supplierCost: number;
  profitAmount: number;
  currency: string;
  trackingNumber: string | null;
  trackingCompany: string | null;
  trackingUrl: string | null;
  supplierOrderId: string | null;
  autoFulfilled: boolean;
  errorMessage: string | null;
  orderedAt: Date | string;
  items: { title: string; sku: string; quantity: number; unitPrice: number; imageUrl?: string | null }[];
}

export function OrdersTable({
  orders,
  summary,
}: {
  orders: OrderRow[];
  summary: { total: number; pending: number; toFulfill: number; shipped: number; errors: number; revenue: number; profit: number };
}) {
  const router = useRouter();
  const [status, setStatus] = useState('ALL');
  const [fulfillment, setFulfillment] = useState('ALL');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ variant: 'success' | 'danger' | 'info'; text: string } | null>(null);

  const filtered = orders.filter((o) => {
    if (status !== 'ALL' && o.status !== status) return false;
    if (fulfillment !== 'ALL' && o.fulfillmentStatus !== fulfillment) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        o.number.toLowerCase().includes(q) ||
        o.customerName.toLowerCase().includes(q) ||
        (o.trackingNumber ?? '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  const action = async (orderId: string, kind: 'push-to-supplier' | 'tracking' | 'mark-delivered') => {
    setBusy(orderId);
    setMsg(null);
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: kind, orderId }),
      });
      const json = await res.json();
      setMsg({
        variant: json.ok ? 'success' : 'danger',
        text:
          json.message ??
          (kind === 'push-to-supplier'
            ? 'Pedido encolado: el worker lo enviará al proveedor y registrará el número de orden.'
            : 'Acción aplicada.'),
      });
      router.refresh();
    } catch (err) {
      setMsg({ variant: 'danger', text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const copyTracking = (t: string) => {
    void navigator.clipboard.writeText(t);
    setMsg({ variant: 'info', text: `Tracking ${t} copiado al portapapeles` });
  };

  return (
    <div className="space-y-3">
      {/* Resumen */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        {[
          { label: 'Pedidos totales', value: formatNumber(summary.total), tone: '' },
          { label: 'Pendientes de enviar', value: formatNumber(summary.pending), tone: 'text-amber-400' },
          { label: 'Sin preparar', value: formatNumber(summary.toFulfill), tone: 'text-rose-400' },
          { label: 'Enviados con tracking', value: formatNumber(summary.shipped), tone: 'text-emerald-400' },
          { label: 'Beneficio acumulado', value: formatCurrency(summary.profit), tone: 'text-emerald-400' },
        ].map((k) => (
          <div key={k.label} className="glass-card p-4">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{k.label}</p>
            <p className={cn('mt-1 text-xl font-semibold tabular-nums', k.tone)}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-2">
        <Input placeholder="Buscar por nº de pedido, cliente o tracking…" value={search} onChange={(e) => setSearch(e.target.value)} className="min-w-[240px] flex-1" />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-[200px]">
          <option value="ALL">Todos los estados</option>
          {['PENDING', 'PAID', 'SUPPLIER_PURCHASED', 'SUPPLIER_ERROR', 'SHIPPED', 'DELIVERED', 'CANCELED', 'REFUNDED'].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <Select value={fulfillment} onChange={(e) => setFulfillment(e.target.value)} className="w-[190px]">
          <option value="ALL">Todo el fulfillment</option>
          <option value="UNFULFILLED">Sin preparar</option>
          <option value="FULFILLED">Con tracking</option>
        </Select>
      </div>

      {msg && (
        <Alert variant={msg.variant} onDismiss={() => setMsg(null)}>
          {msg.text}
        </Alert>
      )}

      {/* Móvil: una tarjeta por pedido */}
      <div className="space-y-2 md:hidden">
        {filtered.map((o) => (
          <div key={o.id} className="glass-card p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[14px] font-semibold">{o.number}</p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {o.storeName} · {formatRelative(o.orderedAt as any)}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <StatusBadge status={o.status} />
                <StatusBadge status={o.fulfillmentStatus} />
              </div>
            </div>
            <p className="mt-2 text-[12px]">
              {o.customerName} <span className="text-muted-foreground">· {o.shippingCity}, {o.shippingCountry}</span>
            </p>
            <div className="mt-2 space-y-1">
              {o.items.map((it, i) => (
                <div key={i} className="flex items-center gap-2">
                  {it.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={it.imageUrl} alt="" className="size-8 shrink-0 rounded object-cover" loading="lazy" />
                  )}
                  <span className="line-clamp-2 text-[12px]">
                    {it.quantity}× {it.title}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 border-t border-white/[0.06] pt-3 text-center">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Total</p>
                <p className="text-[13px] font-medium tabular-nums">{formatCurrency(o.total, o.currency)}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Coste prov.</p>
                <p className="text-[12px] tabular-nums text-muted-foreground">{formatCurrency(o.supplierCost, o.currency)}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Beneficio</p>
                <p className="text-[13px] font-semibold tabular-nums text-emerald-400">+{formatCurrency(o.profitAmount, o.currency)}</p>
              </div>
            </div>
            {o.errorMessage && <p className="mt-2 text-[11px] leading-tight text-rose-400">{o.errorMessage}</p>}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] pt-3">
              {o.trackingNumber ? (
                <div className="min-w-0">
                  <p className="truncate font-mono text-[11px]">{o.trackingNumber}</p>
                  <p className="text-[10px] text-muted-foreground">{o.trackingCompany}</p>
                </div>
              ) : (
                <Badge variant="outline">{o.status === 'PENDING' ? 'pendiente de compra' : 'sin tracking'}</Badge>
              )}
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => action(o.id, 'push-to-supplier')}
                  disabled={busy === o.id || ['SHIPPED', 'DELIVERED'].includes(o.status)}
                >
                  {busy === o.id ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                  Comprar
                </Button>
                <Button variant="ghost" size="icon" onClick={() => action(o.id, 'tracking')} disabled={busy === o.id} title="Sincronizar tracking">
                  <Truck className="size-4" />
                </Button>
              </div>
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="glass-card py-10 text-center text-sm text-muted-foreground">
            <Package className="mx-auto mb-2 size-6" />
            No hay pedidos que coincidan con los filtros.
          </div>
        )}
      </div>

      {/* Escritorio: tabla */}
      <div className="glass-card hidden overflow-hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Pedido</TableHead>
              <TableHead>Cliente / destino</TableHead>
              <TableHead>Artículos</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Coste prov.</TableHead>
              <TableHead className="text-right">Beneficio</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Tracking</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((o) => (
              <TableRow key={o.id}>
                <TableCell>
                  <p className="text-[13px] font-medium">{o.number}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {o.storeName} · {formatRelative(o.orderedAt as any)}
                  </p>
                </TableCell>
                <TableCell>
                  <p className="text-[12px]">{o.customerName}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {o.shippingCity}, {o.shippingCountry}
                  </p>
                </TableCell>
                <TableCell className="max-w-[260px]">
                  {o.items.map((it, i) => (
                    <div key={i} className="flex items-center gap-2">
                      {it.imageUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={it.imageUrl} alt="" className="size-6 rounded object-cover" loading="lazy" />
                      )}
                      <span className="truncate text-[12px]">
                        {it.quantity}× {truncate(it.title, 34)}
                      </span>
                    </div>
                  ))}
                  {o.supplierOrderId && <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">orden proveedor {o.supplierOrderId}</p>}
                </TableCell>
                <TableCell className="text-right text-[13px] font-medium tabular-nums">{formatCurrency(o.total, o.currency)}</TableCell>
                <TableCell className="text-right text-[12px] tabular-nums text-muted-foreground">{formatCurrency(o.supplierCost, o.currency)}</TableCell>
                <TableCell className="text-right text-[13px] font-semibold tabular-nums text-emerald-400">+{formatCurrency(o.profitAmount, o.currency)}</TableCell>
                <TableCell>
                  <div className="flex flex-col items-start gap-1">
                    <StatusBadge status={o.status} />
                    <StatusBadge status={o.fulfillmentStatus} />
                  </div>
                  {o.errorMessage && <p className="mt-1 max-w-[200px] text-[10px] leading-tight text-rose-400">{o.errorMessage}</p>}
                </TableCell>
                <TableCell>
                  {o.trackingNumber ? (
                    <div className="space-y-0.5">
                      <p className="font-mono text-[11px]">{o.trackingNumber}</p>
                      <p className="text-[10px] text-muted-foreground">{o.trackingCompany}</p>
                      <div className="flex gap-1">
                        <button onClick={() => copyTracking(o.trackingNumber!)} className="text-[10px] text-indigo-300 hover:underline">
                          <Copy className="inline size-3" /> copiar
                        </button>
                        {o.trackingUrl && (
                          <a href={o.trackingUrl} target="_blank" rel="noreferrer" className="text-[10px] text-indigo-300 hover:underline">
                            <ExternalLink className="inline size-3" /> seguir
                          </a>
                        )}
                      </div>
                    </div>
                  ) : (
                    <Badge variant="outline">{o.status === 'PENDING' ? 'pendiente de compra' : 'sin tracking'}</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => action(o.id, 'push-to-supplier')}
                      disabled={busy === o.id || ['SHIPPED', 'DELIVERED'].includes(o.status)}
                      title="Enviar al proveedor"
                    >
                      {busy === o.id ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                      Comprar
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => action(o.id, 'tracking')} disabled={busy === o.id} title="Sincronizar tracking">
                      <Truck className="size-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="py-12 text-center text-sm text-muted-foreground">
                  <Package className="mx-auto mb-2 size-6" />
                  No hay pedidos que coincidan con los filtros.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Check className="size-3 text-emerald-400" />
        Flujo automático: webhook de la tienda → pedido en el panel → envío al proveedor → tracking subido a la tienda y aviso al cliente.
      </p>
    </div>
  );
}
