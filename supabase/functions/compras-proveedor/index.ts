/**
 * compras-proveedor — Compra al proveedor de los pedidos pagados de Retador (docs/contrato-pedidos.md).
 *
 * Acciones (POST, JSON, con sesión de usuario):
 *   config_obtener                     Modo de compras, topes y cuántas compras reales lleva el usuario.
 *   config_guardar {config}            Cambia el modo y los topes (el modo AUTOMATICO exige 3 compras reales antes).
 *   comprar {orderId, aprobar?}        Decide y, según el modo, simula o crea el pedido en el proveedor.
 *   marcar_pagada {orderId}            El usuario confirma que pagó el pedido en CJ: queda COMPRADA y se avisa a Retador.
 *
 * Seguridad: por defecto SIMULACION (no llama a ningún proveedor). Con MANUAL hace falta `aprobar: true` en cada pedido.
 * El pedido se crea en CJ SIN PAGAR (no se mueve dinero); el pago lo confirma el usuario. Nunca se compra dos veces
 * (índice único en CompraProveedor), ni un pedido sin pagar, cancelado, con datos dudosos o por encima de los topes.
 * Las llamadas al proveedor van de una en una por la vía interna de `cj-catalogo`. AliExpress todavía no está construido.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { CONFIG_POR_DEFECTO, elegirEnvioCompra, evaluarCompra, validarConfig, type ConfigCompras, type ItemCompra, type OrdenCompra, type Proveedor } from "./compras.ts";
import { stockPorOrigen } from "./retador-stock.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const responder = (cuerpo: unknown, estado = 200) => new Response(JSON.stringify(cuerpo), { status: estado, headers: { ...CORS, "Content-Type": "application/json" } });
const servicio = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const ahora = () => new Date().toISOString();
const PROVEEDOR_DE_SUPPLIER: Record<string, Proveedor> = { "proveedor-cj": "CJ_DROPSHIPPING", "proveedor-aliexpress": "ALIEXPRESS" };

class ErrorApp extends Error {
  constructor(public codigo: string, mensaje: string, public extra: Record<string, unknown> = {}) {
    super(mensaje);
  }
}

/** Las tablas de compras se crean con una migración que puede estar pendiente de aprobar: se avisa con claridad, no se rompe. */
const tablaFalta = (e: any) => Boolean(e) && (e.code === "42P01" || e.code === "PGRST205" || /does not exist|Could not find the table/i.test(String(e.message ?? "")));
const TABLAS_PENDIENTES = new ErrorApp("tablas_pendientes", "Las tablas de compras todavía no están creadas en la base de datos. Hay que aplicar la migración «compras_proveedor».");

async function leerConfig(uid: string): Promise<ConfigCompras> {
  const { data, error } = await servicio.from("ConfigCompras").select("modo,limitePedidoUsd,limiteDiaUsd,subidaMaxPct").eq("userId", uid).maybeSingle();
  if (tablaFalta(error)) throw TABLAS_PENDIENTES;
  if (error) throw new ErrorApp("error_interno", "No se pudo leer la configuración de compras");
  if (!data) return { ...CONFIG_POR_DEFECTO };
  return { modo: data.modo, limitePedidoUsd: Number(data.limitePedidoUsd), limiteDiaUsd: Number(data.limiteDiaUsd), subidaMaxPct: Number(data.subidaMaxPct) };
}

async function comprasReales(uid: string): Promise<number> {
  const { count, error } = await servicio.from("CompraProveedor").select("id", { count: "exact", head: true }).eq("userId", uid).eq("estado", "COMPRADA");
  if (tablaFalta(error)) throw TABLAS_PENDIENTES;
  return count ?? 0;
}

async function accionConfigObtener(uid: string) {
  return { config: await leerConfig(uid), comprasRealesHechas: await comprasReales(uid) };
}

async function accionConfigGuardar(uid: string, cuerpo: any) {
  const hechas = await comprasReales(uid);
  const v = validarConfig(cuerpo?.config, hechas);
  if (!v.ok) throw new ErrorApp("config_no_valida", v.motivo);
  const { error } = await servicio.from("ConfigCompras").upsert({ userId: uid, ...v.config, actualizadoEn: ahora() }, { onConflict: "userId" });
  if (tablaFalta(error)) throw TABLAS_PENDIENTES;
  if (error) throw new ErrorApp("error_interno", "No se pudo guardar la configuración");
  return { config: v.config, comprasRealesHechas: hechas };
}

