/**
 * Importar por enlace (versión con datos reales). La app solo habla con la función central `importar-enlace`;
 * ella decide si el producto es de CJ o de AliExpress y llama a la función de ese proveedor.
 */
import { supabase } from '../supabase/cliente';

export interface ResultadoImportacion {
  itemId: string;
  proveedor: 'CJ_DROPSHIPPING' | 'ALIEXPRESS';
  titulo: string | null;
  /** true = el producto ya estaba en el catálogo común (con o sin llamadas nuevas al proveedor) */
  yaEstaba: boolean;
  llamadas: number;
  avisos: string[];
  mensaje: string;
}

export class ErrorImportacion extends Error {
  constructor(mensaje: string, readonly motivo?: string) {
    super(mensaje);
  }
}

/** Pide la importación de un producto por su enlace. Los errores llegan ya en español (enlace no válido, límite diario, proveedor caído…). */
export async function importarPorEnlace(url: string, destino: string): Promise<ResultadoImportacion> {
  const { data, error } = await supabase().functions.invoke('importar-enlace', { body: { url, destino } });
  if (error) {
    // Si la función contestó con un estado de error, el cuerpo trae el mensaje en español
    const respuesta = (error as { context?: Response }).context;
    if (respuesta && typeof respuesta.json === 'function') {
      const cuerpo = await respuesta.json().catch(() => null);
      if (cuerpo?.error) throw new ErrorImportacion(String(cuerpo.error), cuerpo.motivo);
    }
    throw new ErrorImportacion('No se pudo contactar con el servidor. Comprueba tu conexión y vuelve a intentarlo.');
  }
  if (!data?.ok) throw new ErrorImportacion(String(data?.error ?? 'La importación no se pudo completar.'), data?.motivo);
  return {
    itemId: String(data.itemId),
    proveedor: data.proveedor,
    titulo: data.titulo ?? null,
    yaEstaba: Boolean(data.yaEstaba),
    llamadas: Number(data.llamadas ?? 0),
    avisos: Array.isArray(data.avisos) ? data.avisos.map(String) : [],
    mensaje: String(data.mensaje ?? ''),
  };
}
