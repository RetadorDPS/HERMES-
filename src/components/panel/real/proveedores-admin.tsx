'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/lib/supabase/cliente';
import { nombrePais } from '@/lib/paises';

interface InformeFicha {
  id: string;
  ok: boolean;
  titulo?: string;
  error?: string;
  imagenes?: number;
  variantes?: number;
  almacenes?: number;
  origenes?: string[];
  resenas?: number;
  avisos?: string[];
  formaProducto?: string[];
}

interface Respuesta {
  ok: boolean;
  mensaje?: string;
  error?: string;
  tokenReutilizado?: boolean;
  llamadasACj?: number;
  llamadasAAliExpress?: number;
  secretoCjApiKey?: boolean;
  secretoAppKey?: boolean;
  secretoAppSecret?: boolean;
  secretosVistos?: string[];
  formaClave?: { longitud: number; tieneEspaciosOSaltos: boolean; contieneArrobaApi: boolean; sobrabanEspaciosAlBorde: boolean };
  avisos?: string[];
  totalEnCj?: number | null;
  informe?: InformeFicha[];
  resumen?: Record<string, { conServicio: string[]; sinServicio: string[]; pendientes: string[] }>;
  feeds?: { nombre: string | null; productos: number | null; descripcion: string | null }[];
  codigoAli?: string | null;
  longitudes?: { appKey: number; appSecret: number };
  detalleError?: unknown;
  formaRespuesta?: string[];
  forma?: { claves?: string[] };
  urlRetorno?: string;
  urlAutorizacion?: string;
  autorizada?: boolean;
}

type Accion = 'probar' | 'categorias' | 'descargar' | 'detalle' | 'envio' | 'feeds' | 'sondear' | 'autorizar';
type Proveedor = 'CJ_DROPSHIPPING' | 'ALIEXPRESS';

const FUNCION: Record<Proveedor, string> = { CJ_DROPSHIPPING: 'cj-catalogo', ALIEXPRESS: 'ali-catalogo' };

/** Llama a la función del proveedor (solo administrador) y devuelve su respuesta, con el error real si falla. */
async function invocar(proveedor: Proveedor, cuerpo: Record<string, unknown>): Promise<Respuesta> {
  const { data, error } = await supabase().functions.invoke(FUNCION[proveedor], { body: cuerpo });
  if (error) {
    let texto = error.message;
    try {
      const j = await (error as any).context?.json?.();
      if (j?.error) texto = j.error;
    } catch {
      /* sin cuerpo legible */
    }
    return { ok: false, error: texto };
  }
  return data as Respuesta;
}

/** Elige hasta `cantidad` artículos del proveedor que todavía no tienen la ficha completa (los más pedidos primero). */
async function articulosSinFicha(proveedor: Proveedor, cantidad: number): Promise<string[]> {
  const cliente = supabase();
  const [{ data: items, error: e1 }, { data: hechos, error: e2 }] = await Promise.all([
    cliente.from('CatalogItem').select('id').eq('provider', proveedor).order('ordersCount', { ascending: false, nullsFirst: false }).limit(300),
    cliente.from('CatalogItemDetail').select('itemId'),
  ]);
  if (e1 || e2) throw new Error((e1 || e2)!.message);
  const conFicha = new Set((hechos ?? []).map((h: any) => h.itemId));
  return (items ?? []).map((i: any) => i.id as string).filter((id) => !conFicha.has(id)).slice(0, cantidad);
}

const DESTINOS_DEFECTO = 12;

/** Elige, entre los artículos del proveedor con ficha, el MÁS POPULAR al que todavía le faltan cotizaciones de envío. */
async function articuloSinEnvio(proveedor: Proveedor): Promise<string | null> {
  const { data, error } = await supabase()
    .from('CatalogItemDetail')
    .select('itemId, origenes:ficha->origenes, envio:ficha->envio, item:CatalogItem!inner(ordersCount, provider)')
    .eq('item.provider', proveedor);
  if (error) throw new Error(error.message);
  const pedidos = (d: any) => Number((Array.isArray(d.item) ? d.item[0]?.ordersCount : d.item?.ordersCount) ?? 0);
  const pendientes = (data ?? [])
    .filter((d: any) => {
      const conStock = ((d.origenes ?? []) as { pais: string; total: number }[]).filter((o) => (o.total ?? 0) > 0 || proveedor === 'ALIEXPRESS').slice(0, 6);
      const esperadas = Math.max(conStock.length, 1) * DESTINOS_DEFECTO;
      const hechas = Object.values((d.envio?.porOrigen ?? {}) as Record<string, Record<string, unknown>>).reduce((n, porDestino) => n + Object.keys(porDestino).length, 0);
      return hechas < esperadas;
    })
    .sort((x: any, y: any) => pedidos(y) - pedidos(x));
  return pendientes.length ? (pendientes[0] as any).itemId : null;
}

