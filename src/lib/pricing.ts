/**
 * Motor de precios: convierte costo de proveedor + regla de margen en precio de venta.
 *
 * precio = costo*(1+markup/100) + fixedFee [+ envío si includeShipping]
 * luego: se respeta minProfit (suelo absoluto), minPrice/maxPrice y redondeo psicológico.
 */
import type { PriceBreakdown, PricingRuleLike } from './types';
import { round2, roundPsychological } from './utils';

export const DEFAULT_RULE: Required<Omit<PricingRuleLike, 'minPrice' | 'maxPrice'>> & {
  minPrice: number | null;
  maxPrice: number | null;
} = {
  markupPct: 40,
  fixedFee: 0,
  minProfit: 1.5,
  roundTo: 0.99,
  includeShipping: true,
  minPrice: null,
  maxPrice: null,
};

export function computeSellingPrice(
  cost: number,
  shipping = 0,
  rule: PricingRuleLike = DEFAULT_RULE,
  ruleName = 'default',
): PriceBreakdown {
  const markupPct = clamp(Number(rule.markupPct) || 0, -90, 2000);
  const fixedFee = Number(rule.fixedFee ?? 0) || 0;
  const minProfit = Number(rule.minProfit ?? 0) || 0;
  const includeShipping = rule.includeShipping ?? true;
  const roundTo = rule.roundTo === null || rule.roundTo === undefined ? 0.99 : Number(rule.roundTo);

  const landedCost = round2(cost + (includeShipping ? shipping : 0));
  let price = cost * (1 + markupPct / 100) + fixedFee + (includeShipping ? shipping : 0);

  // Suelo: nunca por debajo de costo + beneficio mínimo
  price = Math.max(price, landedCost + minProfit);

  if (rule.minPrice != null) price = Math.max(price, Number(rule.minPrice));
  if (rule.maxPrice != null) price = Math.min(price, Number(rule.maxPrice));

  price = roundTo > 0 ? roundPsychological(price, roundTo) : round2(price);
  if (rule.minPrice != null) price = Math.max(price, round2(Number(rule.minPrice)));
  if (rule.maxPrice != null) price = Math.min(price, round2(Number(rule.maxPrice)));

  const profit = round2(price - landedCost);
  const marginPct = price > 0 ? round2((profit / price) * 100) : 0;

  return {
    cost: round2(cost),
    shipping: round2(shipping),
    sellingPrice: round2(price),
    compareAtPrice: round2(roundPsychological(price * 1.35)),
    profit,
    marginPct,
    ruleApplied: ruleName,
  };
}

export function applyMarginToVariants<
  T extends { price: number; compareAtPrice?: number },
>(variants: T[], shipping: number, rule: PricingRuleLike) {
  return variants.map((v) => {
    const b = computeSellingPrice(v.price, shipping, rule);
    return { ...v, price: b.sellingPrice, compareAtPrice: b.compareAtPrice, __cost: v.price, __profit: b.profit };
  });
}

/**
 * Detecta si merece la pena actualizar el precio en la tienda.
 * Evita "flapping": sólo cambia si la variación supera el umbral (por defecto 1.5%).
 */
export function shouldUpdatePrice(currentPrice: number, newPrice: number, thresholdPct = 1.5) {
  if (currentPrice <= 0) return true;
  const delta = Math.abs((newPrice - currentPrice) / currentPrice) * 100;
  return delta >= thresholdPct;
}

/** Análisis de una venta: beneficio real considerando coste proveedor y comisiones de pasarela */
export function orderProfit(input: {
  total: number;
  supplierCost: number;
  paymentFeePct?: number;
  paymentFeeFixed?: number;
}) {
  const feePct = input.paymentFeePct ?? 2.9;
  const feeFixed = input.paymentFeeFixed ?? 0.3;
  const fees = round2(input.total * (feePct / 100) + feeFixed);
  const profit = round2(input.total - input.supplierCost - fees);
  const margin = input.total > 0 ? round2((profit / input.total) * 100) : 0;
  return { fees, profit, margin };
}

const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), max);
