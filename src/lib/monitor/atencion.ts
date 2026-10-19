/**
 * Qué productos publicados necesitan atención, comparando lo que el vendedor guardó al publicar con lo que el proveedor cobra y tiene HOY.
 * Parte pura (sin red): se prueba en tests/monitor/atencion.test.ts. Todo en USD, la moneda en que cobra el proveedor.
 *
 * Esto cubre lo que el filtro de avisos del servidor no ve: una subida que se va sumando de pocos céntimos en cada repaso.
 */
import { stockTotal } from '../../../supabase/functions/_compartido/cambios';

export interface VarianteGuardada {
  id: string;
  supplierVariantId: string | null;
  sku: string | null;
  title: string;
  /** Coste del proveedor guardado al publicar (USD) */
  costPrice: number;
  /** Precio de venta publicado (USD) */
  sellingPrice: number;
  /** Envío que paga el vendedor, guardado al publicar (USD) */
  shippingCost: number;
}

export interface VarianteActual {
  vid: string | null;
  sku: string | null;
  precio: number | null;
  stock: { total: number | null }[] | null | undefined;
}

export type MotivoAtencion = 'COSTE_SUBIO' | 'AGOTADO' | 'SIN_FICHA';

export interface Atencion {
  motivo: MotivoAtencion;
  variante: string;
  /** Coste guardado y coste actual (USD) */
  costeAntes?: number;
  costeAhora?: number;
  pct?: number;
  /** Lo que queda de cada unidad antes de la comisión de la plataforma: precio − coste − envío (USD) */
  gananciaAntes?: number;
  gananciaAhora?: number;
  /** Con el coste nuevo el precio publicado ya no cubre el coste */
  vendeAPerdida?: boolean;
}

export const MIN_SUBIDA_USD = 0.05;
export const MIN_SUBIDA_PCT = 1;
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Compara cada variante publicada con la ficha actual del proveedor. Devuelve solo lo que requiere una decisión del vendedor. */
export function atencionDeProducto(guardadas: VarianteGuardada[], actuales: VarianteActual[] | null | undefined): Atencion[] {
  if (!actuales || !actuales.length) return guardadas.length ? [{ motivo: 'SIN_FICHA', variante: '' }] : [];
  const salida: Atencion[] = [];
  for (const g of guardadas) {
    const a = actuales.find((x) => (g.supplierVariantId && x.vid === g.supplierVariantId) || (g.sku && x.sku === g.sku));
    if (!a) continue;
    if (a.precio !== null && Number.isFinite(a.precio) && g.costPrice > 0) {
      const sube = a.precio - g.costPrice;
      const pct = (sube / g.costPrice) * 100;
      if (sube >= MIN_SUBIDA_USD && pct >= MIN_SUBIDA_PCT) {
        const gananciaAntes = r2(g.sellingPrice - g.costPrice - g.shippingCost);
        const gananciaAhora = r2(g.sellingPrice - a.precio - g.shippingCost);
        salida.push({ motivo: 'COSTE_SUBIO', variante: g.title, costeAntes: r2(g.costPrice), costeAhora: r2(a.precio), pct: r2(pct), gananciaAntes, gananciaAhora, vendeAPerdida: gananciaAhora < 0 });
      }
    }
    const total = stockTotal((a.stock ?? []).map((s) => ({ total: s.total })));
    if (total === 0) salida.push({ motivo: 'AGOTADO', variante: g.title });
  }
  return salida;
}
