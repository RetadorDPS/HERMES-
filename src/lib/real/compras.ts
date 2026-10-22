/** Compras al proveedor de los pedidos de Retador (función `compras-proveedor`). */
import { supabase } from '../supabase/cliente';
import { ErrorTiendaRetador } from './retador';

export type ModoCompras = 'APAGADO' | 'SIMULACION' | 'MANUAL' | 'AUTOMATICO';

export interface ConfigComprasVista {
  modo: ModoCompras;
  limitePedidoUsd: number;
  limiteDiaUsd: number;
  subidaMaxPct: number;
}

export interface ResultadoCompra {
  comprado: boolean;
  codigo?: string;
  motivo?: string;
  modo?: ModoCompras;
  resultados?: { proveedor: string; hecho: boolean; simulada?: boolean; motivo?: string; costeUsd?: number; origen?: string; logistica?: string; envioUsd?: number; pedidoProveedorId?: string }[];
}

export async function llamarCompras<T = any>(cuerpo: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase().functions.invoke('compras-proveedor', { body: cuerpo });
  if (error) {
    let mensaje = 'No se pudo contactar con el servidor. Revisa tu conexión e inténtalo de nuevo.';
    try {
      const cuerpoError = await (error as any).context?.json?.();
      if (cuerpoError?.error) mensaje = cuerpoError.error;
    } catch {
      /* sin JSON legible: se queda el mensaje general */
    }
    throw new ErrorTiendaRetador(mensaje, 'red');
  }
  if (!data?.ok) {
    const { ok: _ok, codigo, error: mensaje, ...extra } = data ?? {};
    throw new ErrorTiendaRetador(mensaje ?? 'Ocurrió un error inesperado.', codigo ?? 'desconocido', extra);
  }
  return data as T;
}
