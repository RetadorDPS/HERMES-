/**
 * ali-callback — Dirección de retorno de la autorización de AliExpress (OAuth).
 *
 * AliExpress devuelve al administrador a la página de retorno de Retador (única Callback URL de la app compartida), que
 * lo reparte aquí con `?code=...&state=dropshippilot.…`. Esta función:
 *   1. comprueba que `state` lo firmó `ali-catalogo` hace menos de 15 minutos (así nadie de fuera puede guardar un token),
 *   2. cambia el `code` por el `access_token` y el `refresh_token`,
 *   3. los guarda SOLO en la tabla privada PlatformCredential (nunca se devuelven ni se muestran),
 *   4. devuelve al administrador a la pantalla de Administración.
 *
 * Es independiente de CJ. No exige sesión (AliExpress no la envía), pero solo actúa con un `state` válido y firmado.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const PROVEEDOR = "ALIEXPRESS";
const VOLVER = "https://retadordps.github.io/HERMES-/admin/";

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
async function hmac(texto: string, secreto: string) {
  const clave = await crypto.subtle.importKey("raw", new TextEncoder().encode(secreto), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", clave, new TextEncoder().encode(texto)));
}
const volver = (estado: "ok" | "error", mensaje: string) =>
  new Response(null, { status: 302, headers: { Location: `${VOLVER}?ali=${estado}&mensaje=${encodeURIComponent(mensaje.slice(0, 200))}` } });

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const appKey = (Deno.env.get("ALIEXPRESS_APP_KEY") ?? Deno.env.get("ALI_APP_KEY") ?? "").trim();
  const appSecret = (Deno.env.get("ALIEXPRESS_APP_SECRET") ?? Deno.env.get("ALI_APP_SECRET") ?? "").trim();
  if (!appKey || !appSecret) return volver("error", "Faltan los secretos de AliExpress en Supabase");
  if (!code || !state) return volver("error", "AliExpress no devolvió el código de autorización");

  // 1. Comprobar el state firmado
  let carga = "";
  try {
    // El `state` lleva el prefijo «dropshippilot.» que usa la página de retorno de Retador para repartir la autorización
    const sinPrefijo = state.startsWith("dropshippilot.") ? state.slice("dropshippilot.".length) : state;
    const crudo = atob(sinPrefijo.replace(/-/g, "+").replace(/_/g, "/"));
    const corte = crudo.lastIndexOf(".");
    carga = crudo.slice(0, corte);
    const firma = crudo.slice(corte + 1);
    const [uid, expira] = carga.split(".");
    if (!uid || Number(expira) < Date.now()) return volver("error", "El enlace de autorización caducó: vuelve a pulsar «Autorizar»");
    if ((await hmac(carga, appSecret)) !== firma) return volver("error", "Autorización no válida");
  } catch {
    return volver("error", "Autorización no válida");
  }

  // 2. Cambiar el código por el token (la firma de estas rutas lleva delante la ruta de la API)
  const ruta = "/auth/token/create";
  const params: Record<string, string> = { app_key: appKey, timestamp: String(Date.now()), sign_method: "sha256", code };
  params.sign = (await hmac(ruta + Object.keys(params).sort().map((k) => `${k}${params[k]}`).join(""), appSecret)).toUpperCase();
  let json: any = {};
  try {
    const res = await fetch(`https://api-sg.aliexpress.com/rest${ruta}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" }, body: new URLSearchParams(params).toString() });
    json = await res.json().catch(() => ({}));
  } catch (e) {
    return volver("error", `No se pudo conectar con AliExpress (${(e as Error).message})`);
  }
  if (!json?.access_token) return volver("error", `AliExpress no entregó el token: ${String(json?.message ?? json?.msg ?? json?.error_response?.msg ?? "sin detalle")}`);

  // 3. Guardar solo en la tabla privada
  const servicio = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: fila } = await servicio.from("PlatformCredential").select("settings").eq("provider", PROVEEDOR).maybeSingle();
  const expiraEn = Number(json.expire_time) > 1e12 ? Number(json.expire_time) : Date.now() + (Number(json.expires_in) || 0) * 1000;
  const ajustes = {
    ...((fila?.settings as any) ?? {}),
    aliToken: { accessToken: json.access_token, refreshToken: json.refresh_token ?? null, expiraEn, cuenta: json.user_nick ?? json.account ?? null, guardadoEn: new Date().toISOString() },
  };
  const { error } = fila
    ? await servicio.from("PlatformCredential").update({ settings: ajustes, status: "CONNECTED", lastError: null, updatedAt: new Date().toISOString() }).eq("provider", PROVEEDOR)
    : await servicio.from("PlatformCredential").insert({ provider: PROVEEDOR, label: "AliExpress (secretos de Supabase)", credentialsEnc: "ENTORNO", settings: ajustes, status: "CONNECTED" });
  if (error) return volver("error", `No se pudo guardar la autorización: ${error.message}`);
  return volver("ok", `Cuenta de AliExpress autorizada${json.user_nick ? `: ${json.user_nick}` : ""}`);
});
