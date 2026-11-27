/**
 * Buscador en vivo de CJ y AliExpress (datos reales). La app solo habla con la puerta central `acciones-usuario`
 * (acción `buscar_proveedor`), que comprueba el cupo del plan, reutiliza las búsquedas de las últimas 24 horas y
 * llama a la función del proveedor elegido. Nada se guarda en el catálogo hasta que el usuario pulsa «Añadir».
 */
import { supabase } from '../supabase/cliente';

export type ProveedorBusqueda = 'CJ_DROPSHIPPING' | 'ALIEXPRESS';
/** Orden común: cada proveedor lo traduce a su manera en su propia función */
export type OrdenBusqueda = 'relevancia' | 'ventas' | 'precio_mayor' | 'precio_menor';

export interface ResultadoBusqueda {
  externalId: string;
  titulo: string;
  imagen: string | null;
  precioUsd: number | null;
  /** CJ: tiendas que lo tienen listado · AliExpress: unidades vendidas */
  popularidad: number | null;
  valoracion?: number | null;
  categoria: string | null;
  stock: number | null;
  url: string;
  /** Si ya está en el catálogo común, su identificador (abre la ficha) */
  itemId: string | null;
}

export interface PaginaBusqueda {
  proveedor: ProveedorBusqueda;
  buscado: string;
  pagina: number;
  total: number | null;
  hayMas: boolean;
  resultados: ResultadoBusqueda[];
  /** false = el proveedor no admitió el orden pedido y devolvió su orden normal */
  ordenAplicado: boolean;
  gastado: number;
  desdeCache: boolean;
}

export interface CupoBusqueda {
  ilimitado: boolean;
  restanteMes: number | null;
  restanteDia: number | null;
  /** Productos que el plan deja elegir A LA VEZ (para añadir al catálogo y para publicar varios en Retador). */
  tanda: number;
  /** Páginas que muestra cada búsqueda en este plan (bajar para ver más no gasta del plan). */
  paginas: number;
  /** Productos que aún puede añadir al catálogo (null = el servidor no lo informó). `total` = el plan de prueba no se renueva. */
  anadir: { restanteVentana: number; restanteDia: number; total: boolean } | null;
}

/** Lo más prudente mientras no se sabe el plan (lo del plan de prueba). */
export const TANDA_POR_DEFECTO = 5;

async function invocar<T>(cuerpo: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase().functions.invoke('acciones-usuario', { body: cuerpo });
  if (error) {
    const respuesta = (error as { context?: Response }).context;
    if (respuesta && typeof respuesta.json === 'function') {
      const c = await respuesta.json().catch(() => null);
      if (c?.error) throw new Error(String(c.error));
    }
    throw new Error('No se pudo contactar con el servidor. Comprueba tu conexión y vuelve a intentarlo.');
  }
  if (!data?.ok) throw new Error(String(data?.error ?? 'La búsqueda no se pudo completar.'));
  return data as T;
}

export async function buscarEnProveedor(proveedor: ProveedorBusqueda, palabra: string, pagina = 1, orden: OrdenBusqueda = 'relevancia'): Promise<PaginaBusqueda> {
  const d = await invocar<any>({ accion: 'buscar_proveedor', proveedor, palabra, pagina, orden });
  return {
    proveedor,
    buscado: String(d.buscado ?? palabra),
    pagina: Number(d.pagina ?? pagina),
    total: typeof d.total === 'number' ? d.total : null,
    hayMas: Boolean(d.hayMas),
    resultados: (Array.isArray(d.resultados) ? d.resultados : []).map((r: any) => ({
      externalId: String(r.externalId),
      titulo: String(r.titulo ?? ''),
      imagen: r.imagen ?? null,
      precioUsd: typeof r.precioUsd === 'number' ? r.precioUsd : null,
      popularidad: typeof r.popularidad === 'number' ? r.popularidad : null,
      valoracion: typeof r.valoracion === 'number' ? r.valoracion : null,
      categoria: r.categoria ?? null,
      stock: typeof r.stock === 'number' ? r.stock : null,
      url: String(r.url ?? ''),
      itemId: r.itemId ?? null,
    })),
    ordenAplicado: d.ordenAplicado !== false,
    gastado: Number(d.gastado ?? 0),
    desdeCache: Boolean(d.desdeCache),
  };
}

/** Lo que le queda al usuario de su cupo de búsquedas (lo cuenta el servidor). */
export async function cupoBusqueda(): Promise<CupoBusqueda> {
  const d = await invocar<any>({ accion: 'uso' });
  const b = d?.limites?.BUSQUEDA;
  const i = d?.limites?.IMPORTACION;
  const cap = d?.capacidad ?? {};
  return {
    ilimitado: Boolean(d?.ilimitado),
    restanteMes: typeof b?.restanteVentana === 'number' ? b.restanteVentana : null,
    restanteDia: typeof b?.restanteDia === 'number' ? b.restanteDia : null,
    tanda: Number.isInteger(cap.productosPorTanda) && cap.productosPorTanda > 0 ? cap.productosPorTanda : TANDA_POR_DEFECTO,
    paginas: Number.isInteger(cap.paginasPorBusqueda) && cap.paginasPorBusqueda > 0 ? cap.paginasPorBusqueda : 3,
    anadir: typeof i?.restanteVentana === 'number' && typeof i?.restanteDia === 'number' ? { restanteVentana: i.restanteVentana, restanteDia: i.restanteDia, total: i.ventana === 'TOTAL' } : null,
  };
}

/**
 * Cotiza el envío de un producto del catálogo a esos países por la puerta central (con el cupo del plan; lo que ya está
 * cotizado y al día no gasta nada). Devuelve el mensaje del servidor.
 */
export async function cotizarEnvio(itemId: string, paises: string[]): Promise<string> {
  const d = await invocar<any>({ accion: 'cotizar_envio', itemId, paises });
  return String(d?.mensaje ?? 'Envío cotizado');
}
