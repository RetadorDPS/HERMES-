/**
 * acciones-usuario — Puerta central para que cada USUARIO pida por sí mismo dos acciones que gastan llamadas al proveedor,
 * con límites ESTRICTOS según su plan (tabla `PlanLimite`), contados en el servidor (`consumir_cuota`).
 *
 *   completar_ficha {itemId}                 Descarga la ficha completa del producto (variantes, stock, peso, reseñas).
 *   cotizar_envio  {itemId, paises?}         Cotiza el envío del producto a uno o varios países (hasta 12).
 *   uso                                      Plan del usuario, límites y lo que lleva gastado (para enseñarlo en pantalla).
 *
 * Reglas:
 *  · SIN lógica de proveedor: solo decide a qué función llamar según el proveedor del producto (`cj-catalogo` / `ali-catalogo`,
 *    por la vía interna con la clave de servicio) y la llamada la hace cada una con su propia lógica. Nunca se tocan entre sí.
 *  · Si la ficha o la cotización ya están al día en el catálogo común, NO se llama al proveedor y NO se gasta cupo.
 *  · Se gasta el cupo antes de llamar (todo o nada) y se DEVUELVE si el proveedor falla.
 *  · Nunca dos consultas a la vez contra el mismo proveedor (turno con caducidad): AliExpress corta con `AppApiCallLimit` si se llama en paralelo.
 *  · El administrador no tiene límite de plan (usa las mismas herramientas para mantener el catálogo).
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const responder = (cuerpo: unknown, estado = 200) => new Response(JSON.stringify(cuerpo), { status: estado, headers: { ...CORS, "Content-Type": "application/json" } });
const servicio = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

const FUNCION_DE_PROVEEDOR: Record<string, string> = { CJ_DROPSHIPPING: "cj-catalogo", ALIEXPRESS: "ali-catalogo" };
const FICHA_VIGENTE_MS = 14 * 24 * 3_600_000; // una ficha de menos de 14 días se considera al día
const COTIZACION_VIGENTE_MS = 7 * 24 * 3_600_000; // una cotización de menos de 7 días se considera al día
const MAX_PAISES = 12;
const TURNO_SEGUNDOS = 120;

const NOMBRE_ACCION: Record<string, string> = { FICHA: "completar fichas", COTIZACION_ENVIO: "cotizar envíos" };

function mensajeDeCuota(tipo: string, c: any): string {
  const que = NOMBRE_ACCION[tipo] ?? "esta acción";
  if (c?.motivo === "dia") return `Has llegado al límite de hoy para ${que} (${c.usadoDia} de ${c.limiteDia}). Mañana se renueva; si necesitas más, sube de plan.`;
  if (c?.motivo === "ventana") {
    return c.ventana === "TOTAL"
      ? `Has gastado todo lo que incluye tu prueba para ${que} (${c.usadoVentana} de ${c.limiteVentana}). Sube de plan para seguir.`
      : `Has llegado al límite de este mes para ${que} (${c.usadoVentana} de ${c.limiteVentana}). Se renueva el mes que viene; si necesitas más, sube de plan.`;
  }
  return "No se pudo comprobar tu límite. Inténtalo de nuevo en un momento.";
}

/** Países ya cotizados (y vigentes) en la ficha, sea cual sea el almacén de origen. */
function paisesCotizadosVigentes(ficha: any): Set<string> {
  const vistos = new Set<string>();
  const porOrigen = ficha?.envio?.porOrigen ?? {};
  for (const origen of Object.values(porOrigen) as any[]) {
    for (const [pais, q] of Object.entries(origen ?? {}) as [string, any][]) {
      const t = Date.parse(String(q?.actualizado ?? ""));
      if (Number.isFinite(t) && Date.now() - t < COTIZACION_VIGENTE_MS) vistos.add(pais.toUpperCase());
    }
  }
  // Un país que el proveedor ya dijo que no tiene servicio también cuenta como consultado (si no, se cobraría cupo por repetir lo mismo)
  for (const [pais, q] of Object.entries(ficha?.envio?.sinServicio ?? {}) as [string, any][]) {
    const t = Date.parse(String(q?.actualizado ?? ""));
    if (Number.isFinite(t) && Date.now() - t < COTIZACION_VIGENTE_MS) vistos.add(pais.toUpperCase());
  }
  return vistos;
}

/** Mensajes del proveedor que hablan de claves o cuentas: un usuario normal nunca los ve (solo el administrador). */
const MENSAJE_DE_CLAVES = /api.?key|clave|token|unauthori|expired|invalid|secret|appkey|signature|permission|forbidden/i;
const MENSAJE_GENERICO = "El proveedor no está disponible ahora mismo. Inténtalo más tarde.";