function Resultado({ r }: { r: Respuesta }) {
  const llamadas = r.llamadasACj ?? r.llamadasAAliExpress;
  return (
    <Alert variant={r.ok ? 'success' : 'warning'} title={r.ok ? 'Hecho' : 'No se pudo completar'}>
      <p>{r.ok ? r.mensaje : r.error}</p>
      {r.ok && llamadas !== undefined && (
        <p className="mt-1 text-[12px] opacity-80">
          Llamadas al proveedor: {llamadas}
          {r.tokenReutilizado !== undefined ? ` · token ${r.tokenReutilizado ? 'reutilizado' : 'nuevo'}` : ''}
          {r.totalEnCj ? ` · CJ tiene ${r.totalEnCj.toLocaleString('es-ES')} productos` : ''}
        </p>
      )}
      {!r.ok && (r.secretoCjApiKey === false || r.secretoAppKey === false || r.secretoAppSecret === false) && (
        <p className="mt-1 text-[12px] opacity-80">
          Secretos que empiezan por CJ o ALI en el servidor: {r.secretosVistos?.length ? r.secretosVistos.join(', ') : 'ninguno'}.
        </p>
      )}
      {!r.ok && r.formaClave && r.secretoCjApiKey && (
        <p className="mt-1 text-[12px] opacity-80">
          Forma de la clave guardada (sin mostrarla): {r.formaClave.longitud} caracteres{r.formaClave.contieneArrobaApi ? ', con «@api@»' : ', sin «@api@»'}.
        </p>
      )}
      {!r.ok && r.codigoAli && <p className="mt-1 text-[12px] opacity-80">Código de AliExpress: {r.codigoAli}</p>}
      {!r.ok && r.longitudes && (
        <p className="mt-1 text-[12px] opacity-80">
          Claves guardadas (sin mostrarlas): App Key de {r.longitudes.appKey} caracteres y App Secret de {r.longitudes.appSecret} caracteres. Lo normal en AliExpress: App Key de unos 6 a 8 dígitos y App Secret de 32 caracteres.
        </p>
      )}
      {!r.ok && r.detalleError !== undefined && r.detalleError !== null && (
        <p className="mt-1 break-words text-[11px] opacity-70">{JSON.stringify(r.detalleError).slice(0, 400)}</p>
      )}
      {r.ok && r.formaRespuesta && <p className="mt-1 text-[11px] opacity-70">Campos recibidos: {r.formaRespuesta.join(', ')}</p>}
      {r.ok && r.forma?.claves && <p className="mt-1 text-[11px] opacity-70">Campos recibidos: {r.forma.claves.join(', ')}</p>}
      {r.avisos && r.avisos.length > 0 && <p className="mt-1 text-[12px] opacity-80">{r.avisos.join(' · ')}</p>}
      {r.urlAutorizacion && (
        <div className="mt-2 space-y-2 text-[12px]">
          <p>
            Esta es la dirección de retorno que ya tiene registrada tu app de AliExpress (la comparte con Retador, no hay que cambiar nada en la consola). Antes de autorizar, la página de retorno de Retador debe estar publicada con el reparto:
          </p>
          <p className="rounded-md bg-black/30 p-2 font-mono text-[11px]">{r.urlRetorno}</p>
          <Button asChild variant="gradient" size="sm">
            <a href={r.urlAutorizacion}>Abrir la autorización de AliExpress</a>
          </Button>
        </div>
      )}
      {r.feeds && r.feeds.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-[12px]">
          {r.feeds.map((f, i) => (
            <li key={i}>
              {f.nombre} {f.productos ? `· ${f.productos.toLocaleString('es-ES')} productos` : ''}
            </li>
          ))}
        </ul>
      )}
      {r.resumen && (
        <ul className="mt-2 space-y-1 text-[12px]">
          {Object.entries(r.resumen).map(([origen, x]) => (
            <li key={origen}>
              <p className="font-medium">{origen.length === 2 ? `Almacén de ${nombrePais(origen)}` : origen}</p>
              {x.conServicio.length > 0 && <p className="opacity-90">Envía a: {x.conServicio.map((t) => `${nombrePais(t.slice(0, 2))}${t.slice(2)}`).join(' · ')}</p>}
              {x.sinServicio.length > 0 && <p className="opacity-70">Sin servicio a: {x.sinServicio.map(nombrePais).join(', ')}</p>}
              {x.pendientes.length > 0 && <p className="opacity-70">Por cotizar: {x.pendientes.map(nombrePais).join(', ')}</p>}
            </li>
          ))}
        </ul>
      )}
      {r.informe && r.informe.length > 0 && (
        <ul className="mt-2 space-y-1.5 text-[12px]">
          {r.informe.map((f) => (
            <li key={f.id}>
              <p className="truncate font-medium">{f.titulo ?? f.id}</p>
              {f.ok ? (
                <p className="opacity-80">
                  {f.imagenes} fotos · {f.variantes} variantes
                  {f.origenes && f.origenes.length > 0
                    ? ` · almacenes con stock: ${f.origenes
                        .map((o) => {
                          const [c, n] = o.split(':');
                          return `${nombrePais(c)} ${Number(n).toLocaleString('es-ES')}`;
                        })
                        .join(', ')}`
                    : ''}
                  {f.resenas !== undefined ? ` · ${f.resenas} reseñas` : ''}
                </p>
              ) : (
                <p className="opacity-80">{f.error}</p>
              )}
              {f.avisos && f.avisos.length > 0 && <p className="opacity-70">Avisos: {f.avisos.join(' · ')}</p>}
              {f.formaProducto && <p className="opacity-60">Campos: {f.formaProducto.join(', ')}</p>}
            </li>
          ))}
        </ul>
      )}
    </Alert>
  );
}