/** Dinero ya comprometido hoy (compras reales: en curso, creadas o hechas; las simuladas no cuentan). */
async function gastadoHoy(uid: string): Promise<number> {
  const inicio = new Date();
  inicio.setUTCHours(0, 0, 0, 0);
  const { data, error } = await servicio.from("CompraProveedor").select("costeUsd").eq("userId", uid).in("estado", ["EN_CURSO", "CREADA", "COMPRADA"]).gte("creadoEn", inicio.toISOString());
  if (tablaFalta(error)) throw TABLAS_PENDIENTES;
  return (data ?? []).reduce((s: number, f: any) => s + Number(f.costeUsd ?? 0), 0);
}

/** Datos reales del pedido, de sus productos y de la ficha de cada variante (existencias, coste actual y envío cotizado). */
async function cargarPedido(uid: string, orderId: unknown) {
  if (typeof orderId !== "string" || !orderId) throw new ErrorApp("datos_invalidos", "Indica el pedido");
  const { data: orden } = await servicio.from("Order").select("*").eq("id", orderId).eq("userId", uid).maybeSingle();
  if (!orden) throw new ErrorApp("pedido_no_encontrado", "No se encontró ese pedido");
  const { data: lineas } = await servicio.from("OrderItem").select("*").eq("orderId", orderId);
  const productosIds = [...new Set((lineas ?? []).map((l: any) => l.productId).filter(Boolean))];
  const { data: productos } = productosIds.length ? await servicio.from("Product").select("id,supplierId,supplierProductId").in("id", productosIds) : { data: [] as any[] };
  const { data: previas, error } = await servicio.from("CompraProveedor").select("proveedor,estado").eq("orderId", orderId).in("estado", ["EN_CURSO", "CREADA", "COMPRADA"]);
  if (tablaFalta(error)) throw TABLAS_PENDIENTES;

  const items: ItemCompra[] = [];
  const fichas: any[] = [];
  const origenes: Set<string>[] = [];
  for (const l of lineas ?? []) {
    const producto = (productos ?? []).find((p: any) => p.id === l.productId);
    const proveedor = producto ? PROVEEDOR_DE_SUPPLIER[producto.supplierId] ?? null : null;
    let ficha: any = null;
    if (producto && proveedor) {
      const { data: item } = await servicio.from("CatalogItem").select("id").eq("provider", proveedor).eq("externalId", producto.supplierProductId).maybeSingle();
      if (item) ficha = (await servicio.from("CatalogItemDetail").select("ficha").eq("itemId", item.id).maybeSingle()).data?.ficha ?? null;
    }
    const variante = ficha?.variantes?.find((v: any) => String(v.vid) === String(l.supplierVariantId) || v.sku === l.sku);
    const costeActual = typeof variante?.precio === "number" && Number.isFinite(variante.precio) ? variante.precio : null;
    items.push({
      sku: l.sku, titulo: l.title, cantidad: Number(l.quantity), supplierVariantId: l.supplierVariantId ?? null, proveedor,
      costeUnitUsd: Number(l.unitCost), costeActualUsd: costeActual,
    });
    fichas.push(ficha);
    const stock = variante && proveedor === "CJ_DROPSHIPPING" ? stockPorOrigen(variante, "cj") : null;
    origenes.push(new Set(stock ? [...stock.origenes.entries()].filter(([, n]) => n >= Number(l.quantity)).map(([o]) => o) : []));
  }
  const entrega = { nombre: orden.shippingName, direccion1: orden.shippingAddress1, ciudad: orden.shippingCity, pais: orden.shippingCountry };
  const ordenCompra: OrdenCompra = {
    id: orden.id, estado: orden.status, aviso: orden.errorMessage ?? null, entrega, items,
    yaComprado: [...new Set<Proveedor>((previas ?? []).map((p: any) => p.proveedor as Proveedor))],
  };
  return { orden, lineas: lineas ?? [], ordenCompra, fichas, origenes };
}

