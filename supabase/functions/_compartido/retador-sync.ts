/**
 * Qué hay que empujar a Retador cuando el proveedor cambia algo (sincronización automática del monitor). Archivo SIN acceso a red ni a
 * base de datos: recibe lo ya leído y devuelve el plan (se prueba en Node y corre en Deno).
 *
 * Reglas:
 *  · el PRECIO de venta nunca se cambia solo. Si el coste sube tanto que el precio publicado queda por debajo del mínimo de Retador o con
 *    pérdida para el vendedor, el plan pide PAUSAR el producto y avisar; subir el precio lo decide el vendedor;
 *  · con el PRECIO AUTOMÁTICO activado (decisión del vendedor, por producto) el precio sigue su regla de porcentaje con frenos
 *    (ver `retador-precio-auto.ts`): sube y baja solo; sin él, el precio nunca se cambia solo;
 *  · stock: se manda solo lo que cambió en el proveedor; las ventas que Retador ya descontó no se pisan al alza;
 *    0 = Retador lo deja agotado solo; desconocido viaja como null (Retador marca «estimado», nunca inventamos nosotros);
 *  · envío y opiniones: solo si cambiaron desde la última vez que se mandaron.
 */
import { liquidacion, precioMinimoContandoEnvio, type TarifasRetador } from "./retador-costes.ts";
import { huellaEnvio, huellaTexto, type EnvioParaRetador } from "./retador-envio.ts";
import type { OpinionesProveedor } from "./resenas.ts";
import { decidirPrecioAuto, type DecisionPrecio } from "./retador-precio-auto.ts";
import type { ReglaPrecio } from "./reglas-precio.ts";

/** Subida de coste que se considera de verdad (no una oscilación de céntimos): como en los avisos del monitor. */
export const SUBIDA_MIN_USD = 0.05;
export const SUBIDA_MIN_PCT = 1;

export interface LocalVariante {
  sku: string;
  titulo: string;
  /** Existencias del PROVEEDOR la última vez que se sincronizaron (null = no se sabía). */
  stockProveedorPrevio: number | null;
  /** Precio de venta publicado. */
  precioActual: number;
  /** Coste (producto + envío) con el que se publicó: sirve para saber cuánto ha subido. */
  costeAntes: number;
}

export interface RemotaVariante {
  stock: number | null;
  estimado: boolean;
  precio: number | null;
}

export interface ActualVariante {
  /** Existencias reales de hoy en el proveedor (null = no las informa). */
  stock: number | null;
  /** Coste de hoy; null si falta algún dato para calcularlo (por ejemplo el envío cotizado). */
  coste: { total: number; producto: number } | null;
}

export interface EntradaPlan {
  locales: LocalVariante[];
  remotas: Map<string, RemotaVariante>;
  /** Variantes que el proveedor devuelve hoy, por sku. Una variante que no está aquí la ha retirado el proveedor. */
  actuales: Map<string, ActualVariante>;
  tarifas: TarifasRetador | null;
  /** Estado del producto en Retador ahora: activo | pausado | agotado. */
  estadoRemoto: string;
  admiteEnvio: boolean;
  envio: EnvioParaRetador | null;
  huellaEnvioPrevia: string | null;
  admiteResenas: boolean;
  resenas: OpinionesProveedor | null;
  huellaResenasPrevia: string | null;
  /** Precio automático de este producto (solo si el vendedor lo activó). */
  auto?: { regla: ReglaPrecio; ultimoCambioMs: number | null; ahoraMs: number };
}

export interface Riesgo {
  sku: string;
  titulo: string;
  precioActual: number;
  minimoUsd: number;
  costeAntes: number;
  costeAhora: number;
  /** Parte de producto del coste de hoy (sin envío): hace falta para calcular el neto con el coste actual. */
  costeProductoAhora: number;
  pierde: boolean;
}

