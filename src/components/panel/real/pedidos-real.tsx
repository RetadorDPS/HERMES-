'use client';

/**
 * Pedidos reales: los pedidos PAGADOS que Retador pasa a DropshipPilot para comprarlos al proveedor.
 * La compra al proveedor se controla desde la tarjeta «Compras al proveedor»: empieza en Simulación y no compra nada hasta que tú lo decidas.
 */
import { useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, Loader2, PackageCheck, RefreshCw, ShoppingCart, Truck } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn, formatRelative } from '@/lib/utils';
import { llamarTienda, obtenerTiendaRetador } from '@/lib/real/retador';
import { llamarCompras, type ModoCompras, type ResultadoCompra } from '@/lib/real/compras';
import { ComprasConfig } from './compras-config';
import { obtenerPedidosReales } from '@/lib/real/pedidos';
import { etiquetaEstadoPedido } from '../../../../supabase/functions/_compartido/retador-pedidos';
import { nombrePais } from '@/lib/paises';
import { PantallaReal, useCarga } from './comun';

const usd = (n: number) => `${n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} US$`;
const VARIANTE: Record<string, 'success' | 'warning' | 'danger' | 'outline'> = { ok: 'success', aviso: 'warning', error: 'danger', neutro: 'outline' };

export function PedidosReal() {
  const { datos, error, cargando, recargar } = useCarga(async () => {
    const [pedidos, tienda] = await Promise.all([obtenerPedidosReales(), obtenerTiendaRetador()]);
    return { pedidos, tienda };
  });
  const [trabajando, setTrabajando] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{ tipo: 'ok' | 'aviso' | 'error'; texto: string } | null>(null);
  const [modo, setModo] = useState<ModoCompras | null>(null);
  const [pedidoActivo, setPedidoActivo] = useState<string | null>(null);
  const [mensajes, setMensajes] = useState<Record<string, { tipo: 'ok' | 'aviso' | 'error'; texto: string }>>({});

  async function accionPedido(orderId: string, accion: 'comprar' | 'marcar_pagada', aprobar = false) {
    setPedidoActivo(orderId);
    try {
      if (accion === 'marcar_pagada') {
        const r = await llamarCompras<{ avisoRetador: string | null }>({ accion, orderId });
        setMensajes((m) => ({ ...m, [orderId]: r.avisoRetador ? { tipo: 'aviso', texto: `Compra confirmada, pero Retador no recibió el aviso: ${r.avisoRetador}` } : { tipo: 'ok', texto: 'Compra confirmada y Retador avisado.' } }));
      } else {
        const r = await llamarCompras<ResultadoCompra>({ accion, orderId, aprobar });
        if (r.motivo) setMensajes((m) => ({ ...m, [orderId]: { tipo: 'aviso', texto: r.motivo! } }));
        else {
          const x = r.resultados?.[0];
          const texto = x?.simulada
            ? `Simulado: se compraría en CJ por ${usd(x.costeUsd ?? 0)} desde ${x.origen} con «${x.logistica}». No se llamó al proveedor.`
            : x?.hecho
              ? `Pedido creado en CJ (${x.pedidoProveedorId}) SIN pagar. Págalo en CJ y luego pulsa «Ya lo pagué en CJ».`
              : (x?.motivo ?? 'No se compró.');
          setMensajes((m) => ({ ...m, [orderId]: { tipo: x?.hecho || x?.simulada ? 'ok' : 'aviso', texto } }));
        }
      }
      await recargar();
    } catch (e) {
      setMensajes((m) => ({ ...m, [orderId]: { tipo: 'error', texto: (e as Error).message } }));
    } finally {
      setPedidoActivo(null);
    }
  }

  const tienda = datos?.tienda ?? null;
  const conectada = Boolean(tienda && tienda.status === 'CONNECTED');
  const pedidos = datos?.pedidos ?? [];
  const porComprar = pedidos.filter((p) => p.estado === 'PAID' && !p.aviso?.startsWith('Necesita revisión')).length;
  const enRevision = pedidos.filter((p) => p.aviso).length;
  const errores = pedidos.filter((p) => p.estado === 'SUPPLIER_ERROR').length;

  async function lanzar(accion: 'pedidos_sincronizar' | 'simular_pedido') {
    if (!tienda) return;
    setTrabajando(accion);
    setResultado(null);
    try {
      const r = await llamarTienda<{ disponible?: boolean; nuevos?: number; actualizados?: number; revision?: number; mensaje?: string; creado?: boolean }>({ accion, storeId: tienda.id });
      if (accion === 'simular_pedido') setResultado({ tipo: 'ok', texto: 'Pedido de prueba creado. Pulsa «Buscar pedidos nuevos» para traerlo.' });
      else if (r.disponible === false) setResultado({ tipo: 'aviso', texto: r.mensaje ?? 'Retador todavía no ofrece los pedidos.' });
      else setResultado({ tipo: 'ok', texto: `${r.nuevos ?? 0} pedidos nuevos${r.actualizados ? `, ${r.actualizados} actualizados` : ''}${r.revision ? `, ${r.revision} necesitan revisión` : ''}.` });
      await recargar();
    } catch (e) {
      setResultado({ tipo: 'error', texto: (e as Error).message });
    } finally {
      setTrabajando(null);
    }
  }

  return (
    <PantallaReal titulo="Pedidos" subtitulo="Lo que se ha vendido y hay que comprar al proveedor" cargando={cargando} error={error} alRecargar={recargar} tour="screen:orders">
      {datos && (
        <>
          <div className="grid grid-cols-2 gap-2.5 sm:gap-3 xl:grid-cols-4">
            {[
              { etiqueta: 'Por comprar', valor: porComprar, sub: 'pagados por el cliente', icono: ShoppingCart },
              { etiqueta: 'En revisión', valor: enRevision, sub: 'necesitan tu atención', icono: AlertTriangle },
              { etiqueta: 'Con error', valor: errores, sub: 'falló la compra', icono: AlertTriangle },
              { etiqueta: 'Total', valor: pedidos.length, sub: 'últimos 100', icono: PackageCheck },
            ].map(({ etiqueta, valor, sub, icono: Icono }) => (
              <Card key={etiqueta} className="p-4">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{etiqueta}</p>
                  <Icono className="size-4 text-indigo-300" />
                </div>
                <p className="mt-1.5 text-xl font-semibold tabular-nums">{valor}</p>
                <p className="text-[11px] text-muted-foreground">{sub}</p>
              </Card>
            ))}
          </div>

          <ComprasConfig alCambiar={setModo} />

          {!conectada ? (
            <Alert variant="warning" title="Conecta tu tienda de Retador">
              Los pedidos llegan desde tu tienda. Conéctala en{' '}
              <Link href="/stores" className="underline">
                Tiendas
              </Link>
              .
            </Alert>
          ) : (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-[13px]">Pedidos de Retador</CardTitle>
                <CardDescription>Pulsa el botón para buscar los pedidos pagados que Retador tenga para ti.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => lanzar('pedidos_sincronizar')} disabled={trabajando !== null}>
                    {trabajando === 'pedidos_sincronizar' ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                    Buscar pedidos nuevos
                  </Button>
                  {tienda?.simulada && (
                    <Button size="sm" variant="ghost" onClick={() => lanzar('simular_pedido')} disabled={trabajando !== null}>
                      {trabajando === 'simular_pedido' && <Loader2 className="size-4 animate-spin" />}
                      Crear pedido de prueba (simulado)
                    </Button>
                  )}
                </div>
                {resultado && (
                  <Alert variant={resultado.tipo === 'ok' ? 'success' : resultado.tipo === 'aviso' ? 'warning' : 'danger'} title={resultado.tipo === 'error' ? 'No se pudo' : 'Resultado'}>
                    {resultado.texto}
                  </Alert>
                )}
              </CardContent>
            </Card>
          )}

          {pedidos.length === 0 ? (
            <Alert variant="info" title="Todavía no hay pedidos">
              Cuando un cliente pague un producto tuyo en Retador, aparecerá aquí.
            </Alert>
          ) : (
            <div className="space-y-3">
              {pedidos.map((p) => {
                const e = etiquetaEstadoPedido(p.estado);
                return (
                  <Card key={p.id}>
                    <CardContent className="space-y-2.5 p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-[13px] font-semibold">Pedido {p.numero}</p>
                        <Badge variant={VARIANTE[e.tono]}>{e.texto}</Badge>
                        <span className="ml-auto text-[11px] text-muted-foreground">{p.fecha ? formatRelative(p.fecha) : ''}</span>
                      </div>
                      <ul className="space-y-1 text-[12px]">
                        {p.items.map((i, k) => (
                          <li key={k} className="flex flex-wrap items-baseline justify-between gap-x-3">
                            <span className="min-w-0 break-words">
                              {i.cantidad} × {i.titulo}
                            </span>
                            <span className="tabular-nums text-muted-foreground">
                              vendido a {usd(i.precio)} · costo {i.coste > 0 ? usd(i.coste) : 'sin dato'}
                            </span>
                          </li>
                        ))}
                      </ul>
                      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                        <span>{[p.ciudad, p.pais ? nombrePais(p.pais) : null].filter(Boolean).join(', ')}</span>
                        {p.notas && <span>{p.notas}</span>}
                        <span className="ml-auto tabular-nums">Total {usd(p.total)}</span>
                      </p>
                      {p.compras.length > 0 && (
                        <ul className="space-y-1 rounded-lg bg-black/25 px-3 py-2 text-[11px]">
                          {p.compras.map((c) => (
                            <li key={c.id} className="flex flex-wrap items-center gap-x-2">
                              <CheckCircle2 className={cn('size-3', c.estado === 'COMPRADA' ? 'text-emerald-300' : 'text-amber-300')} />
                              <span>
                                {c.proveedor === 'CJ_DROPSHIPPING' ? 'CJ' : 'AliExpress'} · {c.modo.toLowerCase()} · {c.estado.toLowerCase()}
                                {c.costeUsd !== null ? ` · ${usd(c.costeUsd)}` : ''}
                              </span>
                              {c.mensaje && <span className="text-muted-foreground">{c.mensaje}</span>}
                            </li>
                          ))}
                        </ul>
                      )}
                      {p.seguimiento && (
                        <p className="flex items-center gap-1.5 text-[12px]">
                          <Truck className="size-3.5 text-indigo-300" /> Seguimiento {p.seguimiento.numero}
                          {p.seguimiento.empresa ? ` (${p.seguimiento.empresa})` : ''}
                        </p>
                      )}
                      {modo && modo !== 'APAGADO' && p.estado === 'PAID' && !p.aviso?.startsWith('Necesita revisión') && !p.compras.some((c) => ['EN_CURSO', 'CREADA', 'COMPRADA'].includes(c.estado)) && (
                        <div className="flex flex-wrap items-center gap-2">
                          <Button size="sm" variant={modo === 'MANUAL' ? 'default' : 'outline'} onClick={() => accionPedido(p.id, 'comprar', modo === 'MANUAL')} disabled={pedidoActivo !== null}>
                            {pedidoActivo === p.id && <Loader2 className="size-4 animate-spin" />}
                            {modo === 'SIMULACION' ? 'Simular compra' : 'Aprobar y comprar'}
                          </Button>
                        </div>
                      )}
                      {p.compras.some((c) => c.estado === 'CREADA') && (
                        <Button size="sm" variant="outline" onClick={() => accionPedido(p.id, 'marcar_pagada')} disabled={pedidoActivo !== null}>
                          {pedidoActivo === p.id && <Loader2 className="size-4 animate-spin" />}
                          Ya lo pagué en CJ
                        </Button>
                      )}
                      {mensajes[p.id] && (
                        <p className={cn('rounded-lg border px-3 py-2 text-[12px]', mensajes[p.id].tipo === 'ok' ? 'border-emerald-500/30 bg-emerald-500/[0.07] text-emerald-200' : mensajes[p.id].tipo === 'error' ? 'border-red-500/30 bg-red-500/[0.07] text-red-200' : 'border-amber-500/30 bg-amber-500/[0.07] text-amber-200')}>{mensajes[p.id].texto}</p>
                      )}
                      {p.aviso && <p className="rounded-lg border border-amber-500/30 bg-amber-500/[0.07] px-3 py-2 text-[12px] text-amber-200">{p.aviso}</p>}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}
    </PantallaReal>
  );
}
