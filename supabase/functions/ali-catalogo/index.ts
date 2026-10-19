/**
 * ali-catalogo — Catálogo de AliExpress (Open Platform · Dropshipping) hacia CatalogItem y CatalogItemDetail.
 *
 * Es independiente de la función de CJ (cj-catalogo): no comparte código ni tablas de estado con ella.
 * Sigue el cliente original (src/lib/supplier-apis/aliexpress.ts): firma HMAC-SHA256 de todos los parámetros con el
 * App Secret, feed curado `aliexpress.ds.recommend.feed.get`, detalle `aliexpress.ds.product.get` y envío
 * `aliexpress.ds.freight.query`.
 *
 * Acciones (solo administrador): probar · autorizar · feeds · sondear · descargar · detalle · envio
 *
 * Autorización de la cuenta (OAuth): `ds.product.get` y `ds.freight.query` exigen un `access_token`. La acción `autorizar` da el enlace; el retorno llega a la página de Retador, que lo reparte a la función `ali-callback`, que guarda el token en la tabla privada PlatformCredential. Aquí se usa y se renueva solo.
 *
 * Límite: AliExpress corta con `AppApiCallLimit` si se llama en paralelo o muy deprisa. TODAS las llamadas pasan
 * por `ali()`, una a una y con pausa. Las claves viven como secretos (ALIEXPRESS_APP_KEY, ALIEXPRESS_APP_SECRET) y nunca se devuelven.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { compararVariantes, vigilarVariantes } from "./cambios.ts";

const GATEWAY = "https://api-sg.aliexpress.com/sync";
const PROVEEDOR = "ALIEXPRESS";
const PAUSA_MS = 1_500;
const MONEDA = "USD"; // misma moneda que CJ, para poder comparar costes
const DESTINOS_DEFECTO = ["ES", "US", "MX", "GB", "DE", "FR", "IT", "CA", "AU", "BR", "CO", "CL"];
const MAX_COTIZACIONES = 12;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const responder = (cuerpo: unknown, estado = 200) =>
  new Response(JSON.stringify(cuerpo), { status: estado, headers: { ...CORS, "Content-Type": "application/json" } });
const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ahoraIso = () => new Date().toISOString();

const secretosVistos = () => Object.keys(Deno.env.toObject()).filter((n) => /^(CJ|ALI)/i.test(n)).sort();

function numeroONulo(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/[^\d.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}
/** Las listas de AliExpress llegan como lista, como {string:[...]}, como {nombre_dto:[...]} o como texto separado por ; */
function lista(v: any): any[] {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") return v.split(";").map((x) => x.trim()).filter(Boolean);
  if (v && typeof v === "object") {
    const primera = Object.values(v).find((x) => Array.isArray(x));
    if (primera) return primera as any[];
    return [v];
  }
  return [];
}
/** Busca la primera lista que haya dentro de un objeto (hasta 3 niveles), porque AliExpress cambia el nombre del contenedor según la API. */
function primerArray(v: any, nivel = 0): any[] | null {
  if (Array.isArray(v)) return v;
  if (v && typeof v === "object" && nivel < 3) {
    for (const x of Object.values(v)) {
      const r = primerArray(x, nivel + 1);
      if (r) return r;
    }
  }
  return null;
}
function sinRepetidos(a: string[]) {
  return [...new Set(a.filter(Boolean))];
}
const slugTexto = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60);

