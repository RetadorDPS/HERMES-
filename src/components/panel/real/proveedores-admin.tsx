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
  recibidos?: number;
  guardados?: number;
  nuevos?: number;
  actualizados?: number;
  hayMas?: boolean;
  total?: number | null;
  pagina?: number;
  palabraEnviada?: string | null;
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

/* ───────── Descarga por páginas: cada búsqueda recuerda su página para no repetir siempre los mismos productos ───────── */

/** CJ: cada combinación de categoría, orden y palabra tiene su propia página por la que seguir (clave de siempre). */
const claveCursorCj = (categoria: string, orden = 1, palabra = '') => `hermes-cj-descarga:${categoria || 'todas'}:o${orden}${palabra ? `:${palabra.toLowerCase()}` : ''}`;
/** AliExpress: por palabra y categoría (con su orden) o por listado. */
const claveCursorAli = (modo: ModoAli, categoria: string, orden: string, palabra: string, feed: string) =>
  modo === 'listado' ? `hermes-ali-descarga:listado:${feed || 'defecto'}` : `hermes-ali-descarga:busqueda:${categoria || 'todas'}:${orden || 'relevancia'}${palabra ? `:${palabra.toLowerCase()}` : ''}`;

const leerCursor = (clave: string): number | null => {
  try {
    const v = Number(localStorage.getItem(clave));
    return Number.isInteger(v) && v >= 1 ? v : null;
  } catch {
    return null;
  }
};
const guardarCursor = (clave: string, pagina: number | null) => {
  try {
    if (pagina === null) localStorage.removeItem(clave);
    else localStorage.setItem(clave, String(pagina));
  } catch {
    /* sin almacenamiento en el navegador: se empieza por la página 1 */
  }
};

