/**
 * Comparación de lo que el proveedor tenía antes y lo que dice ahora (precio y existencias por variante).
 * Archivo SIN dependencias: lo usan las funciones de los dos proveedores y la app. No sabe nada de CJ ni de AliExpress:
 * recibe variantes ya normalizadas y devuelve los cambios que importan al vendedor.
 */

export interface VarianteVigilada {
  /** Identificador de la variante en el proveedor (si no lo trae, se usa el SKU o el nombre) */
  vid: string | null;
  nombre: string;
  sku?: string | null;
  /** Coste que cobra la API del proveedor (USD) */
  precio: number | null;
  /** Existencias totales conocidas; null = el proveedor no lo informa (nunca se inventa un 0) */
  stock: number | null;
}

export type TipoCambio = 'PRECIO_SUBE' | 'PRECIO_BAJA' | 'AGOTADO' | 'DISPONIBLE' | 'STOCK_BAJO' | 'VARIANTE_NUEVA' | 'VARIANTE_RETIRADA';

export interface Cambio {
  tipo: TipoCambio;
  vid: string | null;
  nombre: string;
  sku: string | null;
  antes: number | null;
  despues: number | null;
  /** Variación del precio en % (solo en los cambios de precio) */
  pct: number | null;
}

/** Por debajo de esta cantidad se avisa de «stock bajo» (solo al cruzarla, no cada vez que baja una unidad). */
export const UMBRAL_STOCK_BAJO = 5;
const MIN_CAMBIO_PRECIO = 0.005;

const clave = (v: VarianteVigilada) => v.vid ?? v.sku ?? v.nombre;
const redondear = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

/** Suma las existencias de una lista [{ total }]; null si no hay ningún dato (así «sin dato» no se confunde con «0»). */
export function stockTotal(lista: { total: number | null }[] | null | undefined): number | null {
  const conDato = (lista ?? []).filter((x) => typeof x?.total === 'number' && Number.isFinite(x.total));
  return conDato.length ? conDato.reduce((a, x) => a + (x.total as number), 0) : null;
}

/** Cambios entre dos fotos de las variantes de un producto. */
export function compararVariantes(antes: VarianteVigilada[], despues: VarianteVigilada[]): Cambio[] {
  const cambios: Cambio[] = [];
  const mapaAntes = new Map(antes.map((v) => [clave(v), v]));
  const mapaDespues = new Map(despues.map((v) => [clave(v), v]));

  for (const [k, ahora] of mapaDespues) {
    const previa = mapaAntes.get(k);
    const base = { vid: ahora.vid, nombre: ahora.nombre, sku: ahora.sku ?? null };
    if (!previa) {
      cambios.push({ ...base, tipo: 'VARIANTE_NUEVA', antes: null, despues: ahora.precio, pct: null });
      continue;
    }
    if (previa.precio !== null && ahora.precio !== null && Math.abs(ahora.precio - previa.precio) >= MIN_CAMBIO_PRECIO) {
      cambios.push({ ...base, tipo: ahora.precio > previa.precio ? 'PRECIO_SUBE' : 'PRECIO_BAJA', antes: previa.precio, despues: ahora.precio, pct: previa.precio > 0 ? redondear(((ahora.precio - previa.precio) / previa.precio) * 100, 1) : null });
    }
    if (previa.stock !== null && ahora.stock !== null) {
      if (previa.stock > 0 && ahora.stock === 0) cambios.push({ ...base, tipo: 'AGOTADO', antes: previa.stock, despues: 0, pct: null });
      else if (previa.stock === 0 && ahora.stock > 0) cambios.push({ ...base, tipo: 'DISPONIBLE', antes: 0, despues: ahora.stock, pct: null });
      else if (previa.stock > UMBRAL_STOCK_BAJO && ahora.stock > 0 && ahora.stock <= UMBRAL_STOCK_BAJO) cambios.push({ ...base, tipo: 'STOCK_BAJO', antes: previa.stock, despues: ahora.stock, pct: null });
    }
  }
  for (const [k, previa] of mapaAntes) {
    if (!mapaDespues.has(k)) cambios.push({ tipo: 'VARIANTE_RETIRADA', vid: previa.vid, nombre: previa.nombre, sku: previa.sku ?? null, antes: previa.precio, despues: null, pct: null });
  }
  return cambios;
}

const usd = (n: number | null) => (n === null ? '—' : `${n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} US$`);

/** Frase para el registro del usuario, en español y sin jerga. */
export function describirCambio(c: Cambio): string {
  const v = c.nombre ? `«${c.nombre}»` : 'una variante';
  switch (c.tipo) {
    case 'PRECIO_SUBE':
      return `El coste de ${v} subió de ${usd(c.antes)} a ${usd(c.despues)}${c.pct !== null ? ` (+${c.pct.toLocaleString('es-ES')} %)` : ''}. Revisa tu precio de venta.`;
    case 'PRECIO_BAJA':
      return `El coste de ${v} bajó de ${usd(c.antes)} a ${usd(c.despues)}${c.pct !== null ? ` (${c.pct.toLocaleString('es-ES')} %)` : ''}.`;
    case 'AGOTADO':
      return `${v} se ha agotado en el proveedor.`;
    case 'DISPONIBLE':
      return `${v} vuelve a tener existencias en el proveedor (${c.despues}).`;
    case 'STOCK_BAJO':
      return `${v} tiene pocas existencias en el proveedor (quedan ${c.despues}).`;
    case 'VARIANTE_NUEVA':
      return `El proveedor ha añadido ${v}${c.despues !== null ? ` (${usd(c.despues)})` : ''}.`;
    case 'VARIANTE_RETIRADA':
      return `El proveedor ha retirado ${v}.`;
  }
}

/**
 * ¿Merece un aviso? AliExpress devuelve los precios ya convertidos a dólares y se mueven unos céntimos de un repaso a otro (cambio de moneda,
 * redondeos): eso NO es una subida de coste. Un cambio de precio solo cuenta si pasa de 0,05 US$ Y del 1 %. Lo que se vaya sumando poco a poco
 * lo detecta la comparación con el coste con el que el vendedor publicó (pantalla Monitor), no este filtro.
 */
export const MIN_CAMBIO_PRECIO_ABS = 0.05;
export const MIN_CAMBIO_PRECIO_PCT = 1;
export function esCambioRelevante(c: Cambio): boolean {
  if (c.tipo === 'PRECIO_SUBE' || c.tipo === 'PRECIO_BAJA') {
    const abs = Math.abs((c.despues ?? 0) - (c.antes ?? 0));
    return abs >= MIN_CAMBIO_PRECIO_ABS && Math.abs(c.pct ?? 100) >= MIN_CAMBIO_PRECIO_PCT;
  }
  return true;
}

/** ¿Es un cambio malo para el vendedor (conviene avisar con más fuerza)? */
export const esCambioDeRiesgo = (c: Cambio) => c.tipo === 'PRECIO_SUBE' || c.tipo === 'AGOTADO' || c.tipo === 'STOCK_BAJO' || c.tipo === 'VARIANTE_RETIRADA';

/** Convierte las variantes de una ficha (formato común de los dos proveedores) en lo mínimo que se compara. */
export function vigilarVariantes(variantes: any[] | null | undefined): VarianteVigilada[] {
  return (Array.isArray(variantes) ? variantes : []).map((v) => ({
    vid: v?.vid ? String(v.vid) : null,
    nombre: String(v?.nombre ?? ''),
    sku: v?.sku ?? null,
    precio: typeof v?.precio === 'number' && Number.isFinite(v.precio) ? v.precio : null,
    stock: stockTotal(v?.stock),
  }));
}
