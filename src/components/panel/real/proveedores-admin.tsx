'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/lib/supabase/cliente';

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
}

interface Respuesta {
  ok: boolean;
  mensaje?: string;
  error?: string;
  tokenReutilizado?: boolean;
  llamadasACj?: number;
  secretoCjApiKey?: boolean;
  secretosVistos?: string[];
  formaClave?: { longitud: number; tieneEspaciosOSaltos: boolean; contieneArrobaApi: boolean; sobrabanEspaciosAlBorde: boolean };
  avisos?: string[];
  totalEnCj?: number | null;
  informe?: InformeFicha[];
  resumen?: Record<string, { conServicio: string[]; sinServicio: string[]; pendientes: string[] }>;
}

type Accion = 'probar' | 'categorias' | 'descargar' | 'detalle' | 'envio';

/** Llama a la función `cj-catalogo` (solo administrador) y devuelve su respuesta, con el error real si falla. */
async function invocarCj(cuerpo: Record<string, unknown>): Promise<Respuesta> {
  const { data, error } = await supabase().functions.invoke('cj-catalogo', { body: cuerpo });
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

/** Elige hasta 3 artículos de CJ que todavía no tienen la ficha completa (los más pedidos primero). */
async function articulosSinFicha(cantidad: number): Promise<string[]> {
  const cliente = supabase();
  const [{ data: items, error: e1 }, { data: hechos, error: e2 }] = await Promise.all([
    cliente.from('CatalogItem').select('id').eq('provider', 'CJ_DROPSHIPPING').order('ordersCount', { ascending: false, nullsFirst: false }).limit(60),
    cliente.from('CatalogItemDetail').select('itemId'),
  ]);
  if (e1 || e2) throw new Error((e1 || e2)!.message);
  const conFicha = new Set((hechos ?? []).map((h: any) => h.itemId));
  return (items ?? []).map((i: any) => i.id as string).filter((id) => !conFicha.has(id)).slice(0, cantidad);
}

const DESTINOS_DEFECTO = 12;

/** Elige, entre los artículos con ficha, el MÁS POPULAR al que todavía le faltan cotizaciones de envío (origen × destino). */
async function articuloSinEnvio(): Promise<string | null> {
  const { data, error } = await supabase()
    .from('CatalogItemDetail')
    .select('itemId, origenes:ficha->origenes, envio:ficha->envio, item:CatalogItem(ordersCount)');
  if (error) throw new Error(error.message);
  const pedidos = (d: any) => Number((Array.isArray(d.item) ? d.item[0]?.ordersCount : d.item?.ordersCount) ?? 0);
  const pendientes = (data ?? [])
    .filter((d: any) => {
      const conStock = ((d.origenes ?? []) as { pais: string; total: number }[]).filter((o) => (o.total ?? 0) > 0).slice(0, 6);
      const esperadas = Math.max(conStock.length, 1) * DESTINOS_DEFECTO;
      const hechas = Object.values((d.envio?.porOrigen ?? {}) as Record<string, Record<string, unknown>>).reduce((n, porDestino) => n + Object.keys(porDestino).length, 0);
      return hechas < esperadas;
    })
    .sort((x: any, y: any) => pedidos(y) - pedidos(x));
  return pendientes.length ? (pendientes[0] as any).itemId : null;
}

/** Catálogo del proveedor CJ. AliExpress se añadirá aparte (son independientes). */
export function ProveedoresAdmin() {
  const [trabajando, setTrabajando] = useState<Accion | null>(null);
  const [resultado, setResultado] = useState<Respuesta | null>(null);

  const ejecutar = async (accion: Accion) => {
    setTrabajando(accion);
    setResultado(null);
    try {
      if (accion === 'probar') setResultado(await invocarCj({ accion }));
      else if (accion === 'categorias') setResultado(await invocarCj({ accion }));
      else if (accion === 'descargar') setResultado(await invocarCj({ accion, paginas: 3, tamano: 50, orden: 1 }));
      else if (accion === 'envio') {
        const id = await articuloSinEnvio();
        if (!id) setResultado({ ok: true, mensaje: 'Todos los artículos con ficha ya tienen cotizado el envío desde sus almacenes.' });
        else setResultado(await invocarCj({ accion, ids: [id] }));
      } else {
        const ids = await articulosSinFicha(3);
        if (!ids.length) setResultado({ ok: true, mensaje: 'Todos los artículos descargados ya tienen su ficha completa.' });
        else setResultado(await invocarCj({ accion, ids, paises: ['ES'] }));
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
        <CardTitle>Catálogo de proveedores · CJ Dropshipping</CardTitle>
        <CardDescription>
          Usa la clave guardada en los secretos de Supabase. Todas las llamadas a CJ van en serie, con una pausa de más de un segundo entre una y otra.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {boton('probar', 'Probar la clave')}
          {boton('categorias', '1. Descargar categorías')}
          {boton('descargar', '2. Descargar 150 productos populares')}
          {boton('detalle', '3. Completar 3 fichas')}
          {boton('envio', '4. Cotizar envío mundial (1 producto)', 'gradient')}
        </div>
        <p className="text-[12px] text-muted-foreground">
          Orden recomendado: categorías, productos y fichas. La ficha trae variantes, stock por almacén y reseñas (unas 5 llamadas a CJ por producto). El envío mundial se cotiza aparte, desde cada almacén con stock hasta 12 países (ES, US, MX, GB, DE, FR, IT, CA, AU, BR, CO, CL): hasta 30 llamadas por producto, con pausa.
        </p>

        {resultado && (
          <Alert variant={resultado.ok ? 'success' : 'warning'} title={resultado.ok ? 'Hecho' : 'No se pudo completar'}>
            <p>{resultado.ok ? resultado.mensaje : resultado.error}</p>
            {resultado.ok && resultado.llamadasACj !== undefined && (
              <p className="mt-1 text-[12px] opacity-80">
                Llamadas a CJ: {resultado.llamadasACj} · token {resultado.tokenReutilizado ? 'reutilizado' : 'nuevo'}
                {resultado.totalEnCj ? ` · CJ tiene ${resultado.totalEnCj.toLocaleString('es-ES')} productos` : ''}
              </p>
            )}
            {!resultado.ok && resultado.secretoCjApiKey === false && (
              <p className="mt-1 text-[12px] opacity-80">
                Secretos que empiezan por CJ o ALI en el servidor: {resultado.secretosVistos?.length ? resultado.secretosVistos.join(', ') : 'ninguno'}.
              </p>
            )}
            {!resultado.ok && resultado.formaClave && resultado.secretoCjApiKey && (
              <p className="mt-1 text-[12px] opacity-80">
                Forma de la clave guardada (sin mostrarla): {resultado.formaClave.longitud} caracteres
                {resultado.formaClave.contieneArrobaApi ? ', con «@api@»' : ', sin «@api@»'}.
              </p>
            )}
            {resultado.avisos && resultado.avisos.length > 0 && <p className="mt-1 text-[12px] opacity-80">{resultado.avisos.join(' · ')}</p>}
            {resultado.resumen && (
              <ul className="mt-2 space-y-1 text-[12px]">
                {Object.entries(resultado.resumen).map(([origen, r]) => (
                  <li key={origen}>
                    <p className="font-medium">Almacén de {origen}</p>
                    {r.conServicio.length > 0 && <p className="opacity-90">Envía a: {r.conServicio.join(' · ')}</p>}
                    {r.sinServicio.length > 0 && <p className="opacity-70">Sin servicio a: {r.sinServicio.join(', ')}</p>}
                    {r.pendientes.length > 0 && <p className="opacity-70">Por cotizar: {r.pendientes.join(', ')}</p>}
                  </li>
                ))}
              </ul>
            )}
            {resultado.informe && resultado.informe.length > 0 && (
              <ul className="mt-2 space-y-1.5 text-[12px]">
                {resultado.informe.map((f) => (
                  <li key={f.id}>
                    <p className="truncate font-medium">{f.titulo ?? f.id}</p>
                    {f.ok ? (
                      <p className="opacity-80">
                        {f.imagenes} fotos · {f.variantes} variantes · {f.almacenes} registros de almacén · orígenes con stock:{' '}
                        {f.origenes?.join(', ') || 'sin datos'} · {f.resenas} reseñas
                      </p>
                    ) : (
                      <p className="opacity-80">{f.error}</p>
                    )}
                    {f.avisos && f.avisos.length > 0 && <p className="opacity-70">Avisos: {f.avisos.join(' · ')}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
