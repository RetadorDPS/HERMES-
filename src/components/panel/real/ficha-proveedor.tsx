'use client';

/**
 * Ficha completa de un artículo del proveedor (datos reales de Supabase).
 *
 * Reúne todo lo que el usuario necesita antes de importar: fotos, precio de coste, stock por almacén,
 * variantes, características, envío por almacén de origen y país de destino (precio y días), reseñas y descripción.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, ExternalLink, Loader2, Package, Star, Truck, X } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatNumber, cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase/cliente';
import { obtenerPerfil } from '@/lib/real/datos';
import { nombrePais, PAISES_FRECUENTES } from '@/lib/paises';
import { ProviderBadge } from '@/app/(dashboard)/catalog/catalog-card';

/* ───────────── utilidades de presentación ───────────── */

const usd = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} US$`);

const pais = nombrePais;

const dias = (min: number | null, max: number | null) => (min === null && max === null ? 'sin plazo' : min === max || max === null ? `${min} días` : `${min ?? '?'}–${max} días`);

/** Convierte el HTML de la descripción en párrafos de texto. */
function textoDeHtml(html: string): string[] {
  return String(html ?? '')
    .replace(/<\s*(\/p|br\s*\/?|\/li|\/h\d|\/div|\/tr)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

const CARACTERISTICAS: Record<string, string> = {
  COMMON: 'Producto normal',
  HAVE_LIQUID: 'Contiene líquido',
  HAVE_CREAM: 'Contiene crema',
  HAVE_POWDER: 'Contiene polvo',
  HAVE_BATTERY: 'Lleva batería',
  BATTERY: 'Lleva batería',
  HAVE_MAGNETIC: 'Contiene imán',
  OVERSIZE: 'Tamaño grande',
  CLOTHES: 'Ropa',
  FOOD: 'Alimento',
};
const etiquetaCaracteristica = (c: string) => CARACTERISTICAS[c.toUpperCase()] ?? CARACTERISTICAS[c] ?? c;

interface Opcion {
  nombre: string;
  precio: number | null;
  diasMin: number | null;
  diasMax: number | null;
}
interface Cotizacion {
  variante?: string;
  actualizado?: string;
  opciones: Opcion[];
  error?: string;
}

/* ───────────── componente ───────────── */

export function FichaProveedor({ itemId, onClose }: { itemId: string | null; onClose: () => void }) {
  const [item, setItem] = useState<any>(null);
  const [ficha, setFicha] = useState<any>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [foto, setFoto] = useState(0);
  const [destino, setDestino] = useState('');
  const [verVariantes, setVerVariantes] = useState(false);
  const [esAdmin, setEsAdmin] = useState(false);
  const [trabajando, setTrabajando] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [otroPais, setOtroPais] = useState('');

  const cargar = useCallback(async (id: string) => {
    setCargando(true);
    setError(null);
    try {
      const c = supabase();
      const [a, b, perfil] = await Promise.all([
        c
          .from('CatalogItem')
          .select('id,provider,externalId,title,description,categoryName,imageUrl,images,currency,costPrice,stock,rating,ordersCount,sourceUrl,lastSyncedAt')
          .eq('id', id)
          .maybeSingle(),
        c.from('CatalogItemDetail').select('ficha,fetchedAt').eq('itemId', id).maybeSingle(),
        obtenerPerfil().catch(() => null),
      ]);
      if (a.error) throw new Error(a.error.message);
      if (b.error) throw new Error(b.error.message);
      if (!a.data) throw new Error('No se encontró el artículo');
      setItem(a.data);
      setFicha((b.data as any)?.ficha ?? null);
      setEsAdmin(perfil?.perfil?.role === 'ADMIN');
      setFoto(0);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    if (itemId) {
      setAviso(null);
      void cargar(itemId);
    } else {
      setItem(null);
      setFicha(null);
    }
  }, [itemId, cargar]);

  /** Acciones del administrador sobre este artículo (completar ficha, cotizar envío). */
  const ejecutarCj = async (accion: 'detalle' | 'envio', extra: Record<string, unknown> = {}) => {
    if (!itemId) return;
    setTrabajando(accion);
    setAviso(null);
    const { data, error: e } = await supabase().functions.invoke(item?.provider === 'ALIEXPRESS' ? 'ali-catalogo' : 'cj-catalogo', { body: { accion, ids: [itemId], ...extra } });
    setTrabajando(null);
    if (e || !data?.ok) {
      let texto = e?.message ?? data?.error ?? 'No se pudo completar';
      try {
        const j = await (e as any)?.context?.json?.();
        if (j?.error) texto = j.error;
      } catch {
        /* sin cuerpo */
      }
      setAviso(texto);
      return;
    }
    setAviso(data.mensaje ?? 'Hecho');
    await cargar(itemId);
  };

  /* ── datos derivados ── */
  const imagenes: string[] = useMemo(() => {
    const lista: string[] = ficha?.imagenes?.length ? ficha.imagenes : item?.images?.length ? item.images : item?.imageUrl ? [item.imageUrl] : [];
    return lista;
  }, [ficha, item]);

  const porOrigen = useMemo<Record<string, Record<string, Cotizacion>>>(() => ficha?.envio?.porOrigen ?? {}, [ficha]);
  const origenes = useMemo<{ pais: string; total: number | null }[]>(() => ficha?.origenes ?? [], [ficha]);
  // Destinos sin servicio (guardados aparte): también se pueden elegir para ver el aviso
  const sinServicioGlobal = useMemo<Record<string, any>>(() => ficha?.envio?.sinServicio ?? {}, [ficha]);
  const destinos = useMemo(() => {
    const s = new Set<string>();
    for (const d of Object.values(porOrigen)) for (const k of Object.keys(d)) s.add(k);
    for (const k of Object.keys(sinServicioGlobal)) s.add(k);
    return [...s].sort((a, b) => pais(a).localeCompare(pais(b), 'es'));
  }, [porOrigen, sinServicioGlobal]);
  const destinoActivo = destino || (destinos.includes('ES') ? 'ES' : destinos[0] ?? '');

  const filasEnvio = useMemo(() => {
    if (!destinoActivo) return { filas: [] as any[], sinServicio: [] as string[], porCotizar: [] as string[] };
    const origenesConocidos = new Set<string>([...origenes.filter((o) => (o.total ?? 0) > 0).map((o) => o.pais), ...Object.keys(porOrigen)]);
    const filas: any[] = [];
    const sinServicio: string[] = [];
    const porCotizar: string[] = [];
    for (const o of origenesConocidos) {
      const q = porOrigen[o]?.[destinoActivo];
      const stock = origenes.find((x) => x.pais === o)?.total ?? null;
      // En AliExpress el almacén lo decide cada cotización: que un almacén no tenga cotización para este destino no significa que falte
      if (!q) { if (item?.provider !== 'ALIEXPRESS') porCotizar.push(o); }
      else if (q.error || !q.opciones?.length) sinServicio.push(o);
      else for (const op of q.opciones) filas.push({ origen: o, stock, ...op });
    }
    filas.sort((x, y) => (x.precio ?? 1e9) - (y.precio ?? 1e9));
    const masRapida = [...filas].sort((x, y) => (x.diasMax ?? 1e9) - (y.diasMax ?? 1e9))[0];
    const masBarata = filas[0];
    return { filas: filas.map((f) => ({ ...f, barata: f === masBarata, rapida: f === masRapida })), sinServicio, porCotizar };
  }, [destinoActivo, origenes, porOrigen, item?.provider]);

  const nombreProveedor = item?.provider === 'ALIEXPRESS' ? 'AliExpress' : 'CJ';
  const variantes: any[] = ficha?.variantes ?? [];
  const variantesVisibles = verVariantes ? variantes : variantes.slice(0, 6);
  const resenas = ficha?.resenas;
  const textoDescripcion = useMemo(() => textoDeHtml(ficha?.descripcionHtml ?? item?.description ?? ''), [ficha, item]);
  const ruta: string = Array.isArray(ficha?.categoria?.ruta) ? ficha.categoria.ruta.join(' › ') : item?.categoryName ?? '';
  const varianteCotizada = variantes.find((v) => v.vid && v.vid === Object.values(porOrigen).flatMap((d) => Object.values(d))[0]?.variante);

  if (!itemId) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm">
      <button type="button" aria-label="Cerrar" className="flex-1 cursor-default" onClick={onClose} />
      <aside className="flex h-full w-full max-w-[760px] flex-col border-l border-white/10 bg-[#0b0d12] shadow-2xl">
        <header className="flex items-center justify-between gap-3 border-b border-white/[0.07] px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2 text-sm font-semibold">
            <Package className="size-4 shrink-0 text-indigo-300" />
            <span className="truncate">Ficha del producto</span>
            {item && <ProviderBadge provider={item.provider} />}
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-3">
          {cargando && !item && (
            <p className="flex items-center gap-2 text-[12px] text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Cargando la ficha…
            </p>
          )}
          {error && (
            <Alert variant="danger" title="No se pudo cargar el artículo">
              {error}
            </Alert>
          )}

          {item && (
            <>
              {/* Galería y resumen */}
              <div className="grid gap-3 sm:grid-cols-[230px,1fr]">
                <div className="space-y-2">
                  <div className="overflow-hidden rounded-xl border border-white/[0.07] bg-black/30">
                    {imagenes[foto] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={imagenes[foto]} alt={item.title} className="max-h-64 w-full object-contain sm:aspect-square sm:max-h-none sm:object-cover" />
                    ) : (
                      <div className="grid aspect-square place-items-center text-[11px] text-muted-foreground">Sin imagen</div>
                    )}
                  </div>
                  {imagenes.length > 1 && (
                    <div className="flex flex-wrap gap-1.5">
                      {imagenes.slice(0, 8).map((u, i) => (
                        <button key={`${u}-${i}`} type="button" onClick={() => setFoto(i)} className={cn('size-10 overflow-hidden rounded-md border', i === foto ? 'border-indigo-400' : 'border-white/10 opacity-70 hover:opacity-100')}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={u} alt="" className="size-full object-cover" />
                        </button>
                      ))}
                      {imagenes.length > 8 && <span className="grid size-10 place-items-center text-[11px] text-muted-foreground">+{imagenes.length - 8}</span>}
                    </div>
                  )}
                </div>

                <div className="min-w-0 space-y-2.5">
                  <h2 className="text-[15px] font-semibold leading-snug">{ficha?.titulo ?? item.title}</h2>
                  {ruta && <p className="text-[11px] text-muted-foreground">{ruta}</p>}

                  <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Coste del proveedor</p>
                    <p className="text-xl font-semibold tabular-nums">
                      {ficha?.precio?.min !== null && ficha?.precio?.min !== undefined
                        ? ficha.precio.max && ficha.precio.max !== ficha.precio.min
                          ? `${usd(ficha.precio.min)} – ${usd(ficha.precio.max)}`
                          : usd(ficha.precio.min)
                        : usd(Number(item.costPrice))}
                    </p>
                    {ficha?.precio?.pais && (
                      <p className="mt-1 text-[10.5px] leading-snug text-muted-foreground">
                        Precio que cobra {nombreProveedor} por API (para {pais(ficha.precio.pais)}), consultado el {new Date(ficha.precio.consultado ?? ficha.actualizado).toLocaleDateString('es-ES')}. La app de {nombreProveedor} puede enseñar menos por ofertas personales (bienvenida, monedas, cupones): no cuentan para tu margen.
                      </p>
                    )}
                    {ficha?.precioSugeridoCj && <p className="text-[11px] text-muted-foreground">Precio de venta sugerido por el proveedor: {ficha.precioSugeridoCj} US$</p>}
                  </div>

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
                    {(resenas?.media ?? item.rating) ? (
                      <span className="inline-flex items-center gap-1 text-amber-300">
                        <Star className="size-3 fill-current" /> {Number(resenas?.media ?? item.rating).toFixed(1)}
                        {resenas?.total ? <span className="text-muted-foreground">({formatNumber(resenas.total)} reseñas)</span> : null}
                      </span>
                    ) : (
                      <span>Sin reseñas todavía</span>
                    )}
                    {item.ordersCount ? <span>{formatNumber(item.ordersCount)} pedidos</span> : null}
                    <span>{item.stock === null || item.stock === undefined ? 'Stock por consultar en la ficha' : `${formatNumber(item.stock)} uds en total`}</span>
                  </div>

                  {origenes.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        {origenes.some((o) => o.total !== null && o.total !== undefined) ? 'Stock por almacén' : 'Sale desde'}
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {origenes.map((o) => (
                          <span key={o.pais} className="rounded-md border border-white/10 bg-white/[0.03] px-1.5 py-0.5 text-[11px]">
                            {pais(o.pais)}
                            {o.total !== null && o.total !== undefined ? ` · ${formatNumber(o.total)}` : ''}
                          </span>
                        ))}
                      </div>
                      {origenes.every((o) => o.total === null || o.total === undefined) && (
                        <p className="text-[10.5px] text-muted-foreground">{nombreProveedor} no informa del stock por almacén: arriba se suma el stock de todas las variantes.</p>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Si la ficha todavía no está completa */}
              {!ficha && (
                <Alert variant="info" title="La ficha completa de este artículo todavía no se ha descargado">
                  Aquí se mostrarán las variantes, el stock por almacén, el envío por país, las reseñas y las características.
                  {esAdmin && (
                    <div className="mt-2">
                      <Button size="sm" variant="gradient" disabled={trabajando !== null} onClick={() => ejecutarCj('detalle')}>
                        {trabajando === 'detalle' && <Loader2 className="size-4 animate-spin" />}
                        Completar la ficha ahora
                      </Button>
                    </div>
                  )}
                </Alert>
              )}
              {aviso && (
                <p className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[12px] text-muted-foreground">{aviso}</p>
              )}

              {/* Envío */}
              {ficha && (
                <section className="space-y-2 rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="flex items-center gap-1.5 text-[13px] font-semibold">
                      <Truck className="size-4 text-indigo-300" /> Envío a tu cliente
                    </h3>
                    {destinos.length > 0 && (
                      <select
                        value={destinoActivo}
                        onChange={(e) => setDestino(e.target.value)}
                        className="h-8 rounded-md border border-white/10 bg-black/30 px-2 text-[12px]"
                        aria-label="País de destino"
                      >
                        {destinos.map((d) => (
                          <option key={d} value={d}>
                            {pais(d)}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>

                  {destinos.length === 0 ? (
                    <p className="text-[12px] text-muted-foreground">Todavía no se ha cotizado el envío de este artículo.</p>
                  ) : (
                    <>
                      {filasEnvio.filas.length > 0 ? (
                        <ul className="space-y-1.5">
                          {filasEnvio.filas.map((f, i) => (
                            <li key={`${f.origen}-${f.nombre}-${i}`} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg bg-black/25 px-3 py-2 text-[12px]">
                              <span className="min-w-0">
                                <span className="font-medium">{f.nombre}</span>
                                <span className="text-muted-foreground"> · desde el almacén de {pais(f.origen)}</span>
                                {f.stock !== null && f.stock !== undefined && <span className="text-muted-foreground"> ({formatNumber(f.stock)} uds)</span>}
                              </span>
                              <span className="flex items-center gap-2 tabular-nums">
                                {f.barata && <Badge variant="success">más barato</Badge>}
                                {f.rapida && <Badge variant="info">más rápido</Badge>}
                                <span className="font-semibold">{f.precio === 0 ? 'Gratis' : usd(f.precio)}</span>
                                {f.gratisDesde && f.precio !== 0 && <span className="text-[10.5px] text-muted-foreground">gratis desde {String(f.gratisDesde).replace('US $', '')} US$</span>}
                                <span className="text-muted-foreground">{dias(f.diasMin, f.diasMax)}</span>
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <Alert variant="warning" title={`${nombreProveedor} no envía este artículo a ${pais(destinoActivo)}`}>
                          Ningún almacén con stock tiene servicio de envío a ese país. No lo ofrezcas allí.
                        </Alert>
                      )}
                      {filasEnvio.sinServicio.length > 0 && filasEnvio.filas.length > 0 && (
                        <p className="text-[11px] text-muted-foreground">Sin servicio desde: {filasEnvio.sinServicio.map(pais).join(', ')}.</p>
                      )}
                      {filasEnvio.porCotizar.length > 0 && <p className="text-[11px] text-muted-foreground">Por cotizar desde: {filasEnvio.porCotizar.map(pais).join(', ')}.</p>}
                      <p className="text-[11px] text-muted-foreground">
                        Cotizado para la variante «{varianteCotizada?.nombre ?? 'más barata'}» (1 unidad). El precio puede cambiar según el peso de la variante y la cantidad.
                      </p>
                    </>
                  )}

                  {esAdmin && (
                    <div className="space-y-2 border-t border-white/[0.06] pt-2">
                      <p className="text-[11px] text-muted-foreground">
                        Solo para el administrador. Pide a {nombreProveedor} los precios y plazos de envío de este artículo y los guarda. Cada país cuesta {item?.provider === 'ALIEXPRESS' ? 'una llamada a AliExpress' : 'unas llamadas a CJ (una por almacén)'}.
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button size="sm" variant="outline" disabled={trabajando !== null} onClick={() => ejecutarCj('envio')}>
                          {trabajando === 'envio' && <Loader2 className="size-4 animate-spin" />}
                          Cotizar los 12 países principales
                        </Button>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          value={otroPais}
                          onChange={(e) => setOtroPais(e.target.value)}
                          className="h-8 min-w-0 flex-1 rounded-md border border-white/10 bg-black/30 px-2 text-[12px]"
                          aria-label="Otro país de destino"
                        >
                          <option value="">Elegir otro país…</option>
                          {PAISES_FRECUENTES.filter((c) => !destinos.includes(c))
                            .sort((a, b) => pais(a).localeCompare(pais(b), 'es'))
                            .map((c) => (
                              <option key={c} value={c}>
                                {pais(c)}
                              </option>
                            ))}
                        </select>
                        <Button size="sm" variant="outline" disabled={trabajando !== null || !otroPais} onClick={() => ejecutarCj('envio', { paises: [otroPais] })}>
                          Cotizar ese país
                        </Button>
                      </div>
                    </div>
                  )}
                </section>
              )}

              {/* Variantes */}
              {variantes.length > 0 && (
                <section className="space-y-2">
                  <h3 className="text-[13px] font-semibold">Variantes ({variantes.length})</h3>
                  <ul className="space-y-1.5">
                    {variantesVisibles.map((v: any) => {
                      const filasStock: any[] = v.stock ?? [];
                      return (
                        <li key={v.vid ?? v.sku} className="flex gap-2.5 rounded-lg border border-white/[0.06] bg-white/[0.02] p-2 text-[12px]">
                          {v.imagen && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={v.imagen} alt="" className="size-11 shrink-0 rounded-md object-cover" />
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                              <span className="truncate font-medium">{v.nombre}</span>
                              <span className="font-semibold tabular-nums">{usd(v.precio)}</span>
                            </div>
                            <p className="text-[11px] text-muted-foreground">
                              {v.sku ? `SKU ${v.sku} · ` : ''}
                              {v.pesoGramos ? `${formatNumber(v.pesoGramos)} g` : 'peso sin dato'}
                              {v.largoMm && v.anchoMm && v.altoMm ? ` · ${v.largoMm / 10}×${v.anchoMm / 10}×${v.altoMm / 10} cm` : ''}
                            </p>
                            {filasStock.length > 0 && (
                              <p className="mt-0.5 flex flex-wrap gap-1">
                                {filasStock.map((s, i) => (
                                  <span key={i} title={`En almacén de CJ: ${formatNumber(s.cj ?? 0)} · en fábrica: ${formatNumber(s.fabrica ?? 0)}`} className="rounded bg-white/[0.05] px-1 text-[10.5px] text-muted-foreground">
                                    {s.pais ? pais(s.pais) : 'Disponible'} {formatNumber(s.total ?? 0)}
                                    {(s.cj ?? 0) === 0 && (s.fabrica ?? 0) > 0 ? ' (fábrica)' : ''}
                                  </span>
                                ))}
                              </p>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                  {variantes.length > 6 && (
                    <button type="button" onClick={() => setVerVariantes((v) => !v)} className="text-[12px] text-indigo-300 hover:underline">
                      {verVariantes ? 'Ver menos' : `Ver las ${variantes.length} variantes`}
                    </button>
                  )}
                  {item?.provider !== 'ALIEXPRESS' && <p className="text-[11px] text-muted-foreground">«(fábrica)» significa que el stock está en la fábrica y no en un almacén de CJ: tarda más en salir.</p>}
                </section>
              )}

              {/* Características */}
              {ficha && (
                <section className="space-y-1.5">
                  <h3 className="text-[13px] font-semibold">Características</h3>
                  <dl className="grid grid-cols-[110px,1fr] gap-x-3 gap-y-1 text-[12px]">
                    {ficha.caracteristicasEnvio?.length > 0 && (
                      <>
                        <dt className="text-muted-foreground">Para el envío</dt>
                        <dd>{ficha.caracteristicasEnvio.map(etiquetaCaracteristica).join(', ')}</dd>
                      </>
                    )}
                    {ficha.materiales?.length > 0 && (
                      <>
                        <dt className="text-muted-foreground">Material</dt>
                        <dd>{ficha.materiales.join(', ')}</dd>
                      </>
                    )}
                    {ficha.embalaje?.length > 0 && (
                      <>
                        <dt className="text-muted-foreground">Embalaje</dt>
                        <dd>{ficha.embalaje.join(', ')}</dd>
                      </>
                    )}
                    {(ficha.peso?.gramos || ficha.peso?.conEmbalaje) && (
                      <>
                        <dt className="text-muted-foreground">Peso</dt>
                        <dd>
                          {ficha.peso.gramos ? `${formatNumber(ficha.peso.gramos)} g` : ''}
                          {ficha.peso.conEmbalaje ? `${ficha.peso.gramos ? ' · ' : ''}con embalaje ${ficha.peso.conEmbalaje} g` : ''}
                        </dd>
                      </>
                    )}
                    {ficha.opcionesProducto?.length > 0 && (
                      <>
                        <dt className="text-muted-foreground">Opciones</dt>
                        <dd>{ficha.opcionesProducto.join(', ')}</dd>
                      </>
                    )}
                    {ficha.tienda?.nombre && (
                      <>
                        <dt className="text-muted-foreground">Tienda</dt>
                        <dd>{ficha.tienda.nombre}</dd>
                      </>
                    )}
                    {Array.isArray(ficha.propiedades) &&
                      ficha.propiedades.slice(0, 12).map((p: any, i: number) => (
                        <div key={i} className="contents">
                          <dt className="text-muted-foreground">{p.nombre}</dt>
                          <dd>{String(p.valor ?? '')}</dd>
                        </div>
                      ))}
                    {ficha.tipo && (
                      <>
                        <dt className="text-muted-foreground">Tipo</dt>
                        <dd>{ficha.tipo === 'SUPPLIER_SHIPPED_PRODUCT' ? 'Lo envía el proveedor' : ficha.tipo === 'ORDINARY_PRODUCT' ? 'Producto ordinario' : ficha.tipo}</dd>
                      </>
                    )}
                  </dl>
                </section>
              )}

              {/* Reseñas */}
              {resenas && (
                <section className="space-y-2">
                  <h3 className="text-[13px] font-semibold">
                    Reseñas {resenas.total ? `(${formatNumber(resenas.total)})` : ''}
                    {resenas.media ? <span className="ml-2 text-amber-300">★ {Number(resenas.media).toFixed(1)}</span> : null}
                  </h3>
                  {resenas.lista?.length ? (
                    <ul className="space-y-1.5">
                      {resenas.lista.slice(0, 5).map((r: any, i: number) => (
                        <li key={i} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2 text-[12px]">
                          <p className="flex items-center justify-between text-[11px] text-muted-foreground">
                            <span>
                              {r.usuario ?? 'Cliente'} {r.pais ? `· ${pais(r.pais)}` : ''}
                            </span>
                            <span className="text-amber-300">{'★'.repeat(Math.max(0, Math.min(5, Math.round(r.puntuacion ?? 0))))}</span>
                          </p>
                          {r.texto && <p className="mt-1">{r.texto}</p>}
                          {r.fotos?.length > 0 && (
                            <div className="mt-1 flex gap-1">
                              {r.fotos.slice(0, 4).map((u: string, k: number) => (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img key={k} src={u} alt="" className="size-12 rounded object-cover" />
                              ))}
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-[12px] text-muted-foreground">Este artículo no tiene reseñas en CJ.</p>
                  )}
                </section>
              )}

              {/* Descripción */}
              {textoDescripcion.length > 0 && (
                <section className="space-y-1.5">
                  <h3 className="text-[13px] font-semibold">Descripción del proveedor</h3>
                  <div className="space-y-1 text-[12px] leading-relaxed text-muted-foreground">
                    {textoDescripcion.slice(0, 14).map((p, i) => (
                      <p key={i}>{p}</p>
                    ))}
                  </div>
                </section>
              )}

              {(ficha?.enlace || item.sourceUrl) && (
                <a href={ficha?.enlace ?? item.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[12px] text-indigo-300 hover:underline">
                  <ExternalLink className="size-3.5" /> Ver el producto en {nombreProveedor}
                </a>
              )}
              {ficha?.avisos?.length > 0 && (
                <p className="flex items-start gap-1.5 text-[11px] text-amber-300/80">
                  <AlertCircle className="mt-0.5 size-3.5 shrink-0" /> {ficha.avisos.join(' · ')}
                </p>
              )}
            </>
          )}
        </div>

        <footer className="border-t border-white/[0.07] px-4 py-2.5">
          <Button disabled className="w-full" variant="gradient">
            Importar a mi tienda
          </Button>
          <p className="mt-1 text-center text-[11px] text-muted-foreground">Se activará al conectar tu tienda (siguiente paso).</p>
        </footer>
      </aside>
    </div>
  );
}
