/**
 * Fotos de los proveedores (CJ y AliExpress). Se piden a NUESTRO servidor (función `imagen-proveedor` de Supabase), no al del proveedor:
 * en algunos móviles y redes muchas fotos directas no cargan. La función solo acepta servidores de fotos de CJ y AliExpress.
 */
import { SUPABASE_URL } from '@/lib/supabase/config';

const SERVIDORES_DE_FOTOS = [/(^|\.)alicdn\.com$/i, /(^|\.)aliexpress-media\.com$/i, /(^|\.)cjdropshipping\.com$/i];

export function esFotoDeProveedor(url: string | null | undefined): boolean {
  try {
    const u = new URL(String(url));
    return u.protocol === 'https:' && SERVIDORES_DE_FOTOS.some((r) => r.test(u.hostname));
  } catch {
    return false;
  }
}

/** Dirección de la foto a través de nuestro servidor (con `ancho` pide una versión reducida, más rápida en móvil). Las que no son de proveedor no cambian. */
export function fotoPorNuestroServidor(url: string, ancho?: 240 | 480 | 640): string {
  if (!esFotoDeProveedor(url)) return url;
  return `${SUPABASE_URL}/functions/v1/imagen-proveedor?${ancho ? `w=${ancho}&` : ''}u=${encodeURIComponent(url)}`;
}

/** Si la dirección ya pasa por un servidor propio (proxy anterior o nuevo), devuelve la original del proveedor. */
export function direccionOriginal(src: string | null | undefined): string {
  if (!src) return '';
  try {
    const u = new URL(src, 'https://x.invalid');
    if (u.pathname.endsWith('/imagen-proveedor') || u.pathname.endsWith('/api/img')) return u.searchParams.get('u') ?? '';
  } catch {
    /* se devuelve tal cual */
  }
  return src;
}
