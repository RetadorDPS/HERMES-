'use client';

/**
 * Pedidos reales de Retador.
 *
 * Contrato 1.7 de Retador: RETADOR SIEMPRE PAGA AL PROVEEDOR. El comprador paga a Retador, Retador compra el producto y el envío
 * al proveedor, y cuando el pedido se entrega la ganancia del vendedor pasa sola a su Billetera de Retador. El vendedor nunca paga a
 * CJ ni a AliExpress, así que aquí ya no hay botones de comprar ni de «ya lo pagué»: solo se enseña lo que gana en cada venta, en qué
 * punto está su dinero y si Retador ya compró al proveedor. DropshipPilot no gestiona retiros ni pide datos bancarios.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, Loader2, PackageCheck, RefreshCw, Truck, Wallet } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatRelative } from '@/lib/utils';
import { llamarTienda, obtenerFinanzas, obtenerTiendaRetador, URL_BILLETERA_RETADOR, type FinanzasRetador, type VentaFinanzas } from '@/lib/real/retador';
import { obtenerPedidosReales } from '@/lib/real/pedidos';
import { etiquetaEstadoPedido } from '../../../../supabase/functions/_compartido/retador-pedidos';
import { nombrePais } from '@/lib/paises';
import { PantallaReal, useCarga } from './comun';

const usd = (n: number | null | undefined) => (typeof n === 'number' ? `${n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD` : '—');
const fecha = (iso: string | null) => (iso && !Number.isNaN(Date.parse(iso)) ? new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) : null);
const VARIANTE: Record<string, 'success' | 'warning' | 'danger' | 'outline'> = { ok: 'success', aviso: 'warning', error: 'danger', neutro: 'outline' };

/** En qué punto está el dinero de una venta, en palabras del vendedor. */
function estadoDinero(v: VentaFinanzas): { texto: string; variante: 'success' | 'warning' | 'outline' | 'danger' } {
  switch (v.estadoDinero) {
    case 'retenido':
      return { texto: 'Retenido hasta la entrega', variante: 'outline' };
    case 'por_liberar':
      return { texto: fecha(v.liberaEn) ? `Pasa a tu Billetera el ${fecha(v.liberaEn)}` : 'Por pasar a tu Billetera', variante: 'warning' };
    case 'liberado':
      return { texto: 'Ya está en tu Billetera', variante: 'success' };
    case 'cancelado':
      return { texto: 'Cancelado: no hay ganancia', variante: 'danger' };
    default:
      return { texto: 'Sin dato de Retador', variante: 'outline' };
  }
}

/** Qué ha hecho Retador con la compra al proveedor. */
function estadoCompra(v: VentaFinanzas): string | null {
  switch (v.compraProveedor?.estado) {
    case 'pendiente':
      return 'Retador está comprando al proveedor';
    case 'comprado':
      return 'Retador ya compró al proveedor';
    case 'entregado':
      return 'Entregado al comprador';
    default:
      return null;
  }
}

