/**
 * retador-avisos — Receptor de los avisos que Retador manda a DropshipPilot (contrato 1.6, «Avisos de RETADOR hacia DropshipPilot»).
 *
 * Sin sesión de usuario: la credencial es la FIRMA. Cada aviso llega con la cabecera `x-retador-firma: t=<epoch>,v1=<hex>`,
 * donde v1 = HMAC-SHA256(secreto, "<t>.<cuerpo tal cual llegó>"). Se comprueba con el cuerpo crudo y se rechaza si `t` se
 * aleja más de 5 minutos. El secreto vive en el almacén de secretos de la base (`retador_avisos_secreto`), nunca en el código.
 *
 * Responde 2xx rápido y hace el trabajo después. Un aviso repetido (mismo `id`) no se procesa dos veces.
 * Los avisos son «de máquina»: aquí solo se actualiza lo que hace falta (pedidos, estado de productos, tarifas). A la persona
 * la avisa Retador; esta app solo le avisa cuando tiene que hacer algo aquí.
 *
 *   pedido_nuevo / pedido_actualizado  → `pedidos-barrido` (vía interna) para esa tienda: sincroniza los pedidos y, si el usuario activó la
 *                                        compra automática, la lanza. El barrido de seguridad sigue existiendo, mucho más espaciado.
 *   producto_cambiado                  → `retador-tienda` acción `estado` (relee lo publicado y lo deja al día).
 *   tarifas_cambiadas                  → `retador-tienda` acción `config` (tarifas, planes y plan conjunto).
 *   prueba                             → solo se anota.
 *
 * Registro (una sola vez, solo con la clave de servicio): POST { "accion": "registrar" } → llama a `dropship-avisos-registrar` de Retador.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const URL_RETADOR = "https://qsxtjuhueqdxoduyroli.supabase.co/functions/v1";
const TOLERANCIA_S = 300;

const responder = (cuerpo: unknown, estado = 200) => new Response(JSON.stringify(cuerpo), { status: estado, headers: { "Content-Type": "application/json" } });
const servicio = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const clave = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function secreto(nombre: "retador_avisos_secreto" | "retador_cliente_secreto"): Promise<string | null> {
  const r = await servicio.rpc("leer_secreto_retador", { p_nombre: nombre });
  return !r.error && typeof r.data === "string" && r.data.length >= 32 ? r.data : null;
}

const aHex = (b: ArrayBuffer) => Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join("");

async function firmaValida(cabecera: string | null, cuerpoCrudo: string, clave: string): Promise<boolean> {
  if (!cabecera) return false;
  const partes = Object.fromEntries(cabecera.split(",").map((p) => { const i = p.indexOf("="); return [p.slice(0, i).trim(), p.slice(i + 1).trim()]; }));
  const t = Number(partes.t);
  const v1 = String(partes.v1 ?? "");
  if (!Number.isFinite(t) || !/^[0-9a-f]{64}$/i.test(v1)) return false;
  if (Math.abs(Date.now() / 1000 - t) > TOLERANCIA_S) return false;
  const llave = await crypto.subtle.importKey("raw", new TextEncoder().encode(clave), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const esperada = aHex(await crypto.subtle.sign("HMAC", llave, new TextEncoder().encode(`${t}.${cuerpoCrudo}`)));
  // Comparación en tiempo constante
  if (esperada.length !== v1.length) return false;
  let diferencia = 0;
  for (let i = 0; i < esperada.length; i++) diferencia |= esperada.charCodeAt(i) ^ v1.toLowerCase().charCodeAt(i);
  return diferencia === 0;
}

async function llamarInterna(funcion: string, usuario: string | null, cuerpo: Record<string, unknown>) {
  const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/${funcion}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${clave}`, ...(usuario ? { "x-usuario": usuario } : {}) },
    body: JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(120_000),
  });
  return await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
}

/** Hace el trabajo de un aviso ya aceptado. Si falla, queda anotado y el barrido de seguridad lo cubre (aquí ya se respondió 2xx). */
async function procesar(aviso: any) {
  // «Tarifas cambiadas» es un aviso general (sin vendedor): se relee la configuración de TODAS las tiendas vinculadas, de una en una
  if (aviso.tipo === "tarifas_cambiadas" && !aviso.vendedor_id) {
    const { data: tiendas } = await servicio.from("Store").select("id,userId,settings").eq("platform", "RETADOR").eq("status", "CONNECTED").limit(50);
    let hechas = 0;
    for (const t of tiendas ?? []) {
      if ((t.settings as any)?.simulada) continue;
      await llamarInterna("retador-tienda", t.userId, { accion: "config", storeId: t.id });
      hechas += 1;
    }
    return { tiendas: hechas };
  }
  const { data: tienda } = await servicio.from("Store").select("id,userId,settings").eq("platform", "RETADOR").eq("settings->>vendedorId", String(aviso.vendedor_id ?? "")).eq("status", "CONNECTED").maybeSingle();
  if (!tienda) return { omitido: "sin_tienda_vinculada" };
  switch (aviso.tipo) {
    case "pedido_nuevo":
    case "pedido_actualizado":
      return await llamarInterna("pedidos-barrido", null, { storeId: tienda.id });
    case "producto_cambiado":
      return await llamarInterna("retador-tienda", tienda.userId, { accion: "estado", storeId: tienda.id });
    case "tarifas_cambiadas":
      return await llamarInterna("retador-tienda", tienda.userId, { accion: "config", storeId: tienda.id });
    default:
      return { omitido: "tipo_sin_accion" };
  }
}

