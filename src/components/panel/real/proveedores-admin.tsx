'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
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
    cliente.from('CatalogItem').select('id').eq('provider', proveedor).order('ordersCount', { ascending: false, nullsFirst: false }).limit(60),
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
              <p className="font-medium">Almacén de {nombrePais(origen)}</p>
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

  const ejecutar = async (accion: Accion) => {
    setTrabajando(accion);
    setResultado(null);
    try {
      if (accion === 'probar' || accion === 'categorias' || accion === 'feeds' || accion === 'sondear' || accion === 'autorizar') setResultado(await invocar(proveedor, { accion }));
      else if (accion === 'descargar')
        setResultado(await invocar(proveedor, esCj ? { accion, paginas: 3, tamano: 50, orden: 1 } : { accion, paginas: 1, tamano: 50 }));
      else if (accion === 'envio') {
        const id = await articuloSinEnvio(proveedor);
        if (!id) setResultado({ ok: true, mensaje: 'Todos los artículos con ficha ya tienen cotizado el envío.' });
        else setResultado(await invocar(proveedor, { accion, ids: [id] }));
      } else {
        const ids = await articulosSinFicha(proveedor, esCj ? 3 : 1);
        if (!ids.length) setResultado({ ok: true, mensaje: 'Todos los artículos descargados ya tienen su ficha completa.' });
        else setResultado(await invocar(proveedor, { accion, ids, paises: ['ES'] }));
      }
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Catálogo de proveedores · {esCj ? 'CJ Dropshipping' : 'AliExpress'}</CardTitle>
        <CardDescription>
          Usa {esCj ? 'la clave guardada' : 'las claves guardadas'} en los secretos de Supabase. Las llamadas van una a una, con pausa entre ellas.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {boton('probar', esCj ? 'Probar la clave' : 'Probar las claves')}
          {esCj ? boton('categorias', '1. Descargar categorías') : boton('feeds', '1. Ver los feeds disponibles')}
          {boton('descargar', esCj ? '2. Descargar 150 productos populares' : '2. Descargar 50 productos más vendidos')}
          {boton('detalle', esCj ? '3. Completar 3 fichas' : '3. Completar 1 ficha')}
          {boton('envio', '4. Cotizar envío mundial (1 producto)', 'gradient')}
          {!esCj && boton('autorizar', '5. Autorizar la cuenta de AliExpress')}
          {!esCj && boton('sondear', 'Sondear el feed (máx. 5 llamadas)')}
        </div>
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
