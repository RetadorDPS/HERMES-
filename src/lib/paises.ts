/** Nombres de países en español a partir del código de dos letras (así nadie tiene que adivinar qué es «CN» o «ES»). */
let nombres: Intl.DisplayNames | null = null;

export function nombrePais(codigo: string | null | undefined): string {
  const c = String(codigo ?? '').trim().toUpperCase();
  if (!c) return '';
  try {
    nombres = nombres ?? new Intl.DisplayNames(['es'], { type: 'region' });
    return nombres.of(c) ?? c;
  } catch {
    return c;
  }
}

/** Nombre natural de un almacén de salida: «CN» → «China», «EU» → «Unión Europea». */
export function nombreAlmacen(codigo: string | null | undefined): string {
  const c = String(codigo ?? '').trim().toUpperCase();
  if (c === 'EU') return 'Unión Europea';
  return nombrePais(c) || c;
}

/**
 * Texto honesto de la cifra de popularidad de cada proveedor. No son lo mismo:
 *  · AliExpress: unidades vendidas (el dato acumulado que informa el proveedor).
 *  · CJ: veces que el producto está listado por tiendas (NO son pedidos).
 */
export function textoPopularidad(proveedor: string, n: number, formato: (v: number) => string): string {
  if (proveedor === 'ALIEXPRESS') return `${formato(n)} vendidos`;
  if (proveedor === 'CJ_DROPSHIPPING') return `${formato(n)} listados por tiendas`;
  return `${formato(n)} pedidos`;
}

/** Países a los que suele interesar vender, para elegir de una lista en lugar de escribir el código. */
export const PAISES_FRECUENTES = [
  'ES', 'US', 'MX', 'GB', 'DE', 'FR', 'IT', 'CA', 'AU', 'BR', 'CO', 'CL',
  'PT', 'NL', 'BE', 'AT', 'CH', 'IE', 'PL', 'SE', 'DK', 'NO', 'FI', 'CZ', 'GR', 'RO', 'HU',
  'AR', 'PE', 'EC', 'UY', 'PA', 'CR', 'DO', 'PR', 'GT',
  'JP', 'KR', 'SG', 'NZ', 'AE', 'SA', 'IL', 'ZA', 'MA', 'TR',
] as const;