export interface CambioPrecio {
  sku: string;
  titulo: string;
  antes: number;
  nuevo: number;
  objetivoRegla: number;
  costeAhora: number;
  urgente: boolean;
  cambioPct: number;
}

export interface PlanSync {
  variantes: { sku: string; stock: number | null }[];
  /** Precios que se mandan por el precio automático (solo con el precio automático activado). */
  precios: CambioPrecio[];
  /** Cambios de precio que el sistema NO hace solo (más del 25 %): se avisa y decide el vendedor. */
  revisiones: CambioPrecio[];
  pausar: boolean;
  riesgos: Riesgo[];
  envio?: EnvioParaRetador;
  huellaEnvio?: string;
  resenas?: OpinionesProveedor;
  huellaResenas?: string;
  /** Existencias del proveedor de hoy por sku: se guardan para comparar la próxima vez. */
  stockProveedorNuevo: Record<string, number | null>;
  hayCambios: boolean;
  resumen: string[];
}

/**
 * Qué stock mandar a Retador para una variante, o `undefined` si no hay nada que mandar.
 *  prev   = existencias del proveedor la última vez que se sincronizaron
 *  nuevo  = existencias del proveedor hoy
 *  remoto = lo que Retador tiene ahora (ya descontadas sus ventas)
 */
export function stockAEnviar(prev: number | null, nuevo: number | null, remoto: { stock: number | null; estimado: boolean }): number | null | undefined {
  if (nuevo === null) return prev === null ? undefined : null; // pasa a «no se sabe»
  if (nuevo === prev) return undefined; // el proveedor no cambió: no se pisa lo que Retador ya descontó por sus ventas
  if (nuevo === 0) return remoto.stock === 0 && !remoto.estimado ? undefined : 0;
  const r = remoto.stock;
  if (r === null || remoto.estimado) return nuevo; // el dato real sustituye a la estimación
  if (prev === null) return nuevo < r ? nuevo : undefined; // sin referencia: solo se baja, nunca se sube a ciegas
  if (nuevo < prev) return nuevo < r ? nuevo : undefined; // el proveedor bajó: se baja lo que haga falta
  return r + (nuevo - prev); // el proveedor repuso: se suma lo repuesto a lo que Retador tenga
}

export const huellaResenas = (o: OpinionesProveedor): string => huellaTexto(`${o.media ?? "-"}|${o.total ?? "-"}`);

