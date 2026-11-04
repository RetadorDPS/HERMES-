/**
 * retador-desvincular — Desvincula la cuenta del usuario de Retador (contrato 1.6, «Desvincular»).
 *
 *   POST { storeId }  (con la sesión del usuario; o vía interna con clave de servicio + `x-usuario`)
 *
 * 1) ANULA la clave en Retador (`dropship_desvincular_token`, por la API pública de Retador y desde el servidor: la clave nunca pasa por el navegador).
 *    Si Retador dice que ya estaba anulada, se da por desvinculado igual. Si Retador no responde, NO se borra nada y se pide reintentar
 *    (así la clave no queda viva en Retador sin que lo sepamos).
 * 2) Borra la clave guardada aquí y deja la tienda en «sin vincular». Los productos ya publicados siguen en Retador.
 * 3) Si el plan venía de Retador (plan conjunto), vuelve al plan de prueba.
 * El Retador simulado no tiene nada que anular en Retador: solo se borra la clave de pruebas.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { descifrar, esSimulado } from "./cifrado.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const responder = (cuerpo: unknown, estado = 200) => new Response(JSON.stringify(cuerpo), { status: estado, headers: { ...CORS, "Content-Type": "application/json" } });
const servicio = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

// Clave PUBLICABLE de Retador (no es secreta: está pensada para ir en llamadas públicas)
const URL_ANULAR = "https://qsxtjuhueqdxoduyroli.supabase.co/rest/v1/rpc/dropship_desvincular_token";
const CLAVE_PUBLICABLE_RETADOR = "sb_publishable_VbX-xBAVLKl_SnrkOTxc2w_oTe5-1Va";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return responder({ ok: false, codigo: "metodo", error: "Usa POST" }, 405);

  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const interna = jwt !== "" && jwt === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const uid = interna ? (req.headers.get("x-usuario") ?? undefined) : (await servicio.auth.getUser(jwt)).data?.user?.id;
  if (!uid) return responder({ ok: false, codigo: "sesion", error: "Sesión no válida" }, 401);
  const cuerpo: any = await req.json().catch(() => ({}));
  const storeId = typeof cuerpo?.storeId === "string" ? cuerpo.storeId : "";
  if (!storeId) return responder({ ok: false, codigo: "datos_invalidos", error: "Indica la tienda" });

  const { data: tienda } = await servicio.from("Store").select("*").eq("id", storeId).eq("userId", uid).maybeSingle();
  if (!tienda || tienda.platform !== "RETADOR") return responder({ ok: false, codigo: "tienda_no_encontrada", error: "No se encontró tu tienda de Retador" });

  // 1) Anular la clave en Retador (solo la real)
  let anuladaEnRetador: boolean | null = null;
  if (tienda.accessTokenEnc) {
    let token: string | null = null;
    try {
      token = await descifrar(tienda.accessTokenEnc);
    } catch {
      token = null; // la clave guardada ya no se puede leer: no hay nada que anular, se limpia igual
    }
    if (token && !esSimulado(token)) {
      try {
        const r = await fetch(URL_ANULAR, {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: CLAVE_PUBLICABLE_RETADOR },
          body: JSON.stringify({ p_token: token }),
          signal: AbortSignal.timeout(20_000),
        });
        const j: any = await r.json().catch(() => null);
        if (j?.ok === true) anuladaEnRetador = j.anulada === true;
        else if (j?.codigo === "token_invalido") anuladaEnRetador = false; // ya no valdría de todos modos
        else return responder({ ok: false, codigo: "retador_no_responde", error: "No se pudo desvincular en Retador ahora mismo. No se ha cambiado nada: inténtalo de nuevo en un momento." });
      } catch {
        return responder({ ok: false, codigo: "retador_no_responde", error: "No se pudo contactar con Retador para desvincular. No se ha cambiado nada: inténtalo de nuevo en un momento." });
      }
    }
  }

  // 2) Olvidar la clave aquí
  await servicio.from("Store").update({ accessTokenEnc: null, status: "DISCONNECTED", lastError: null, updatedAt: new Date().toISOString() }).eq("id", tienda.id);

  // 3) Si el plan venía de Retador, vuelve al de prueba
  await servicio.from("User").update({ plan: "TRIAL", planOrigen: "PROPIO" }).eq("id", uid).eq("planOrigen", "RETADOR");

  const { count } = await servicio.from("Product").select("id", { count: "exact", head: true }).eq("storeId", tienda.id).not("storeProductId", "is", null);
  return responder({
    ok: true,
    anuladaEnRetador,
    productosEnRetador: count ?? 0,
    aviso: count ? "Tus productos siguen publicados en Retador, pero ya no se mantendrán actualizados desde aquí hasta que vuelvas a vincular tu cuenta." : null,
  });
});
