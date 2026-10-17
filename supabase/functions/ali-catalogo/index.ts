/**
 * ali-catalogo — Catálogo de AliExpress (Open Platform · Dropshipping) hacia CatalogItem y CatalogItemDetail.
 *
 * Es independiente de la función de CJ (cj-catalogo): no comparte código ni tablas de estado con ella.
 * Sigue el cliente original (src/lib/supplier-apis/aliexpress.ts): firma HMAC-SHA256 de todos los parámetros con el
 * App Secret, feed curado `aliexpress.ds.recommend.feed.get`, detalle `aliexpress.ds.product.get` y envío
 * `aliexpress.ds.freight.query`.
 *
 * Acciones (solo administrador): probar · feeds · descargar · detalle · envio
 *
 * Límite: AliExpress corta con `AppApiCallLimit` si se llama en paralelo o muy deprisa. TODAS las llamadas pasan
 * por `ali()`, una a una y con pausa. Las claves viven como secretos (ALIEXPRESS_APP_KEY, ALIEXPRESS_APP_SECRET) y nunca se devuelven.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

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

  // ── Solo administradores ──
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth } = await servicio.auth.getUser(jwt);
  const uid = auth?.user?.id;
  if (!uid) return responder({ ok: false, error: "Sesión no válida" }, 401);
  const { data: yo } = await servicio.from("User").select("role").eq("id", uid).maybeSingle();
  if (yo?.role !== "ADMIN") return responder({ ok: false, error: "Solo el administrador puede usar el catálogo de proveedores" }, 403);

  const cuerpo = await req.json().catch(() => ({}));
  const accion: string = cuerpo?.accion ?? "probar";

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

  /* ───────────────────────── probar ───────────────────────── */
  if (accion === "probar") {
    const r = await ali("aliexpress.ds.recommend.feed.get", { feed_name: "DS bestseller", target_currency: MONEDA, target_language: "ES", country: "ES", page_size: 1, page_no: 1 });
    if (!r.ok) return await fallo(`AliExpress rechazó la prueba: ${r.mensaje}`, { codigoAli: r.codigo, detalleError: r.crudo });
    return await cerrarOk({ mensaje: "App Key y App Secret válidos: AliExpress respondió", formaRespuesta: Object.keys(r.datos ?? {}) });
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
    const feed = String(cuerpo?.feed ?? "DS bestseller").slice(0, 80);
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
            freeShipping: false,
            isTrending: (pedidos ?? 0) > 5000,
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
      const variantes = skus.map((s: any, i: number) => {
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
          largoMm: numeroONulo(paquete.package_length) !== null ? (numeroONulo(paquete.package_length) as number) * 10 : null,
          anchoMm: numeroONulo(paquete.package_width) !== null ? (numeroONulo(paquete.package_width) as number) * 10 : null,
          altoMm: numeroONulo(paquete.package_height) !== null ? (numeroONulo(paquete.package_height) as number) * 10 : null,
          imagen: imagenSku,
          stock: stock !== null ? [{ pais: null, total: stock, cj: null, fabrica: null }] : [],
        };
      });
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
        precio: { moneda: MONEDA, min: precios.length ? Math.min(...precios) : null, max: precios.length ? Math.max(...precios) : null },
        variantes,
        almacenes: [],
        origenes: [],
        envio: (previa?.ficha as any)?.envio ?? { porOrigen: {} },
        resenas: { total: totalResenas, media: valoracion, lista: [] },
        enlace: `https://www.aliexpress.com/item/${pid}.html`,
        fuentes: { detalle: true, variantes: variantes.length > 0, inventario: stockTotal > 0, resenas: totalResenas !== null },
        avisos: variantes.length ? [] : ["AliExpress no devolvió variantes: puede hacer falta la autorización de la cuenta"],
        actualizado: ahoraIso(),
      };
      const { error: eDet } = await servicio.from("CatalogItemDetail").upsert({ itemId: item.id, ficha, raw: { ...((previa?.raw as any) ?? {}), producto: nodo }, fetchedAt: ahoraIso() }, { onConflict: "itemId" });
      if (eDet) {
        informe.push({ id: item.id, ok: false, error: `No se pudo guardar la ficha: ${eDet.message}` });
        continue;
      }
      const cambios: Record<string, unknown> = { updatedAt: ahoraIso() };
      if (imagenes.length) { cambios.images = imagenes.slice(0, 12); cambios.imageUrl = imagenes[0]; }
      if (ficha.descripcionHtml) cambios.description = ficha.descripcionHtml.slice(0, 5000);
      if (stockTotal > 0) cambios.stock = stockTotal;
      if (valoracion !== null) cambios.rating = valoracion;
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
    const envio: any = { origen: ficha.envio?.origen ?? null, porOrigen: { ...(ficha.envio?.porOrigen ?? {}) } };
    const crudoEnvio: Record<string, any> = { ...(((det.raw as any)?.envio) ?? {}) };
    const avisos: string[] = [];
    let hechas = 0;
    for (const destino of destinos) {
      const previa = envio.porOrigen.CN?.[destino];
      if (previa && !cuerpo?.forzar && Date.now() - new Date(previa.actualizado).getTime() < 24 * 3_600_000) continue;
      if (hechas >= MAX_COTIZACIONES) { avisos.push(`Se alcanzó el máximo de ${MAX_COTIZACIONES} cotizaciones por vez: vuelve a pulsar para seguir`); break; }
      const r = await ali("aliexpress.ds.freight.query", {
        queryDeliveryReq: JSON.stringify({ productId: String(item.externalId), quantity: "1", shipToCountry: destino, selectedSkuId: sku?.vid ?? "", language: "es_ES", currency: MONEDA, locale: "es_ES" }),
      });
      hechas += 1;
      envio.porOrigen.CN = envio.porOrigen.CN ?? {};
      crudoEnvio.CN = crudoEnvio.CN ?? {};
      if (!r.ok) {
        envio.porOrigen.CN[destino] = { variante: sku?.vid ?? null, actualizado: ahoraIso(), opciones: [], error: r.mensaje };
        crudoEnvio.CN[destino] = { error: r.mensaje, detalle: r.crudo };
        continue;
      }
      crudoEnvio.CN[destino] = r.datos;
      const nodo = r.datos?.aliexpress_ds_freight_query_response?.result ?? r.datos?.aliexpress_ds_freight_query_response ?? {};
      const opciones = lista(nodo.delivery_options?.delivery_option_d_t_o ?? nodo.delivery_options).map((o: any) => ({
        nombre: String(o.company ?? o.service_name ?? o.code ?? "Envío AliExpress"),
        precio: numeroONulo(o.shipping_fee ?? o.freight_amount?.amount ?? o.shipping_fee_cent),
        diasMin: numeroONulo(o.min_delivery_days ?? o.delivery_time_min),
        diasMax: numeroONulo(o.max_delivery_days ?? o.delivery_time_max ?? o.delivery_date_desc),
        textoDias: o.delivery_date_desc ?? null,
      }));
      envio.porOrigen.CN[destino] = { variante: sku?.vid ?? null, actualizado: ahoraIso(), opciones };
    }
    ficha.envio = envio;
    ficha.origenes = ficha.origenes?.length ? ficha.origenes : [{ pais: "CN", total: 0 }];
    const { error: eEnv } = await servicio.from("CatalogItemDetail").update({ ficha, raw: { ...((det.raw as any) ?? {}), envio: crudoEnvio }, fetchedAt: ahoraIso() }).eq("itemId", id);
    if (eEnv) return await fallo(`No se pudo guardar el envío: ${eEnv.message}`);
    const resumen = Object.fromEntries([["CN", {
      conServicio: destinos.filter((d) => envio.porOrigen.CN?.[d]?.opciones?.length).map((d) => `${d} (${envio.porOrigen.CN[d].opciones.length} métodos)`),
      sinServicio: destinos.filter((d) => envio.porOrigen.CN?.[d] && !envio.porOrigen.CN[d].opciones?.length),
      pendientes: destinos.filter((d) => !envio.porOrigen.CN?.[d]),
    }]]);
    return await cerrarOk({ mensaje: `${hechas} cotizaciones nuevas`, resumen, avisos });
  }

  return responder({ ok: false, error: `Acción desconocida: ${accion}`, ...diagnostico });
});