export function planificarSincronizacion(e: EntradaPlan): PlanSync {
  const variantes: PlanSync["variantes"] = [];
  const precios: CambioPrecio[] = [];
  const revisiones: CambioPrecio[] = [];
  const riesgos: Riesgo[] = [];
  const stockProveedorNuevo: Record<string, number | null> = {};
  const resumen: string[] = [];
  let bajas = 0;
  let subidas = 0;
  let desconocidas = 0;
  let retiradas = 0;

  for (const l of e.locales) {
    const act = e.actuales.get(l.sku);
    const remota = e.remotas.get(l.sku) ?? { stock: null, estimado: true, precio: null };
    const nuevo = act ? act.stock : 0; // el proveedor ya no la devuelve = sin existencias
    stockProveedorNuevo[l.sku] = nuevo;
    const enviar = stockAEnviar(l.stockProveedorPrevio, nuevo, remota);
    if (enviar !== undefined) {
      variantes.push({ sku: l.sku, stock: enviar });
      if (!act) retiradas += 1;
      else if (enviar === null) desconocidas += 1;
      else if (remota.stock === null || enviar < remota.stock) bajas += 1;
      else subidas += 1;
    }

    // ¿Con el coste de hoy, el precio publicado deja de valer? (solo variantes que se pueden vender)
    const stockFinal = enviar !== undefined ? enviar : remota.stock;
    let precio = remota.precio ?? l.precioActual;

    // Precio automático: la regla del vendedor, con sus frenos, mueve el precio cuando cambia el coste
    if (e.auto && act && act.coste && e.tarifas) {
      const d: DecisionPrecio = decidirPrecioAuto({ precioActual: precio, coste: act.coste, tarifas: e.tarifas, regla: e.auto.regla, ultimoCambioMs: e.auto.ultimoCambioMs, ahoraMs: e.auto.ahoraMs });
      const fila: CambioPrecio = { sku: l.sku, titulo: l.titulo, antes: precio, nuevo: "nuevo" in d ? d.nuevo : precio, objetivoRegla: d.objetivo, costeAhora: act.coste.total, urgente: "urgente" in d ? d.urgente : false, cambioPct: "cambioPct" in d ? d.cambioPct : 0 };
      if (d.tipo === "cambiar") {
        precios.push(fila);
        precio = d.nuevo; // con el precio nuevo ya no hay riesgo de vender por debajo del mínimo
      } else if (d.tipo === "revisar") {
        revisiones.push(fila);
      }
    }

    if (!act || !act.coste || !e.tarifas || stockFinal === 0) continue;
    const subida = act.coste.total - l.costeAntes;
    const pct = l.costeAntes > 0 ? (subida / l.costeAntes) * 100 : 100;
    if (subida < SUBIDA_MIN_USD || pct < SUBIDA_MIN_PCT) continue; // oscilación de céntimos: no es una subida de coste
    const minimo = precioMinimoContandoEnvio(act.coste.total, e.tarifas, act.coste.producto);
    const liq = liquidacion(precio, act.coste.total, e.tarifas, act.coste.producto);
    if (precio + 0.004 < minimo || liq.neto < 0) {
      riesgos.push({ sku: l.sku, titulo: l.titulo, precioActual: precio, minimoUsd: minimo, costeAntes: l.costeAntes, costeAhora: act.coste.total, costeProductoAhora: act.coste.producto, pierde: liq.neto < 0 });
    }
  }

  if (bajas) resumen.push(`stock bajado en ${bajas} ${bajas === 1 ? "variante" : "variantes"}`);
  if (subidas) resumen.push(`stock repuesto en ${subidas} ${subidas === 1 ? "variante" : "variantes"}`);
  if (retiradas) resumen.push(`${retiradas} ${retiradas === 1 ? "variante retirada" : "variantes retiradas"} por el proveedor (stock 0)`);
  if (desconocidas) resumen.push(`stock desconocido en ${desconocidas} ${desconocidas === 1 ? "variante" : "variantes"}`);
  if (precios.length) resumen.push(`precio ajustado con tu regla en ${precios.length} ${precios.length === 1 ? "variante" : "variantes"}`);

  const plan: PlanSync = {
    variantes,
    precios,
    revisiones,
    pausar: riesgos.length > 0 && e.estadoRemoto !== "pausado",
    riesgos,
    stockProveedorNuevo,
    hayCambios: false,
    resumen,
  };
  if (riesgos.length) resumen.push(e.estadoRemoto === "pausado" ? "el coste subió y el precio ya no vale (el producto ya estaba pausado)" : "pausado porque el coste subió y el precio ya no vale");

  if (e.admiteEnvio && e.envio) {
    const h = huellaEnvio(e.envio);
    if (h !== e.huellaEnvioPrevia) {
      plan.envio = e.envio;
      plan.huellaEnvio = h;
      resumen.push(`envío a ${e.envio.destinos.length} ${e.envio.destinos.length === 1 ? "país" : "países"}`);
    }
  }
  if (e.admiteResenas && e.resenas) {
    const h = huellaResenas(e.resenas);
    if (h !== e.huellaResenasPrevia) {
      plan.resenas = e.resenas;
      plan.huellaResenas = h;
      resumen.push("opiniones del producto");
    }
  }
  plan.hayCambios = variantes.length > 0 || precios.length > 0 || plan.pausar || Boolean(plan.envio) || Boolean(plan.resenas);
  return plan;
}
