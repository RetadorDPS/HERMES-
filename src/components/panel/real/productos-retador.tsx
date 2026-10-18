'use client';

/**
 * Productos que el usuario tiene publicados en Retador: estado, precio, stock (verificado o estimado) y beneficio neto
 * estimado, con edición de precio y stock, pausa y reactivación. Todo pasa por la función `retador-tienda`, que
 * rechaza cualquier precio con el que se pierda dinero.
 */
import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Loader2, Pause, Pencil, Play, TriangleAlert } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { llamarTienda, obtenerProductosRetador, type ProductoRetador, type TiendaRetador } from '@/lib/real/retador';
import { liquidacion } from '@/lib/retador/precios';
import { cn } from '@/lib/utils';

const usd = (n: number) => `${n.toFixed(2)} US$`;

const ESTADOS: Record<string, { texto: string; variante: 'success' | 'warning' | 'danger' | 'outline' }> = {
  ACTIVE: { texto: 'Activo', variante: 'success' },
  PAUSED: { texto: 'Pausado', variante: 'warning' },
  OUT_OF_STOCK: { texto: 'Agotado', variante: 'danger' },
  ERROR: { texto: 'Con error', variante: 'danger' },
  DRAFT: { texto: 'Publicando…', variante: 'outline' },
  ARCHIVED: { texto: 'Archivado', variante: 'outline' },
};

const hace = (f: Date | null) => {
  if (!f) return 'nunca';
  const min = Math.round((Date.now() - f.getTime()) / 60000);
  if (min < 1) return 'ahora mismo';
  if (min < 60) return `hace ${min} min`;
  if (min < 1440) return `hace ${Math.round(min / 60)} h`;
  return `hace ${Math.round(min / 1440)} días`;
};

