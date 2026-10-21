/**
 * Explicación del envío a CUBA para quien elige Cuba como destino (solo se usa en esa elección).
 *
 * La ruta de Retador es proveedor → hub de EE. UU. → Cuba. El precio al comprador son dos tramos reales:
 *   1) proveedor → hub: la cotización más barata del proveedor hacia EE. UU. desde un almacén que tiene stock;
 *   2) hub → Cuba: peso real de la variante × tarifa por libra que informa Retador (nunca copiada a mano).
 * Si falta un dato real (cotización, peso, tarifa) no se calcula y se dice qué falta. Nada se inventa.
 */
import { envioAlHub, stockPorOrigen } from '../../../supabase/functions/_compartido/retador-stock';

const GRAMOS_POR_LIBRA = 453.592;
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface TarifaHubCuba {
  hubUsdPorLibra: number;
  diasHubCuba: [number, number];
}

export interface EnvioCuba {
  /** Tramo 1: proveedor → hub de EE. UU. (precio de la cotización real más barata) */
  tramoHub: { precio: number; origen: string; dias: [number, number] | null };
  /** Tramo 2: hub → Cuba, mínimo y máximo entre las variantes con stock y peso conocido */
  tramoCuba: { min: number; max: number };
  /** Total al comprador (tramo 1 + tramo 2) */
  total: { min: number; max: number };
  /** Plazo total en días si el proveedor informa el suyo; si no, solo el de Retador */
  dias: { min: number | null; max: number | null; soloRetador: [number, number] };
  variantesCalculadas: number;
  variantesSinPeso: number;
}

export type ResultadoEnvioCuba = { ok: true; envio: EnvioCuba } | { ok: false; falta: string };

export function envioACuba(ficha: any, proveedor: 'cj' | 'aliexpress', tarifa: TarifaHubCuba | null | undefined): ResultadoEnvioCuba {
  if (!tarifa || !Number.isFinite(tarifa.hubUsdPorLibra)) return { ok: false, falta: 'la tarifa de envío de Retador (conecta tu tienda de Retador en «Tiendas»)' };
  const variantes: any[] = Array.isArray(ficha?.variantes) ? ficha.variantes : [];
  const pesoFicha = typeof ficha?.peso?.gramos === 'number' && ficha.peso.gramos > 0 ? ficha.peso.gramos : null;
  let hub: ReturnType<typeof envioAlHub> = null;
  const tramos2: number[] = [];
  let sinPeso = 0;
  for (const v of variantes) {
    const existencias = stockPorOrigen(v, proveedor);
    if (existencias.total === null || existencias.total <= 0) continue; // solo cuentan las variantes con stock
    const conStock = new Set([...existencias.origenes].filter(([, n]) => n > 0).map(([o]) => o));
    const cotizacion = envioAlHub(ficha, proveedor === 'cj' ? conStock : null);
    if (!cotizacion) continue;
    if (!hub || cotizacion.precio < hub.precio) hub = cotizacion;
    const peso = typeof v.pesoGramos === 'number' && v.pesoGramos > 0 ? v.pesoGramos : pesoFicha;
    if (peso === null) {
      sinPeso += 1;
      continue;
    }
    tramos2.push(r2((peso / GRAMOS_POR_LIBRA) * tarifa.hubUsdPorLibra));
  }
  if (!hub) return { ok: false, falta: 'la cotización del proveedor hacia EE. UU. desde un almacén con stock' };
  if (!tramos2.length) return { ok: false, falta: 'el peso real de las variantes con stock' };
  const min2 = Math.min(...tramos2);
  const max2 = Math.max(...tramos2);
  const dias = hub.dias ? { min: hub.dias[0] + tarifa.diasHubCuba[0], max: hub.dias[1] + tarifa.diasHubCuba[1] } : { min: null, max: null };
  return {
    ok: true,
    envio: {
      tramoHub: hub,
      tramoCuba: { min: min2, max: max2 },
      total: { min: r2(hub.precio + min2), max: r2(hub.precio + max2) },
      dias: { ...dias, soloRetador: tarifa.diasHubCuba },
      variantesCalculadas: tramos2.length,
      variantesSinPeso: sinPeso,
    },
  };
}