/** Cuántos productos de CJ hay ya guardados (en una categoría o en total). */
async function contarCj(categoria: string): Promise<number> {
  let c = supabase().from('CatalogItem').select('id', { count: 'exact', head: true }).eq('provider', 'CJ_DROPSHIPPING');
  if (categoria) c = c.eq('categoryId', categoria);
  const { count, error } = await c;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** CJ: página por la que seguir. La recordada; si no hay y es la descarga «de siempre», se calcula con lo ya descargado. */
async function paginaSiguienteCj(categoria: string, orden: number, palabra: string): Promise<number> {
  const guardada = leerCursor(claveCursorCj(categoria, orden, palabra));
  if (guardada) return guardada;
  if (orden !== 1 || palabra) return 1;
  return Math.floor((await contarCj(categoria)) / TAMANO_CJ) + 1;
}

/** Tamaño de página fijo: así «página 7» es siempre la misma, pidas los que pidas. */
const TAMANO_CJ = 50;
/** AliExpress entrega 20 por página en la búsqueda aunque se le pidan más (comprobado el 28/11/2026). */
const TAMANO_ALI_BUSQUEDA = 20;
const TAMANO_ALI_LISTADO = 50;

/** Órdenes que ofrece CJ para el listado (el número es el de su API). */
const ORDENES_CJ = [
  { valor: 1, texto: 'Más populares (los más listados)' },
  { valor: 3, texto: 'Más nuevos (recién añadidos a CJ)' },
  { valor: 4, texto: 'Con más existencias' },
  { valor: 2, texto: 'Más caros primero' },
];

/** Órdenes de la búsqueda de AliExpress (los acepta `ali-catalogo`). */
const ORDENES_ALI = [
  { valor: '', texto: 'Los que mejor encajan con la búsqueda' },
  { valor: 'ventas', texto: 'Más vendidos primero' },
  { valor: 'precio_menor', texto: 'Más baratos primero' },
  { valor: 'precio_mayor', texto: 'Más caros primero' },
];

/** Ideas para variar la descarga (en español: CJ lo traduce solo y AliExpress lo entiende). */
const IDEAS = ['auriculares', 'reloj inteligente', 'zapatillas', 'vestido', 'juguetes', 'mascotas', 'cocina', 'belleza', 'herramientas', 'coche', 'bebé', 'deporte'];

type ModoAli = 'busqueda' | 'listado';

interface Categoria {
  externalId: string;
  name: string;
  parentName: string | null;
}

interface Feed {
  nombre: string;
  productos: number | null;
}

/** Selector de categoría con un filtro de texto (CJ tiene cientos y AliExpress más de 500). */
function SelectorCategoria({ categorias, valor, onChange, disabled, etiqueta }: { categorias: Categoria[]; valor: string; onChange: (id: string) => void; disabled: boolean; etiqueta: string }) {
  const [filtro, setFiltro] = useState('');
  const normal = (t: string) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const f = normal(filtro.trim());
  const visibles = f ? categorias.filter((c) => normal(`${c.parentName ?? ''} ${c.name}`).includes(f) || c.externalId === valor) : categorias;
  return (
    <div className="space-y-1.5">
      <label className="flex flex-wrap items-center gap-2 text-[12px]">
        {etiqueta}
        <select value={valor} onChange={(e) => onChange(e.target.value)} disabled={disabled} className="h-9 min-w-0 max-w-full flex-1 rounded-md border border-white/10 bg-[#0e1220] px-2 text-[13px]" aria-label={etiqueta}>
          <option value="">{f ? `Elige entre ${visibles.length} que coinciden` : 'Todas las categorías'}</option>
          {visibles.map((c) => (
            <option key={c.externalId} value={c.externalId}>
              {c.parentName ? `${c.parentName} › ${c.name}` : c.name}
            </option>
          ))}
        </select>
      </label>
      {categorias.length > 20 && <Input value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="Filtrar categorías (por ejemplo: zapatos)" disabled={disabled} className="h-8 text-[12px]" aria-label="Filtrar categorías" />}
    </div>
  );
}

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

/** Tarjeta de un proveedor. CJ y AliExpress son independientes: cada uno usa su propia función, con la MISMA pantalla. */
function TarjetaProveedor({ proveedor }: { proveedor: Proveedor }) {
  const esCj = proveedor === 'CJ_DROPSHIPPING';
  const nombre = esCj ? 'CJ' : 'AliExpress';
  const [trabajando, setTrabajando] = useState<Accion | null>(null);
  const [resultado, setResultado] = useState<Respuesta | null>(null);
  // Cuántos artículos procesar en cada pulsación (el usuario elige el número)
  const [cantidades, setCantidades] = useState({ descargar: esCj ? 150 : 100, detalle: esCj ? 3 : 1, envio: 1, almacen: 50 });
  const [progreso, setProgreso] = useState<string | null>(null);
  const detener = useRef(false);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [categoriaId, setCategoriaId] = useState('');
  const [seguira, setSeguira] = useState<number | null>(null);
  const [ordenCj, setOrdenCj] = useState(1);
  const [ordenAli, setOrdenAli] = useState('');
  const [modoAli, setModoAli] = useState<ModoAli>('busqueda');
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [feed, setFeed] = useState('');
  const [palabra, setPalabra] = useState('');
  const palabraLimpia = palabra.trim().replace(/\s+/g, ' ').slice(0, 80);
  const LIMITES = { descargar: esCj ? 500 : 300, detalle: 30, envio: 10, almacen: 50 };
  const tamanoPagina = esCj ? TAMANO_CJ : modoAli === 'listado' ? TAMANO_ALI_LISTADO : TAMANO_ALI_BUSQUEDA;
  const porBusqueda = esCj || modoAli === 'busqueda';
  const claveActual = esCj ? claveCursorCj(categoriaId, ordenCj, palabraLimpia) : claveCursorAli(modoAli, categoriaId, ordenAli, palabraLimpia, feed);
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

  // Categorías del proveedor (salen de «1. Descargar categorías») para llenar el catálogo categoría por categoría
  useEffect(() => {
    let vivo = true;
    supabase()
      .from('CatalogCategory')
      .select('externalId,name,parentName')
      .eq('provider', proveedor)
      .order('parentName', { ascending: true, nullsFirst: true })
      .order('name', { ascending: true })
      .limit(3000)
      .then(({ data }) => vivo && setCategorias((data ?? []) as Categoria[]));
    return () => {
      vivo = false;
    };
  }, [proveedor, resultado]);

  // Listados de AliExpress: se recuerdan en el navegador para no gastar una llamada cada vez
  useEffect(() => {
    if (esCj) return;
    try {
      const guardados = JSON.parse(localStorage.getItem('hermes-ali-listados') ?? '[]');
      if (Array.isArray(guardados)) setFeeds(guardados.filter((f) => f && typeof f.nombre === 'string'));
    } catch {
      /* sin listados guardados */
    }
  }, [esCj]);

  useEffect(() => {
    setSeguira(leerCursor(claveActual));
  }, [claveActual, resultado]);

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

  const cargarListados = async () => {
    const r = await invocar(proveedor, { accion: 'feeds' });
    if (!r.ok) {
      setResultado(r);
      return;
    }
    const lista = (r.feeds ?? []).filter((f) => f.nombre).map((f) => ({ nombre: String(f.nombre), productos: f.productos ?? null }));
    lista.sort((a, b) => (b.productos ?? 0) - (a.productos ?? 0));
    setFeeds(lista);
    try {
      localStorage.setItem('hermes-ali-listados', JSON.stringify(lista));
    } catch {
      /* sin almacenamiento: se volverán a pedir */
    }
    setResultado({ ok: true, mensaje: `${lista.length} listados de AliExpress disponibles. Elige uno en «Listado».`, llamadasAAliExpress: r.llamadasAAliExpress });
  };

  const ejecutar = async (accion: Accion) => {
    setTrabajando(accion);
    setResultado(null);
    try {
      if (accion === 'probar' || accion === 'categorias' || accion === 'autorizar') setResultado(await invocar(proveedor, { accion }));
      else if (accion === 'feeds') await cargarListados();
      else if (accion === 'descargar') await descargar();
      else if (accion === 'envio') {
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

  /**
   * Descarga por páginas, SIEMPRE por donde se quedó la vez anterior con esa misma búsqueda (categoría, orden, palabra o
   * listado). Una página por llamada, en serie. El servidor dice cuántos eran NUEVOS y si quedan más páginas.
   */
  const descargar = async () => {
    detener.current = false;
    if (!esCj && modoAli === 'busqueda' && !palabraLimpia && !categoriaId) {
      setResultado({ ok: false, error: 'Escribe una palabra o elige una categoría de AliExpress (o cambia a «Listados de AliExpress»).' });
      return;
    }
    const clave = claveActual;
    const tamano = tamanoPagina;
    const paginas = Math.max(1, Math.ceil(cantidades.descargar / tamano));
    const nombreCategoria = categorias.find((c) => c.externalId === categoriaId)?.name;
    let pagina = esCj ? await paginaSiguienteCj(categoriaId, ordenCj, palabraLimpia) : (leerCursor(clave) ?? 1);
    const desde = pagina;
    let recibidos = 0;
    let nuevos = 0;
    let yaEstaban = 0;
    let llamadas = 0;
    let total: number | null = null;
    let palabraEnviada: string | null = null;
    let fin = false;
    let fallo: string | null = null;
    const avisos = new Set<string>();
    for (let i = 0; i < paginas; i += 1) {
      if (detener.current) break;
      setProgreso(`Descargando de ${nombre}, página ${pagina} (${i + 1} de ${paginas})…`);
      const cuerpo: Record<string, unknown> = esCj
        ? { accion: 'descargar', paginas: 1, tamano, orden: ordenCj, paginaInicial: pagina, ...(palabraLimpia ? { palabra: palabraLimpia } : {}), ...(categoriaId ? { categoryId: categoriaId } : {}) }
        : modoAli === 'listado'
          ? { accion: 'descargar', paginas: 1, tamano, paginaInicial: pagina, ...(feed ? { feed } : {}) }
          : { accion: 'descargar', modo: 'busqueda', tamano, paginaInicial: pagina, ...(ordenAli ? { orden: ordenAli } : {}), ...(palabraLimpia ? { palabra: palabraLimpia } : {}), ...(categoriaId ? { categoryId: categoriaId, categoryName: nombreCategoria } : {}) };
      const r = await invocar(proveedor, cuerpo);
      if (!r.ok) {
        // Pasada la última página, AliExpress contesta «sin productos»: eso es el final de la búsqueda, no un fallo
        if (i > 0 && /no devolvi[oó] productos/i.test(r.error ?? '')) {
          fin = true;
          guardarCursor(clave, null);
        } else fallo = r.error ?? 'Falló una llamada';
        break;
      }
      llamadas += r.llamadasACj ?? r.llamadasAAliExpress ?? 1;
      recibidos += r.recibidos ?? 0;
      nuevos += r.nuevos ?? 0;
      yaEstaban += r.actualizados ?? 0;
      if (i === 0) {
        total = r.totalEnCj ?? r.total ?? null;
        palabraEnviada = r.palabraEnviada ?? null;
      }
      for (const a of r.avisos ?? []) avisos.add(a);
      pagina += 1;
      if (r.hayMas === false || !r.recibidos) {
        fin = true;
        guardarCursor(clave, null);
        break;
      }
      guardarCursor(clave, pagina);
    }
    setProgreso(null);
    const parada = detener.current ? ' (detenido por ti)' : '';
    const llamadasCampo = esCj ? { llamadasACj: llamadas } : { llamadasAAliExpress: llamadas };
    if (fallo) {
      setResultado({ ok: false, error: `${fallo}${recibidos ? ` — antes se recibieron ${recibidos} (${nuevos} nuevos)` : ''}${parada}.`, ...llamadasCampo });
      return;
    }
    const hasta = Math.max(desde, pagina - 1);
    const partes: string[] = [];
    if (recibidos) partes.push(`Página${hasta > desde ? `s ${desde} a ${hasta}` : ` ${desde}`}: ${recibidos} recibidos de ${nombre} · ${nuevos} NUEVOS · ${yaEstaban} que ya tenías${parada}.`);
    else partes.push(`${nombre} no devolvió productos${parada}.`);
    if (total) partes.push(`${nombre} tiene ${total.toLocaleString('es-ES')} productos con esta búsqueda.`);
    if (palabraEnviada && esCj && palabraEnviada !== palabraLimpia.toLowerCase()) partes.push(`CJ solo entiende inglés: buscó «${palabraEnviada}».`);
    if (fin) partes.push('Llegaste al final: la próxima vez esta búsqueda empezará otra vez por la página 1.');
    if (recibidos && nuevos === 0) partes.push('Todo lo recibido ya estaba en tu catálogo: prueba otra categoría, otro orden o una palabra (debajo tienes ideas).');
    setResultado({ ok: true, mensaje: partes.join(' '), avisos: [...avisos], ...llamadasCampo });
  };

  /** Descarga de CJ por almacén: solo productos con existencias en ese país, anotando el almacén en cada uno. */
  const descargarAlmacen = async (pais: string) => {
    setTrabajando('descargar');
    setResultado(null);
    try {
      const r = await invocar(proveedor, { accion: 'descargar', paginas: 1, tamano: cantidades.almacen, orden: 1, pais });
      setResultado(r.ok ? { ok: true, mensaje: `Almacén de ${nombrePais(pais)}: ${r.recibidos ?? 0} recibidos · ${r.nuevos ?? 0} NUEVOS · ${r.actualizados ?? 0} que ya tenías.`, llamadasACj: r.llamadasACj } : r);
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

  const selectorClase = 'h-9 min-w-0 max-w-full flex-1 rounded-md border border-white/10 bg-[#0e1220] px-2 text-[13px]';

  return (
    <Card>
      <CardHeader>
        <CardTitle>Catálogo de proveedores · {esCj ? 'CJ Dropshipping' : 'AliExpress'}</CardTitle>
        <CardDescription>
          Usa {esCj ? 'la clave guardada' : 'las claves guardadas'} de la plataforma. Las llamadas van una a una, con pausa entre ellas. Como administrador no tienes límite de plan.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {boton('probar', esCj ? 'Probar la clave' : 'Probar las claves')}
          {boton('categorias', '1. Descargar categorías')}
          {!esCj && boton('autorizar', 'Autorizar la cuenta de AliExpress')}
        </div>

        <div className="space-y-2.5 rounded-lg border border-white/[0.07] bg-white/[0.02] p-3">
          <p className="text-[12px] font-medium">2. Descargar productos de {nombre}</p>
          {!esCj && (
            <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Cómo descargar de AliExpress">
              {(
                [
                  ['busqueda', 'Por palabra o categoría'],
                  ['listado', 'Listados de AliExpress'],
                ] as const
              ).map(([valor, texto]) => (
                <button
                  key={valor}
                  type="button"
                  role="radio"
                  aria-checked={modoAli === valor}
                  disabled={trabajando !== null}
                  onClick={() => setModoAli(valor)}
                  className={`min-h-9 rounded-md border px-2 py-1.5 text-[12px] ${modoAli === valor ? 'border-indigo-400/60 bg-indigo-500/15 text-indigo-100' : 'border-white/10 text-muted-foreground'}`}
                >
                  {texto}
                </button>
              ))}
            </div>
          )}

          {porBusqueda && (
            <>
              <SelectorCategoria categorias={categorias} valor={categoriaId} onChange={setCategoriaId} disabled={trabajando !== null} etiqueta={`Categoría de ${nombre}`} />
              {categorias.length === 0 && <p className="text-[11px] text-muted-foreground">Pulsa «1. Descargar categorías» para ver la lista de categorías.</p>}
              <label className="flex flex-wrap items-center gap-2 text-[12px]">
                Orden
                {esCj ? (
                  <select value={ordenCj} onChange={(e) => setOrdenCj(Number(e.target.value))} disabled={trabajando !== null} className={selectorClase} aria-label="Orden de la descarga de CJ">
                    {ORDENES_CJ.map((o) => (
                      <option key={o.valor} value={o.valor}>
                        {o.texto}
                      </option>
                    ))}
                  </select>
                ) : (
                  <select value={ordenAli} onChange={(e) => setOrdenAli(e.target.value)} disabled={trabajando !== null} className={selectorClase} aria-label="Orden de la descarga de AliExpress">
                    {ORDENES_ALI.map((o) => (
                      <option key={o.valor} value={o.valor}>
                        {o.texto}
                      </option>
                    ))}
                  </select>
                )}
              </label>
              <label className="flex flex-wrap items-center gap-2 text-[12px]">
                Palabra {esCj ? '(opcional)' : categoriaId ? '(opcional)' : ''}
                <Input value={palabra} onChange={(e) => setPalabra(e.target.value)} placeholder="por ejemplo: zapatillas, sofá, funda iPhone" disabled={trabajando !== null} className="h-9 min-w-0 flex-1" aria-label={`Palabra para buscar en ${nombre}`} />
              </label>
              <div className="flex flex-wrap gap-1.5">
                {IDEAS.map((idea) => (
                  <button
                    key={idea}
                    type="button"
                    disabled={trabajando !== null}
                    onClick={() => setPalabra(idea)}
                    className={`rounded-full border px-2.5 py-1 text-[11px] ${palabraLimpia === idea ? 'border-indigo-400/60 bg-indigo-500/15 text-indigo-100' : 'border-white/10 text-muted-foreground hover:text-foreground'}`}
                  >
                    {idea}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">
                Puedes escribir en español{esCj ? ' (CJ solo entiende inglés: se traduce solo)' : ''}. Cada combinación de categoría, orden y palabra sigue por su propia página: así cada descarga trae productos distintos.
              </p>
            </>
          )}

          {!esCj && modoAli === 'listado' && (
            <>
              <label className="flex flex-wrap items-center gap-2 text-[12px]">
                Listado
                <select value={feed} onChange={(e) => setFeed(e.target.value)} disabled={trabajando !== null || feeds.length === 0} className={selectorClase} aria-label="Listado de AliExpress">
                  <option value="">{feeds.length ? 'El de más vendidos (por defecto)' : 'Primero carga los listados'}</option>
                  {feeds.map((f) => (
                    <option key={f.nombre} value={f.nombre}>
                      {f.nombre}
                      {f.productos ? ` · ${f.productos.toLocaleString('es-ES')}` : ''}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex flex-wrap items-center gap-2">{boton('feeds', feeds.length ? 'Actualizar los listados' : 'Cargar los listados')}</div>
              <p className="text-[11px] text-muted-foreground">
                Los listados son selecciones que prepara AliExpress y suelen traer pocos productos (unas decenas). Para tener todo el catálogo y variedad, usa «Por palabra o categoría».
              </p>
            </>
          )}

          <p className="text-[11px] text-muted-foreground">
            {seguira && seguira > 1 ? `Seguirá desde la página ${seguira}. ` : 'Empezará por la página 1. '}
            {seguira && seguira > 1 && (
              <button
                type="button"
                className="text-indigo-300 underline-offset-2 hover:underline"
                disabled={trabajando !== null}
                onClick={() => {
                  guardarCursor(claveActual, 1);
                  setSeguira(1);
                }}
              >
                Empezar desde el principio
              </button>
            )}
          </p>
          {cantidad('descargar', `Descargar de ${nombre}`, 'productos', `Máx. ${LIMITES.descargar} por pulsación. Una llamada por cada ${tamanoPagina}, de una en una.`, 'gradient')}
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          {cantidad('detalle', '3. Completar fichas', 'fichas', `Máx. ${LIMITES.detalle}. Una llamada por ficha (la más popular primero).`)}
          {cantidad('envio', '4. Cotizar envío mundial', 'productos', `Máx. ${LIMITES.envio}. Cada producto hace hasta ${esCj ? '30 llamadas a CJ (1 por segundo)' : '12 llamadas a AliExpress'}.`)}
        </div>
        {progreso && (
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-indigo-200">
            <Loader2 className="size-3.5 animate-spin" /> {progreso}
            <Button size="sm" variant="outline" className="h-7" onClick={() => (detener.current = true)}>
              Detener
            </Button>
          </div>
        )}
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
            : 'Orden recomendado: categorías, productos y fichas. La cuenta autorizada de AliExpress hace falta para completar fichas y cotizar envíos.'}
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