export function ProductosRetador({ tienda }: { tienda: TiendaRetador }) {
  const [productos, setProductos] = useState<ProductoRetador[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      setProductos(await obtenerProductosRetador(tienda.id));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [tienda.id]);

  useEffect(() => {
    void cargar();
  }, [cargar, tienda.publicados]);

  async function accion(id: string, etiqueta: string, cuerpo: Record<string, unknown>, ok: string) {
    setOcupado(`${id}:${etiqueta}`);
    setError(null);
    setAviso(null);
    try {
      await llamarTienda({ productId: id, ...cuerpo });
      await cargar();
      setAviso(ok);
      setEditando(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(null);
    }
  }

  if (!productos) {
    return error ? <Alert variant="danger">{error}</Alert> : null;
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Productos en Retador</CardTitle>
        <CardDescription>
          {productos.length ? `${productos.length} publicados desde DropshipPilot. El neto es una estimación con las tarifas de Retador.` : 'Todavía no has publicado ninguno. Ábrelos desde el catálogo con «Publicar en Retador».'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && <Alert variant="danger">{error}</Alert>}
        {aviso && <Alert variant="success">{aviso}</Alert>}
        {productos.map((p) => {
          const e = ESTADOS[p.status] ?? ESTADOS.ACTIVE;
          const precios = p.variantes.map((v) => v.sellingPrice);
          const minimo = precios.length ? Math.min(...precios) : 0;
          const maximo = precios.length ? Math.max(...precios) : 0;
          const hayEstimado = p.variantes.some((v) => v.stockVerificado === false);
          return (
            <div key={p.id} className="space-y-2 rounded-lg border border-white/10 bg-white/[0.02] p-3">
              <div className="flex gap-3">
                {p.foto ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.foto} alt="" className="size-14 shrink-0 rounded-md object-cover" />
                ) : (
                  <div className="size-14 shrink-0 rounded-md bg-white/5" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-[13px] font-medium">{p.title}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Badge variant={e.variante}>{e.texto}</Badge>
                    {p.moderacion === 'pending' && <Badge variant="warning">En revisión</Badge>}
                    {p.moderacion === 'rejected' && <Badge variant="danger">Rechazado por Retador</Badge>}
                    <span className="text-[12px] text-muted-foreground">
                      {p.variantes.length} {p.variantes.length === 1 ? 'variante' : 'variantes'} · {minimo === maximo ? usd(minimo) : `${usd(minimo)} – ${usd(maximo)}`} · stock {p.stockTotal}
                      {hayEstimado ? ' (estimado)' : ''}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    Sincronizado {hace(p.lastSyncedAt)}
                    {p.vendidos != null ? ` · ${p.vendidos} vendidos` : ''}
                  </p>
                </div>
              </div>

              {(p.cambiadoEnRetador || p.lastSyncStatus === 'FAILED') && (
                <p className="flex items-start gap-1.5 text-[12px] text-amber-300">
                  <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                  {p.lastSyncStatus === 'FAILED' ? `La última sincronización falló: ${p.lastSyncError ?? 'sin detalle'}` : 'Lo cambiaste a mano en Retador. Revisa precio y stock antes de editarlo desde aquí.'}
                </p>
              )}

              {editando === p.id ? (
                <EditorProducto
                  producto={p}
                  tienda={tienda}
                  guardando={ocupado === `${p.id}:guardar`}
                  alCancelar={() => setEditando(null)}
                  alGuardar={(variantes) => accion(p.id, 'guardar', { accion: 'actualizar', variantes }, 'Cambios guardados en Retador.')}
                />
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" disabled={!!ocupado} onClick={() => setEditando(p.id)}>
                    <Pencil /> Precio y stock
                  </Button>
                  {p.status === 'PAUSED' ? (
                    <Button size="sm" variant="outline" disabled={!!ocupado} onClick={() => accion(p.id, 'reactivar', { accion: 'actualizar', estado: 'activo' }, 'Producto reactivado en Retador.')}>
                      {ocupado === `${p.id}:reactivar` ? <Loader2 className="animate-spin" /> : <Play />} Reactivar
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" disabled={!!ocupado} onClick={() => accion(p.id, 'retirar', { accion: 'retirar' }, 'Producto retirado de la venta (pausado) en Retador.')}>
                      {ocupado === `${p.id}:retirar` ? <Loader2 className="animate-spin" /> : <Pause />} Pausar
                    </Button>
                  )}
                  {p.url && (
                    <Button size="sm" variant="ghost" asChild>
                      <a href={p.url} target="_blank" rel="noopener noreferrer">
                        <ExternalLink /> Ver en Retador
                      </a>
                    </Button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function EditorProducto({
  producto,
  tienda,
  guardando,
  alCancelar,
  alGuardar,
}: {
  producto: ProductoRetador;
  tienda: TiendaRetador;
  guardando: boolean;
  alCancelar: () => void;
  alGuardar: (v: { sku: string; precioVentaUsd?: number; stock?: number }[]) => void;
}) {
  const [precios, setPrecios] = useState<Record<string, string>>(() => Object.fromEntries(producto.variantes.map((v) => [v.sku, v.sellingPrice.toFixed(2)])));
  const [stocks, setStocks] = useState<Record<string, string>>(() => Object.fromEntries(producto.variantes.map((v) => [v.sku, String(v.stock)])));

  const cambios = producto.variantes
    .map((v) => {
      const precio = Number(precios[v.sku]);
      const stock = Number(stocks[v.sku]);
      const c: { sku: string; precioVentaUsd?: number; stock?: number } = { sku: v.sku };
      if (Number.isFinite(precio) && precio > 0 && Math.abs(precio - v.sellingPrice) >= 0.005) c.precioVentaUsd = Math.round(precio * 100) / 100;
      if (Number.isInteger(stock) && stock >= 0 && stock !== v.stock) c.stock = stock;
      return c;
    })
    .filter((c) => c.precioVentaUsd !== undefined || c.stock !== undefined);

  return (
    <div className="space-y-2 rounded-lg border border-indigo-400/30 bg-indigo-500/[0.05] p-2.5">
      {producto.variantes.map((v) => {
        const precio = Number(precios[v.sku]);
        const liq = tienda.tarifas && Number.isFinite(precio) && precio > 0 ? liquidacion(precio, v.costPrice + v.shippingCost, tienda.tarifas, v.costPrice) : null;
        return (
          <div key={v.sku} className="space-y-1 border-b border-white/[0.06] pb-2 text-[12px] last:border-0 last:pb-0">
            <p className="truncate font-medium">{v.title}</p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <label className="flex items-center gap-1.5">
                Precio
                <Input inputMode="decimal" className="h-8 w-24" value={precios[v.sku]} onChange={(e) => setPrecios((x) => ({ ...x, [v.sku]: e.target.value.replace(',', '.') }))} aria-label={`Precio de ${v.title}`} />
                US$
              </label>
              <label className="flex items-center gap-1.5">
                Stock
                <Input inputMode="numeric" className="h-8 w-20" value={stocks[v.sku]} onChange={(e) => setStocks((x) => ({ ...x, [v.sku]: e.target.value.replace(/\D/g, '') }))} aria-label={`Stock de ${v.title}`} />
              </label>
              {liq && <span className={cn('font-medium', liq.neto < 0 ? 'text-rose-300' : 'text-emerald-300')}>Neto {usd(liq.neto)}</span>}
            </div>
            {v.stockVerificado === false && <p className="text-[11px] text-amber-300">El stock es una estimación de Retador, no un dato del proveedor.</p>}
          </div>
        );
      })}
      <div className="flex gap-2 pt-1">
        <Button size="sm" variant="gradient" disabled={guardando || !cambios.length} onClick={() => alGuardar(cambios)}>
          {guardando ? <Loader2 className="animate-spin" /> : null} Guardar en Retador
        </Button>
        <Button size="sm" variant="ghost" disabled={guardando} onClick={alCancelar}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}
