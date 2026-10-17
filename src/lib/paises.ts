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

/** Países a los que suele interesar vender, para elegir de una lista en lugar de escribir el código. */
export const PAISES_FRECUENTES = [
  'ES', 'US', 'MX', 'GB', 'DE', 'FR', 'IT', 'CA', 'AU', 'BR', 'CO', 'CL',
  'PT', 'NL', 'BE', 'AT', 'CH', 'IE', 'PL', 'SE', 'DK', 'NO', 'FI', 'CZ', 'GR', 'RO', 'HU',
  'AR', 'PE', 'EC', 'UY', 'PA', 'CR', 'DO', 'PR', 'GT',
  'JP', 'KR', 'SG', 'NZ', 'AE', 'SA', 'IL', 'ZA', 'MA', 'TR',
] as const;
