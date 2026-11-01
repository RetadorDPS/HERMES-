/**
 * Regla de precios del vendedor (porcentaje, tarifa fija, beneficio mínimo, redondeo) para el servidor. Archivo SIN dependencias (se prueba en Node y corre en Deno).
 *
 * Es la MISMA cuenta que `computeSellingPrice` de `src/lib/pricing.ts` (la que usa la pantalla al proponer un precio), sin envío: en Retador el envío va aparte.
 * Hay una prueba (`tests/retador/precio-auto.test.ts`) que compara las dos cuentas para que nunca se separen.
 */
export interface ReglaPrecio {
  markupPct: number;
  fixedFee: number;
  minProfit: number;
  minPrice: number | null;
  maxPrice: number | null;
  roundTo: number;
}

/** Sin regla propia se usa esta (la misma que enseña la app). */
export const REGLA_POR_DEFECTO: ReglaPrecio = { markupPct: 40, fixedFee: 0, minProfit: 1.5, minPrice: null, maxPrice: null, roundTo: 0.99 };

const r2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const acotar = (n: number, min: number, max: number) => Math.min(Math.max(n, min), max);

/** Redondeo psicológico: 24.99 en lugar de 25.12 (igual que `roundPsychological` de la app). */
export function redondeoPsicologico(n: number, roundTo = 0.99): number {
  const base = Math.floor(n);
  const decimales = roundTo - Math.floor(roundTo);
  const candidato = base + roundTo;
  if (candidato < n) return r2(base + 1 + decimales);
  return r2(candidato);
}

/** Redondea un precio con el estilo de la regla (por ejemplo, siempre acabado en .99). */
export const redondearConRegla = (n: number, regla: ReglaPrecio): number => (Number(regla.roundTo) > 0 ? redondeoPsicologico(n, Number(regla.roundTo)) : r2(n));

/** Fila de la tabla `PricingRule` → regla. Sin fila (o con datos raros) se usa la regla por defecto. */
export function reglaDeFila(f: any | null | undefined): ReglaPrecio {
  if (!f) return { ...REGLA_POR_DEFECTO };
  const num = (v: unknown, defecto: number) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? defecto : Number(v));
  const opc = (v: unknown) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
  return {
    markupPct: num(f.markupPct, REGLA_POR_DEFECTO.markupPct),
    fixedFee: num(f.fixedFee, 0),
    minProfit: num(f.minProfit, 0),
    minPrice: opc(f.minPrice),
    maxPrice: opc(f.maxPrice),
    roundTo: f.roundTo === null || f.roundTo === undefined ? 0.99 : num(f.roundTo, 0.99),
  };
}

/** Precio de venta que da la regla para un coste (en la misma moneda), sin envío. */
export function precioPorRegla(coste: number, regla: ReglaPrecio): number {
  const markup = acotar(Number(regla.markupPct) || 0, -90, 2000);
  const fija = Number(regla.fixedFee ?? 0) || 0;
  const minimoBeneficio = Number(regla.minProfit ?? 0) || 0;
  const roundTo = regla.roundTo === null || regla.roundTo === undefined ? 0.99 : Number(regla.roundTo);
  const costeRedondeado = r2(coste);
  let precio = coste * (1 + markup / 100) + fija;
  precio = Math.max(precio, costeRedondeado + minimoBeneficio); // nunca por debajo de coste + beneficio mínimo
  if (regla.minPrice != null) precio = Math.max(precio, Number(regla.minPrice));
  if (regla.maxPrice != null) precio = Math.min(precio, Number(regla.maxPrice));
  precio = roundTo > 0 ? redondeoPsicologico(precio, roundTo) : r2(precio);
  if (regla.minPrice != null) precio = Math.max(precio, r2(Number(regla.minPrice)));
  if (regla.maxPrice != null) precio = Math.min(precio, r2(Number(regla.maxPrice)));
  return r2(precio);
}