async function procesarYAnotar(id: string, aviso: any) {
  let error: string | null = null;
  try {
    const r: any = await procesar(aviso);
    if (r && r.ok === false) error = String(r.error ?? "sin detalle").slice(0, 300);
  } catch (e) {
    error = String((e as Error)?.message ?? e).slice(0, 300);
  }
  await servicio.from("AvisoRetador").update({ procesadoEn: new Date().toISOString(), error }).eq("id", id);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return responder({ ok: false, error: "Usa POST" }, 405);
  const crudo = await req.text();

  // Vía interna (clave de servicio): registrar esta dirección en Retador, una sola vez
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (bearer !== "" && bearer === clave) {
    let cuerpo: any = {};
    try { cuerpo = JSON.parse(crudo); } catch { /* sin cuerpo */ }
    if (cuerpo?.accion !== "registrar") return responder({ ok: false, error: "Acción desconocida" }, 400);
    const [cliente, avisos] = await Promise.all([secreto("retador_cliente_secreto"), secreto("retador_avisos_secreto")]);
    if (!cliente || !avisos) return responder({ ok: false, error: "Faltan los secretos de la aplicación" }, 500);
    const res = await fetch(`${URL_RETADOR}/dropship-avisos-registrar`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-dropship-cliente": cliente },
      body: JSON.stringify({ url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/retador-avisos`, secreto: avisos }),
      signal: AbortSignal.timeout(30_000),
    });
    const json: any = await res.json().catch(() => null);
    return responder({ ok: json?.ok === true, codigo: json?.codigo ?? null, error: json?.ok === true ? null : String(json?.error ?? `HTTP ${res.status}`).slice(0, 200) });
  }

  // Aviso de Retador: se acepta solo con firma válida
  const claveAvisos = await secreto("retador_avisos_secreto");
  if (!claveAvisos || !(await firmaValida(req.headers.get("x-retador-firma"), crudo, claveAvisos))) return responder({ ok: false, error: "Firma no válida" }, 401);
  let aviso: any;
  try { aviso = JSON.parse(crudo); } catch { return responder({ ok: false, error: "El cuerpo no es JSON" }, 400); }
  const id = String(aviso?.id ?? req.headers.get("x-retador-aviso-id") ?? "");
  if (!id || id.length > 200 || typeof aviso?.tipo !== "string") return responder({ ok: false, error: "Aviso incompleto" }, 400);

  // Sin duplicados: un mismo `id` ya procesado se contesta con éxito sin repetir el trabajo
  const { data: previo } = await servicio.from("AvisoRetador").select("id,procesadoEn").eq("id", id).maybeSingle();
  if (previo?.procesadoEn) return responder({ ok: true, duplicado: true });
  if (!previo) {
    const { error } = await servicio.from("AvisoRetador").insert({ id, tipo: aviso.tipo.slice(0, 60), vendedorId: aviso.vendedor_id ? String(aviso.vendedor_id).slice(0, 100) : null });
    if (error && !/duplicate|unique/i.test(error.message)) return responder({ ok: false, error: "No se pudo anotar el aviso" }, 500);
  }
  if (aviso.tipo === "prueba") {
    await servicio.from("AvisoRetador").update({ procesadoEn: new Date().toISOString() }).eq("id", id);
    return responder({ ok: true });
  }
  const trabajo = procesarYAnotar(id, aviso);
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(trabajo);
  else await trabajo;
  return responder({ ok: true });
});