async function llamarCj(cuerpo: Record<string, unknown>) {
  const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/cj-catalogo`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
    body: JSON.stringify(cuerpo),
  });
  return await res.json().catch(() => ({ ok: false, error: `CJ respondió HTTP ${res.status}` }));
}

async function accionComprar(uid: string, cuerpo: any) {
  const config = await leerConfig(uid);
  const { orden, lineas, ordenCompra, fichas, origenes } = await cargarPedido(uid, cuerpo.orderId);
  const decision = evaluarCompra(ordenCompra, config, await gastadoHoy(uid));
  if (!decision.ok) return { comprado: false, codigo: decision.codigo, motivo: decision.motivo };
  if (config.modo === "MANUAL" && cuerpo.aprobar !== true) return { comprado: false, codigo: "falta_aprobacion", motivo: "En modo manual hay que aprobar cada compra con el botón." };

  const resultados: Record<string, unknown>[] = [];
  for (const grupo of decision.grupos) {
    const modoReal = config.modo === "SIMULACION" ? "SIMULACION" : (config.modo as "MANUAL" | "AUTOMATICO");
    if (grupo.proveedor !== "CJ_DROPSHIPPING") {
      resultados.push({ proveedor: grupo.proveedor, hecho: false, motivo: "La compra automática en AliExpress todavía no está construida: hay que comprarlo a mano." });
      continue;
    }
    // Envío: el más barato cotizado hacia el país de entrega desde un almacén que tenga todas las existencias
    const indices = ordenCompra.items.map((_, i) => i).filter((i) => ordenCompra.items[i].proveedor === grupo.proveedor);
    const envio = elegirEnvioCompra(indices.map((i) => fichas[i]), indices.map((i) => origenes[i]), String(orden.shippingCountry).toUpperCase());
    if ("error" in envio) {
      resultados.push({ proveedor: grupo.proveedor, hecho: false, motivo: envio.error });
      continue;
    }
    if (modoReal === "SIMULACION") {
      const { error } = await servicio.from("CompraProveedor").insert({
        orderId: orden.id, userId: uid, proveedor: grupo.proveedor, modo: "SIMULACION", estado: "SIMULADA", costeUsd: grupo.costeUsd,
        mensaje: `Simulación: se crearía el pedido en CJ desde ${envio.origen} con «${envio.logistica}» (envío ${envio.precioUsd.toFixed(2)} US$). No se llamó a CJ.`,
      });
      if (tablaFalta(error)) throw TABLAS_PENDIENTES;
      resultados.push({ proveedor: grupo.proveedor, hecho: false, simulada: true, costeUsd: grupo.costeUsd, origen: envio.origen, logistica: envio.logistica, envioUsd: envio.precioUsd });
      continue;
    }
    // Compra real: primero se reserva (el índice único impide dos compras a la vez), luego se llama a CJ
    const { data: reserva, error: eRes } = await servicio.from("CompraProveedor").insert({
      orderId: orden.id, userId: uid, proveedor: grupo.proveedor, modo: modoReal, estado: "EN_CURSO", costeUsd: grupo.costeUsd,
      mensaje: `Creando el pedido en CJ desde ${envio.origen} con «${envio.logistica}»`,
    }).select("id").single();
    if (tablaFalta(eRes)) throw TABLAS_PENDIENTES;
    if (eRes) {
      resultados.push({ proveedor: grupo.proveedor, hecho: false, motivo: eRes.code === "23505" ? "Este pedido ya se está comprando o ya se compró." : "No se pudo reservar la compra." });
      continue;
    }
    const lineasGrupo = indices.map((i) => lineas[i]);
    const r = await llamarCj({
      accion: "crear_pedido", numero: `${orden.storeOrderNumber ?? orden.id}-${String(reserva!.id).slice(0, 6)}`,
      entrega: { nombre: orden.shippingName, telefono: orden.customerPhone, direccion1: orden.shippingAddress1, direccion2: orden.shippingAddress2, ciudad: orden.shippingCity, provincia: orden.shippingProvince, pais: orden.shippingCountry, codigoPostal: orden.shippingZip },
      origen: envio.origen, logistica: envio.logistica, nota: orden.notes ?? "",
      items: lineasGrupo.map((l: any) => ({ vid: l.supplierVariantId, cantidad: Number(l.quantity) })),
    });
    if (!r?.ok || !r.pedidoCjId) {
      await servicio.from("CompraProveedor").update({ estado: "ERROR", mensaje: String(r?.error ?? "CJ no creó el pedido").slice(0, 300) }).eq("id", reserva!.id);
      await servicio.from("Order").update({ errorMessage: `Compra en CJ fallida: ${String(r?.error ?? "sin detalle").slice(0, 200)}`, updatedAt: ahora() }).eq("id", orden.id);
      resultados.push({ proveedor: grupo.proveedor, hecho: false, motivo: String(r?.error ?? "CJ no creó el pedido") });
      continue;
    }
    await servicio.from("CompraProveedor").update({ estado: "CREADA", proveedorPedidoId: r.pedidoCjId, mensaje: "Pedido creado en CJ sin pagar: falta pagarlo y confirmarlo aquí." }).eq("id", reserva!.id);
    await servicio.from("Order").update({ supplierOrderId: r.pedidoCjId, errorMessage: null, updatedAt: ahora() }).eq("id", orden.id);
    resultados.push({ proveedor: grupo.proveedor, hecho: true, pedidoProveedorId: r.pedidoCjId, costeUsd: grupo.costeUsd, origen: envio.origen, logistica: envio.logistica, envioUsd: envio.precioUsd });
  }
  return { comprado: resultados.some((x) => x.hecho === true), modo: config.modo, resultados };
}

async function accionMarcarPagada(uid: string, cuerpo: any, jwt: string) {
  const { data: orden } = await servicio.from("Order").select("id,storeId").eq("id", String(cuerpo.orderId ?? "")).eq("userId", uid).maybeSingle();
  if (!orden) throw new ErrorApp("pedido_no_encontrado", "No se encontró ese pedido");
  const { data: compra, error } = await servicio.from("CompraProveedor").select("id,proveedorPedidoId").eq("orderId", orden.id).eq("estado", "CREADA").maybeSingle();
  if (tablaFalta(error)) throw TABLAS_PENDIENTES;
  if (!compra) throw new ErrorApp("sin_compra_creada", "Este pedido no tiene una compra creada pendiente de pago.");
  await servicio.from("CompraProveedor").update({ estado: "COMPRADA", mensaje: "Pago confirmado por el usuario" }).eq("id", compra.id);
  await servicio.from("Order").update({ status: "SUPPLIER_PURCHASED", fulfillmentStatus: "PROCESSING", supplierOrderId: compra.proveedorPedidoId, updatedAt: ahora() }).eq("id", orden.id);
  // Avisar a Retador de que ya se compró (idempotente); si falla, no se pierde nada: se puede repetir desde la pantalla
  let avisoRetador: string | null = null;
  try {
    const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/retador-tienda`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
      body: JSON.stringify({ accion: "pedido_informar", orderId: orden.id, estado: "comprado", proveedor: "cj" }),
    });
    const r = await res.json().catch(() => ({}));
    if (!r?.ok) avisoRetador = String(r?.error ?? "Retador no confirmó el aviso");
  } catch (e) {
    avisoRetador = (e as Error).message;
  }
  return { orderId: orden.id, avisoRetador };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return responder({ ok: false, codigo: "metodo", error: "Usa POST" }, 405);
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  // Llamada interna del barrido programado (`pedidos-barrido`): con la clave de servicio, que solo vive en el servidor,
  // se actúa en nombre del usuario indicado en `x-usuario`, y SOLO se puede pedir `comprar` (nunca cambiar la configuración).
  const interna = jwt !== "" && jwt === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const uid = interna ? (req.headers.get("x-usuario") ?? undefined) : (await servicio.auth.getUser(jwt)).data?.user?.id;
  if (interna && (await req.clone().json().catch(() => ({})))?.accion !== "comprar") return responder({ ok: false, codigo: "no_permitido", error: "Por la vía interna solo se puede comprar" }, 403);
  if (!uid) return responder({ ok: false, codigo: "sesion", error: "Sesión no válida" }, 401);
  const cuerpo = await req.json().catch(() => null);
  if (!cuerpo) return responder({ ok: false, codigo: "datos_invalidos", error: "El cuerpo no es JSON" });
  try {
    const accion = String(cuerpo.accion ?? "");
    let resultado: object;
    if (accion === "config_obtener") resultado = await accionConfigObtener(uid);
    else if (accion === "config_guardar") resultado = await accionConfigGuardar(uid, cuerpo);
    else if (accion === "comprar") resultado = await accionComprar(uid, cuerpo);
    else if (accion === "marcar_pagada") resultado = await accionMarcarPagada(uid, cuerpo, jwt);
    else return responder({ ok: false, codigo: "accion_desconocida", error: `Acción desconocida: ${accion}` });
    return responder({ ok: true, ...resultado });
  } catch (e) {
    if (e instanceof ErrorApp) return responder({ ok: false, codigo: e.codigo, error: e.message, ...e.extra });
    console.error("compras-proveedor", (e as Error)?.message);
    return responder({ ok: false, codigo: "error_interno", error: "Ocurrió un error inesperado. Inténtalo de nuevo; si sigue igual, avisa a soporte." });
  }
});