export function PedidosReal() {
  const { datos, error, cargando, recargar } = useCarga(async () => {
    const [pedidos, tienda] = await Promise.all([obtenerPedidosReales(), obtenerTiendaRetador()]);
    return { pedidos, tienda };
  });
  const [trabajando, setTrabajando] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{ tipo: 'ok' | 'aviso' | 'error'; texto: string } | null>(null);
  const [finanzas, setFinanzas] = useState<FinanzasRetador | null>(null);
  const [errorFinanzas, setErrorFinanzas] = useState<string | null>(null);

  const tienda = datos?.tienda ?? null;
  const conectada = Boolean(tienda && tienda.status === 'CONNECTED');
  // Se pide siempre con la tienda conectada: las capacidades guardadas pueden ser de antes de que Retador
  // activara las finanzas, y el servidor ya contesta «no disponible» si Retador no las ofrece
  const conFinanzas = conectada && tienda?.capacidades?.finanzas !== false;
  const finanzasVisibles = finanzas === null || finanzas.disponible === true;
  const pedidos = datos?.pedidos ?? [];

  // El dinero de cada venta lo cuenta Retador: se lee de allí (si no lo ofrece, el servidor contesta «no disponible»)
  useEffect(() => {
    if (!conFinanzas || !tienda) return;
    let vivo = true;
    setErrorFinanzas(null);
    obtenerFinanzas(tienda.id)
      .then((f) => vivo && setFinanzas(f))
      .catch((e) => vivo && setErrorFinanzas((e as Error).message));
    return () => {
      vivo = false;
    };
  }, [conFinanzas, tienda?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function lanzar(accion: 'pedidos_sincronizar' | 'simular_pedido') {
    if (!tienda) return;
    setTrabajando(accion);
    setResultado(null);
    try {
      const r = await llamarTienda<{ disponible?: boolean; nuevos?: number; actualizados?: number; revision?: number; mensaje?: string }>({ accion, storeId: tienda.id });
      if (accion === 'simular_pedido') setResultado({ tipo: 'ok', texto: 'Pedido de prueba creado. Pulsa «Buscar pedidos nuevos» para traerlo.' });
      else if (r.disponible === false) setResultado({ tipo: 'aviso', texto: r.mensaje ?? 'Retador todavía no ofrece los pedidos.' });
      else setResultado({ tipo: 'ok', texto: `${r.nuevos ?? 0} pedidos nuevos${r.actualizados ? `, ${r.actualizados} actualizados` : ''}${r.revision ? `, ${r.revision} necesitan revisión` : ''}.` });
      await recargar();
      if (conFinanzas && tienda) setFinanzas(await obtenerFinanzas(tienda.id).catch(() => finanzas));
    } catch (e) {
      setResultado({ tipo: 'error', texto: (e as Error).message });
    } finally {
      setTrabajando(null);
    }
  }

  const resumen = finanzas?.disponible ? finanzas.resumen : null;
  const ventas = finanzas?.disponible ? (finanzas.ventas ?? []) : [];
  const dias = finanzas?.diasLiberacion ?? null;

  return (
    <PantallaReal titulo="Pedidos" subtitulo="Lo que has vendido y lo que ganas en cada venta" cargando={cargando} error={error} alRecargar={recargar} tour="screen:orders">
      {datos && (
        <>
          {!conectada ? (
            <Alert variant="warning" title="Vincula tu cuenta con Retador">
              Los pedidos llegan desde tu tienda de Retador. Vincúlala en{' '}
              <Link href="/stores" className="underline">
                Tiendas
              </Link>
              .
            </Alert>
          ) : (
            <>
              <Alert variant="info" title="Retador compra al proveedor por ti">
                Cuando un cliente paga, Retador compra el producto y el envío al proveedor. Tú no pagas nada a CJ ni a AliExpress. Cuando el pedido se entrega, tu ganancia pasa sola a tu Billetera de
                Retador{dias !== null ? ` a los ${dias} días (o antes si el comprador confirma que lo recibió)` : ''}. Si hay un reclamo o un reembolso, ese dinero no se libera.
              </Alert>

              {conFinanzas && (
                <>
                  {finanzasVisibles && !errorFinanzas && (
                  <div className="grid grid-cols-2 gap-2.5 sm:gap-3 xl:grid-cols-4">
                    {[
                      { etiqueta: 'Retenido', valor: resumen?.retenido, sub: 'hasta la entrega' },
                      { etiqueta: 'Por liberar', valor: resumen?.porLiberar, sub: 'entregado, pronto en tu Billetera' },
                      { etiqueta: 'Liberado', valor: resumen?.liberadoTotal, sub: 'ya pasó a tu Billetera' },
                      { etiqueta: 'Saldo en tu Billetera', valor: resumen?.saldoDisponible, sub: 'incluye tus otras ventas' },
                    ].map(({ etiqueta, valor, sub }) => (
                      <Card key={etiqueta} className="p-4">
                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{etiqueta}</p>
                        <p className="mt-1.5 text-lg font-semibold tabular-nums">{finanzas ? usd(valor) : <Loader2 className="size-4 animate-spin" />}</p>
                        <p className="text-[11px] text-muted-foreground">{sub}</p>
                      </Card>
                    ))}
                  </div>
                  )}
                  <Card className="p-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <Wallet className="size-5 shrink-0 text-indigo-300" />
                      <p className="min-w-0 flex-1 text-[13px]">
                        Tu dinero está en tu Billetera de RETADOR. Allí guardas tus cuentas de cobro y pides tus retiros.
                      </p>
                      <a href={URL_BILLETERA_RETADOR} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[13px] text-indigo-300 underline-offset-2 hover:underline">
                        Abrir Retador (Perfil → Billetera) <ExternalLink className="size-3.5" />
                      </a>
                    </div>
                  </Card>
                  {errorFinanzas && <Alert variant="warning" title="No se pudo leer tu dinero en Retador">{errorFinanzas}</Alert>}
                  {finanzas && !finanzas.disponible && <Alert variant="info">Retador todavía no ofrece el detalle de tu dinero por venta.</Alert>}
                </>
              )}

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-[13px]">Pedidos de Retador</CardTitle>
                  <CardDescription>Los pedidos se buscan solos cada 30 minutos; también puedes buscarlos ahora.</CardDescription>
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
            </>
          )}

          {/* Lo que gana el vendedor en cada venta (lo cuenta Retador) */}
          {ventas.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-[13px] font-semibold">Tus ventas y tu ganancia</h2>
              {ventas.map((v) => {
                const d = estadoDinero(v);
                const compra = estadoCompra(v);
                return (
                  <Card key={v.pedidoId}>
                    <CardContent className="space-y-2 p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-[13px] font-semibold">Pedido {v.numero ?? v.pedidoId.slice(0, 8)}</p>
                        <Badge variant={d.variante}>{d.texto}</Badge>
                        {v.envioIncluido && <Badge variant="outline">Envío incluido</Badge>}
                        {v.actualizadoEn && <span className="ml-auto text-[11px] text-muted-foreground">{formatRelative(new Date(v.actualizadoEn))}</span>}
                      </div>
                      <p className="text-[13px]">
                        Ganas <b className="text-emerald-300">{usd(v.ganancia)}</b> de {usd(v.cobrado)} cobrados
                      </p>
                      {compra && (
                        <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                          <PackageCheck className="size-3.5 text-indigo-300" /> {compra}
                        </p>
                      )}
                      <details className="text-[12px] text-muted-foreground">
                        <summary className="cursor-pointer text-indigo-300">Ver la cuenta</summary>
                        <ul className="mt-1 space-y-0.5">
                          <li>Cobrado al comprador: {usd(v.cobrado)}</li>
                          <li>− Producto: {usd(v.producto)}</li>
                          <li>− Envío: {usd(v.envio)}{v.envioIncluido ? ' (incluido en tu precio)' : ' (lo pagó el comprador aparte)'}</li>
                          <li>− Pasarela de pago: {usd(v.pasarela)}</li>
                          <li>− Comisión de Retador: {usd(v.comision)}</li>
                          <li>
                            = Tu ganancia: <b className="text-foreground">{usd(v.ganancia)}</b>
                          </li>
                        </ul>
                      </details>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          {/* Pedidos guardados aquí (dirección de entrega y seguimiento) */}
          {pedidos.length === 0 && ventas.length === 0 ? (
            <Alert variant="info" title="Todavía no hay pedidos">
              Cuando un cliente pague un producto tuyo en Retador, aparecerá aquí.
            </Alert>
          ) : pedidos.length > 0 ? (
            <div className="space-y-3">
              <h2 className="text-[13px] font-semibold">Entregas</h2>
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
                            <span className="tabular-nums text-muted-foreground">vendido a {usd(i.precio)}</span>
                          </li>
                        ))}
                      </ul>
                      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                        <span>{[p.ciudad, p.pais ? nombrePais(p.pais) : null].filter(Boolean).join(', ')}</span>
                        {p.notas && <span>{p.notas}</span>}
                        <span className="ml-auto tabular-nums">Total {usd(p.total)}</span>
                      </p>
                      {p.seguimiento && (
                        <p className="flex items-center gap-1.5 text-[12px]">
                          <Truck className="size-3.5 text-indigo-300" /> Seguimiento {p.seguimiento.numero}
                          {p.seguimiento.empresa ? ` (${p.seguimiento.empresa})` : ''}
                        </p>
                      )}
                      {p.aviso && <p className="rounded-lg border border-amber-500/30 bg-amber-500/[0.07] px-3 py-2 text-[12px] text-amber-200">{p.aviso}</p>}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          ) : null}
        </>
      )}
    </PantallaReal>
  );
}
