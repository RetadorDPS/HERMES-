'use client';

/**
 * Publicar un producto del catálogo en la tienda de Retador del usuario.
 *
 * El servidor calcula con datos reales el coste puesto en Cuba (producto + envío al hub de EE. UU. + tramo hub→Cuba por
 * peso) y esta pantalla propone el precio con la regla de margen del usuario y enseña lo que le queda de verdad
 * tras la comisión de Retador y la pasarela. Si falta un dato real (peso, envío al hub), la variante no se puede publicar.
 */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, CheckCircle2, ExternalLink, Loader2, Star, X } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { DEFAULT_RULE } from '@/lib/pricing';
import { reglaPredeterminada } from '@/lib/real/datos';
import { ErrorTiendaRetador, llamarTienda, obtenerTiendaRetador, type CategoriaRetador, type TiendaRetador } from '@/lib/real/retador';
import { liquidacion, precioMinimoSinPerdida, precioPropuesto, type CostePuestoEnCuba, type TarifasRetador } from '@/lib/retador/precios';
import { cn } from '@/lib/utils';

interface VarianteServidor {
  sku: string;
  nombre: string;
  imagen: string | null;
  costeUsd: number | null;
  pesoGramos: number | null;
  stock: number | null;
  coste: CostePuestoEnCuba | null;
  faltan: string[];
}
interface Preparacion {
  tarifas: TarifasRetador | null;
  categorias: CategoriaRetador[];
  provincias: string[];
  proveedor: 'cj' | 'aliexpress';
  envioHub: { precio: number; origen: string; dias: [number, number] | null } | null;
  contenido: { titulo: string; descripcion: string; imagenes: string[] };
  variantes: VarianteServidor[];
  yaPublicado: { productId: string; estado: string } | null;
  costeReferencia?: { pais: string | null; proveedor: 'cj' | 'aliexpress' };
}

const usd = (n: number) => `${n.toFixed(2)} US$`;
const MAX_VARIANTES = 12;

