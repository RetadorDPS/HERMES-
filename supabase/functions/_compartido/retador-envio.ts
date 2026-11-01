/**
 * Envío por país hacia Retador (contrato v1.5, campo `envio`). Archivo SIN dependencias de red ni de base de datos
 * (se prueba en Node y corre en Deno).
 *
 * Reglas:
 *  · solo cotizaciones REALES ya guardadas en la ficha; un país sin cotización no se manda (nada se inventa);
 *  · en CJ solo cuentan los almacenes que tienen el stock de lo publicado; en AliExpress el almacén lo decide cada cotización;
 *  · Cuba (CU) NO se manda: Retador la calcula con su propia regla (EE. UU. + tramo del hub). EE. UU. (US) sí, siempre que exista;
 *  · precios en USD; «gratis» solo si la propia cotización lo dice (cuenta como 0).
 */
import { precioDeOpcion } from "./retador-stock.ts";

export interface DestinoEnvio {
  pais: string;
  dias_min: number;
  dias_max: number;
  precio_usd: number | null;
  gratis: boolean;
}

export interface EnvioParaRetador {
  /** Fecha ISO de la cotización más reciente de las que se mandan. */
  cotizado_en: string;
  destinos: DestinoEnvio[];
}

export const MAX_DESTINOS = 100;
const MAX_DIAS_MIN = 120;
const MAX_DIAS_MAX = 150;

const redondear = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Días de una opción de envío como enteros válidos para Retador, o null si la cotización no los trae bien. */
function diasValidos(o: any): [number, number] | null {
  const a = Number(o?.diasMin);
  const b = Number(o?.diasMax);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const min = Math.floor(a);
  const max = Math.ceil(b);
  if (min < 0 || max < 1 || max < min || min > MAX_DIAS_MIN || max > MAX_DIAS_MAX) return null;
  return [min, max];
}

/**
 * Envío por país de una ficha del catálogo. `origenesConStock` = almacenes que tienen el stock de las variantes publicadas
 * (null = vale cualquier almacén, como en AliExpress). Devuelve null si no hay ninguna cotización utilizable.
 */
export function envioParaRetador(ficha: any, origenesConStock: Set<string> | null): EnvioParaRetador | null {
  if (origenesConStock && origenesConStock.size === 0) return null;
  const porOrigen = ficha?.envio?.porOrigen ?? {};
  const mejores = new Map<string, { precio: number; gratis: boolean; min: number; max: number; cuando: number }>();
  for (const [origen, destinos] of Object.entries<any>(porOrigen)) {
    if (origenesConStock && !origenesConStock.has(origen)) continue;
    for (const [pais, q] of Object.entries<any>(destinos ?? {})) {
      if (!/^[A-Z]{2}$/.test(pais) || pais === "CU") continue;
      if (!q || q.error || !Array.isArray(q.opciones)) continue;
      const cuando = Date.parse(String(q.actualizado ?? ""));
      if (!Number.isFinite(cuando)) continue;
      for (const o of q.opciones) {
        const precio = precioDeOpcion(o);
        if (precio === null || precio < 0) continue;
        const dias = diasValidos(o);
        if (!dias) continue;
        const candidata = { precio: redondear(precio), gratis: o?.gratis === true, min: dias[0], max: dias[1], cuando };
        const previa = mejores.get(pais);
        // La opción más barata; a igualdad de precio, la más rápida
        if (!previa || candidata.precio < previa.precio || (candidata.precio === previa.precio && candidata.max < previa.max)) mejores.set(pais, candidata);
      }
    }
  }
  if (!mejores.size) return null;
  // EE. UU. primero (Retador lo necesita para Cuba) y después por orden alfabético; el tope de 100 nunca deja fuera a EE. UU.
  const paises = [...mejores.keys()].sort((a, b) => (a === "US" ? -1 : b === "US" ? 1 : a.localeCompare(b)));
  const destinos: DestinoEnvio[] = paises.slice(0, MAX_DESTINOS).map((pais) => {
    const m = mejores.get(pais)!;
    return { pais, dias_min: m.min, dias_max: m.max, precio_usd: m.precio, gratis: m.gratis };
  });
  const masReciente = Math.max(...paises.slice(0, MAX_DESTINOS).map((p) => mejores.get(p)!.cuando));
  return { cotizado_en: new Date(masReciente).toISOString(), destinos };
}

/** Huella corta y estable de lo que se manda (sin la fecha): sirve para saber si hay algo nuevo que enviar. */
export function huellaEnvio(e: EnvioParaRetador): string {
  return huellaTexto(JSON.stringify(e.destinos));
}

/** FNV-1a de 32 bits aplicado al texto y a su reverso: 16 caracteres hexadecimales. */
export function huellaTexto(texto: string): string {
  const fnv = (s: string) => {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, "0");
  };
  return fnv(texto) + fnv([...texto].reverse().join(""));
}
