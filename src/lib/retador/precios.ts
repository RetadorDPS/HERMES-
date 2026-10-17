/**
 * Cuentas de Retador en la app. La parte pura (coste puesto en Cuba, liquidación, mínimo sin pérdida) vive en
 * supabase/functions/_compartido/retador-costes.ts para que app y servidor usen EXACTAMENTE las mismas fórmulas.
 */
import { computeSellingPrice } from '../pricing';
import type { PricingRuleLike } from '../types';
import type { CostePuestoEnCuba } from '../../../supabase/functions/_compartido/retador-costes';

export * from '../../../supabase/functions/_compartido/retador-costes';

/**
 * Precio de venta propuesto con la regla de margen del vendedor, aplicada sobre el coste puesto en Cuba.
 * Nunca baja del coste: el suelo es coste + beneficio mínimo de la regla.
 */
export function precioPropuesto(coste: CostePuestoEnCuba, regla: PricingRuleLike): number {
  return computeSellingPrice(coste.total, 0, { ...regla, includeShipping: false }).sellingPrice;
}
