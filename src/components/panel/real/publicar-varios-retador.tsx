'use client';

/**
 * Publicar VARIOS productos del catálogo en la tienda de Retador de una vez.
 *
 * Para cada producto se piden sus datos a Retador (de uno en uno) y se propone todo con las MISMAS reglas que la pantalla de
 * publicar un producto (`src/lib/retador/plan-publicacion.ts`): variantes con existencias y código válido, precio con la
 * regla de margen y nunca bajo el mínimo de Retador, descripción y fotos del proveedor y categoría sugerida. La persona
 * revisa la lista, puede cambiar la categoría o quitar productos y pulsa «Publicar»; el servidor vuelve a comprobarlo todo.
 */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, CheckCircle2, Loader2, Send, Truck, X } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { DEFAULT_RULE } from '@/lib/pricing';
import type { CatalogRow } from '@/lib/catalog';
import { reglaPredeterminada } from '@/lib/real/datos';
import { cotizarEnvio } from '@/lib/real/buscar';
import { llamarTienda, obtenerTiendaRetador, type CategoriaRetador, type TiendaRetador } from '@/lib/real/retador';
import { planPublicacion, type PlanPublicacion, type Preparacion } from '@/lib/retador/plan-publicacion';
import { cn } from '@/lib/utils';
import { Foto } from './foto';
import { BloqueVincular } from './vincular-retador';

/** Tope absoluto de la app (cada plan tiene el suyo, `productosPorTanda`): se publican de uno en uno y conviene revisar la lista. */
export const MAX_PUBLICAR_VARIOS = 20;
/** País del tramo que exige Retador para publicar (el envío al almacén de EE. UU.). */
const PAIS_ENVIO_PUBLICAR = 'US';

type Fila = {
  item: CatalogRow;
  estado: 'esperando' | 'preparando' | 'listo' | 'no' | 'publicando' | 'hecho' | 'error';
  plan?: PlanPublicacion;
  /** «cat|subcat» elegido en el desplegable */
  categoria: string;
  incluir: boolean;
  mensaje?: string;
  url?: string | null;
};

const usd = (n: number) => `${n.toFixed(2)} USD`;
const faltaEnvio = (f: Fila) => f.estado === 'no' && /envío cotizado/i.test(f.mensaje ?? '');

