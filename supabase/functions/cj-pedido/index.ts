/**
 * cj-pedido — Crea en CJ Dropshipping el pedido de una compra (función propia de CJ; AliExpress tendrá la suya).
 *
 * SOLO vía interna (clave de servicio, que únicamente vive en el servidor): la llama `compras-proveedor` después de decidir que se puede comprar.
 * Crea el pedido SIN PAGARLO (`payType` 3): no se mueve dinero; el pago lo hace el usuario en CJ. Una sola llamada a CJ por pedido.
 * Usa el mismo token de CJ que `cj-catalogo` (tabla privada PlatformCredential) y respeta 1 petición por segundo.
 * Los nombres de campo de `createOrderV2` salen de la documentación pública de CJ y NO están comprobados con un pedido real:
 * si CJ rechaza alguno, el mensaje de CJ se devuelve tal cual y no se crea nada.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const BASE = "https://developers.cjdropshipping.com/api2.0/v1";
const PROVEEDOR = "CJ_DROPSHIPPING";
const PAUSA_MS = 1_300;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const responder = (cuerpo: unknown, estado = 200) => new Response(JSON.stringify(cuerpo), { status: estado, headers: { ...CORS, "Content-Type": "application/json" } });
const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ahoraIso = () => new Date().toISOString();
const texto = (v: unknown) => (typeof v === "string" ? v.trim() : "");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return responder({ ok: false, error: "Usa POST" }, 405);
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (jwt === "" || jwt !== Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) return responder({ ok: false, error: "Esta función solo se pide desde compras-proveedor" }, 403);
  const cuerpo = await req.json().catch(() => ({}));

  // ── Validación de lo que llega (nada de datos dudosos) ──
  const e = cuerpo?.entrega ?? {};
  const items: { vid: string; cantidad: number }[] = Array.isArray(cuerpo?.items) ? cuerpo.items : [];
  const faltan = ["nombre", "direccion1", "ciudad", "pais"].filter((k) => !texto(e[k]));
  if (!texto(cuerpo?.numero) || !texto(cuerpo?.origen) || !texto(cuerpo?.logistica) || !items.length || faltan.length) {
    return responder({ ok: false, error: `Faltan datos para crear el pedido en CJ${faltan.length ? ` (${faltan.join(", ")})` : ""}` });
  }
  if (items.some((i) => !texto(i?.vid) || !Number.isInteger(i?.cantidad) || i.cantidad < 1)) return responder({ ok: false, error: "Alguna línea del pedido no es válida" });

  const apiKey = (Deno.env.get("CJ_API_KEY") ?? "").trim().replace(/^["']|["']$/g, "");
  if (!apiKey) return responder({ ok: false, error: "Falta el secreto CJ_API_KEY en las funciones de Supabase" });
  const servicio = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: fila } = await servicio.from("PlatformCredential").select("settings,usedThisMonth,monthlyQuota").eq("provider", PROVEEDOR).maybeSingle();
  if (!fila) return responder({ ok: false, error: "CJ todavía no está configurado en DropshipPilot" });
  if (fila.monthlyQuota && fila.usedThisMonth >= fila.monthlyQuota) return responder({ ok: false, error: `Cuota mensual de CJ agotada (${fila.usedThisMonth}/${fila.monthlyQuota})` });
  let ajustes: any = fila.settings ?? {};
  let llamadas = 0;
  let ultima = Number(ajustes.ultimaLlamada) || 0;

  async function http(url: string, init: RequestInit) {
    const espera = ultima + PAUSA_MS - Date.now();
    if (espera > 0) await pausa(espera);
    const control = new AbortController();
    const t = setTimeout(() => control.abort(), 25_000);
    try {
      const res = await fetch(url, { ...init, signal: control.signal });
      const json: any = await res.json().catch(() => ({}));
      return { res, json };
    } finally {
      ultima = Date.now();
      llamadas += 1;
      clearTimeout(t);
    }
  }
  const guardar = async (extra: Record<string, unknown>, ok = true) => {
    ajustes = { ...ajustes, ...extra, ultimaLlamada: ultima };
    await servicio.from("PlatformCredential").update({ settings: ajustes, ...(ok ? {} : {}), usedThisMonth: (fila.usedThisMonth ?? 0) + llamadas, updatedAt: ahoraIso() }).eq("provider", PROVEEDOR);
  };

  // ── Token (se reutiliza el de cj-catalogo; si caduca, se pide uno nuevo y se guarda igual que allí) ──
  let token: string;
  if (ajustes.accessToken && ajustes.accessTokenExpira && new Date(ajustes.accessTokenExpira).getTime() > Date.now() + 86_400_000) {
    token = String(ajustes.accessToken);
  } else {
    const { res, json } = await http(`${BASE}/authentication/getAccessToken`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiKey }) });
    if (!json?.result || !json?.data?.accessToken) {
      await guardar({});
      return responder({ ok: false, error: `CJ rechazó la clave: ${String(json?.message ?? `HTTP ${res.status}`)}` });
    }
    token = String(json.data.accessToken);
    ajustes = { ...ajustes, accessToken: token, accessTokenExpira: json.data.accessTokenExpiryDate ?? null, refreshToken: json.data.refreshToken ?? null };
  }

  // ── Crear el pedido SIN pagar ──
  const cuerpoCj = {
    orderNumber: texto(cuerpo.numero),
    shippingCountryCode: texto(e.pais).toUpperCase(),
    shippingProvince: texto(e.provincia),
    shippingCity: texto(e.ciudad),
    shippingAddress: texto(e.direccion1),
    shippingAddress2: texto(e.direccion2),
    shippingCustomerName: texto(e.nombre),
    shippingPhone: texto(e.telefono),
    shippingZip: texto(e.codigoPostal),
    remark: texto(cuerpo?.nota).slice(0, 200),
    fromCountryCode: texto(cuerpo.origen).toUpperCase(),
    logisticName: texto(cuerpo.logistica),
    payType: 3,
    products: items.map((i) => ({ vid: texto(i.vid), quantity: i.cantidad })),
  };
  const { res, json } = await http(`${BASE}/shopping/order/createOrderV2`, { method: "POST", headers: { "CJ-Access-Token": token, "Content-Type": "application/json" }, body: JSON.stringify(cuerpoCj) });
  await guardar({});
  if (json?.result === false || !res.ok) return responder({ ok: false, error: `CJ no creó el pedido: ${String(json?.message ?? `HTTP ${res.status}`)}`, codigoCj: json?.code ?? null, llamadasACj: llamadas });
  const d = json?.data ?? {};
  const idCj = d.orderId ?? d.cjOrderId ?? d.id ?? null;
  if (!idCj) return responder({ ok: false, error: "CJ respondió sin identificador de pedido: se deja sin confirmar para revisarlo a mano", respuestaCj: d, llamadasACj: llamadas });
  return responder({ ok: true, mensaje: "Pedido creado en CJ sin pagar", pedidoCjId: String(idCj), estadoCj: d.orderStatus ?? null, llamadasACj: llamadas });
});
