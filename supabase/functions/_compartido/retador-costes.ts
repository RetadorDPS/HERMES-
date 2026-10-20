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
  /** Quién paga la pasarela de pago. «retador»: sale de lo que retiene Retador y al vendedor no se le descuenta nada. Si no lo dice se asume al vendedor (lo más prudente). */
  pasarelaACargo?: 'vendedor' | 'comprador' | 'retador';
  /**
   * Sobre qué se calcula la comisión de Retador: «precio_venta_menos_costo_producto» (valor real de Retador: precio de venta menos el costo
   * del producto del proveedor, sin envío) o «precio_venta_menos_costo_cuba» (menos el coste puesto en Cuba). Si no lo dice se usa el producto,
   * que da la comisión más alta y por tanto el neto más prudente.
   */
  comisionBase?: 'precio_venta_menos_costo_producto' | 'precio_venta_menos_costo_cuba' | 'precio_venta_menos_costo_producto_menos_pasarela';
  /**
   * Ganancia mínima por unidad que exige Retador (USD). Si viene, rige el contrato v1.3: el precio mínimo es el del Importador de Retador
   * (costo del producto + pasarela fija + esta ganancia, entre 1 − pasarela %), el envío va aparte y la pasarela se calcula sobre el total cobrado.
   * Si no viene, rigen las cuentas de la versión 1 del contrato (coste puesto en Cuba).
   */
  gananciaMinimaRetadorUsd?: number;
}

/** ¿Las tarifas de Retador siguen el contrato v1.3? (solo si Retador informa su ganancia mínima). */
export const esContratoV13 = (t: TarifasRetador | null | undefined): boolean =>
  Boolean(t) && typeof t!.gananciaMinimaRetadorUsd === 'number' && Number.isFinite(t!.gananciaMinimaRetadorUsd) && t!.gananciaMinimaRetadorUsd >= 0;

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

/** Coste que se descuenta al calcular la ganancia: el del producto (valor real de Retador) o el puesto en Cuba si Retador así lo declara. */
function costeBase(costeTotal: number, costeProducto: number | undefined, t: TarifasRetador): number {
  if (t.comisionBase === 'precio_venta_menos_costo_cuba' || costeProducto === undefined) return costeTotal;
  return costeProducto;
}

/** Cuánto de la pasarela de pago sale del bolsillo del vendedor (0 si la paga el comprador o Retador). */
function pasarelaDelVendedor(precio: number, t: TarifasRetador): number {
  if (t.pasarelaACargo === 'comprador' || t.pasarelaACargo === 'retador') return 0;
  return round2(precio * (t.pasarelaPct / 100) + t.pasarelaFijaUsd);
}

/**
 * Lo que queda al vendedor por unidad: (precio − costo base) − comisión de Retador − pasarela si la paga él.
 * Con el reparto real de Retador es (precio − costo del producto) × (1 − comisión %); el envío lo paga el comprador aparte.
 */
export function liquidacion(precio: number, costeTotal: number, t: TarifasRetador, costeProducto?: number): Liquidacion {
  if (esContratoV13(t)) return liquidacionV13(precio, costeTotal, t, costeProducto);
  const base = costeBase(costeTotal, costeProducto, t);
  const ganancia = round2(precio - base);
  const comision = round2(Math.max(0, ganancia) * (t.comisionPctGanancia / 100));
  const pasarela = round2(precio * (t.pasarelaPct / 100) + t.pasarelaFijaUsd);
  const neto = round2(ganancia - comision - pasarelaDelVendedor(precio, t));
  return { precio: round2(precio), coste: round2(base), ganancia, comision, pasarela, neto, margenNetoPct: precio > 0 ? round2((neto / precio) * 100) : 0 };
}

/** Quién paga la pasarela según Retador. Si no lo dice, se asume al vendedor (lo más prudente). */
const pasarelaLaPagaElVendedor = (t: TarifasRetador): boolean => t.pasarelaACargo !== 'retador' && t.pasarelaACargo !== 'comprador';