export function PublicarEnRetador({ itemId, titulo, onClose }: { itemId: string; titulo: string; onClose: () => void }) {
  const [tienda, setTienda] = useState<TiendaRetador | null | undefined>(undefined);
  const [prep, setPrep] = useState<Preparacion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [hecho, setHecho] = useState<{ url: string | null; moderacion: string | null } | null>(null);

  const [elegidas, setElegidas] = useState<Record<string, boolean>>({});
  const [precios, setPrecios] = useState<Record<string, string>>({});
  const [cat, setCat] = useState('');
  const [subcat, setSubcat] = useState('');
  const [provincia, setProvincia] = useState('');
  const [tituloEdit, setTituloEdit] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [fotos, setFotos] = useState<string[]>([]);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const t = await obtenerTiendaRetador();
        if (!vivo) return;
        setTienda(t);
        if (!t || t.status !== 'CONNECTED') return;
        const [p, regla] = await Promise.all([llamarTienda<Preparacion>({ accion: 'preparar', storeId: t.id, itemId }), reglaPredeterminada().catch(() => null)]);
        if (!vivo) return;
        setPrep(p);
        const reglaUso = regla ?? DEFAULT_RULE;
        const iniciales: Record<string, string> = {};
        const marcadas: Record<string, boolean> = {};
        let contador = 0;
        for (const v of p.variantes) {
          if (v.coste) {
            iniciales[v.sku] = precioPropuesto(v.coste, reglaUso).toFixed(2);
            if (contador < MAX_VARIANTES && !p.yaPublicado) {
              marcadas[v.sku] = true;
              contador++;
            }
          }
        }
        setPrecios(iniciales);
        setElegidas(marcadas);
        setTituloEdit(p.contenido.titulo);
        setDescripcion(p.contenido.descripcion);
        setFotos(p.contenido.imagenes);
        const primera = p.categorias[0];
        setCat(primera?.cat ?? '');
        setSubcat(primera?.subcategorias[0] ?? '');
        setProvincia(p.provincias.includes('La Habana') ? 'La Habana' : p.provincias[0] ?? '');
      } catch (e) {
        if (vivo) setError((e as Error).message);
      } finally {
        if (vivo) setCargando(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [itemId]);

  const categoria = prep?.categorias.find((c) => c.cat === cat);
  const marcadas = prep?.variantes.filter((v) => elegidas[v.sku]) ?? [];

  /** Cuentas por variante con lo que escribe el usuario. */
  const cuentas = useMemo(() => {
    const m = new Map<string, { precio: number; neto: number; margen: number; minimo: number } | null>();
    if (!prep?.tarifas) return m;
    for (const v of prep.variantes) {
      const precio = Number(precios[v.sku]);
      if (!v.coste || !Number.isFinite(precio) || precio <= 0) {
        m.set(v.sku, null);
        continue;
      }
      const l = liquidacion(precio, v.coste.total, prep.tarifas, v.coste.producto);
      m.set(v.sku, { precio, neto: l.neto, margen: l.margenNetoPct, minimo: precioMinimoSinPerdida(v.coste.total, prep.tarifas, v.coste.producto) });
    }
    return m;
  }, [prep, precios]);

  const perdidas = marcadas.filter((v) => {
    const c = cuentas.get(v.sku);
    return !c || c.neto < 0 || c.precio < c.minimo;
  });
  const sinPrecio = marcadas.filter((v) => !cuentas.get(v.sku));
  const problemas: string[] = [];
  if (!marcadas.length) problemas.push('Elige al menos una variante.');
  if (marcadas.length > MAX_VARIANTES) problemas.push(`Como máximo ${MAX_VARIANTES} variantes.`);
  if (sinPrecio.length) problemas.push('Pon un precio válido a todas las variantes elegidas.');
  if (perdidas.length) problemas.push('Hay variantes por debajo del precio mínimo (coste puesto en Cuba). Sube el precio.');
  if (!cat || !subcat) problemas.push('Elige categoría y subcategoría.');
  if (!provincia) problemas.push('Elige la provincia.');
  if (!tituloEdit.trim()) problemas.push('Escribe el título.');
  if (tituloEdit.length > 150) problemas.push('El título pasa de 150 caracteres.');
  if (descripcion.length > 5000) problemas.push('La descripción pasa de 5000 caracteres.');
  if (!fotos.length) problemas.push('Deja al menos una foto.');

  async function publicar() {
    if (!tienda || problemas.length) return;
    setEnviando(true);
    setError(null);
    try {
      const r = await llamarTienda<{ url: string | null; moderacion: string | null }>({
        accion: 'publicar',
        storeId: tienda.id,
        itemId,
        cat,
        subcat,
        provincia,
        variantes: marcadas.map((v) => ({ sku: v.sku, precioVentaUsd: Number(precios[v.sku]) })),
        contenido: { titulo: tituloEdit.trim(), descripcion: descripcion.trim(), imagenes: fotos },
      });
      setHecho({ url: r.url, moderacion: r.moderacion });
    } catch (e) {
      const err = e as ErrorTiendaRetador;
      setError(err.message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Publicar en Retador">
      <div className="flex max-h-[94vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl border border-white/10 bg-[#0e1220] shadow-2xl sm:rounded-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-white/[0.07] px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">Publicar en Retador</h2>
            <p className="truncate text-[12px] text-muted-foreground">{titulo}</p>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="rounded-md p-1 text-muted-foreground hover:bg-white/10 hover:text-foreground">
            <X className="size-4" />
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-3">
          {cargando && (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Calculando costes reales con Retador…
            </div>
          )}

          {!cargando && tienda !== undefined && (!tienda || tienda.status !== 'CONNECTED') && (
            <Alert variant="warning" title="Primero conecta tu tienda de Retador">
              Pega tu token de Retador en{' '}
              <Link href="/stores" className="underline">
                Tiendas conectadas
              </Link>{' '}
              y vuelve aquí.
            </Alert>
          )}

          {error && <Alert variant="danger">{error}</Alert>}

          {hecho && (
            <Alert variant="success" title="Publicado en Retador">
              Tu producto ya está en tu tienda de Retador{hecho.moderacion === 'pending' ? ' (pendiente de revisión)' : ''}.{' '}
              {hecho.url && (
                <a href={hecho.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline">
                  Verlo en Retador <ExternalLink className="size-3" />
                </a>
              )}
            </Alert>
          )}

          {prep?.yaPublicado && !hecho && (
            <Alert variant="info" title="Ya lo tienes publicado">
              Este producto ya está en tu tienda de Retador. Para cambiar precio o stock usa «Productos».
            </Alert>
          )}

          {prep && !hecho && !prep.yaPublicado && (
            <>
              {!prep.tarifas && (
                <Alert variant="danger" title="Retador no ha enviado sus tarifas">
                  Sin ellas no se puede calcular tu beneficio. Pulsa «Actualizar datos» en Tiendas conectadas o inténtalo más tarde.
                </Alert>
              )}

              {/* Variantes y precios */}
              <section className="space-y-2">
                <h3 className="text-[13px] font-semibold">Variantes y precio de venta (en dólares)</h3>
                <p className="text-[12px] text-muted-foreground">
                  Coste puesto en Cuba = producto + envío del proveedor al hub de EE. UU.
                  {prep.envioHub ? ` (${usd(prep.envioHub.precio)}, desde ${prep.envioHub.origen})` : ' (sin cotización: pide el envío a EE. UU. desde la ficha)'} + hub→Cuba por peso.
                </p>
                <div className="space-y-2">
                  {prep.variantes.map((v) => {
                    const c = cuentas.get(v.sku);
                    const activa = Boolean(elegidas[v.sku]);
                    return (
                      <div key={v.sku} className={cn('rounded-lg border p-2.5 text-[12px]', activa ? 'border-indigo-400/40 bg-indigo-500/[0.06]' : 'border-white/10 bg-white/[0.02]', !v.coste && 'opacity-70')}>
                        <label className="flex items-start gap-2">
                          <input
                            type="checkbox"
                            className="mt-0.5"
                            checked={activa}
                            disabled={!v.coste}
                            onChange={(e) => setElegidas((x) => ({ ...x, [v.sku]: e.target.checked }))}
                          />
                          {v.imagen && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={v.imagen} alt="" className="size-9 shrink-0 rounded object-cover" />
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">{v.nombre}</span>
                            {v.coste ? (
                              <span className="block text-muted-foreground">
                                Producto {usd(v.coste.producto)} · envío al hub {usd(v.coste.envioHub)} · hub→Cuba {usd(v.coste.hubCuba)} = <b className="text-foreground">{usd(v.coste.total)}</b>
                              </span>
                            ) : (
                              <span className="flex items-start gap-1 text-amber-300">
                                <AlertCircle className="mt-0.5 size-3.5 shrink-0" /> No se puede publicar: falta {v.faltan.join(', ')}.
                              </span>
                            )}
                            <span className="block text-muted-foreground">
                              Stock:{' '}
                              {v.stock === null ? 'sin dato del proveedor (Retador usará una cifra prudente y la marcará como estimada)' : v.stock === 0 ? <span className="text-amber-300">0 verificado: saldría agotado</span> : `${v.stock} verificados`}
                            </span>
                          </span>
                        </label>
                        {activa && v.coste && (
                          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 pl-6">
                            <label className="flex items-center gap-1.5">
                              Precio
                              <Input
                                inputMode="decimal"
                                className="h-8 w-24"
                                value={precios[v.sku] ?? ''}
                                onChange={(e) => setPrecios((x) => ({ ...x, [v.sku]: e.target.value.replace(',', '.') }))}
                                aria-label={`Precio de ${v.nombre}`}
                              />
                              US$
                            </label>
                            {c ? (
                              <span className={cn('font-medium', c.neto < 0 || c.precio < c.minimo ? 'text-rose-300' : 'text-emerald-300')}>
                                Te quedan {usd(c.neto)} netos ({c.margen.toFixed(0)} %)
                                {c.precio < c.minimo && ` · mínimo ${usd(c.minimo)}`}
                              </span>
                            ) : (
                              <span className="text-amber-300">Pon un precio</span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                {prep.tarifas && (
                  <p className="text-[11px] text-muted-foreground">
                    Neto = (precio − costo del producto) − comisión de Retador ({prep.tarifas.comisionPctGanancia} % de esa ganancia)
                    {prep.tarifas.pasarelaACargo === 'retador' ? '. La pasarela de pago la asume Retador.' : prep.tarifas.pasarelaACargo === 'comprador' ? '. La pasarela la paga el comprador.' : ` − pasarela (${prep.tarifas.pasarelaPct} % + ${usd(prep.tarifas.pasarelaFijaUsd)}).`}{' '}
                    El precio mínimo que acepta Retador es el coste puesto en Cuba. Estimación con las tarifas que informa Retador.
                  </p>
                )}
                {prep.costeReferencia?.proveedor === 'aliexpress' && prep.costeReferencia.pais !== 'US' && (
                  <Alert variant="warning" title="Coste de AliExpress para otro país">
                    El coste de tu ficha es el de {prep.costeReferencia.pais ? prep.costeReferencia.pais : 'un país no registrado'}; Retador usa el precio para EE. UU. Si difiere, Retador te dirá el mínimo real al publicar.
                  </Alert>
                )}
              </section>

              {/* Dónde se publica */}
              <section className="grid gap-2 sm:grid-cols-3">
                <label className="space-y-1 text-[12px]">
                  <span className="text-muted-foreground">Categoría en Retador</span>
                  <select
                    className="h-9 w-full rounded-lg border border-white/10 bg-white/[0.03] px-2 text-sm"
                    value={cat}
                    onChange={(e) => {
                      setCat(e.target.value);
                      setSubcat(prep.categorias.find((c) => c.cat === e.target.value)?.subcategorias[0] ?? '');
                    }}
                  >
                    {prep.categorias.map((c) => (
                      <option key={c.cat} value={c.cat}>
                        {c.nombre}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1 text-[12px]">
                  <span className="text-muted-foreground">Subcategoría</span>
                  <select className="h-9 w-full rounded-lg border border-white/10 bg-white/[0.03] px-2 text-sm" value={subcat} onChange={(e) => setSubcat(e.target.value)}>
                    {(categoria?.subcategorias ?? []).map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1 text-[12px]">
                  <span className="text-muted-foreground">Provincia</span>
                  <select className="h-9 w-full rounded-lg border border-white/10 bg-white/[0.03] px-2 text-sm" value={provincia} onChange={(e) => setProvincia(e.target.value)}>
                    {prep.provincias.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </label>
              </section>

              {/* Contenido */}
              <section className="space-y-2">
                <h3 className="text-[13px] font-semibold">Lo que verán los compradores</h3>
                <label className="block space-y-1 text-[12px]">
                  <span className="flex justify-between text-muted-foreground">
                    Título <span className={tituloEdit.length > 150 ? 'text-rose-300' : ''}>{tituloEdit.length}/150</span>
                  </span>
                  <Input value={tituloEdit} onChange={(e) => setTituloEdit(e.target.value)} />
                </label>
                <label className="block space-y-1 text-[12px]">
                  <span className="flex justify-between text-muted-foreground">
                    Descripción (texto, sin formato) <span className={descripcion.length > 5000 ? 'text-rose-300' : ''}>{descripcion.length}/5000</span>
                  </span>
                  <Textarea rows={6} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />
                </label>
                <p className="text-[11px] text-muted-foreground">El título y la descripción vienen del proveedor tal cual (normalmente en inglés). Tradúcelos aquí si quieres.</p>
                <div className="space-y-1">
                  <span className="text-[12px] text-muted-foreground">Fotos (la primera es la portada, máximo 9)</span>
                  <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                    {fotos.map((url, i) => (
                      <div key={url} className="group relative aspect-square overflow-hidden rounded-lg border border-white/10">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={url} alt="" className="size-full object-cover" />
                        {i === 0 && <Badge className="absolute left-1 top-1 gap-1 bg-black/70 px-1 py-0 text-[10px]"><Star className="size-2.5" /> Portada</Badge>}
                        <div className="absolute inset-x-0 bottom-0 flex justify-between bg-black/60 p-0.5">
                          {i > 0 ? (
                            <button type="button" title="Poner de portada" aria-label="Poner de portada" className="size-6 rounded text-[13px] hover:bg-white/15" onClick={() => setFotos((f) => [url, ...f.filter((x) => x !== url)])}>
                              ★
                            </button>
                          ) : (
                            <span />
                          )}
                          <button type="button" title="Quitar foto" aria-label="Quitar foto" className="size-6 rounded text-[13px] text-rose-300 hover:bg-white/15" onClick={() => setFotos((f) => f.filter((x) => x !== url))}>
                            ✕
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            </>
          )}
        </div>

        <footer className="space-y-1.5 border-t border-white/[0.07] px-4 py-3">
          {problemas.length > 0 && prep && !hecho && !prep.yaPublicado && <p className="text-[11px] text-amber-300">{problemas[0]}</p>}
          {hecho ? (
            <Button className="w-full" variant="gradient" onClick={onClose}>
              <CheckCircle2 /> Listo
            </Button>
          ) : (
            <Button className="w-full" variant="gradient" disabled={enviando || !prep || problemas.length > 0 || Boolean(prep?.yaPublicado)} onClick={() => void publicar()}>
              {enviando ? <Loader2 className="animate-spin" /> : null} Publicar en Retador
            </Button>
          )}
        </footer>
      </div>
    </div>
  );
}
