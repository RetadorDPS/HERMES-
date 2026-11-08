'use client';

/**
 * Publicar un producto del catálogo en la tienda de Retador del usuario.
 *
 * El servidor calcula con datos reales el coste puesto en Cuba (producto + envío al hub de EE. UU. + tramo hub→Cuba por
 * peso) y esta pantalla propone el precio con la regla de margen del usuario y enseña lo que le queda de verdad
 * tras la comisión de Retador y la pasarela. Si falta un dato real (peso, envío al hub), la variante no se puede publicar.
 */
import { Foto } from './foto';
import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, ExternalLink, Loader2, Star, X } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { DEFAULT_RULE } from '@/lib/pricing';
import { reglaPredeterminada } from '@/lib/real/datos';
import { ErrorTiendaRetador, llamarTienda, obtenerTiendaRetador, type CategoriaRetador, type TiendaRetador } from '@/lib/real/retador';
import { esContratoV13, liquidacion, netoContandoEnvio, precioMinimoContandoEnvio, precioPropuesto, type CostePuestoEnCuba, type TarifasRetador } from '@/lib/retador/precios';
import { sugerirCategoria } from '@/lib/retador/sugerir-categoria';
import { cn } from '@/lib/utils';
import { BloqueVincular } from './vincular-retador';

interface VarianteServidor {
  sku: string;
  nombre: string;
  imagen: string | null;
  costeUsd: number | null;
  pesoGramos: number | null;
  stock: number | null;
  stockAlmacen?: number | null;
  stockFabrica?: number | null;
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
  /** Máximo de variantes por producto que admite Retador (lo informa su configuración; si no lo dice, 12). */
  maxVariantes?: number;
}

const usd = (n: number) => `${n.toFixed(2)} USD`;
/** Límite de variantes por producto mientras Retador no informe otro. */
const MAX_VARIANTES_POR_DEFECTO = 12;

