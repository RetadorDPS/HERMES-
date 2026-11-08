'use client';

/**
 * Productos que el usuario tiene publicados en Retador: estado, precio, stock (verificado o estimado) y beneficio neto
 * estimado, con edición de precio y stock, pausa y reactivación. Todo pasa por la función `retador-tienda`, que
 * rechaza cualquier precio con el que se pierda dinero.
 */
import { Foto } from './foto';
import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Loader2, MessageSquareQuote, Pause, Pencil, Play, Trash2, TriangleAlert, Wand2 } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { llamarTienda, obtenerProductosRetador, type PrecioEnRiesgo, type ProductoRetador, type TiendaRetador, type VistaPrecioAuto } from '@/lib/real/retador';
import { liquidacion, netoContandoEnvio } from '@/lib/retador/precios';
import { cn } from '@/lib/utils';

const usd = (n: number) => `${n.toFixed(2)} USD`;

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
  // Vista previa del precio automático de un producto (qué precios saldrían con la regla) antes de activarlo
  const [autoVista, setAutoVista] = useState<{ id: string; datos: VistaPrecioAuto } | null>(null);

  const cargar = useCallback(async () => {
    try {
      setProductos(await obtenerProductosRetador(tienda.id));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [tienda.id]);

  useEffect(() => {
    // Primero se pregunta a Retador qué sigue existiendo (si lo eliminaste allí, aquí se limpia solo) y luego se lee la lista
    void (async () => {
      try {
        // La configuración de Retador se relee para saber qué admite (por ejemplo las opiniones del proveedor)
        if (!tienda.resenasProveedor) await llamarTienda({ accion: 'config', storeId: tienda.id }).catch(() => undefined);
        await llamarTienda({ accion: 'estado', storeId: tienda.id });
      } catch {
        /* sin respuesta de Retador: se enseña lo último que se sabe */
      }
      await cargar();
    })();
  }, [cargar, tienda.id, tienda.publicados]);

  // Desde el Monitor, «Ajustar precio» llega con ?ajustar=<producto>: se abre el editor de ese producto y se baja hasta él
  const [yaAbierto, setYaAbierto] = useState(false);
  useEffect(() => {
    if (!productos || yaAbierto) return;
    let id: string | null = null;
    try {
      id = new URLSearchParams(window.location.search).get('ajustar');
    } catch {
      /* sin acceso a la dirección: no se abre nada */
    }
    setYaAbierto(true);
    if (!id || !productos.some((p) => p.id === id)) return;
    setEditando(id);
    window.setTimeout(() => document.getElementById(`producto-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
  }, [productos, yaAbierto]);

  async function eliminar(p: ProductoRetador) {
    const archivado = p.status === 'ARCHIVED';
    const pregunta = archivado
      ? 'Este producto ya no existe en Retador. ¿Quitarlo de esta lista?'
      : `¿Eliminar «${p.title}» de Retador? Desaparece del mercado y de tu perfil, y podrás volver a importarlo cuando quieras. Si tiene pedidos pendientes, Retador no lo permitirá.`;
    if (!window.confirm(pregunta)) return;
    await accion(p.id, 'eliminar', { accion: 'eliminar' }, archivado ? 'Quitado de la lista.' : 'Producto eliminado de Retador. Ya puedes importarlo otra vez.');
  }

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

  async function verPrecioAuto(p: ProductoRetador) {
    setOcupado(`${p.id}:auto`);
    setError(null);
    setAviso(null);
    try {
      const r = await llamarTienda<VistaPrecioAuto>({ accion: 'precio_auto', productId: p.id, activo: true });
      setAutoVista({ id: p.id, datos: r });
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
          {productos.length ? `${productos.length} publicados desde DropshipPilot. Lo que te queda es una estimación con las tarifas de Retador y el envío estimado.` : 'Todavía no has publicado ninguno. Ábrelos desde el catálogo con «Publicar en…» y elige Retador.'}
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
            <div key={p.id} id={`producto-${p.id}`} className="space-y-2 rounded-lg border border-white/10 bg-white/[0.02] p-3">
              <div className="flex gap-3">
                {p.foto ? (
                  <Foto src={p.foto} ancho={240} className="size-14 shrink-0 rounded-md object-cover" />
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

              {p.precioEnRiesgo && editando !== p.id && (
                <Alert variant="warning" title="Tu precio ya no vale con el coste de hoy">
                  <AvisoPrecio riesgo={p.precioEnRiesgo} pausado={p.status === 'PAUSED'} />
                  <Button size="sm" variant="outline" className="mt-2" disabled={!!ocupado} onClick={() => setEditando(p.id)}>
                    <Pencil /> Ajustar precio
                  </Button>
                </Alert>
              )}

              {p.status !== 'ARCHIVED' && (
                <div className="space-y-1.5 rounded-lg border border-white/[0.07] bg-white/[0.02] p-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Wand2 className="size-3.5 text-indigo-300" />
                    <span className="text-[12px] font-medium">Precio automático</span>
                    <Badge variant={p.precioAuto?.activo ? 'success' : 'outline'}>{p.precioAuto?.activo ? 'Activado' : 'Apagado'}</Badge>
                    <span className="flex-1" />
                    {p.precioAuto?.activo ? (
                      <Button size="sm" variant="ghost" disabled={!!ocupado} onClick={() => accion(p.id, 'autooff', { accion: 'precio_auto', activo: false }, 'Precio automático apagado: el precio solo cambiará cuando tú lo cambies.')}>
                        {ocupado === `${p.id}:autooff` ? <Loader2 className="animate-spin" /> : null} Apagar
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" disabled={!!ocupado} onClick={() => void verPrecioAuto(p)}>
                        {ocupado === `${p.id}:auto` ? <Loader2 className="animate-spin" /> : <Wand2 />} Activar…
                      </Button>
                    )}
                  </div>
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    {p.precioAuto?.activo
                      ? 'Cuando el coste del proveedor sube o baja, tu precio sube o baja solo con tu regla de precios. Se avisa en el Monitor cada vez.'
                      : p.precioAuto?.apagadoPor === 'vendedor'
                        ? 'Está apagado porque pusiste un precio a mano. Puedes volver a activarlo cuando quieras.'
                        : 'Si lo activas, el precio seguirá tu regla de precios cuando cambie el coste del proveedor.'}
                  </p>
                  {autoVista?.id === p.id && (
                    <div className="space-y-2 rounded-md border border-indigo-400/30 bg-indigo-500/[0.05] p-2.5 text-[12px]">
                      <p>
                        Tu regla: <strong>{autoVista.datos.regla.markupPct} % de margen</strong>
                        {autoVista.datos.regla.propia ? '' : ' (regla por defecto: todavía no has guardado una propia en «Precios y márgenes»)'}.
                      </p>
                      {autoVista.datos.cambian ? (
                        <ul className="space-y-1">
                          {autoVista.datos.variantes
                            .filter((x) => Math.abs(x.precioNuevo - x.precioActual) > 0.005)
                            .map((x) => (
                              <li key={x.sku}>
                                <strong>«{x.titulo}»</strong>: de {usd(x.precioActual)} a <strong>{usd(x.precioNuevo)}</strong>
                              </li>
                            ))}
                        </ul>
                      ) : (
                        <p>Tus precios ya coinciden con tu regla: no cambia ninguno.</p>
                      )}
                      <p className="text-[11px] text-muted-foreground">
                        Para que el precio no baile: solo se mueve si el cambio es de al menos el 2 % (o 0,50 USD), como mucho una vez al día, y nunca por debajo del mínimo de Retador. Si el cambio es de más del 25 % no lo hace solo: te avisa y decides tú.
                      </p>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="gradient"
                          disabled={!!ocupado}
                          onClick={async () => {
                            await accion(p.id, 'autoon', { accion: 'precio_auto', activo: true, confirmar: true }, autoVista.datos.cambian ? 'Precio automático activado y precios actualizados en Retador.' : 'Precio automático activado.');
                            setAutoVista(null);
                          }}
                        >
                          {ocupado === `${p.id}:autoon` ? <Loader2 className="animate-spin" /> : null} {autoVista.datos.cambian ? 'Activar y aplicar estos precios' : 'Activar'}
                        </Button>
                        <Button size="sm" variant="ghost" disabled={!!ocupado} onClick={() => setAutoVista(null)}>
                          Cancelar
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {editando === p.id ? (
                <EditorProducto
                  producto={p}
                  tienda={tienda}
                  guardando={ocupado === `${p.id}:guardar`}
                  alCancelar={() => setEditando(null)}
                  alGuardar={(variantes) =>
                    accion(
                      p.id,
                      'guardar',
                      { accion: 'actualizar', variantes },
                      p.precioEnRiesgo && p.status === 'PAUSED'
                        ? 'Precio guardado en Retador. El producto sigue pausado: pulsa «Reactivar» cuando quieras volver a venderlo.'
                        : p.precioAuto?.activo
                          ? 'Cambios guardados en Retador. Si cambiaste un precio, el precio automático de este producto se ha apagado.'
                          : 'Cambios guardados en Retador.',
                    )
                  }
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
                  {tienda.resenasProveedor && p.status !== 'ARCHIVED' && (
                    <Button size="sm" variant="outline" disabled={!!ocupado} onClick={() => accion(p.id, 'opiniones', { accion: 'actualizar', resenas: true }, 'Opiniones del proveedor enviadas a Retador (se muestran como opiniones de CJ o AliExpress, no de compradores de Retador).')}>
                      {ocupado === `${p.id}:opiniones` ? <Loader2 className="animate-spin" /> : <MessageSquareQuote />} Enviar opiniones
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" className="text-rose-300 hover:text-rose-200" disabled={!!ocupado} onClick={() => eliminar(p)}>
                    {ocupado === `${p.id}:eliminar` ? <Loader2 className="animate-spin" /> : <Trash2 />} {p.status === 'ARCHIVED' ? 'Quitar de la lista' : 'Eliminar'}
                  </Button>
                  {p.url && (
                    <Button size="sm" variant="ghost" asChild>
                      <a href={p.url} target="_blank" rel="noopener noreferrer">
                        <ExternalLink /> Ver en Retador
                      </a>
                    </Button>
                  )}
                </div>
              )}
              {editando !== p.id && p.status !== 'ARCHIVED' && <p className="text-[11px] text-muted-foreground">Pausar solo lo oculta del mercado (sigue en tu perfil de Retador). Eliminar lo quita de los dos sitios.</p>}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

/** Qué ha pasado con el coste y cuánto hay que cobrar como mínimo ahora, variante por variante. */
function AvisoPrecio({ riesgo, pausado }: { riesgo: PrecioEnRiesgo; pausado: boolean }) {
  return (
    <div className="space-y-1 text-[12px]">
      <ul className="space-y-1">
        {riesgo.variantes.map((v) => (
          <li key={v.sku}>
            <strong>«{v.titulo}»</strong>: el coste pasó de {usd(v.costeAntes)} a {usd(v.costeAhora)}. Tu precio es {usd(v.precioActual)} y ahora el mínimo es <strong>{usd(v.minimoUsd)}</strong>
            {v.pierde ? ' (con tu precio perderías dinero).' : ' (el mínimo de Retador).'}
          </li>
        ))}
      </ul>
      <p>
        {pausado && riesgo.pausadoSolo ? 'Hemos pausado el producto en Retador para que no se venda así. ' : ''}
        Nunca cambiamos tu precio por ti: súbelo tú y, si quieres, reactiva el producto.
      </p>
    </div>
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
  // Con el coste de hoy ya no vale tu precio: se propone el mínimo (tú decides si cobras más) y las cuentas usan el coste actual
  const riesgoDe = (sku: string) => producto.precioEnRiesgo?.variantes.find((r) => r.sku === sku);
  const [precios, setPrecios] = useState<Record<string, string>>(() =>
    Object.fromEntries(producto.variantes.map((v) => [v.sku, (riesgoDe(v.sku) ? riesgoDe(v.sku)!.minimoUsd : v.sellingPrice).toFixed(2)])),
  );
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
        const riesgo = riesgoDe(v.sku);
        const liq =
          tienda.tarifas && Number.isFinite(precio) && precio > 0
            ? riesgo
              ? liquidacion(precio, riesgo.costeAhora, tienda.tarifas, riesgo.costeProductoAhora)
              : liquidacion(precio, v.costPrice + v.shippingCost, tienda.tarifas, v.costPrice)
            : null;
        return (
          <div key={v.sku} className="space-y-1 border-b border-white/[0.06] pb-2 text-[12px] last:border-0 last:pb-0">
            <p className="truncate font-medium">{v.title}</p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <label className="flex items-center gap-1.5">
                Precio
                <Input inputMode="decimal" className="h-8 w-24" value={precios[v.sku]} onChange={(e) => setPrecios((x) => ({ ...x, [v.sku]: e.target.value.replace(',', '.') }))} aria-label={`Precio de ${v.title}`} />
                USD
              </label>
              <label className="flex items-center gap-1.5">
                Stock
                <Input inputMode="numeric" className="h-8 w-20" value={stocks[v.sku]} onChange={(e) => setStocks((x) => ({ ...x, [v.sku]: e.target.value.replace(/\D/g, '') }))} aria-label={`Stock de ${v.title}`} />
              </label>
              {liq && (() => {
                // Contando el envío estimado (Retador calcula su neto sin él): la cifra prudente, igual que al publicar
                const envio = Math.max(0, (riesgo ? riesgo.costeAhora - riesgo.costeProductoAhora : v.shippingCost) || 0);
                const neto = netoContandoEnvio(liq.neto, envio);
                return <span className={cn('font-medium', neto < 0 ? 'text-rose-300' : 'text-emerald-300')}>Te quedan {usd(neto)}{envio > 0 ? ', contando el envío' : ''}</span>;
              })()}
            </div>
            {riesgo && <p className="text-[11px] text-amber-300">Mínimo con el coste de hoy: {usd(riesgo.minimoUsd)}. Te lo hemos puesto como punto de partida; puedes cobrar más.</p>}
            {v.stockVerificado === false && <p className="text-[11px] text-amber-300">El stock es una estimación de Retador, no un dato del proveedor.</p>}
          </div>
        );
      })}
      {producto.precioAuto?.activo && <p className="text-[11px] text-amber-300">Si cambias un precio a mano, el precio automático de este producto se apaga y se respeta el tuyo.</p>}
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
