/**
 * Cuentas de Retador compartidas entre la app (src/lib/retador/precios.ts) y las funciones del servidor.
 * Archivo SIN dependencias: se importa tal cual desde Next y desde Deno.
 *
 * Todo en USD (moneda de los productos de proveedor en Retador). Las tarifas NUNCA se copian a mano:
 * llegan de `dropship-config` de Retador. Si falta un dato real (peso, envío al hub, tarifa), no se
 * calcula y se dice qué falta; jamás se rellena con un valor supuesto.
 */
const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

export const GRAMOS_POR_LIBRA = 453.592;

export interface TarifasRetador {
  hubUsdPorLibra: number;
  diasHubCuba: [number, number];
  comisionPctGanancia: number;
  pasarelaPct: number;
  pasarelaFijaUsd: number;
  /** Quién paga la pasarela. Si Retador no lo dice se asume al vendedor (la opción más prudente). */
  pasarelaACargo?: 'vendedor' | 'comprador';
}

export interface EntradaCoste {
  /** Coste de la variante que cobra el proveedor (USD). */
  costeUsd: number | null | undefined;
  /** Envío real proveedor → hub de EE. UU. (USD), de una cotización del proveedor. */
  envioHubUsd: number | null | undefined;
  /** Peso real de la variante en gramos. */
  pesoGramos: number | null | undefined;
  tarifas: TarifasRetador | null | undefined;
}

export interface CostePuestoEnCuba {
  producto: number;
  envioHub: number;
  hubCuba: number;
  total: number;
}

const esNumero = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;

/** Qué datos reales faltan para calcular el coste puesto en Cuba (lista vacía = se puede calcular). */
export function datosQueFaltan(e: EntradaCoste): string[] {
  const falta: string[] = [];
  if (!esNumero(e.costeUsd)) falta.push('coste de la variante');
  if (!esNumero(e.envioHubUsd)) falta.push('envío del proveedor al hub de EE. UU.');
  if (!esNumero(e.pesoGramos) || e.pesoGramos <= 0) falta.push('peso real');
  if (!e.tarifas || !esNumero(e.tarifas.hubUsdPorLibra)) falta.push('tarifa hub→Cuba de Retador');
  return falta;
}

/** Producto + tramo al hub + tramo hub→Cuba (peso real × tarifa por libra). Null si falta algún dato real. */
export function costePuestoEnCuba(e: EntradaCoste): CostePuestoEnCuba | null {
  if (datosQueFaltan(e).length) return null;
  const producto = round2(e.costeUsd as number);
  const envioHub = round2(e.envioHubUsd as number);
  const hubCuba = round2(((e.pesoGramos as number) / GRAMOS_POR_LIBRA) * (e.tarifas as TarifasRetador).hubUsdPorLibra);
  return { producto, envioHub, hubCuba, total: round2(producto + envioHub + hubCuba) };
}

export interface Liquidacion {
  precio: number;
  coste: number;
  ganancia: number;
  comision: number;
  pasarela: number;
  /** Beneficio que realmente queda al vendedor. */
  neto: number;
  /** Beneficio neto sobre el precio de venta (%). */
  margenNetoPct: number;
}

/** Lo que queda al vendedor tras la comisión de Retador (sobre la ganancia) y la pasarela de pago. */
export function liquidacion(precio: number, costeTotal: number, t: TarifasRetador): Liquidacion {
  const ganancia = round2(precio - costeTotal);
  const comision = round2(Math.max(0, ganancia) * (t.comisionPctGanancia / 100));
  const pasarela = round2(precio * (t.pasarelaPct / 100) + t.pasarelaFijaUsd);
  const paga = t.pasarelaACargo === 'comprador' ? 0 : pasarela;
  const neto = round2(ganancia - comision - paga);
  return { precio: round2(precio), coste: round2(costeTotal), ganancia, comision, pasarela, neto, margenNetoPct: precio > 0 ? round2((neto / precio) * 100) : 0 };
}

/** Precio mínimo para no perder dinero: el coste puesto en Cuba, más lo que se lleva Retador y la pasarela si las paga el vendedor. */
export function precioMinimoSinPerdida(costeTotal: number, t: TarifasRetador): number {
  // neto >= 0  ⇒  p - c - (p-c)·k - (p·g + f) >= 0   con k = comisión y g = pasarela% (si la paga el vendedor)
  const k = t.comisionPctGanancia / 100;
  const g = t.pasarelaACargo === 'comprador' ? 0 : t.pasarelaPct / 100;
  const f = t.pasarelaACargo === 'comprador' ? 0 : t.pasarelaFijaUsd;
  const denominador = 1 - k - g;
  if (denominador <= 0) return Number.POSITIVE_INFINITY;
  return Math.ceil(((costeTotal * (1 - k) + f) / denominador) * 100) / 100;
}