/** Códigos de variante que Retador acepta (9/11/2026): con espacios normales, sin comillas, < >, saltos de línea ni caracteres de control, hasta 100 caracteres. */
const SKU_ADMITIDO_POR_RETADOR = /^[^<>"'\u0000-\u001f\u007f]{1,100}$/;
const MOTIVO_SKU = 'un código de variante que Retador admita (lleva comillas, signos de mayor o menor, o más de 100 caracteres)';

export function PublicarEnRetador({ itemId, titulo, categoriaProveedor, onClose }: { itemId: string; titulo: string; categoriaProveedor?: string | null; onClose: () => void }) {
  const [tienda, setTienda] = useState<TiendaRetador | null | undefined>(undefined);
  const [prep, setPrep] = useState<Preparacion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [hecho, setHecho] = useState<{ url: string | null; moderacion: string | null; estado: string | null } | null>(null);

  const [elegidas, setElegidas] = useState<Record<string, boolean>>({});
  const [precios, setPrecios] = useState<Record<string, string>>({});
  const [cat, setCat] = useState('');
  const [subcat, setSubcat] = useState('');
  const [tituloEdit, setTituloEdit] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [fotos, setFotos] = useState<string[]>([]);
  // Por defecto el precio sigue la regla del vendedor cuando cambie el coste del proveedor (se puede quitar)
  const [precioAuto, setPrecioAuto] = useState(true);

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
        // Una variante cuyo código Retador va a rechazar no se deja elegir: así no se manda una publicación que ya sabemos que falla
        p.variantes = p.variantes.map((v) => (SKU_ADMITIDO_POR_RETADOR.test(v.sku) ? v : { ...v, coste: null, faltan: [MOTIVO_SKU] }));
        setPrep(p);
        const reglaUso = regla ?? DEFAULT_RULE;
        const iniciales: Record<string, string> = {};
        const marcadas: Record<string, boolean> = {};
        let contador = 0;
        const tope = p.maxVariantes && p.maxVariantes >= 1 ? p.maxVariantes : MAX_VARIANTES_POR_DEFECTO;
        for (const v of p.variantes) {
          if (v.coste) {
            // Nunca se propone un precio con el que se pierda dinero contando el envío
            const propuesto = precioPropuesto(v.coste, reglaUso);
            const minimoSeguro = p.tarifas ? precioMinimoContandoEnvio(v.coste.total, p.tarifas, v.coste.producto) : 0;
            iniciales[v.sku] = Math.max(propuesto, minimoSeguro).toFixed(2);
            if (contador < tope && !p.yaPublicado) {
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
        // Sin categoría por defecto: la elige la persona (antes salía la primera de la lista y se podía publicar una depiladora como «Muebles»)
        setCat('');
        setSubcat('');
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
  // Sugerencia (nunca se aplica sola): la categoría más cercana de Retador según la del proveedor y el título
  const sugerencia = useMemo(() => (prep ? sugerirCategoria(prep.categorias, tituloEdit || titulo, categoriaProveedor) : null), [prep, tituloEdit, titulo, categoriaProveedor]);
  const marcadas = prep?.variantes.filter((v) => elegidas[v.sku]) ?? [];
  const maxVariantes = prep?.maxVariantes && prep.maxVariantes >= 1 ? prep.maxVariantes : MAX_VARIANTES_POR_DEFECTO;

  /** Cuentas por variante con lo que escribe el usuario. */
  const cuentas = useMemo(() => {
    const m = new Map<string, { precio: number; neto: number; margen: number; minimo: number; costeProducto: number; pasarela: number; comision: number; envio: number; netoRetador: number; netoConEnvio: number; margenConEnvio: number; totalComprador: number } | null>();
    if (!prep?.tarifas) return m;
    for (const v of prep.variantes) {
      const precio = Number(precios[v.sku]);
      if (!v.coste || !Number.isFinite(precio) || precio <= 0) {
        m.set(v.sku, null);
        continue;
      }
      const l = liquidacion(precio, v.coste.total, prep.tarifas, v.coste.producto);
      // Envío estimado = coste puesto en Cuba − costo del producto (0 si no se pudo estimar)
      const envio = v.coste.sinEnvio ? 0 : Math.max(0, Math.round((v.coste.total - v.coste.producto) * 100) / 100);
      m.set(v.sku, {
        precio,
        neto: l.neto,
        margen: l.margenNetoPct,
        // Mínimo para NO perder dinero contando el envío (nunca baja del mínimo de Retador)
        minimo: precioMinimoContandoEnvio(v.coste.total, prep.tarifas, v.coste.producto),
        costeProducto: v.coste.producto,
        pasarela: l.pasarela,
        comision: l.comision,
        envio,
        netoRetador: l.neto,
        // Cifra prudente que enseña la pantalla: el neto de Retador (que no cuenta el envío) menos el envío estimado
        netoConEnvio: netoContandoEnvio(l.neto, envio),
        margenConEnvio: precio > 0 ? (netoContandoEnvio(l.neto, envio) / precio) * 100 : 0,
        // Lo que paga el comprador en total: el precio y, aparte, el envío
        totalComprador: Math.round((precio + envio) * 100) / 100,
      });
    }
    return m;
  }, [prep, precios]);

  const perdidas = marcadas.filter((v) => {
    const c = cuentas.get(v.sku);
    return !c || c.neto < 0 || c.netoConEnvio < 0 || c.precio < c.minimo;
  });
  const sinPrecio = marcadas.filter((v) => !cuentas.get(v.sku));

  const problemas: string[] = [];
  if (!marcadas.length) problemas.push('Elige al menos una variante.');
  if (marcadas.length > maxVariantes) problemas.push(`Has elegido ${marcadas.length} variantes y Retador admite ${maxVariantes} como máximo: quita ${marcadas.length - maxVariantes}.`);
  if (sinPrecio.length) problemas.push('Pon un precio válido a todas las variantes elegidas.');
  if (perdidas.length) problemas.push('Hay variantes con las que perderías dinero contando el envío, o por debajo del mínimo de Retador. Sube el precio al mínimo que se indica.');
  if (!cat || !subcat) problemas.push('Elige categoría y subcategoría.');
  if (!tituloEdit.trim()) problemas.push('Escribe el título.');
  if (tituloEdit.length > 150) problemas.push('El título pasa de 150 caracteres.');
  if (descripcion.length > 5000) problemas.push('La descripción pasa de 5000 caracteres.');
  if (!fotos.length) problemas.push('Deja al menos una foto.');

  async function publicar() {
    if (!tienda || problemas.length) return;
    setEnviando(true);
    setError(null);
    try {
      const r = await llamarTienda<{ url: string | null; moderacion: string | null; estado: string | null }>({
        accion: 'publicar',
        storeId: tienda.id,
        itemId,
        cat,
        subcat,
        precioAuto,
        variantes: marcadas.map((v) => ({ sku: v.sku, precioVentaUsd: Number(precios[v.sku]) })),
        contenido: { titulo: tituloEdit.trim(), descripcion: descripcion.trim(), imagenes: fotos },
      });
      setHecho({ url: r.url, moderacion: r.moderacion, estado: r.estado ?? null });
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
            <Alert variant="warning" title="Vincula tu cuenta con Retador">
              Para publicar en Retador, primero vincula tu cuenta. Después podrás pulsar «Publicar en Retador».
              <div className="mt-3">
                <BloqueVincular />
              </div>
            </Alert>
          )}

          {error && !prep && <Alert variant="danger">{error}</Alert>}

          {prep && !hecho && !prep.yaPublicado && prep.variantes.length > 0 && prep.variantes.every((v) => v.faltan.includes(MOTIVO_SKU)) && (
            <Alert variant="warning" title="Este producto todavía no se puede publicar en Retador">
              Los códigos de todas sus variantes llevan comillas, signos de mayor o menor, o pasan de 100 caracteres, y Retador no los acepta.
            </Alert>
          )}

          {hecho && hecho.estado === 'agotado' && (
            <Alert variant="warning" title="Publicado, pero AGOTADO: los compradores no lo ven">
              Retador lo dejó agotado porque no tiene existencias. Aparece en tu panel de productos, pero no en el mercado ni en tu tienda. Cuando quieras venderlo, ponle existencias desde «Productos en Retador» (Precio y stock).
            </Alert>
          )}

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
                  {esContratoV13(prep.tarifas)
                    ? 'El comprador paga el producto y el envío; el envío lo cotiza Retador al comprar. Aquí se estima con las cotizaciones del proveedor para que veas lo que de verdad te queda.'
                    : 'Coste estimado = producto + envío estimado.'}
                </p>
                <div className="flex flex-wrap items-center justify-between gap-2 text-[12px]">
                  <span className={cn(marcadas.length > maxVariantes ? 'font-medium text-rose-300' : 'text-muted-foreground')}>
                    Elegidas: <b>{marcadas.length}</b> de {prep.variantes.length}{prep.variantes.length > maxVariantes ? ` · Retador admite ${maxVariantes} por producto` : ''}
                  </span>
                  {marcadas.length > 0 && (
                    <button type="button" className="rounded-md px-2 py-1 text-indigo-300 hover:bg-white/10" onClick={() => setElegidas({})}>
                      Quitar todas
                    </button>
                  )}
                </div>
                <div className="space-y-2">
                  {prep.variantes.map((v) => {
                    const c = cuentas.get(v.sku);
                    const activa = Boolean(elegidas[v.sku]);
                    const llenas = !activa && marcadas.length >= maxVariantes;
                    return (
                      <div key={v.sku} className={cn('rounded-lg border p-2.5 text-[12px]', activa ? 'border-indigo-400/40 bg-indigo-500/[0.06]' : 'border-white/10 bg-white/[0.02]', !v.coste && 'opacity-70')}>
                        <label className="flex items-start gap-2">
                          <input
                            type="checkbox"
                            className="mt-0.5"
                            checked={activa}
                            disabled={!v.coste || llenas}
                            onChange={(e) => setElegidas((x) => ({ ...x, [v.sku]: e.target.checked }))}
                          />
                          {v.imagen && (
                            <Foto src={v.imagen} ancho={240} className="size-9 shrink-0 rounded object-cover" />
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">{v.nombre}</span>
                            {v.coste ? (
                              <span className="block text-muted-foreground">
                                {v.coste.sinEnvio ? (
                                  <>
                                    Producto <b className="text-foreground">{usd(v.coste.producto)}</b> · envío sin estimar (Retador lo cotiza al comprar): el neto se calcula sin envío
                                  </>
                                ) : (
                                  <>
                                    Producto {usd(v.coste.producto)} · envío estimado {usd(Math.round((v.coste.envioHub + v.coste.hubCuba) * 100) / 100)} = <b className="text-foreground">{usd(v.coste.total)}</b>
                                  </>
                                )}
                              </span>
                            ) : (
                              <span className="flex items-start gap-1 text-amber-300">
                                <AlertCircle className="mt-0.5 size-3.5 shrink-0" /> No se puede publicar: falta {v.faltan.join(', ')}.
                              </span>
                            )}
                            <span className="block text-muted-foreground">
                              Stock:{' '}
                              {v.stock === null ? <span className="text-amber-300">sin dato del proveedor</span> : v.stock === 0 ? <span className="text-amber-300">sin stock (ni en almacén ni en fábrica)</span> : v.stockAlmacen !== null && v.stockAlmacen !== undefined && v.stockFabrica !== null && v.stockFabrica !== undefined ? `${v.stock.toLocaleString('es-ES')} (${v.stockAlmacen.toLocaleString('es-ES')} en almacén + ${v.stockFabrica.toLocaleString('es-ES')} en fábrica)` : `${v.stock.toLocaleString('es-ES')} verificados`}
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
                              USD
                            </label>
                            {c ? (
                              <span className={cn('font-medium', c.netoConEnvio < 0 || c.precio < c.minimo ? 'text-rose-300' : 'text-emerald-300')}>
                                Te quedan {usd(c.netoConEnvio)} netos{c.envio > 0 ? ', ya contando el envío' : ''} ({c.margenConEnvio.toFixed(0)} %)
                                {c.precio < c.minimo && ` · precio mínimo para no perder: ${usd(c.minimo)}`}
                              </span>
                            ) : (
                              <span className="text-amber-300">Pon un precio</span>
                            )}
                          </div>
                        )}
                        {activa && v.coste && c && (
                          <div className="mt-2 space-y-1.5 pl-6">
                            {c.envio > 0 && (
                              <p className="text-muted-foreground">
                                El comprador pagará <b className="text-foreground">{usd(c.totalComprador)}</b> en total: {usd(c.precio)} del producto + {usd(c.envio)} de envío estimado.
                                {c.totalComprador > c.costeProducto * 3 && ` Es ${(c.totalComprador / c.costeProducto).toFixed(1)} veces lo que cuesta el producto: revisa que el precio sea competitivo.`}
                              </p>
                            )}
                            <details className="text-muted-foreground">
                              <summary className="cursor-pointer text-indigo-300">Ver la cuenta completa</summary>
                              <ul className="mt-1 space-y-0.5">
                                <li>Precio de venta: <b className="text-foreground">{usd(c.precio)}</b></li>
                                <li>− Costo del producto en el proveedor: {usd(c.costeProducto)}</li>
                                {c.envio > 0 && <li>− Envío estimado (proveedor → hub → destino): {usd(c.envio)}</li>}
                                <li>− Pasarela de pago: {usd(c.pasarela)}</li>
                                <li>− Comisión de Retador: {usd(c.comision)}</li>
                                <li>= Te quedan{c.envio > 0 ? ', contando el envío' : ''}: <b className="text-foreground">{usd(c.netoConEnvio)}</b></li>
                              </ul>
                              {c.envio > 0 && (
                                <p className="mt-1.5 text-[11px]">
                                  Retador calcula {usd(c.netoRetador)} porque no descuenta el envío: se lo cobra al comprador aparte. Mientras Retador no confirme que ese dinero te llega entero, te enseñamos la cifra prudente (la de arriba).
                                </p>
                              )}
                            </details>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                {prep.tarifas && (
                  <p className="text-[11px] text-muted-foreground">
                    {esContratoV13(prep.tarifas) && prep.tarifas.pasarelaACargo !== 'retador' && prep.tarifas.pasarelaACargo !== 'comprador' ? (
                      <>
                        Neto = (precio − costo del producto − pasarela) − comisión de Retador ({prep.tarifas.comisionPctGanancia} % de esa ganancia). La pasarela ({prep.tarifas.pasarelaPct} % + {usd(prep.tarifas.pasarelaFijaUsd)}) se calcula sobre el total
                        que paga el comprador (producto + envío) y la pagas tú. El envío lo paga el comprador aparte: aquí se estima con la cotización del proveedor; el real lo cotiza Retador al comprar. El precio mínimo es el mismo del Importador de Retador y no incluye el envío.
                      </>
                    ) : (
                      <>
                        Neto = (precio − costo del producto) − comisión de Retador ({prep.tarifas.comisionPctGanancia} % de esa ganancia)
                        {prep.tarifas.pasarelaACargo === 'retador' ? '. La pasarela de pago la asume Retador.' : prep.tarifas.pasarelaACargo === 'comprador' ? '. La pasarela la paga el comprador.' : ` − pasarela (${prep.tarifas.pasarelaPct} % + ${usd(prep.tarifas.pasarelaFijaUsd)}).`}{' '}
                        {esContratoV13(prep.tarifas) ? 'El precio mínimo es el mismo del Importador de Retador y no incluye el envío.' : 'El precio mínimo que acepta Retador es el coste estimado.'}
                      </>
                    )}{' '}
                    Estimación con las tarifas que informa Retador.
                  </p>
                )}
                {prep.costeReferencia?.proveedor === 'aliexpress' && prep.costeReferencia.pais !== 'US' && (
                  <Alert variant="warning" title="Coste de AliExpress para otro país">
                    El coste de tu ficha es el de {prep.costeReferencia.pais ? prep.costeReferencia.pais : 'un país no registrado'}; Retador usa el precio para EE. UU. Si difiere, Retador te dirá el mínimo real al publicar.
                  </Alert>
                )}
              </section>

              {/* Dónde se publica */}
              {sugerencia && !(cat === sugerencia.cat && subcat === sugerencia.subcat) && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-indigo-400/25 bg-indigo-400/[0.06] p-2.5 text-[12px]">
                  <span className="min-w-0 flex-1">
                    Categoría sugerida: <b>{sugerencia.nombreCat} › {sugerencia.subcat}</b>
                    {categoriaProveedor ? <span className="text-muted-foreground"> (según «{categoriaProveedor}»)</span> : null}. Revísala antes de usarla.
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setCat(sugerencia.cat);
                      setSubcat(sugerencia.subcat);
                    }}
                  >
                    Usar esta
                  </Button>
                </div>
              )}
              <section className="grid gap-2 sm:grid-cols-3">
                <label className="space-y-1 text-[12px]">
                  <span className="text-muted-foreground">Categoría en Retador</span>
                  <select
                    className="h-9 w-full rounded-lg border border-white/10 bg-white/[0.03] px-2 text-sm"
                    value={cat}
                    onChange={(e) => {
                      setCat(e.target.value);
                      setSubcat('');
                    }}
                  >
                    <option value="">Elige una categoría…</option>
                    {prep.categorias.map((c) => (
                      <option key={c.cat} value={c.cat}>
                        {c.nombre}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1 text-[12px]">
                  <span className="text-muted-foreground">Subcategoría</span>
                  <select className="h-9 w-full rounded-lg border border-white/10 bg-white/[0.03] px-2 text-sm" value={subcat} onChange={(e) => setSubcat(e.target.value)} disabled={!categoria}>
                    <option value="">Elige una subcategoría…</option>
                    {(categoria?.subcategorias ?? []).map((s) => (
                      <option key={s} value={s}>
                        {s}
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
                        <Foto src={url} ancho={240} className="size-full object-cover" />
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
          {error && prep && <Alert variant="danger" title="No se pudo publicar">{error}</Alert>}
          {problemas.length > 0 && prep && !hecho && !prep.yaPublicado && <p className="text-[11px] text-amber-300">{problemas[0]}</p>}
          {prep && !hecho && !prep.yaPublicado && (
            <label className="flex items-start gap-2 text-[12px]">
              <input type="checkbox" className="mt-0.5 size-3.5 accent-indigo-500" checked={precioAuto} onChange={(e) => setPrecioAuto(e.target.checked)} />
              <span>
                <strong>Precio automático:</strong> cuando cambie el coste del proveedor, mi precio sube o baja solo con mi regla de precios (con frenos para que no baile; lo puedes apagar cuando quieras).
              </span>
            </label>
          )}
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
