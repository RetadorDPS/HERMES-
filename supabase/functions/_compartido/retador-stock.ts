/**
 * Existencias y envío de una ficha del catálogo, para publicar en Retador. Archivo SIN dependencias (se prueba en Node y corre en Deno).
 * Regla: no se publica una variante sin existencias reales (en almacén o en fábrica) ni sin envío cotizado desde el almacén que las tiene.
 */
/** Precio de una opción de envío cotizada: el número que informa el proveedor o 0 si la propia cotización dice que es gratis (nunca se supone gratis sin que lo diga). */
export function precioDeOpcion(o: any): number | null {
  if (typeof o?.precio === "number" && Number.isFinite(o.precio)) return o.precio;
  return o?.gratis === true ? 0 : null;
}

/** Envío real al hub de EE. UU.: la cotización más barata del producto hacia US. Con `origenes` solo cuentan los almacenes indicados (los que tienen el stock). */
export function envioAlHub(ficha: any, origenes: Set<string> | null = null): { precio: number; origen: string; dias: [number, number] | null } | null {
  let mejor: { precio: number; origen: string; dias: [number, number] | null } | null = null;
  const porOrigen = ficha?.envio?.porOrigen ?? {};
  for (const [origen, destinos] of Object.entries<any>(porOrigen)) {
    if (origenes && !origenes.has(origen)) continue;
    const opciones = destinos?.US?.opciones;
    if (!Array.isArray(opciones)) continue;
    for (const o of opciones) {
      const precio = precioDeOpcion(o);
      if (precio === null) continue;
      if (!mejor || precio < mejor.precio) mejor = { precio, origen, dias: typeof o.diasMin === "number" && typeof o.diasMax === "number" ? [o.diasMin, o.diasMax] : null };
    }
  }
  return mejor;
}

const entero = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/**
 * Existencias REALES de una variante por almacén de salida. AliExpress informa el stock de la variante (el almacén lo decide cada cotización).
 * En CJ cuentan las del almacén de CJ MÁS las de la fábrica (las dos las informa CJ; la de fábrica tarda más en salir). Null = no se sabe.
 */
export function stockPorOrigen(variante: any, proveedor: "cj" | "aliexpress"): { total: number | null; origenes: Map<string, number>; almacen: number | null; fabrica: number | null } {
  const filas: any[] = Array.isArray(variante?.stock) ? variante.stock : [];
  const origenes = new Map<string, number>();
  if (proveedor === "aliexpress") {
    const totales = filas.map((f) => f?.total).filter(entero);
    return { total: totales.length ? Math.max(0, ...totales) : null, origenes, almacen: null, fabrica: null };
  }
  let total: number | null = null, almacen: number | null = null, fabrica: number | null = null;
  for (const f of filas) {
    const partes = [f?.cj, f?.fabrica].filter(entero);
    const unidades = partes.length ? partes.reduce((a: number, b: number) => a + b, 0) : entero(f?.total) ? f.total : null;
    if (unidades === null) continue;
    total = (total ?? 0) + unidades;
    if (entero(f?.cj)) almacen = (almacen ?? 0) + f.cj;
    if (entero(f?.fabrica)) fabrica = (fabrica ?? 0) + f.fabrica;
    const origen = typeof f?.pais === "string" && f.pais ? f.pais : "?";
    origenes.set(origen, (origenes.get(origen) ?? 0) + unidades);
  }
  return { total, origenes, almacen, fabrica };
}
