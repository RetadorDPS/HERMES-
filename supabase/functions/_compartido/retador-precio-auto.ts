/**
 * Precio automático en Retador: decide, variante por variante, si el precio publicado debe moverse cuando cambia el coste del proveedor.
 * Archivo SIN acceso a red ni a base de datos (se prueba en Node y corre en Deno).
 *
 * La regla del vendedor (porcentaje, redondeo…) marca el precio «ideal». Encima de eso mandan los FRENOS:
 *  1. Suelo: nunca por debajo del mínimo de Retador ni de lo que hace perder dinero al vendedor.
 *  2. Cambios pequeños no se aplican (menos del 2 % del precio o de 0,50 USD): así el comprador no ve el precio bailar por céntimos.
 *  3. Como mucho un cambio de precio al día por producto (salvo que el precio actual ya no valga: eso se arregla al momento).
 *  4. Un cambio de más del 25 % no se hace solo: puede ser un error del proveedor. Se avisa y decide el vendedor.
 */
import { precioMinimoContandoEnvio, type TarifasRetador } from "./retador-costes.ts";
import { precioPorRegla, redondearConRegla, type ReglaPrecio } from "./reglas-precio.ts";

export const UMBRAL_CAMBIO_PCT = 2;
export const UMBRAL_CAMBIO_USD = 0.5;
export const TOPE_CAMBIO_PCT = 25;
export const ESPERA_ENTRE_CAMBIOS_MS = 24 * 3_600_000;

export interface EntradaPrecioAuto {
  precioActual: number;
  /** Coste de hoy en el proveedor: total (producto + envío estimado) y solo producto. */
  coste: { total: number; producto: number };
  tarifas: TarifasRetador | null;
  regla: ReglaPrecio;
  /** Última vez que el sistema cambió este precio solo (null = nunca). */
  ultimoCambioMs: number | null;
  ahoraMs: number;
  /** El vendedor acaba de activar el precio automático y lo ha confirmado: se aplica la regla sin frenos de umbral, espera ni tope. */
  forzar?: boolean;
}

export type DecisionPrecio =
  | { tipo: "sin_cambio"; objetivo: number; minimo: number | null }
  | { tipo: "cambiar"; nuevo: number; objetivo: number; minimo: number | null; urgente: boolean; cambioPct: number }
  | { tipo: "esperar"; nuevo: number; objetivo: number; minimo: number | null; cambioPct: number }
  | { tipo: "revisar"; nuevo: number; objetivo: number; minimo: number | null; urgente: boolean; cambioPct: number };

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function decidirPrecioAuto(e: EntradaPrecioAuto): DecisionPrecio {
  const minimo = e.tarifas ? precioMinimoContandoEnvio(e.coste.total, e.tarifas, e.coste.producto) : null;
  const porRegla = precioPorRegla(e.coste.total, e.regla);
  // El suelo manda sobre la regla; si hay que subir hasta el suelo se redondea hacia arriba con el estilo de la regla (acabado en .99)
  const objetivo = minimo === null ? porRegla : Math.max(porRegla, redondearConRegla(minimo, e.regla));
  const dif = objetivo - e.precioActual;
  const cambioPct = e.precioActual > 0 ? r2((dif / e.precioActual) * 100) : 100;
  const urgente = minimo !== null && e.precioActual + 0.004 < minimo;

  if (Math.abs(dif) < 0.005) return { tipo: "sin_cambio", objetivo, minimo };
  if (e.forzar) return { tipo: "cambiar", nuevo: objetivo, objetivo, minimo, urgente, cambioPct };

  if (!urgente) {
    const umbral = Math.min((UMBRAL_CAMBIO_PCT / 100) * e.precioActual, UMBRAL_CAMBIO_USD);
    if (Math.abs(dif) < umbral) return { tipo: "sin_cambio", objetivo, minimo };
  }
  if (Math.abs(cambioPct) > TOPE_CAMBIO_PCT) return { tipo: "revisar", nuevo: objetivo, objetivo, minimo, urgente, cambioPct };
  if (!urgente && e.ultimoCambioMs !== null && e.ahoraMs - e.ultimoCambioMs < ESPERA_ENTRE_CAMBIOS_MS) return { tipo: "esperar", nuevo: objetivo, objetivo, minimo, cambioPct };
  return { tipo: "cambiar", nuevo: objetivo, objetivo, minimo, urgente, cambioPct };
}
