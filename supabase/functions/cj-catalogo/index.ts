/**
 * cj-catalogo — Descarga de catálogo desde CJ Dropshipping (API v2) hacia la tabla CatalogItem.
 *
 * Sigue la misma lógica del cliente original (src/lib/supplier-apis/cj.ts + syncCatalog de src/lib/catalog/index.ts):
 *   1. token con la clave de CJ (se reutiliza mientras no caduque; guardado en PlatformCredential.settings,
 *      tabla sin permisos para los clientes),
 *   2. product/listV2 (el listado oficial que alimenta el catálogo),
 *   3. normalización y guardado (upsert) en CatalogItem con source = 'api'.
 *
 * Solo para administradores. CJ admite 1 petición por segundo y esta función hace pocas llamadas, en serie.
 * Las claves viven como secretos de la función (CJ_API_KEY): nunca se devuelven ni se escriben en tablas.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const BASE = "https://developers.cjdropshipping.com/api2.0/v1";
const PROVEEDOR = "CJ_DROPSHIPPING";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const responder = (cuerpo: unknown, estado = 200) =>
  new Response(JSON.stringify(cuerpo), { status: estado, headers: { ...CORS, "Content-Type": "application/json" } });

const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Nombres (nunca valores) de los secretos que parecen de CJ, para ayudar a diagnosticar. */
function secretosVistos() {
  const nombres = Object.keys(Deno.env.toObject()).filter((n) => /^(CJ|ALI)/i.test(n)).sort();
  return nombres;
}

async function llamar(url: string, init: RequestInit & { ms?: number } = {}) {
  const control = new AbortController();
  const t = setTimeout(() => control.abort(), init.ms ?? 25_000);
  try {
    const res = await fetch(url, { ...init, signal: control.signal });
    const json = await res.json().catch(() => ({}));
    return { res, json: json as any };
  } finally {
    clearTimeout(t);
  }
}

/** Primer número de un precio de CJ (puede llegar como «1.2» o como rango «1.2 -- 3.4»). */
function primerNumero(v: unknown): number {
  const m = String(v ?? "").match(/\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : 0;
}

function extraerLista(data: any): any[] {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.list)) return data.list;
  if (Array.isArray(data?.content)) {
    return data.content.flatMap((c: any) => (Array.isArray(c?.productList) ? c.productList : c?.pid || c?.id ? [c] : []));
  }
  return [];
}