async function firmar(params: Record<string, string>, secreto: string) {
  const base = Object.keys(params).sort().map((k) => `${k}${params[k]}`).join("");
  const clave = await crypto.subtle.importKey("raw", new TextEncoder().encode(secreto), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const firma = await crypto.subtle.sign("HMAC", clave, new TextEncoder().encode(base));
  return [...new Uint8Array(firma)].map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}

/** Variantes en el formato común de la ficha a partir de los SKU de AliExpress y su paquete (peso en kg, medidas en cm). */
function variantesDeAli(skus: any[], paquete: any) {
  const peso = numeroONulo(paquete?.gross_weight); // kg
  const cm = (v: unknown) => (numeroONulo(v) !== null ? (numeroONulo(v) as number) * 10 : null);
  return skus.map((s: any, i: number) => {
    const propiedades = lista(s.ae_sku_property_dtos?.ae_sku_property_d_t_o ?? s.ae_sku_property_dtos);
    const nombre = propiedades.map((p: any) => p.property_value_definition_name ?? p.sku_property_value).filter(Boolean).join(" · ") || String(s.sku_attr ?? `Variante ${i + 1}`);
    const imagenSku = propiedades.map((p: any) => p.sku_image).find(Boolean) ?? null;
    const stock = numeroONulo(s.sku_available_stock ?? s.sku_available_quantity);
    return {
      vid: s.sku_id ? String(s.sku_id) : null,
      nombre,
      nombreCompleto: nombre,
      sku: s.sku_code ?? s.id ?? null,
      clave: s.sku_attr ?? null,
      precio: numeroONulo(s.offer_sale_price ?? s.sku_price),
      pesoGramos: peso !== null ? Math.round(peso * 1000) : null,
      largoMm: cm(paquete?.package_length),
      anchoMm: cm(paquete?.package_width),
      altoMm: cm(paquete?.package_height),
      imagen: imagenSku,
      stock: stock !== null ? [{ pais: null, total: stock, cj: null, fabrica: null }] : [],
    };
  });
}

const MENSAJES: Record<string, string> = {
  "15": "App Key o App Secret incorrectos",
  "16": "Firma inválida: revisa el App Secret",
  "17": "La petición expiró o el formato de la hora no es el esperado",
  "19": "Access Token caducado: hay que renovar la autorización",
  "21": "Límite de llamadas alcanzado para esta app",
  "1001": "Falta un parámetro obligatorio",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return responder({ ok: false, error: "Usa POST" }, 405);

  const servicio = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  // ── Solo administradores, salvo la vía interna ──
  // La función central `importar-enlace` (que ya comprobó la sesión, el límite diario y que no haya otra importación en curso)
  // llama aquí con la clave de servicio, que solo vive en el servidor, y SOLO puede pedir `importar`, `envio` y `refrescar` (esta última, el monitor de precio y existencias).
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const cuerpo = await req.json().catch(() => ({}));
  let accion: string = cuerpo?.accion ?? "probar";
  const interna = jwt !== "" && jwt === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  let uid = "";
  if (interna) {
    if (accion !== "importar" && accion !== "envio" && accion !== "refrescar") return responder({ ok: false, error: "Esta acción no está permitida por la vía interna" }, 403);
  } else {
    const { data: auth } = await servicio.auth.getUser(jwt);
    uid = auth?.user?.id ?? "";
    if (!uid) return responder({ ok: false, error: "Sesión no válida" }, 401);
    const { data: yo } = await servicio.from("User").select("role").eq("id", uid).maybeSingle();
    if (yo?.role !== "ADMIN") return responder({ ok: false, error: "Solo el administrador puede usar el catálogo de proveedores" }, 403);
    if (accion === "importar" || accion === "refrescar") return responder({ ok: false, error: "Esta acción solo se pide desde las funciones internas (importar-enlace y monitor-proveedor)" }, 403);
  }

  // Nombres de los secretos: ALIEXPRESS_APP_KEY / ALIEXPRESS_APP_SECRET (como en el entorno original); también se acepta ALI_APP_KEY / ALI_APP_SECRET
  const appKey = (Deno.env.get("ALIEXPRESS_APP_KEY") ?? Deno.env.get("ALI_APP_KEY") ?? "").trim();
  const appSecret = (Deno.env.get("ALIEXPRESS_APP_SECRET") ?? Deno.env.get("ALI_APP_SECRET") ?? "").trim();
  const diagnostico = {
    secretoAppKey: Boolean(appKey),
    secretoAppSecret: Boolean(appSecret),
    secretosVistos: secretosVistos(),
    longitudes: { appKey: appKey.length, appSecret: appSecret.length },
  };
  if (!appKey || !appSecret) return responder({ ok: false, error: "Faltan los secretos ALIEXPRESS_APP_KEY y ALIEXPRESS_APP_SECRET en las funciones de Supabase", ...diagnostico });

  // ── Fila del proveedor ──
  const { data: fila0 } = await servicio.from("PlatformCredential").select("*").eq("provider", PROVEEDOR).maybeSingle();
  let fila: any = fila0;
  if (!fila) {
    const { data: nueva, error } = await servicio
      .from("PlatformCredential")
      .insert({ provider: PROVEEDOR, label: "AliExpress (secretos de Supabase)", credentialsEnc: "ENTORNO", settings: {} })
      .select("*")
      .single();
    if (error) return responder({ ok: false, error: `No se pudo crear la fila del proveedor: ${error.message}` });
    fila = nueva;
  }
  let ajustes: any = fila.settings ?? {};
  let llamadas = 0;
  let ultimaLlamada = Number(ajustes.ultimaLlamada) || 0;
  const guardarAjustes = async (extra: Record<string, unknown>) => {
    ajustes = { ...ajustes, ...extra };
    await servicio.from("PlatformCredential").update({ settings: ajustes, updatedAt: ahoraIso() }).eq("provider", PROVEEDOR);
  };
  const marcarError = async (mensaje: string) => {
    await servicio.from("PlatformCredential").update({ status: "ERROR", lastError: mensaje.slice(0, 500), lastTestAt: ahoraIso(), updatedAt: ahoraIso() }).eq("provider", PROVEEDOR);
    await guardarAjustes({ ultimaLlamada });
  };
  const cerrarOk = async (extra: Record<string, unknown>) => {
    await servicio.from("PlatformCredential").update({ status: "CONNECTED", lastError: null, lastTestAt: ahoraIso(), usedThisMonth: (fila.usedThisMonth ?? 0) + llamadas, updatedAt: ahoraIso() }).eq("provider", PROVEEDOR);
    await guardarAjustes({ ultimaLlamada });
    return responder({ ok: true, llamadasAAliExpress: llamadas, ...extra, ...diagnostico });
  };

  /** ÚNICA puerta hacia AliExpress: una llamada cada vez, con pausa y reintento ante el límite. */
  async function ali(metodo: string, negocio: Record<string, string | number | undefined> = {}, intento = 1): Promise<{ ok: boolean; datos: any; mensaje: string; codigo: string | null; crudo?: any }> {
    const espera = ultimaLlamada + PAUSA_MS - Date.now();
    if (espera > 0) await pausa(espera);
    // El detalle y el envío exigen el access_token de la cuenta autorizada (el feed funciona solo con las claves)
    if (/^aliexpress\.ds\.(product|freight)/.test(metodo) && !negocio.access_token) {
      const tk = await tokenVigente();
      if (tk) negocio = { ...negocio, access_token: tk };
    }
    // Formato de la hora: el gateway actual usa milisegundos; el cliente original usaba «aaaa-mm-dd hh:mm:ss». Se prueba el recordado y, si falla por la hora, el otro.
    const formatos: ("ms" | "texto")[] = ajustes.formatoHora === "texto" ? ["texto", "ms"] : ["ms", "texto"];
    let ultimoError: { mensaje: string; codigo: string | null; crudo: any } | null = null;
    for (const formato of formatos) {
      const params: Record<string, string> = {
        method: metodo,
        app_key: appKey,
        timestamp: formato === "ms" ? String(Date.now()) : new Date().toISOString().replace("T", " ").slice(0, 19),
        format: "json",
        v: "2.0",
        sign_method: "sha256",
        ...Object.fromEntries(Object.entries(negocio).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => [k, String(v)])),
      };
      params.sign = await firmar(params, appSecret);
      const control = new AbortController();
      const t = setTimeout(() => control.abort(), 25_000);
      let json: any = {};
      let estado = 0;
      try {
        const res = await fetch(GATEWAY, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" }, body: new URLSearchParams(params).toString(), signal: control.signal });
        estado = res.status;
        const texto = await res.text();
        try { json = JSON.parse(texto); } catch { json = { texto_no_json: texto.slice(0, 300) }; }
      } catch (e) {
        json = { error_response: { code: "RED", msg: `No se pudo conectar con AliExpress (${(e as Error).message})` } };
      } finally {
        clearTimeout(t);
        ultimaLlamada = Date.now();
        llamadas += 1;
      }
      const err = json?.error_response ?? (json?.code && json?.message ? { code: json.code, msg: json.message } : null);
      if (!err && !json?.texto_no_json) {
        if (ajustes.formatoHora !== formato) await guardarAjustes({ formatoHora: formato });
        return { ok: true, datos: json, mensaje: "", codigo: null };
      }
      const codigo = String(err?.code ?? estado);
      const mensaje = `${err?.msg ?? err?.message ?? json?.texto_no_json ?? "Error de AliExpress"}${MENSAJES[codigo] ? ` — ${MENSAJES[codigo]}` : ""}`;
      ultimoError = { mensaje, codigo, crudo: err ?? json };
      // Ante el límite de llamadas se espera de verdad y se reintenta (máximo 2 veces)
      if (/call.?limit|frequency|too many/i.test(`${codigo} ${mensaje}`) && intento < 3) {
        await pausa(3_000 * intento);
        return await ali(metodo, negocio, intento + 1);
      }
      // Solo se prueba el otro formato de hora si el error apunta a la hora o a la firma
      if (!/timestamp|expire|time|sign|17|16/i.test(`${codigo} ${mensaje}`)) break;
    }
    return { ok: false, datos: null, mensaje: ultimoError?.mensaje ?? "Error desconocido", codigo: ultimoError?.codigo ?? null, crudo: ultimoError?.crudo };
  }

  const fallo = async (mensaje: string, extra: Record<string, unknown> = {}) => {
    await marcarError(mensaje);
    return responder({ ok: false, error: mensaje, ...extra, ...diagnostico });
  };

  /** Llamadas del sistema de autorización (ruta /rest/...): la firma lleva delante la ruta de la API. */
  async function restToken(ruta: string, extra: Record<string, string>): Promise<{ ok: boolean; datos: any; mensaje: string }> {
    const params: Record<string, string> = { app_key: appKey, timestamp: String(Date.now()), sign_method: "sha256", ...extra };
    const base = ruta + Object.keys(params).sort().map((k) => `${k}${params[k]}`).join("");
    const clave = await crypto.subtle.importKey("raw", new TextEncoder().encode(appSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    params.sign = [...new Uint8Array(await crypto.subtle.sign("HMAC", clave, new TextEncoder().encode(base)))].map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
    try {
      const res = await fetch(`https://api-sg.aliexpress.com/rest${ruta}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" }, body: new URLSearchParams(params).toString() });
      const json: any = await res.json().catch(() => ({}));
      llamadas += 1;
      ultimaLlamada = Date.now();
      if (json?.access_token) return { ok: true, datos: json, mensaje: "" };
      return { ok: false, datos: json, mensaje: String(json?.message ?? json?.msg ?? json?.error_response?.msg ?? "AliExpress no devolvió el token").slice(0, 300) };
    } catch (e) {
      return { ok: false, datos: null, mensaje: `No se pudo conectar con AliExpress (${(e as Error).message})` };
    }
  }
  const guardarToken = async (d: any) => {
    const expiraEn = Number(d.expire_time) > 1e12 ? Number(d.expire_time) : Date.now() + (Number(d.expires_in) || 0) * 1000;
    await guardarAjustes({ aliToken: { accessToken: d.access_token, refreshToken: d.refresh_token ?? ajustes.aliToken?.refreshToken ?? null, expiraEn, cuenta: d.user_nick ?? d.account ?? ajustes.aliToken?.cuenta ?? null, guardadoEn: ahoraIso() } });
  };
  /** Devuelve el access_token de la cuenta autorizada; lo renueva si caduca en menos de 5 minutos. */
  async function tokenVigente(): Promise<string | null> {
    const t = ajustes.aliToken;
    if (!t?.accessToken) return null;
    if (!t.expiraEn || t.expiraEn - Date.now() > 300_000 || !t.refreshToken) return t.accessToken;
    const r = await restToken("/auth/token/refresh", { refresh_token: t.refreshToken });
    if (r.ok) {
      await guardarToken(r.datos);
      return r.datos.access_token;
    }
    return t.accessToken;
  }

  /* ───────────────────────── autorizar (enlace para que la cuenta de AliExpress autorice la app) ───────────────────────── */
  if (accion === "autorizar") {
    // La app de AliExpress se comparte con Retador y solo admite UNA Callback URL: la de Retador. Su página de retorno reparte
    // el navegador según el `state`: si empieza por «dropshippilot.» lo envía a la función `ali-callback` de este proyecto.
    const urlRetorno = "https://retadormarketplace.es/aliexpress/callback";
    const carga = `${uid}.${Date.now() + 15 * 60_000}`;
    const clave = await crypto.subtle.importKey("raw", new TextEncoder().encode(appSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const firma = [...new Uint8Array(await crypto.subtle.sign("HMAC", clave, new TextEncoder().encode(carga)))].map((b) => b.toString(16).padStart(2, "0")).join("");
    const state = "dropshippilot." + btoa(`${carga}.${firma}`).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const urlAutorizacion = `https://api-sg.aliexpress.com/oauth/authorize?response_type=code&force_auth=true&client_id=${encodeURIComponent(appKey)}&redirect_uri=${encodeURIComponent(urlRetorno)}&state=${state}`;
    const t = ajustes.aliToken;
    return responder({ ok: true, mensaje: t?.accessToken ? `Ya hay una cuenta autorizada${t.cuenta ? ` (${t.cuenta})` : ""}; puedes volver a autorizar si quieres cambiarla` : "Falta autorizar la cuenta de AliExpress", urlRetorno, urlAutorizacion, autorizada: Boolean(t?.accessToken), ...diagnostico });
  }

  /* ───────────────────────── probar ───────────────────────── */
  if (accion === "probar") {
    const r = await ali("aliexpress.ds.recommend.feed.get", { feed_name: "DS bestseller", target_currency: MONEDA, target_language: "ES", country: "ES", page_size: 1, page_no: 1 });
    if (!r.ok) return await fallo(`AliExpress rechazó la prueba: ${r.mensaje}`, { codigoAli: r.codigo, detalleError: r.crudo });
    return await cerrarOk({ mensaje: "App Key y App Secret válidos: AliExpress respondió", formaRespuesta: Object.keys(r.datos ?? {}), autorizada: Boolean(ajustes.aliToken?.accessToken), avisos: ajustes.aliToken?.accessToken ? [`Cuenta autorizada${ajustes.aliToken.cuenta ? `: ${ajustes.aliToken.cuenta}` : ""}`] : ["Cuenta de AliExpress sin autorizar (hace falta para fichas y envío)"] });
  }

  /* ───────────────────────── feeds ───────────────────────── */
  if (accion === "feeds") {
    const r = await ali("aliexpress.ds.feedname.get", {});
    if (!r.ok) return await fallo(`AliExpress no devolvió los feeds: ${r.mensaje}`, { codigoAli: r.codigo, detalleError: r.crudo });
    const nodo = r.datos?.aliexpress_ds_feedname_get_response?.resp_result?.result ?? r.datos?.aliexpress_ds_feedname_get_response ?? r.datos;
    const feeds = lista(nodo?.promos?.promo ?? nodo?.promos).map((p: any) => ({ nombre: p.promo_name ?? p.name ?? null, productos: numeroONulo(p.product_num), descripcion: p.promo_desc ?? null }));
    return await cerrarOk({ mensaje: `${feeds.length} feeds disponibles`, feeds, formaRespuesta: Object.keys(nodo ?? {}) });
  }

  /* ───────────────────────── descargar ───────────────────────── */
  if (accion === "descargar") {
    // «DS bestseller» no existe en AliExpress: si no se indica feed, se usa el de más vendidos con más productos (se recuerda para no gastar otra llamada)
    let feed = String(cuerpo?.feed ?? ajustes.feedPorDefecto ?? "").slice(0, 120);
    if (!feed) {
      const rf = await ali("aliexpress.ds.feedname.get", {});
      if (!rf.ok) return await fallo(`AliExpress no devolvió los feeds: ${rf.mensaje}`, { codigoAli: rf.codigo, detalleError: rf.crudo });
      const nodoF = rf.datos?.aliexpress_ds_feedname_get_response?.resp_result?.result ?? rf.datos?.aliexpress_ds_feedname_get_response ?? rf.datos;
      const feedsDisp = lista(nodoF?.promos?.promo ?? nodoF?.promos).map((p: any) => ({ nombre: String(p.promo_name ?? p.name ?? ""), productos: numeroONulo(p.product_num) ?? 0 })).filter((f) => f.nombre);
      const masVendidos = feedsDisp.filter((f) => /bestseller/i.test(f.nombre));
      const elegido = [...(masVendidos.length ? masVendidos : feedsDisp)].sort((a, b) => b.productos - a.productos)[0];
      if (!elegido) return await fallo("AliExpress no devolvió ningún feed utilizable");
      feed = elegido.nombre;
      await guardarAjustes({ feedPorDefecto: feed });
    }
    const tamano = Math.max(1, Math.min(Number(cuerpo?.tamano ?? 50), 50));
    const paginas = Math.max(1, Math.min(Number(cuerpo?.paginas ?? 1), 3));
    const desde = Math.max(1, Number(cuerpo?.paginaInicial ?? 1));
    const pais = String(cuerpo?.pais ?? "ES").toUpperCase().slice(0, 2); // país para el que se calculan precio y disponibilidad
    let recibidos = 0;
    let guardados = 0;
    const avisos: string[] = [];
    let forma: string[] = [];
    for (let p = desde; p < desde + paginas; p += 1) {
      const pedir = (extra: Record<string, any>) => ali("aliexpress.ds.recommend.feed.get", { feed_name: feed, country: pais, target_currency: MONEDA, target_language: "ES", page_no: p, page_size: tamano, ...extra });
      let r = await pedir({ sort: cuerpo?.orden ?? "volumeDesc", category_id: cuerpo?.categoryId });
      if (!r.ok) {
        if (p === desde) return await fallo(`AliExpress respondió con error: ${r.mensaje}`, { codigoAli: r.codigo, detalleError: r.crudo });
        avisos.push(`Página ${p}: ${r.mensaje}`);
        break;
      }
      const sacarNodo = (datos: any) => datos?.aliexpress_ds_recommend_feed_get_response?.resp_result?.result ?? datos?.aliexpress_ds_recommend_feed_get_response?.result ?? datos?.aliexpress_ds_recommend_feed_get_response ?? {};
      const sacarItems = (n: any): any[] => primerArray(n?.products) ?? primerArray(n?.product_list) ?? primerArray(n?.ae_item_list) ?? [];
      let nodo = sacarNodo(r.datos);
      let items = sacarItems(nodo);
      // Si el feed viene vacío, se repite UNA vez sin orden ni categoría (por si AliExpress no acepta ese orden) y se deja constancia
      if (!items.length && p === desde) {
        avisos.push(`Primer intento vacío (recibidos=${nodo?.current_record_count ?? "?"}, total=${nodo?.total_record_count ?? "?"}); se repite sin orden`);
        await pausa(1_500);
        r = await pedir({});
        if (r.ok) {
          nodo = sacarNodo(r.datos);
          items = sacarItems(nodo);
        }
      }
      if (p === desde) forma = [...Object.keys(nodo), `contadores→recibidos=${nodo?.current_record_count ?? "?"} total=${nodo?.total_record_count ?? "?"} terminado=${nodo?.is_finished ?? "?"}`, `products→${JSON.stringify(nodo?.products ?? null).slice(0, 300)}`, `producto→${Object.keys(items[0] ?? {}).slice(0, 40).join("|") || "sin productos"}`];
      recibidos += items.length;
      const filas = items
        .map((i: any) => {
          const id = String(i.product_id ?? i.productId ?? i.item_id ?? "");
          const principal = String(i.product_main_image_url ?? i.productImage ?? "");
          const imagenes = sinRepetidos([principal, ...lista(i.product_small_image_urls ?? i.image_urls).map(String)]);
          const valoracion = numeroONulo(i.evaluate_rate); // «93.2%» → estrellas sobre 5
          const pedidos = numeroONulo(i.lastest_volume);
          return {
            provider: PROVEEDOR,
            externalId: id,
            title: String(i.product_title ?? i.title ?? "Producto AliExpress").slice(0, 250),
            description: "",
            categoryId: i.second_level_category_id ? String(i.second_level_category_id) : i.first_level_category_id ? String(i.first_level_category_id) : null,
            categoryName: i.second_level_category_name ?? i.first_level_category_name ?? null,
            imageUrl: imagenes[0] ?? null,
            images: imagenes.slice(0, 8),
            currency: MONEDA,
            costPrice: numeroONulo(i.target_sale_price ?? i.sale_price ?? i.target_original_price) ?? 0,
            stock: null, // el feed no informa del stock: se consulta en la ficha
            rating: valoracion !== null ? Math.round((valoracion / 20) * 100) / 100 : null,
            ordersCount: pedidos,
            shipFrom: null,
            rawPayload: i,
            sourceUrl: String(i.product_detail_url ?? `https://www.aliexpress.com/item/${id}.html`),
            source: "api",
            lastSyncedAt: ahoraIso(),
            updatedAt: ahoraIso(),
          };
        })
        .filter((f: any) => f.externalId);
      if (filas.length) {
        const { error } = await servicio.from("CatalogItem").upsert(filas, { onConflict: "provider,externalId" });
        if (error) return await fallo(`No se pudo guardar el catálogo: ${error.message}`);
        guardados += filas.length;
        // Si el artículo ya tiene ficha, el coste vuelve a ser el de su variante más barata (el listado trae otro precio y la tarjeta no debe cambiar de número)
        const { data: ya } = await servicio.from("CatalogItem").select("id,externalId").eq("provider", PROVEEDOR).in("externalId", filas.map((f: any) => f.externalId));
        const { data: fichas } = await servicio.from("CatalogItemDetail").select("itemId,ficha").in("itemId", (ya ?? []).map((x: any) => x.id));
        for (const f of fichas ?? []) {
          const minimo = numeroONulo((f.ficha as any)?.precio?.min);
          if (minimo !== null) await servicio.from("CatalogItem").update({ costPrice: minimo }).eq("id", f.itemId);
        }
      }
      if (items.length < tamano) break;
    }
    // Categorías conocidas a partir de lo descargado
    const { data: conCat } = await servicio.from("CatalogItem").select("categoryId,categoryName").eq("provider", PROVEEDOR).not("categoryId", "is", null).limit(5000);
    const unicas = new Map<string, string>();
    for (const c of conCat ?? []) if (c.categoryName) unicas.set(String(c.categoryId), String(c.categoryName));
    if (unicas.size) {
      await servicio.from("CatalogCategory").upsert(
        [...unicas.entries()].map(([id, nombre], i) => ({ provider: PROVEEDOR, externalId: id, name: nombre, slug: slugTexto(nombre), sortOrder: i, updatedAt: ahoraIso() })),
        { onConflict: "provider,externalId" },
      );
    }
    return await cerrarOk({ mensaje: `${recibidos} recibidos de AliExpress · ${guardados} guardados`, recibidos, guardados, avisos, forma: { claves: forma }, feed });
  }

  /* ───────────────────────── sondear (diagnóstico del feed: pocas llamadas, en serie) ───────────────────────── */
  if (accion === "sondear") {
    const rf = await ali("aliexpress.ds.feedname.get", {});
    if (!rf.ok) return await fallo(`AliExpress no devolvió los feeds: ${rf.mensaje}`, { codigoAli: rf.codigo, detalleError: rf.crudo });
    const nodoF = rf.datos?.aliexpress_ds_feedname_get_response?.resp_result?.result ?? rf.datos?.aliexpress_ds_feedname_get_response ?? rf.datos;
    const feeds = lista(nodoF?.promos?.promo ?? nodoF?.promos).map((p: any) => ({ nombre: String(p.promo_name ?? p.name ?? ""), productos: numeroONulo(p.product_num) ?? 0 })).filter((f) => f.nombre);
    const mayor = [...feeds].sort((a, b) => b.productos - a.productos)[0];
    const lineas: string[] = [`Feeds: ${feeds.length}. Mayor: ${mayor ? `${mayor.nombre} (${mayor.productos})` : "ninguno"}. «DS bestseller» declara ${feeds.find((f) => f.nombre === "DS bestseller")?.productos ?? "no figura"}`];
    const pruebas: { etiqueta: string; feed: string; extra: Record<string, string> }[] = [
      { etiqueta: "DS bestseller sin país", feed: "DS bestseller", extra: { target_currency: MONEDA, target_language: "EN" } },
      { etiqueta: `${mayor?.nombre ?? "feed mayor"} · ES`, feed: mayor?.nombre ?? "DS bestseller", extra: { country: "ES", target_currency: MONEDA, target_language: "ES" } },
      { etiqueta: `${mayor?.nombre ?? "feed mayor"} · sin país`, feed: mayor?.nombre ?? "DS bestseller", extra: { target_currency: MONEDA, target_language: "EN" } },
      { etiqueta: "DS bestseller · US", feed: "DS bestseller", extra: { country: "US", target_currency: MONEDA, target_language: "EN" } },
    ];
    for (const t of pruebas) {
      const r = await ali("aliexpress.ds.recommend.feed.get", { feed_name: t.feed, page_no: 1, page_size: 3, ...t.extra });
      if (!r.ok) { lineas.push(`${t.etiqueta}: error ${r.codigo ?? ""} ${r.mensaje}`.slice(0, 220)); continue; }
      const n = r.datos?.aliexpress_ds_recommend_feed_get_response?.resp_result?.result ?? r.datos?.aliexpress_ds_recommend_feed_get_response?.result ?? r.datos?.aliexpress_ds_recommend_feed_get_response ?? {};
      const it = primerArray(n?.products) ?? [];
      lineas.push(`${t.etiqueta}: total=${n?.total_record_count ?? "?"} recibidos=${it.length}${it[0] ? ` campos=${Object.keys(it[0]).slice(0, 8).join("|")}` : ""}`);
      if (it.length) break; // en cuanto una combinación devuelve productos, se para: no hace falta gastar más llamadas
    }
    return await cerrarOk({ mensaje: "Sondeo del feed de AliExpress", avisos: lineas });
  }

  /* ───────────────────────── refrescar (monitor: precio y existencias actuales; solo vía interna) ───────────────────────── */
  // Una llamada a AliExpress por producto. Compara con la ficha guardada, la actualiza y devuelve los cambios que importan.
  if (accion === "refrescar") {
    const ids: string[] = (Array.isArray(cuerpo?.ids) ? cuerpo.ids : []).map(String).slice(0, 3);
    if (!ids.length) return responder({ ok: false, error: "Indica al menos un artículo", ...diagnostico });
    if (!ajustes.aliToken?.accessToken) return responder({ ok: false, error: "La cuenta de AliExpress todavía no está autorizada, así que no se pueden revisar los productos.", ...diagnostico });
    const { data: items } = await servicio.from("CatalogItem").select("id,externalId,title").eq("provider", PROVEEDOR).in("id", ids);
    const informe: any[] = [];
    for (const item of items ?? []) {
      const pid = String(item.externalId);
      const { data: previa } = await servicio.from("CatalogItemDetail").select("ficha").eq("itemId", item.id).maybeSingle();
      const ficha: any = previa?.ficha;
      if (!Array.isArray(ficha?.variantes) || !ficha.variantes.length) {
        informe.push({ id: item.id, ok: false, error: "Todavía no tiene la ficha completa" });
        continue;
      }
      // El precio se pide para el mismo país con el que se guardó la ficha, para que las cifras sean comparables
      const paisPrecio = String(ficha.precio?.pais ?? "ES").toUpperCase().slice(0, 2);
      const r = await ali("aliexpress.ds.product.get", { product_id: pid, target_currency: MONEDA, target_language: "ES", country: paisPrecio, ship_to_country: paisPrecio });
      if (!r.ok) {
        informe.push({ id: item.id, ok: false, error: `Detalle: ${r.mensaje}`, codigoAli: r.codigo });
        continue;
      }
      const nodo = r.datos?.aliexpress_ds_product_get_response?.result ?? r.datos?.aliexpress_ds_product_get_response ?? {};
      const skus = lista(nodo.ae_item_sku_info_dtos?.ae_item_sku_info_d_t_o ?? nodo.ae_item_sku_info_dtos);
      const nuevas = variantesDeAli(skus, nodo.package_info_dto ?? {});
      if (!nuevas.length) {
        informe.push({ id: item.id, ok: false, posibleRetirada: true, error: "AliExpress no devolvió variantes: puede que el producto ya no esté disponible" });
        continue;
      }
      const cambios = compararVariantes(vigilarVariantes(ficha.variantes), vigilarVariantes(nuevas));
      const precios = nuevas.map((v) => v.precio).filter((p): p is number => p !== null);
      const stockTotalAli = nuevas.reduce((a, v) => a + (v.stock[0]?.total ?? 0), 0);

      ficha.variantes = nuevas;
      if (precios.length) ficha.precio = { ...(ficha.precio ?? {}), moneda: MONEDA, min: Math.min(...precios), max: Math.max(...precios), pais: paisPrecio, consultado: ahoraIso() };
      ficha.fuentes = { ...(ficha.fuentes ?? {}), variantes: true, inventario: stockTotalAli > 0 };
      ficha.actualizado = ahoraIso();
      const { error: eDet } = await servicio.from("CatalogItemDetail").update({ ficha, fetchedAt: ahoraIso() }).eq("itemId", item.id);
      if (eDet) {
        informe.push({ id: item.id, ok: false, error: `No se pudo guardar la ficha: ${eDet.message}` });
        continue;
      }
      const tarjeta: Record<string, unknown> = { updatedAt: ahoraIso(), lastSyncedAt: ahoraIso() };
      if (precios.length) tarjeta.costPrice = Math.min(...precios);
      if (stockTotalAli > 0) tarjeta.stock = stockTotalAli;
      await servicio.from("CatalogItem").update(tarjeta).eq("id", item.id);
      informe.push({ id: item.id, ok: true, titulo: ficha.titulo ?? item.title, variantes: nuevas.length, cambios });
    }
    return await cerrarOk({ mensaje: `${informe.filter((i) => i.ok).length} de ${informe.length} productos revisados`, informe });
  }

  /* ───────────────────────── importar (un producto por su identificador; solo vía interna) ───────────────────────── */
  // Si el producto no está en el catálogo común, crea una fila mínima y sigue con la ficha completa (acción «detalle»), que la rellena.
  // Si AliExpress no devuelve el producto, la fila nueva se borra: no queda nada a medias.
  let filaNuevaId: string | null = null;
  let actualizarTarjeta = false;
  if (accion === "importar") {
    const pid = String(cuerpo?.pid ?? "").trim();
    if (!/^\d{8,20}$/.test(pid)) return responder({ ok: false, error: "El identificador del producto de AliExpress no es válido", ...diagnostico });
    if (!ajustes.aliToken?.accessToken) return responder({ ok: false, error: "La cuenta de AliExpress todavía no está autorizada, así que no se pueden leer fichas. El administrador debe pulsar «Autorizar» en Administración.", ...diagnostico });
    const { data: existente } = await servicio.from("CatalogItem").select("id").eq("provider", PROVEEDOR).eq("externalId", pid).maybeSingle();
    let idItem: string | undefined = existente?.id;
    if (!idItem) {
      const { data: creado, error: eNuevo } = await servicio
        .from("CatalogItem")
        .insert({ provider: PROVEEDOR, externalId: pid, title: "Producto AliExpress", description: "", currency: MONEDA, costPrice: 0, images: [], tags: [], rawPayload: {}, sourceUrl: `https://www.aliexpress.com/item/${pid}.html`, source: "api", lastSyncedAt: ahoraIso(), updatedAt: ahoraIso() })
        .select("id")
        .single();
      if (eNuevo || !creado) return responder({ ok: false, error: `No se pudo guardar el producto en el catálogo: ${eNuevo?.message ?? "sin respuesta"}`, ...diagnostico });
      idItem = creado.id as string;
      filaNuevaId = idItem;
    }
    cuerpo.ids = [idItem];
    actualizarTarjeta = true;
    accion = "detalle"; // sigue con la ficha completa
  }

  /* ───────────────────────── detalle (ficha completa) ───────────────────────── */
  if (accion === "detalle") {
    const ids: string[] = (Array.isArray(cuerpo?.ids) ? cuerpo.ids : []).map(String).slice(0, 2);
    const pais = String(cuerpo?.pais ?? "ES").toUpperCase().slice(0, 2);
    if (!ids.length) return responder({ ok: false, error: "Indica al menos un artículo", ...diagnostico });
    const { data: items } = await servicio.from("CatalogItem").select("id,externalId,title,description").eq("provider", PROVEEDOR).in("id", ids);
    const informe: any[] = [];
    for (const item of items ?? []) {
      const pid = String(item.externalId);
      const r = await ali("aliexpress.ds.product.get", { product_id: pid, target_currency: MONEDA, target_language: "ES", country: pais, ship_to_country: pais });
      if (!r.ok) {
        if (filaNuevaId && filaNuevaId === item.id) await servicio.from("CatalogItem").delete().eq("id", item.id);
        informe.push({ id: item.id, ok: false, error: `Detalle: ${r.mensaje}`, codigoAli: r.codigo });
        continue;
      }
      const nodo = r.datos?.aliexpress_ds_product_get_response?.result ?? r.datos?.aliexpress_ds_product_get_response ?? {};
      const base = nodo.ae_item_base_info_dto ?? {};
      const media = nodo.ae_multimedia_info_dto ?? {};
      const skus = lista(nodo.ae_item_sku_info_dtos?.ae_item_sku_info_d_t_o ?? nodo.ae_item_sku_info_dtos);
      const paquete = nodo.package_info_dto ?? {};
      const tienda = nodo.ae_store_info ?? {};
      const props = lista(nodo.ae_item_properties?.ae_item_property ?? nodo.ae_item_properties);
      const imagenes = sinRepetidos(lista(media.image_urls).map(String));
      const peso = numeroONulo(paquete.gross_weight); // kg
      const variantes = variantesDeAli(skus, paquete);
      if (filaNuevaId && filaNuevaId === item.id && !variantes.length) {
        await servicio.from("CatalogItem").delete().eq("id", item.id);
        informe.push({ id: item.id, ok: false, error: "AliExpress no devolvió variantes de ese producto: puede estar retirado o no estar disponible para el dropshipping." });
        continue;
      }
      const precios = variantes.map((v) => v.precio).filter((p): p is number => p !== null);
      const stockTotal = variantes.reduce((a, v) => a + (v.stock[0]?.total ?? 0), 0);
      const valoracion = numeroONulo(base.avg_evaluation_rating);
      const totalResenas = numeroONulo(base.evaluation_count);
      const { data: previa } = await servicio.from("CatalogItemDetail").select("ficha,raw").eq("itemId", item.id).maybeSingle();

      const ficha = {
        proveedor: PROVEEDOR,
        pid,
        sku: null,
        titulo: String(base.subject ?? item.title),
        categoria: { id: base.category_id ?? null, ruta: [] as string[] },
        imagenes,
        descripcionHtml: String(base.detail ?? nodo.detail ?? ""),
        peso: { gramos: peso !== null ? Math.round(peso * 1000) : null, conEmbalaje: null },
        materiales: [],
        embalaje: [],
        caracteristicasEnvio: [],
        opcionesProducto: [],
        propiedades: props.map((p: any) => ({ nombre: p.attr_name ?? null, valor: p.attr_value ?? null })).filter((p: any) => p.nombre),
        precioSugeridoCj: null,
        proveedorCj: null,
        tienda: { nombre: tienda.store_name ?? null, id: tienda.store_id ?? null, valoraciones: { envio: tienda.shipping_speed_rating ?? null, comunicacion: tienda.communication_rating ?? null, descripcion: tienda.item_as_described_rating ?? null } },
        videos: [],
        unidad: null,
        tipo: base.product_status_type ?? null,
        // Precio según la API de AliExpress para el país indicado (el que se usa al pedir por API); no es el precio personalizado de la app (bienvenida, monedas, cupones)
        precio: { moneda: MONEDA, min: precios.length ? Math.min(...precios) : null, max: precios.length ? Math.max(...precios) : null, pais, consultado: ahoraIso() },
        variantes,
        almacenes: [],
        origenes: (previa?.ficha as any)?.origenes ?? [],
        envio: (previa?.ficha as any)?.envio ?? { porOrigen: {} },
        resenas: { total: totalResenas, media: valoracion, lista: [] },
        enlace: `https://www.aliexpress.com/item/${pid}.html`,
        fuentes: { detalle: true, variantes: variantes.length > 0, inventario: stockTotal > 0, resenas: totalResenas !== null },
        avisos: variantes.length ? [] : ["AliExpress no devolvió variantes: puede hacer falta la autorización de la cuenta"],
        actualizado: ahoraIso(),
      };
      const { error: eDet } = await servicio.from("CatalogItemDetail").upsert({ itemId: item.id, ficha, raw: { ...((previa?.raw as any) ?? {}), producto: nodo }, fetchedAt: ahoraIso() }, { onConflict: "itemId" });
      if (eDet) {
        if (filaNuevaId && filaNuevaId === item.id) await servicio.from("CatalogItem").delete().eq("id", item.id);
        informe.push({ id: item.id, ok: false, error: `No se pudo guardar la ficha: ${eDet.message}` });
        continue;
      }
      const cambios: Record<string, unknown> = { updatedAt: ahoraIso() };
      if (imagenes.length) { cambios.images = imagenes.slice(0, 12); cambios.imageUrl = imagenes[0]; }
      if (ficha.descripcionHtml) cambios.description = ficha.descripcionHtml.slice(0, 5000);
      if (stockTotal > 0) cambios.stock = stockTotal;
      if (valoracion !== null) cambios.rating = valoracion;
      // La tarjeta muestra el coste de la variante más barata de la ficha (el mismo número que ve el vendedor al abrir el producto)
      if (precios.length) cambios.costPrice = Math.min(...precios);
      // Producto importado por enlace: la tarjeta toma también el título y la categoría de la ficha
      if (actualizarTarjeta) {
        if (ficha.titulo) cambios.title = ficha.titulo.slice(0, 250);
        if (base.category_id) cambios.categoryId = String(base.category_id);
      }
      await servicio.from("CatalogItem").update(cambios).eq("id", item.id);
      informe.push({ id: item.id, ok: true, titulo: ficha.titulo, imagenes: imagenes.length, variantes: variantes.length, almacenes: 0, origenes: [], resenas: 0, avisos: ficha.avisos, formaProducto: Object.keys(nodo) });
    }
    return await cerrarOk({ mensaje: `${informe.filter((i) => i.ok).length} de ${informe.length} fichas completadas`, informe });
  }

  /* ───────────────────────── envío (por país de destino) ───────────────────────── */
  if (accion === "envio") {
    const id = String((Array.isArray(cuerpo?.ids) ? cuerpo.ids[0] : cuerpo?.id) ?? "");
    if (!id) return responder({ ok: false, error: "Indica el artículo", ...diagnostico });
    const destinos: string[] = (Array.isArray(cuerpo?.paises) && cuerpo.paises.length ? cuerpo.paises : DESTINOS_DEFECTO).map((p: string) => String(p).toUpperCase().slice(0, 2));
    const { data: det } = await servicio.from("CatalogItemDetail").select("ficha,raw").eq("itemId", id).maybeSingle();
    const { data: item } = await servicio.from("CatalogItem").select("externalId").eq("id", id).maybeSingle();
    if (!det || !item) return responder({ ok: false, error: "Primero hay que completar la ficha de este artículo", ...diagnostico });
    const ficha: any = det.ficha ?? {};
    const sku = (ficha.variantes ?? []).filter((v: any) => v?.vid).sort((a: any, b: any) => (a.precio ?? 1e9) - (b.precio ?? 1e9))[0];
    // El almacén de salida NO se supone: lo dice AliExpress en cada cotización (`ship_from_country`) y puede cambiar según el destino.
    const envio: any = { origen: ficha.envio?.origen ?? null, porOrigen: { ...(ficha.envio?.porOrigen ?? {}) }, sinServicio: { ...(ficha.envio?.sinServicio ?? {}) } };
    const crudoEnvio: Record<string, any> = { ...(((det.raw as any)?.envio) ?? {}) };
    const avisos: string[] = [];
    let hechas = 0;
    const almacenesVistos = new Set<string>();
    const hayCotizacionReciente = (d: string) =>
      Object.values(envio.porOrigen).some((m: any) => m?.[d] && Date.now() - new Date(m[d].actualizado).getTime() < 24 * 3_600_000 && !m[d].error) ||
      (envio.sinServicio[d] && Date.now() - new Date(envio.sinServicio[d].actualizado).getTime() < 24 * 3_600_000);
    for (const destino of destinos) {
      if (!cuerpo?.forzar && hayCotizacionReciente(destino)) continue;
      if (hechas >= MAX_COTIZACIONES) { avisos.push(`Se alcanzó el máximo de ${MAX_COTIZACIONES} cotizaciones por vez: vuelve a pulsar para seguir`); break; }
      const r = await ali("aliexpress.ds.freight.query", {
        queryDeliveryReq: JSON.stringify({ productId: String(item.externalId), quantity: "1", shipToCountry: destino, selectedSkuId: sku?.vid ?? "", language: "es_ES", currency: MONEDA, locale: "es_ES" }),
      });
      hechas += 1;
      if (!r.ok) {
        envio.sinServicio[destino] = { variante: sku?.vid ?? null, actualizado: ahoraIso(), error: r.mensaje };
        crudoEnvio[destino] = { error: r.mensaje, detalle: r.crudo };
        continue;
      }
      crudoEnvio[destino] = r.datos;
      const nodo = r.datos?.aliexpress_ds_freight_query_response?.result ?? r.datos?.aliexpress_ds_freight_query_response ?? {};
      const opciones = lista(nodo.delivery_options?.delivery_option_d_t_o ?? nodo.delivery_options).map((o: any) => {
        const precio = numeroONulo(o.shipping_fee ?? o.freight_amount?.amount ?? o.shipping_fee_cent);
        return {
          nombre: String(o.company ?? o.service_name ?? o.code ?? "Envío AliExpress"),
          precio,
          diasMin: numeroONulo(o.min_delivery_days ?? o.delivery_time_min),
          diasMax: numeroONulo(o.max_delivery_days ?? o.delivery_time_max ?? o.delivery_date_desc),
          textoDias: o.delivery_date_desc ?? null,
          origen: o.ship_from_country ? String(o.ship_from_country).toUpperCase() : null,
          gratis: o.free_shipping === true || precio === 0,
          gratisDesde: o.free_shipping_threshold ?? null, // p. ej. «US $10.00»: envío gratis si el pedido llega a esa cantidad
        };
      });
      if (!opciones.length) {
        envio.sinServicio[destino] = { variante: sku?.vid ?? null, actualizado: ahoraIso(), error: "AliExpress no devolvió ningún método de envío para este país" };
        for (const o of Object.keys(envio.porOrigen)) delete envio.porOrigen[o][destino];
        continue;
      }
      delete envio.sinServicio[destino];
      // Se agrupa por el almacén que informa AliExpress; si alguna opción no lo trae se marca «XX» (desconocido) en vez de suponer China
      const grupos = new Map<string, any[]>();
      for (const o of opciones) {
        const origen = o.origen ?? "XX";
        if (o.origen) almacenesVistos.add(o.origen);
        grupos.set(origen, [...(grupos.get(origen) ?? []), o]);
      }
      for (const [origen, ops] of grupos) {
        envio.porOrigen[origen] = envio.porOrigen[origen] ?? {};
        envio.porOrigen[origen][destino] = { variante: sku?.vid ?? null, actualizado: ahoraIso(), opciones: ops };
      }
      for (const origen of Object.keys(envio.porOrigen)) if (!grupos.has(origen)) delete envio.porOrigen[origen][destino]; // cotizaciones viejas de otro almacén ya no valen
    }
    for (const origen of Object.keys(envio.porOrigen)) if (!Object.keys(envio.porOrigen[origen]).length) delete envio.porOrigen[origen];
    ficha.envio = envio;
    // Almacenes de la ficha: los que AliExpress ha dicho de verdad. El stock por almacén NO existe en AliExpress: se deja sin dato (nunca 0 inventado).
    const conocidos = new Set<string>([...Object.keys(envio.porOrigen).filter((o) => o !== "XX")]);
    ficha.origenes = [...conocidos].map((pais) => ({ pais, total: null }));
    const { error: eEnv } = await servicio.from("CatalogItemDetail").update({ ficha, raw: { ...((det.raw as any) ?? {}), envio: crudoEnvio }, fetchedAt: ahoraIso() }).eq("itemId", id);
    if (eEnv) return await fallo(`No se pudo guardar el envío: ${eEnv.message}`);
    for (const a of conocidos) await servicio.rpc("catalogo_anadir_almacen", { p_provider: PROVEEDOR, p_ids: [String(item.externalId)], p_almacen: a });

    // «Envío gratis» solo se afirma si TODOS los destinos cotizados tienen una opción gratuita (para el envío por API, no para ofertas personales de la app)
    const cotizados = Object.keys(envio.porOrigen).flatMap((o) => Object.keys(envio.porOrigen[o]));
    const destinosConOpciones = [...new Set(cotizados)];
    if (destinosConOpciones.length) {
      const todosGratis = destinosConOpciones.every((d) => Object.values(envio.porOrigen).some((m: any) => (m?.[d]?.opciones ?? []).some((o: any) => o.gratis)));
      await servicio.from("CatalogItem").update({ freeShipping: todosGratis, updatedAt: ahoraIso() }).eq("id", id);
    }

    const textoDestino = (d: string) => {
      const ops: any[] = Object.values(envio.porOrigen).flatMap((m: any) => m?.[d]?.opciones ?? []);
      const precios = ops.map((o) => o.precio).filter((x) => x !== null);
      const dMin = Math.min(...ops.map((o) => o.diasMin ?? 999));
      const dMax = Math.max(...ops.map((o) => o.diasMax ?? 0));
      const desde = [...new Set(ops.map((o) => o.origen).filter(Boolean))].join("/");
      return `${d} (${ops.length} ${ops.length === 1 ? "método" : "métodos"}, desde ${precios.length ? Math.min(...precios).toFixed(2) : "?"} USD, ${dMin === 999 ? "?" : dMin}-${dMax || "?"} días${desde ? `, sale de ${desde}` : ""})`;
    };
    const resumen = {
      "Según AliExpress": {
        conServicio: destinos.filter((d) => destinosConOpciones.includes(d)).map(textoDestino),
        sinServicio: destinos.filter((d) => envio.sinServicio[d]),
        pendientes: destinos.filter((d) => !destinosConOpciones.includes(d) && !envio.sinServicio[d]),
      },
    };
    return await cerrarOk({ mensaje: `${hechas} ${hechas === 1 ? "cotización nueva" : "cotizaciones nuevas"}`, resumen, avisos });
  }

  return responder({ ok: false, error: `Acción desconocida: ${accion}`, ...diagnostico });
});
