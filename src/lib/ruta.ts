/**
 * src/lib/ruta.ts — Ayudas para la versión ESTÁTICA (GitHub Pages).
 *
 * En la versión estática las pantallas se generan una sola vez al construir y
 * viven en una subcarpeta (por ejemplo /HERMES-). Estas ayudas hacen que el
 * mismo código funcione igual en el servidor normal (no cambian nada) y en la
 * versión estática.
 */
export const ESTATICO = process.env.NEXT_PUBLIC_ESTATICO === '1';
export const RUTA_BASE = process.env.NEXT_PUBLIC_RUTA_BASE ?? '';

/** Añade la subcarpeta a rutas absolutas propias (imágenes, enlaces planos). */
export const conBase = (ruta: string): string =>
  ESTATICO && ruta.startsWith('/') && !ruta.startsWith('//') && !ruta.startsWith(`${RUTA_BASE}/`) ? `${RUTA_BASE}${ruta}` : ruta;

/** Quita la subcarpeta de una ruta del navegador (window.location.pathname). */
export const sinBase = (ruta: string): string =>
  ESTATICO && RUTA_BASE && (ruta === RUTA_BASE || ruta.startsWith(`${RUTA_BASE}/`)) ? ruta.slice(RUTA_BASE.length) || '/' : ruta;

/** Ruta actual del navegador sin subcarpeta ni barra final: «/dashboard». */
export const rutaActual = (): string => {
  const ruta = sinBase(window.location.pathname).replace(/\/+$/, '');
  return ruta === '' ? '/' : ruta;
};

/**
 * Parámetros de la dirección (?a=b) leídos en el servidor. En la versión
 * estática no existen al construir, así que se devuelve un objeto vacío.
 */
export function parametrosDeServidor<T extends Record<string, string | undefined>>(searchParams: T): T {
  return ESTATICO ? ({} as T) : searchParams;
}
