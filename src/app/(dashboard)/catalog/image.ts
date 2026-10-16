/**
 * Imagen de catálogo: las locales (muestra) se sirven tal cual; las del
 * proveedor pasan por el proxy del servidor (/api/img), que evita bloqueos por
 * hotlinking y funciona aunque el visor no tenga salida a internet.
 */
import { ESTATICO } from '@/lib/ruta';

export const imageSrc = (url: string | null | undefined) =>
  !url ? '' : url.startsWith('/') || url.startsWith('data:') || ESTATICO ? url : `/api/img?u=${encodeURIComponent(url)}`;