/**
 * Contrato v1.3. Por unidad:
 *   envío cobrado = lo que paga el comprador aparte (aquí, el estimado: coste puesto en Cuba − costo del producto)
 *   pasarela      = round((precio + envío) × pasarela % + pasarela fija, 2)      ← sobre el TOTAL cobrado
 *   base          = (precio − costo del producto) − pasarela                     ← si la pasarela es del vendedor
 *   comisión      = round(max(0, base) × comisión %, 2)
 *   neto          = base − comisión
 * Con la pasarela a cargo de Retador o del comprador no se descuenta nada: neto = (precio − costo del producto) × (1 − comisión %).
 * El neto puede salir negativo (Retador lo recortaría a 0): aquí se deja visible para no publicar nunca con pérdida.
 */
function liquidacionV13(precio: number, costeTotal: number, t: TarifasRetador, costeProducto?: number): Liquidacion {
  const producto = costeProducto ?? costeTotal;
  const envio = costeProducto === undefined ? 0 : Math.max(0, round2(costeTotal - costeProducto));
  const ganancia = round2(precio - producto);
  const pasarela = round2((precio + envio) * (t.pasarelaPct / 100) + t.pasarelaFijaUsd);
  const descuenta = pasarelaLaPagaElVendedor(t);
  const antesDeComision = descuenta && t.comisionBase === 'precio_venta_menos_costo_producto_menos_pasarela';
  const base = round2(ganancia - (antesDeComision ? pasarela : 0));
  const comision = round2(Math.max(0, base) * (t.comisionPctGanancia / 100));
  const neto = round2(base - comision - (descuenta && !antesDeComision ? pasarela : 0));
  return { precio: round2(precio), coste: round2(producto), ganancia, comision, pasarela, neto, margenNetoPct: precio > 0 ? round2((neto / precio) * 100) : 0 };
}

/** Redondea hacia arriba al céntimo sin que un error de coma flotante suba un céntimo de más. */
const techoCentimo = (n: number): number => Math.ceil(Number((n * 100).toFixed(6))) / 100;

/**
 * Precio mínimo del contrato v1.3: el MISMO que el Importador de Retador, `ceil((costo + pasarela fija + ganancia mínima) / (1 − pasarela %) × 100) / 100`.
 * El envío no entra. Además se exige que, con el envío estimado, el vendedor no pierda con la pasarela sobre el total cobrado (nunca se publica con pérdida).
 */
function precioMinimoV13(costeTotal: number, t: TarifasRetador, costeProducto?: number): number {
  const producto = costeProducto ?? costeTotal;
  const g = t.pasarelaPct / 100;
  const minimoRetador = techoCentimo((producto + t.pasarelaFijaUsd + (t.gananciaMinimaRetadorUsd as number)) / (1 - g));
  if (!pasarelaLaPagaElVendedor(t)) return minimoRetador;
  const envio = costeProducto === undefined ? 0 : Math.max(0, costeTotal - costeProducto);
  const sinPerdida = techoCentimo((producto + envio * g + t.pasarelaFijaUsd) / (1 - g));
  return Math.max(minimoRetador, sinPerdida);
}

/**
 * Precio mínimo: el mayor entre lo que exige Retador (el coste puesto en Cuba) y el precio con el que el vendedor deja de perder dinero.
 */
export function precioMinimoSinPerdida(costeTotal: number, t: TarifasRetador, costeProducto?: number): number {
  if (esContratoV13(t)) return precioMinimoV13(costeTotal, t, costeProducto);
  const base = costeBase(costeTotal, costeProducto, t);
  const k = t.comisionPctGanancia / 100;
  const vendedorPaga = t.pasarelaACargo === 'vendedor' || t.pasarelaACargo === undefined;
  const g = vendedorPaga ? t.pasarelaPct / 100 : 0;
  const f = vendedorPaga ? t.pasarelaFijaUsd : 0;
  const denominador = 1 - k - g;
  const sinPerdida = denominador <= 0 ? Number.POSITIVE_INFINITY : Math.ceil(((base * (1 - k) + f) / denominador) * 100) / 100;
  return Math.max(sinPerdida, Math.ceil(costeTotal * 100) / 100);
}