export function PublicarVariosEnRetador({ items, maximo = MAX_PUBLICAR_VARIOS, onClose }: { items: CatalogRow[]; maximo?: number; onClose: () => void }) {
  const tope = Math.max(1, Math.min(maximo, MAX_PUBLICAR_VARIOS));
  const [tienda, setTienda] = useState<TiendaRetador | null | undefined>(undefined);
  const [filas, setFilas] = useState<Fila[]>(() => items.slice(0, tope).map((item) => ({ item, estado: 'esperando', categoria: '', incluir: false })));
  const [categorias, setCategorias] = useState<CategoriaRetador[]>([]);
  const [preparando, setPreparando] = useState(true);
  const [trabajando, setTrabajando] = useState<null | 'cotizando' | 'publicando'>(null);
  const [precioAuto, setPrecioAuto] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cambiar = (id: string, parche: Partial<Fila>) => setFilas((xs) => xs.map((f) => (f.item.id === id ? { ...f, ...parche } : f)));

  /** Pide a Retador los datos de un producto y deja su plan listo (o el motivo por el que no se puede). */
  async function preparar(t: TiendaRetador, item: CatalogRow, regla: any) {
    cambiar(item.id, { estado: 'preparando', mensaje: undefined });
    try {
      const p = await llamarTienda<Preparacion>({ accion: 'preparar', storeId: t.id, itemId: item.id });
      setCategorias((c) => (c.length ? c : p.categorias));
      const plan = planPublicacion(p, regla ?? DEFAULT_RULE, item.categoryName ?? null);
      if (!plan.listo) {
        cambiar(item.id, { estado: 'no', plan, mensaje: plan.motivo, incluir: false });
        return;
      }
      const s = plan.sugerencia;
      cambiar(item.id, { estado: 'listo', plan, incluir: true, categoria: s ? `${s.cat}|${s.subcat}` : '' });
    } catch (e) {
      cambiar(item.id, { estado: 'no', mensaje: (e as Error).message, incluir: false });
    }
  }

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const t = await obtenerTiendaRetador();
        if (!vivo) return;
        setTienda(t);
        if (!t || t.status !== 'CONNECTED') return;
        const regla = await reglaPredeterminada().catch(() => null);
        // De uno en uno: cada producto pide sus datos a Retador
        for (const item of items.slice(0, tope)) {
          if (!vivo) return;
          await preparar(t, item, regla);
        }
      } catch (e) {
        if (vivo) setError((e as Error).message);
      } finally {
        if (vivo) setPreparando(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const opciones = useMemo(() => categorias.flatMap((c) => c.subcategorias.map((s) => ({ valor: `${c.cat}|${s}`, texto: `${c.nombre} › ${s}` }))), [categorias]);
  const elegidas = filas.filter((f) => f.estado === 'listo' && f.incluir);
  const sinCategoria = elegidas.filter((f) => !f.categoria);
  const conFaltaEnvio = filas.filter(faltaEnvio);
  const hechas = filas.filter((f) => f.estado === 'hecho').length;
  const fallidas = filas.filter((f) => f.estado === 'error').length;
  const terminado = !trabajando && (hechas > 0 || fallidas > 0);

  /** Cotiza el envío a EE. UU. de los que lo necesitan (de uno en uno) y vuelve a prepararlos. */
  async function cotizarLosQueFaltan() {
    if (!tienda) return;
    setTrabajando('cotizando');
    setError(null);
    const regla = await reglaPredeterminada().catch(() => null);
    for (const f of conFaltaEnvio) {
      cambiar(f.item.id, { estado: 'preparando', mensaje: 'Cotizando el envío…' });
      try {
        await cotizarEnvio(f.item.id, [PAIS_ENVIO_PUBLICAR]);
      } catch (e) {
        cambiar(f.item.id, { estado: 'no', mensaje: (e as Error).message });
        // El límite del plan no se va a arreglar con el siguiente: se para aquí
        if (/l[ií]mite/i.test((e as Error).message)) break;
        continue;
      }
      await preparar(tienda, f.item, regla);
    }
    setTrabajando(null);
  }

  async function publicarTodas() {
    if (!tienda || !elegidas.length || sinCategoria.length) return;
    setTrabajando('publicando');
    setError(null);
    // De uno en uno: cada publicación la comprueba el servidor con las tarifas de hoy
    for (const f of elegidas) {
      if (!f.plan?.listo) continue;
      const [cat, subcat] = f.categoria.split('|');
      cambiar(f.item.id, { estado: 'publicando' });
      try {
        const r = await llamarTienda<{ url: string | null }>({
          accion: 'publicar',
          storeId: tienda.id,
          itemId: f.item.id,
          cat,
          subcat,
          precioAuto,
          variantes: f.plan.variantes.map((v) => ({ sku: v.sku, precioVentaUsd: v.precioVentaUsd })),
          contenido: f.plan.contenido,
        });
        cambiar(f.item.id, { estado: 'hecho', url: r.url ?? null, mensaje: undefined });
      } catch (e) {
        cambiar(f.item.id, { estado: 'error', mensaje: (e as Error).message });
      }
    }
    setTrabajando(null);
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Publicar varios en Retador">
      <div className="flex max-h-[94vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl border border-white/10 bg-[#0e1220] shadow-2xl sm:rounded-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-white/[0.07] px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">Publicar en Retador</h2>
            <p className="text-[12px] text-muted-foreground">
              {filas.length} {filas.length === 1 ? 'producto' : 'productos'} · revisa la lista y publícalos de una vez
              {items.length > tope && ` (tu plan publica hasta ${tope} a la vez; los demás, en la siguiente tanda)`}
            </p>
          </div>
          <button onClick={onClose} disabled={trabajando === 'publicando'} aria-label="Cerrar" className="rounded-md p-1 text-muted-foreground hover:bg-white/10 hover:text-foreground disabled:opacity-40">
            <X className="size-4" />
          </button>
        </header>

        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
          {tienda === undefined && (
            <p className="flex items-center gap-2 text-[12px] text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Comprobando tu tienda de Retador…
            </p>
          )}
          {tienda !== undefined && (!tienda || tienda.status !== 'CONNECTED') && (
            <Alert variant="warning" title="Primero vincula tu cuenta de Retador">
              Para publicar hace falta tener tu cuenta de Retador unida a esta.
              <div className="mt-3">
                <BloqueVincular />
              </div>
            </Alert>
          )}
          {error && <Alert variant="danger">{error}</Alert>}

          {tienda?.status === 'CONNECTED' && (
            <>
              <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                Cada producto se publica con las variantes que tienen existencias, el precio de tu regla de margen (nunca por debajo del mínimo de Retador) y la
                categoría sugerida. El comprador paga el envío aparte. Si quieres cambiar algo más, publica ese producto desde su ficha.
              </p>

              {conFaltaEnvio.length > 0 && !trabajando && !preparando && (
                <Alert variant="info" title={`${conFaltaEnvio.length} ${conFaltaEnvio.length === 1 ? 'producto necesita' : 'productos necesitan'} el envío cotizado`}>
                  Retador pide el envío hasta su almacén de EE. UU. antes de publicar. Se cotiza con tu plan (lo ya cotizado no gasta nada).
                  <div className="mt-2">
                    <Button size="sm" variant="outline" onClick={cotizarLosQueFaltan}>
                      <Truck className="size-4" /> Cotizar el envío y revisar otra vez
                    </Button>
                  </div>
                </Alert>
              )}

              <ul className="space-y-2">
                {filas.map((f) => {
                  const plan = f.plan?.listo ? f.plan : null;
                  const desde = plan ? Math.min(...plan.variantes.map((v) => v.precioVentaUsd)) : 0;
                  const neto = plan ? Math.min(...plan.variantes.map((v) => v.neto)) : 0;
                  return (
                    <li key={f.item.id} className={cn('rounded-xl border p-2', f.estado === 'hecho' ? 'border-emerald-400/30 bg-emerald-500/[0.05]' : f.estado === 'error' || f.estado === 'no' ? 'border-amber-400/25 bg-amber-500/[0.04]' : 'border-white/[0.07] bg-white/[0.02]')}>
                      <div className="flex gap-2">
                        <span className="size-14 shrink-0 overflow-hidden rounded-lg bg-black/30">
                          <Foto src={f.item.imageUrl} alt={f.item.title} ancho={240} perezosa className="size-full object-cover" />
                        </span>
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex items-start gap-2">
                            {f.estado === 'listo' && (
                              <input type="checkbox" className="mt-0.5" checked={f.incluir} disabled={Boolean(trabajando)} onChange={(e) => cambiar(f.item.id, { incluir: e.target.checked })} aria-label="Incluir en la publicación" />
                            )}
                            <p className="line-clamp-2 text-[12px] font-medium leading-snug">{plan?.contenido.titulo ?? f.item.title}</p>
                          </div>
                          {(f.estado === 'esperando' || f.estado === 'preparando' || f.estado === 'publicando') && (
                            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                              <Loader2 className="size-3.5 animate-spin" />
                              {f.estado === 'publicando' ? 'Publicando…' : f.estado === 'preparando' ? f.mensaje ?? 'Preparando…' : 'En espera'}
                            </p>
                          )}
                          {plan && (f.estado === 'listo' || f.estado === 'publicando' || f.estado === 'error') && (
                            <p className="text-[11px] text-muted-foreground">
                              {plan.variantes.length} {plan.variantes.length === 1 ? 'variante' : 'variantes'} · desde <span className="text-foreground">{usd(desde)}</span> · te quedan desde{' '}
                              <span className="text-emerald-300">{usd(neto)}</span>
                              {plan.sobrantes > 0 && ` · ${plan.sobrantes} no caben (máximo de Retador)`}
                            </p>
                          )}
                          {f.estado === 'listo' && (
                            <select
                              value={f.categoria}
                              disabled={Boolean(trabajando)}
                              onChange={(e) => cambiar(f.item.id, { categoria: e.target.value })}
                              className={cn('h-8 w-full rounded-md border bg-background px-2 text-[12px]', f.categoria ? 'border-white/10' : 'border-amber-400/50')}
                              aria-label="Categoría en Retador"
                            >
                              <option value="">Elige la categoría…</option>
                              {opciones.map((o) => (
                                <option key={o.valor} value={o.valor}>
                                  {o.texto}
                                </option>
                              ))}
                            </select>
                          )}
                          {f.estado === 'listo' && plan?.sugerencia?.porDefecto && <p className="text-[10.5px] text-amber-200/80">No encontré una categoría más parecida: revísala.</p>}
                          {(f.estado === 'no' || f.estado === 'error') && f.mensaje && (
                            <p className="flex items-start gap-1 text-[11px] text-amber-200/90">
                              <AlertCircle className="mt-0.5 size-3.5 shrink-0" /> {f.estado === 'error' ? 'No se publicó: ' : 'No se puede publicar: '}
                              {f.mensaje}
                            </p>
                          )}
                          {f.estado === 'hecho' && (
                            <p className="flex items-center gap-1 text-[11px] text-emerald-300">
                              <CheckCircle2 className="size-3.5" /> Publicado
                              {f.url && (
                                <a href={f.url} target="_blank" rel="noreferrer" className="ml-1 underline">
                                  Ver en Retador
                                </a>
                              )}
                            </p>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>

        {tienda?.status === 'CONNECTED' && (
          <footer className="space-y-2 border-t border-white/[0.07] px-4 py-3">
            {terminado ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[12px]">
                  Publicados <span className="font-semibold text-emerald-300">{hechas}</span> de {hechas + fallidas}
                  {fallidas > 0 && ' (los que fallaron dicen por qué)'}
                </p>
                <Button asChild size="sm">
                  <Link href="/products">Ver en Productos</Link>
                </Button>
              </div>
            ) : (
              <>
                <label className="flex items-start gap-2 text-[11.5px] leading-snug">
                  <input type="checkbox" className="mt-0.5" checked={precioAuto} disabled={Boolean(trabajando)} onChange={(e) => setPrecioAuto(e.target.checked)} />
                  <span>
                    <span className="font-medium">Precio automático:</span> cuando cambie el coste del proveedor, el precio sube o baja solo con tu regla (con frenos; lo
                    puedes apagar cuando quieras).
                  </span>
                </label>
                {sinCategoria.length > 0 && <p className="text-[11px] text-amber-200/90">Elige la categoría de {sinCategoria.length === 1 ? '1 producto' : `${sinCategoria.length} productos`}.</p>}
                <Button className="w-full" disabled={preparando || Boolean(trabajando) || !elegidas.length || sinCategoria.length > 0} onClick={publicarTodas}>
                  {trabajando === 'publicando' ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                  {preparando ? 'Preparando la lista…' : trabajando === 'publicando' ? 'Publicando…' : `Publicar ${elegidas.length} en Retador`}
                </Button>
              </>
            )}
          </footer>
        )}
      </div>
    </div>
  );
}