/** Tarjeta de un proveedor. CJ y AliExpress son independientes: cada uno usa su propia función. */
function TarjetaProveedor({ proveedor }: { proveedor: Proveedor }) {
  const esCj = proveedor === 'CJ_DROPSHIPPING';
  const [trabajando, setTrabajando] = useState<Accion | null>(null);
  const [resultado, setResultado] = useState<Respuesta | null>(null);
  // Cuántos artículos procesar en cada pulsación (el usuario elige el número)
  const [cantidades, setCantidades] = useState({ descargar: esCj ? 150 : 50, detalle: esCj ? 3 : 1, envio: 1, almacen: 50 });
  const [progreso, setProgreso] = useState<string | null>(null);
  const detener = useRef(false);
  const LIMITES = { descargar: esCj ? 500 : 150, detalle: 30, envio: 10, almacen: 50 };
  const fijar = (clave: keyof typeof cantidades, valor: string) => {
    const n = Math.floor(Number(valor));
    setCantidades((c) => ({ ...c, [clave]: Number.isFinite(n) ? Math.min(Math.max(n, 1), LIMITES[clave]) : 1 }));
  };

  // Al volver de la autorización de AliExpress se muestra cómo salió
  useEffect(() => {
    if (esCj) return;
    const q = new URLSearchParams(window.location.search);
    const estado = q.get('ali');
    if (!estado) return;
    const mensaje = q.get('mensaje') ?? '';
    setResultado(estado === 'ok' ? { ok: true, mensaje } : { ok: false, error: mensaje || 'La autorización no se completó' });
    window.history.replaceState(null, '', window.location.pathname);
  }, [esCj]);

  /** Repite una llamada de una en una (con progreso y botón «Detener») y junta el resultado en un mensaje claro. */
  const enSerie = async (total: number, unidad: string, paso: (i: number) => Promise<Respuesta | 'fin'>) => {
    detener.current = false;
    let hechos = 0;
    let ultima: Respuesta | null = null;
    let fallo: string | null = null;
    for (let i = 0; i < total; i += 1) {
      if (detener.current) break;
      setProgreso(`${unidad}: ${i + 1} de ${total}…`);
      const r = await paso(i);
      if (r === 'fin') break;
      ultima = r;
      if (!r.ok) {
        fallo = r.error ?? 'Falló una llamada';
        break;
      }
      hechos += 1;
    }
    setProgreso(null);
    const parada = detener.current ? ' (detenido por ti)' : '';
    if (fallo) setResultado({ ...(ultima ?? {}), ok: false, error: `${fallo} — se hicieron ${hechos} de ${total} ${unidad}${parada}.` });
    else setResultado({ ...(ultima ?? {}), ok: true, mensaje: `${hechos} de ${total} ${unidad} hechos${parada}.${ultima?.mensaje ? ` Último: ${ultima.mensaje}` : ''}` });
  };

  const ejecutar = async (accion: Accion) => {
    setTrabajando(accion);
    setResultado(null);
    try {
      if (accion === 'probar' || accion === 'categorias' || accion === 'feeds' || accion === 'sondear' || accion === 'autorizar') setResultado(await invocar(proveedor, { accion }));
      else if (accion === 'descargar') {
        // Se reparte en páginas de hasta 50 (CJ) o de hasta 50 (AliExpress), una llamada por página
        const n = cantidades.descargar;
        const paginas = Math.ceil(n / 50);
        const tamano = Math.ceil(n / paginas);
        await enSerie(paginas, 'páginas', (i) => invocar(proveedor, esCj ? { accion, paginas: 1, tamano, orden: 1, paginaInicial: i + 1 } : { accion, paginas: 1, tamano, paginaInicial: i + 1 }));
      } else if (accion === 'envio') {
        await enSerie(cantidades.envio, 'productos cotizados', async () => {
          const id = await articuloSinEnvio(proveedor);
          return id ? invocar(proveedor, { accion, ids: [id] }) : 'fin';
        });
      } else {
        const ids = await articulosSinFicha(proveedor, cantidades.detalle);
        if (!ids.length) setResultado({ ok: true, mensaje: 'Todos los artículos descargados ya tienen su ficha completa.' });
        else await enSerie(ids.length, 'fichas', (i) => invocar(proveedor, { accion, ids: [ids[i]], paises: ['ES'] }));
      }
    } catch (e) {
      setProgreso(null);
      setResultado({ ok: false, error: (e as Error).message });
    } finally {
      setTrabajando(null);
    }
  };

  /** Descarga de CJ por almacén: solo productos con existencias en ese país, anotando el almacén en cada uno. */
  const descargarAlmacen = async (pais: string) => {
    setTrabajando('descargar');
    setResultado(null);
    try {
      setResultado(await invocar(proveedor, { accion: 'descargar', paginas: 1, tamano: cantidades.almacen, orden: 1, pais }));
    } catch (e) {
      setResultado({ ok: false, error: (e as Error).message });
    } finally {
      setTrabajando(null);
    }
  };

  const boton = (accion: Accion, texto: string, variante: 'outline' | 'gradient' = 'outline') => (
    <Button variant={variante} size="sm" disabled={trabajando !== null} onClick={() => ejecutar(accion)}>
      {trabajando === accion && <Loader2 className="size-4 animate-spin" />}
      {texto}
    </Button>
  );

  const cantidad = (clave: keyof typeof cantidades, texto: string, unidad: string, ayuda: string, variante: 'outline' | 'gradient' = 'outline') => (
    <div className="space-y-1.5 rounded-lg border border-white/[0.07] p-2">
      <div className="flex items-center gap-2">
        <Input
          type="number"
          inputMode="numeric"
          min={1}
          max={LIMITES[clave]}
          value={cantidades[clave]}
          onChange={(e) => fijar(clave, e.target.value)}
          className="h-9 w-20 shrink-0"
          aria-label={`Cantidad de ${unidad}`}
          disabled={trabajando !== null}
        />
        <Button variant={variante} size="sm" className="h-auto min-h-9 flex-1 whitespace-normal py-1.5 text-left" disabled={trabajando !== null} onClick={() => ejecutar(clave === 'almacen' ? 'descargar' : clave)}>
          {trabajando === (clave === 'almacen' ? 'descargar' : clave) && <Loader2 className="size-4 animate-spin" />}
          {texto} ({cantidades[clave]} {cantidades[clave] === 1 ? unidad.replace(/os$/, 'o').replace(/as$/, 'a') : unidad})
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">{ayuda}</p>
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Catálogo de proveedores · {esCj ? 'CJ Dropshipping' : 'AliExpress'}</CardTitle>
        <CardDescription>
          Usa {esCj ? 'la clave guardada' : 'las claves guardadas'} de la plataforma. Las llamadas van una a una, con pausa entre ellas.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {boton('probar', esCj ? 'Probar la clave' : 'Probar las claves')}
          {esCj ? boton('categorias', '1. Descargar categorías') : boton('feeds', '1. Ver los feeds disponibles')}
        </div>
        <div className="space-y-2 rounded-lg border border-white/[0.07] bg-white/[0.02] p-3">
          <p className="text-[12px] font-medium">Cuántos quieres en cada pulsación</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {cantidad('descargar', esCj ? '2. Descargar productos populares' : '2. Descargar productos más vendidos', 'productos', `Máx. ${LIMITES.descargar}. Una llamada por cada 50.`)}
            {cantidad('detalle', '3. Completar fichas', 'fichas', `Máx. ${LIMITES.detalle}. Una llamada por ficha (la más popular primero).`)}
            {cantidad('envio', '4. Cotizar envío mundial', 'productos', `Máx. ${LIMITES.envio}. Cada producto hace hasta ${esCj ? '30 llamadas a CJ (1 por segundo)' : '12 llamadas a AliExpress'}.`, 'gradient')}
          </div>
          {progreso && (
            <div className="flex flex-wrap items-center gap-2 text-[12px] text-indigo-200">
              <Loader2 className="size-3.5 animate-spin" /> {progreso}
              <Button size="sm" variant="outline" className="h-7" onClick={() => (detener.current = true)}>
                Detener
              </Button>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!esCj && boton('autorizar', '5. Autorizar la cuenta de AliExpress')}
          {!esCj && boton('sondear', 'Sondear el feed (máx. 5 llamadas)')}
        </div>
        {esCj && (
          <div className="space-y-1.5">
            <p className="text-[12px] text-muted-foreground">
              Descargar por almacén: trae productos populares con existencias en ese país y anota el almacén en cada uno (1 o 2 llamadas a CJ por pulsación). Así funciona el filtro «Almacén de salida».
            </p>
            <label className="inline-flex items-center gap-2 text-[12px]">
              Cantidad por almacén
              <Input type="number" inputMode="numeric" min={1} max={LIMITES.almacen} value={cantidades.almacen} onChange={(e) => fijar('almacen', e.target.value)} className="h-8 w-20" disabled={trabajando !== null} aria-label="Cantidad por almacén" />
              <span className="text-muted-foreground">(máx. {LIMITES.almacen})</span>
            </label>
            <div className="flex flex-wrap gap-2">
              {['CN', 'US', 'ES', 'DE', 'FR', 'GB'].map((pais) => (
                <Button key={pais} variant="outline" size="sm" disabled={trabajando !== null} onClick={() => descargarAlmacen(pais)}>
                  {nombrePais(pais)}
                </Button>
              ))}
            </div>
          </div>
        )}
        <p className="text-[12px] text-muted-foreground">
          {esCj
            ? 'Orden recomendado: categorías, productos y fichas. El envío se cotiza desde cada almacén con stock hasta 12 países principales (España, EE. UU., México, Reino Unido, Alemania, Francia, Italia, Canadá, Australia, Brasil, Colombia y Chile).'
            : 'Orden recomendado: probar, descargar y completar una ficha. AliExpress todavía no está comprobado con tus claves: si algo falla, el mensaje de error dice exactamente qué responde AliExpress.'}
        </p>
        {resultado && <Resultado r={resultado} />}
      </CardContent>
    </Card>
  );
}

/** Catálogo de los proveedores (CJ y AliExpress, cada uno con su función). */
export function ProveedoresAdmin() {
  return (
    <div className="space-y-3">
      <TarjetaProveedor proveedor="CJ_DROPSHIPPING" />
      <TarjetaProveedor proveedor="ALIEXPRESS" />
    </div>
  );
}