/** Lo que se devuelve a la pantalla: SOLO lo necesario. Nunca los diagnósticos internos del proveedor (longitud de claves, secretos vistos…). */
function respuestaPublica(r: any, esAdmin: boolean) {
  const limpio = (t: unknown) => (esAdmin || !MENSAJE_DE_CLAVES.test(String(t ?? "")) ? String(t ?? "") : MENSAJE_GENERICO);
  const salida: Record<string, unknown> = { ok: Boolean(r?.ok) };
  if (typeof r?.mensaje === "string") salida.mensaje = limpio(r.mensaje);
  if (typeof r?.error === "string") salida.error = limpio(r.error);
  if (Array.isArray(r?.avisos)) salida.avisos = r.avisos.slice(0, 5).map(limpio);
  if (Array.isArray(r?.informe)) {
    salida.informe = r.informe.slice(0, 5).map((i: any) => ({ id: i?.id, ok: i?.ok !== false, ...(i?.error ? { error: limpio(i.error) } : {}), ...(Array.isArray(i?.avisos) ? { avisos: i.avisos.slice(0, 3).map(limpio) } : {}) }));
  }
  if (r?.devuelto) salida.devuelto = true;
  return salida;
}

async function llamarProveedor(provider: string, cuerpo: Record<string, unknown>) {
  const funcion = FUNCION_DE_PROVEEDOR[provider];
  if (!funcion) return { ok: false, error: "Ese producto no es de un proveedor admitido" };
  const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/${funcion}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
    body: JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(140_000),
  });
  return await r.json().catch(() => ({ ok: false, error: "El proveedor no respondió con datos válidos" }));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return responder({ ok: false, error: "Usa POST" }, 405);

  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  // Vía interna del servidor (pruebas y futuras funciones propias): con la clave de servicio, que solo vive en el servidor, se actúa en nombre del usuario de `x-usuario`
  const interna = jwt !== "" && jwt === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const uid = interna ? (req.headers.get("x-usuario") ?? undefined) : (await servicio.auth.getUser(jwt)).data?.user?.id;
  if (!uid) return responder({ ok: false, codigo: "sesion", error: "Sesión no válida" }, 401);
  const cuerpo = await req.json().catch(() => ({}));
  const accion = String(cuerpo?.accion ?? "");

  const { data: yo } = await servicio.from("User").select("role,plan").eq("id", uid).maybeSingle();
  if (!yo) return responder({ ok: false, codigo: "sesion", error: "No se encontró tu cuenta" }, 401);
  const esAdmin = yo.role === "ADMIN";

  /* ───────── uso: plan, límites y lo gastado ───────── */
  if (accion === "uso") {
    const { data: limites } = await servicio.from("PlanLimite").select("tipo,ventana,limiteVentana,limiteDia").eq("plan", yo.plan);
    const ahora = new Date();
    const mes = `M:${ahora.toISOString().slice(0, 7)}`;
    const dia = `D:${ahora.toISOString().slice(0, 10)}`;
    const { data: usos } = await servicio.from("UsoCuota").select("tipo,clave,usado").eq("userId", uid).in("clave", ["T", mes, dia]);
    const detalle: Record<string, unknown> = {};
    for (const l of limites ?? []) {
      const claveVentana = l.ventana === "TOTAL" ? "T" : mes;
      const usadoVentana = (usos ?? []).find((u: any) => u.tipo === l.tipo && u.clave === claveVentana)?.usado ?? 0;
      const usadoDia = (usos ?? []).find((u: any) => u.tipo === l.tipo && u.clave === dia)?.usado ?? 0;
      detalle[l.tipo as string] = { ventana: l.ventana, limiteVentana: l.limiteVentana, usadoVentana, limiteDia: l.limiteDia, usadoDia, restanteVentana: Math.max(0, l.limiteVentana - usadoVentana), restanteDia: Math.max(0, l.limiteDia - usadoDia) };
    }
    return responder({ ok: true, plan: yo.plan, ilimitado: esAdmin, limites: detalle });
  }

  if (accion !== "completar_ficha" && accion !== "cotizar_envio") return responder({ ok: false, codigo: "accion_desconocida", error: `Acción desconocida: ${accion}` });

  const itemId = String(cuerpo?.itemId ?? "");
  if (!itemId) return responder({ ok: false, codigo: "datos_invalidos", error: "Indica el producto" });
  const { data: item } = await servicio.from("CatalogItem").select("id,provider").eq("id", itemId).maybeSingle();
  if (!item) return responder({ ok: false, codigo: "producto_no_encontrado", error: "Ese producto ya no está en el catálogo" });
  const { data: detalleFicha } = await servicio.from("CatalogItemDetail").select("ficha,fetchedAt").eq("itemId", itemId).maybeSingle();
  const tipo = accion === "completar_ficha" ? "FICHA" : "COTIZACION_ENVIO";

  // Qué hace falta de verdad (si ya está al día no se llama al proveedor ni se gasta cupo)
  let paisesPendientes: string[] = [];
  let cantidad = 1;
  if (accion === "completar_ficha") {
    const fresca = detalleFicha?.fetchedAt && Date.now() - Date.parse(String(detalleFicha.fetchedAt)) < FICHA_VIGENTE_MS && Array.isArray(detalleFicha?.ficha?.variantes) && detalleFicha.ficha.variantes.length > 0;
    if (fresca) return responder({ ok: true, yaAlDia: true, gastado: 0, mensaje: "La ficha ya estaba completa y al día. No se ha gastado nada de tu cupo" });
  } else {
    if (!detalleFicha || !Array.isArray(detalleFicha.ficha?.variantes) || !detalleFicha.ficha.variantes.length) {
      return responder({ ok: false, codigo: "ficha_incompleta", error: "Primero hay que completar la ficha de este producto." });
    }
    const pedidos: string[] = (Array.isArray(cuerpo?.paises) ? cuerpo.paises : []).map((p: unknown) => String(p).toUpperCase().slice(0, 2)).filter((p: string) => /^[A-Z]{2}$/.test(p));
    const unicos = [...new Set(pedidos)];
    if (!unicos.length) return responder({ ok: false, codigo: "datos_invalidos", error: "Indica al menos un país" });
    if (unicos.length > MAX_PAISES) return responder({ ok: false, codigo: "datos_invalidos", error: `Como máximo ${MAX_PAISES} países cada vez` });
    const hechos = paisesCotizadosVigentes(detalleFicha.ficha);
    paisesPendientes = unicos.filter((p) => !hechos.has(p));
    if (!paisesPendientes.length) return responder({ ok: true, yaAlDia: true, gastado: 0, mensaje: "Esos países ya estaban cotizados y al día. No se ha gastado nada de tu cupo" });
    cantidad = paisesPendientes.length;
  }

  // Un turno por proveedor: nunca dos consultas a la vez contra el mismo
  const turno = await servicio.rpc("tomar_turno_proveedor", { p_proveedor: item.provider, p_segundos: TURNO_SEGUNDOS });
  if (turno.error || turno.data !== true) return responder({ ok: false, codigo: "ocupado", error: "Hay otra consulta al proveedor en curso. Espera unos segundos y vuelve a intentarlo (no se ha gastado nada de tu cupo)." });

  let cupoGastado = false;
  try {
    if (!esAdmin) {
      const c = await servicio.rpc("consumir_cuota", { p_user: uid, p_tipo: tipo, p_cantidad: cantidad });
      if (c.error) return responder({ ok: false, codigo: "cuota", error: "No se pudo comprobar tu límite. Inténtalo de nuevo en un momento." });
      if (!(c.data as any)?.permitido) return responder({ ok: false, codigo: "cuota", error: mensajeDeCuota(tipo, c.data), cuota: c.data });
      cupoGastado = true;
    }
    const respuesta: any = accion === "completar_ficha"
      ? await llamarProveedor(item.provider, { accion: "detalle", ids: [itemId] })
      : await llamarProveedor(item.provider, { accion: "envio", ids: [itemId], paises: paisesPendientes });

    const fallos = (Array.isArray(respuesta?.informe) ? respuesta.informe : []).filter((i: any) => i && i.ok === false);
    const fallo = !respuesta?.ok || (accion === "completar_ficha" && fallos.length > 0);
    if (fallo && cupoGastado) {
      await servicio.rpc("devolver_cuota", { p_user: uid, p_tipo: tipo, p_cantidad: cantidad });
      cupoGastado = false;
      respuesta.devuelto = true;
    }
    return responder({ ...respuestaPublica(respuesta, esAdmin), gastado: cupoGastado ? cantidad : 0 });
  } catch (e) {
    if (cupoGastado) await servicio.rpc("devolver_cuota", { p_user: uid, p_tipo: tipo, p_cantidad: cantidad });
    console.error("acciones-usuario", accion, (e as Error)?.message);
    return responder({ ok: false, codigo: "error_interno", error: "El proveedor no respondió a tiempo. No se ha gastado nada de tu cupo; inténtalo de nuevo más tarde." });
  } finally {
    await servicio.rpc("soltar_turno_proveedor", { p_proveedor: item.provider });
  }
});