function normalizar(item: any, pais: string) {
  const id = String(item.id ?? item.pid ?? item.productId ?? "");
  const imagenes: string[] = String(item.bigImage ?? item.productImage ?? "")
    .split(/[;,|]/)
    .map((u) => u.trim())
    .filter(Boolean);
  const ciclo = String(item.deliveryCycle ?? "").match(/(\d+)\s*[-–]\s*(\d+)/);
  const pedidos = item.listedNum ?? item.ordersCount;
  const valoracion = item.productRating ?? item.rating;
  const envio = item.freightPrice;
  return {
    provider: PROVEEDOR,
    externalId: id,
    title: String(item.nameEn ?? item.productNameEn ?? item.productName ?? "Producto CJ").slice(0, 250),
    description: String(item.description ?? item.remark ?? "").slice(0, 5000),
    categoryId: item.categoryId ? String(item.categoryId) : null,
    categoryName: item.threeCategoryName ?? item.twoCategoryName ?? item.oneCategoryName ?? item.categoryName ?? null,
    imageUrl: imagenes[0] ?? null,
    images: imagenes.slice(0, 8),
    currency: "USD",
    costPrice: primerNumero(item.sellPrice ?? item.nowPrice ?? item.variantSellPrice ?? item.price),
    stock: Number(item.warehouseInventoryNum ?? item.totalVerifiedInventory ?? item.variantStock ?? item.stock ?? 0) || 0,
    rating: valoracion ? Number(valoracion) : null,
    ordersCount: pedidos !== undefined && pedidos !== null ? Number(pedidos) : null,
    shippingCost: envio ? Number(envio) : null,
    shippingMinDays: ciclo ? Number(ciclo[1]) : null,
    shippingMaxDays: ciclo ? Number(ciclo[2]) : null,
    shipFrom: pais,
    freeShipping: Number(item.addMarkStatus) === 1,
    isTrending: Number(pedidos ?? 0) > 5000,
    rawPayload: item,
    sourceUrl: `https://cjdropshipping.com/product/-p-${id}.html`,
    source: "api",
    lastSyncedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return responder({ ok: false, error: "Usa POST" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const servicio = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  // ── Solo administradores ──
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth } = await servicio.auth.getUser(jwt);
  const uid = auth?.user?.id;
  if (!uid) return responder({ ok: false, error: "Sesión no válida" }, 401);
  const { data: yo } = await servicio.from("User").select("role").eq("id", uid).maybeSingle();
  if (yo?.role !== "ADMIN") return responder({ ok: false, error: "Solo el administrador puede descargar el catálogo" }, 403);

  const cuerpo = await req.json().catch(() => ({}));
  const accion: string = cuerpo?.accion ?? "probar";
  const tamano = Math.max(1, Math.min(Number(cuerpo?.tamano ?? 5), 20));
  const pais = String(cuerpo?.pais ?? "ES").toUpperCase().slice(0, 2);
  const palabra: string | undefined = cuerpo?.palabra ? String(cuerpo.palabra).slice(0, 80) : undefined;

  const apiKey = Deno.env.get("CJ_API_KEY");
  const diagnostico = { secretoCjApiKey: Boolean(apiKey), secretosVistos: secretosVistos() };
  if (!apiKey) {
    return responder({ ok: false, error: "Falta el secreto CJ_API_KEY en las funciones de Supabase", ...diagnostico });
  }

  // ── Fila del proveedor (guarda estado, cuota y token) ──
  const { data: fila0 } = await servicio.from("PlatformCredential").select("*").eq("provider", PROVEEDOR).maybeSingle();
  let fila: any = fila0;
  if (!fila) {
    const { data: nueva, error } = await servicio
      .from("PlatformCredential")
      .insert({ provider: PROVEEDOR, label: "CJ Dropshipping (secretos de Supabase)", credentialsEnc: "ENTORNO", settings: {} })
      .select("*")
      .single();
    if (error) return responder({ ok: false, error: `No se pudo crear la fila del proveedor: ${error.message}` });
    fila = nueva;
  }
  const ajustes: any = fila.settings ?? {};

  const marcarError = async (mensaje: string) => {
    await servicio.from("PlatformCredential").update({ status: "ERROR", lastError: mensaje.slice(0, 500), lastTestAt: new Date().toISOString(), updatedAt: new Date().toISOString() }).eq("provider", PROVEEDOR);
  };

  // ── Token (se reutiliza; CJ lo conserva 180 días y limita a 1 petición por segundo) ──
  let token: string | null = null;
  let tokenReutilizado = false;
  if (ajustes.accessToken && ajustes.accessTokenExpira && new Date(ajustes.accessTokenExpira).getTime() > Date.now() + 86_400_000) {
    token = String(ajustes.accessToken);
    tokenReutilizado = true;
  } else {
    const { res, json } = await llamar(`${BASE}/authentication/getAccessToken`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey }),
    });
    if (!json?.result || !json?.data?.accessToken) {
      const mensaje = `CJ rechazó la clave: ${String(json?.message ?? `HTTP ${res.status}`)}`;
      await marcarError(mensaje);
      return responder({ ok: false, error: mensaje, codigoCj: json?.code ?? null, ...diagnostico });
    }
    token = String(json.data.accessToken);
    await servicio
      .from("PlatformCredential")
      .update({
        settings: { ...ajustes, accessToken: token, accessTokenExpira: json.data.accessTokenExpiryDate ?? null, refreshToken: json.data.refreshToken ?? null },
        updatedAt: new Date().toISOString(),
      })
      .eq("provider", PROVEEDOR);
    await pausa(1_200); // 1 petición por segundo
  }

  if (accion === "probar") {
    await servicio.from("PlatformCredential").update({ status: "CONNECTED", lastError: null, lastTestAt: new Date().toISOString() }).eq("provider", PROVEEDOR);
    return responder({ ok: true, mensaje: "Clave de CJ válida: se obtuvo el token", tokenReutilizado, ...diagnostico });
  }

  // ── Cuota mensual (opcional) ──
  if (fila.monthlyQuota && fila.usedThisMonth >= fila.monthlyQuota) {
    return responder({ ok: false, error: `Cuota mensual agotada (${fila.usedThisMonth}/${fila.monthlyQuota})`, ...diagnostico });
  }

  // ── Listado oficial (una sola página) ──
  const consulta = new URL(`${BASE}/product/listV2`);
  consulta.searchParams.set("page", "1");
  consulta.searchParams.set("size", String(tamano));
  consulta.searchParams.set("countryCode", pais);
  consulta.searchParams.set("orderBy", palabra ? "0" : "2");
  consulta.searchParams.set("sort", "desc");
  if (palabra) consulta.searchParams.set("keyWord", palabra);

  const { res, json } = await llamar(consulta.toString(), { headers: { "CJ-Access-Token": token!, "Content-Type": "application/json" } });
  if (json?.result === false || !res.ok) {
    const mensaje = `CJ respondió con error: ${String(json?.message ?? `HTTP ${res.status}`)}`;
    await marcarError(mensaje);
    return responder({ ok: false, error: mensaje, codigoCj: json?.code ?? null, ...diagnostico });
  }

  const lista = extraerLista(json?.data);
  const filas = lista.map((i) => normalizar(i, pais)).filter((f) => f.externalId);
  let guardados = 0;
  if (filas.length) {
    const { error } = await servicio.from("CatalogItem").upsert(filas, { onConflict: "provider,externalId" });
    if (error) {
      await marcarError(`No se pudo guardar el catálogo: ${error.message}`);
      return responder({ ok: false, error: `No se pudo guardar el catálogo: ${error.message}`, ...diagnostico });
    }
    guardados = filas.length;
  }

  await servicio
    .from("PlatformCredential")
    .update({ status: "CONNECTED", lastError: null, lastTestAt: new Date().toISOString(), usedThisMonth: (fila.usedThisMonth ?? 0) + 1, updatedAt: new Date().toISOString() })
    .eq("provider", PROVEEDOR);

  return responder({
    ok: true,
    mensaje: `${lista.length} recibidos de CJ · ${guardados} guardados`,
    tokenReutilizado,
    llamadasACj: tokenReutilizado ? 1 : 2,
    forma: { claves: Object.keys(json?.data ?? {}), totalRegistros: json?.data?.totalRecords ?? null },
    muestra: filas.slice(0, 3).map((f) => ({ id: f.externalId, titulo: f.title, costo: f.costPrice, categoria: f.categoryName, stock: f.stock })),
    ...diagnostico,
  });
});
