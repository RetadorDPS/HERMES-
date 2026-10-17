/**
 * cj-catalogo — Catálogo de CJ Dropshipping (API v2) hacia las tablas CatalogItem, CatalogCategory y CatalogItemDetail.
 *
 * Misma lógica que el cliente original (src/lib/supplier-apis/cj.ts y syncCatalog de src/lib/catalog/index.ts):
 *   · token con la clave de CJ (se reutiliza; guardado en PlatformCredential.settings, tabla sin permisos para los clientes),
 *   · product/listV2 para el listado, product/getCategory para las categorías,
 *   · product/query, variantes, inventario por almacén, logistic/freightCalculate y reseñas para la ficha completa.
 *
 * Acciones (solo administrador):
 *   probar      → comprueba la clave y obtiene el token
 *   categorias  → baja las categorías con nombre y las aplica a los artículos
 *   descargar   → baja páginas de productos (en serie, con pausa)
 *   detalle     → completa la ficha de varios artículos (detalle, variantes, stock, envío por país, reseñas)
 *
 * Límite de CJ: 1 petición por segundo. TODAS las llamadas pasan por `cj()`, que espera entre una y otra.
 * Las claves viven como secretos de la función (CJ_API_KEY): nunca se devuelven ni se guardan en tablas legibles.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const BASE = "https://developers.cjdropshipping.com/api2.0/v1";
const PROVEEDOR = "CJ_DROPSHIPPING";
const PAUSA_MS = 1_300; // CJ admite 1 petición por segundo
/** Destinos que se cotizan por defecto (el usuario puede pedir cualquier otro código de país). */
const DESTINOS_DEFECTO = ["ES", "US", "MX", "GB", "DE", "FR", "IT", "CA", "AU", "BR", "CO", "CL"];
const MAX_COTIZACIONES = 30; // por llamada de la función (unos 40 s con la pausa)
const MAX_ORIGENES = 6;
const FRESCURA_ENVIO_MS = 24 * 3_600_000; // una cotización de menos de 24 h no se repite
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const responder = (cuerpo: unknown, estado = 200) =>
  new Response(JSON.stringify(cuerpo), { status: estado, headers: { ...CORS, "Content-Type": "application/json" } });

const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ahoraIso = () => new Date().toISOString();

function secretosVistos() {
  return Object.keys(Deno.env.toObject()).filter((n) => /^(CJ|ALI)/i.test(n)).sort();
}

/* ───────────── Utilidades de normalización (defensivas: la API de CJ no es uniforme) ───────────── */

function primerNumero(v: unknown): number {
  const m = String(v ?? "").match(/\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : 0;
}
function numeroONulo(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
/** Acepta una lista, un texto JSON con lista o un texto separado por ; , | */
function listaDeTextos(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  if (typeof v !== "string" || !v.trim()) return [];
  const t = v.trim();
  if (t.startsWith("[")) {
    try {
      const a = JSON.parse(t);
      if (Array.isArray(a)) return a.map((x) => String(x).trim()).filter(Boolean);
    } catch { /* se sigue con el separador */ }
  }
  return t.split(/[;,|]/).map((x) => x.trim()).filter(Boolean);
}
function sinRepetidos(a: string[]) {
  return [...new Set(a)];
}
function rangoDias(texto: unknown): { min: number | null; max: number | null } {
  const m = String(texto ?? "").match(/(\d+)\s*[-–~]\s*(\d+)/);
  if (m) return { min: Number(m[1]), max: Number(m[2]) };
  const u = String(texto ?? "").match(/(\d+)/);
  return u ? { min: Number(u[1]), max: Number(u[1]) } : { min: null, max: null };
}
function extraerLista(data: any): any[] {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.list)) return data.list;
  if (Array.isArray(data?.content)) {
    return data.content.flatMap((c: any) => (Array.isArray(c?.productList) ? c.productList : c?.pid || c?.id ? [c] : []));
  }
  return [];
}

function normalizarListado(item: any, pais: string | null, nombresCategoria: Map<string, string>) {
  const id = String(item.id ?? item.pid ?? item.productId ?? "");
  const imagenes = sinRepetidos(listaDeTextos(item.bigImage ?? item.productImage));
  const pedidos = numeroONulo(item.listedNum ?? item.ordersCount);
  const categoriaId = item.categoryId ? String(item.categoryId) : null;
  return {
    provider: PROVEEDOR,
    externalId: id,
    title: String(item.nameEn ?? item.productNameEn ?? item.productName ?? "Producto CJ").slice(0, 250),
    description: String(item.description ?? item.remark ?? "").slice(0, 5000),
    categoryId: categoriaId,
    categoryName: (categoriaId && nombresCategoria.get(categoriaId)) || item.threeCategoryName || item.twoCategoryName || item.oneCategoryName || item.categoryName || null,
    imageUrl: imagenes[0] ?? null,
    images: imagenes.slice(0, 8),
    currency: "USD",
    costPrice: primerNumero(item.sellPrice ?? item.nowPrice ?? item.variantSellPrice ?? item.price),
    stock: Number(item.warehouseInventoryNum ?? item.totalVerifiedInventory ?? item.variantStock ?? item.stock ?? 0) || 0,
    ordersCount: pedidos,
    shipFrom: pais,
    // «Envío gratis» ya NO se toma de `addMarkStatus` (marcaba como gratis productos que cotizan 5 USD): lo deduce la base de datos
    // de las cotizaciones guardadas. «Top ventas» se calcula al consultar, por proveedor. Aquí no se afirma ninguna de las dos cosas.
    rawPayload: item,
    sourceUrl: `https://cjdropshipping.com/product/-p-${id}.html`,
    source: "api",
    lastSyncedAt: ahoraIso(),
    updatedAt: ahoraIso(),
  };
}

/** Aplana el árbol de categorías de CJ (3 niveles). Devuelve solo las hojas con identificador. */
function aplanarCategorias(nodos: any[], ruta: string[] = []): { id: string; nombre: string; ruta: string }[] {
  const CLAVES_HIJOS = ["categoryFirstList", "categorySecondList", "categoryThirdList", "children", "categoryList", "childCategoryList", "subCategories", "list"];
  const salida: { id: string; nombre: string; ruta: string }[] = [];
  for (const n of Array.isArray(nodos) ? nodos : []) {
    const nombre = String(n.categoryName ?? n.categoryThirdName ?? n.categorySecondName ?? n.categoryFirstName ?? n.name ?? n.categoryNameEn ?? "").trim();
    const id = String(n.categoryId ?? n.id ?? n.categoryCode ?? "").trim();
    const hijos = CLAVES_HIJOS.flatMap((k) => (Array.isArray(n?.[k]) ? n[k] : []));
    const nuevaRuta = nombre ? [...ruta, nombre] : ruta;
    if (id && nombre && !hijos.length) salida.push({ id, nombre, ruta: ruta.join(" › ") });
    if (hijos.length) salida.push(...aplanarCategorias(hijos, nuevaRuta));
  }
  return salida;
}
const slug = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60);

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

  const claveCruda = Deno.env.get("CJ_API_KEY") ?? "";
  const apiKey = claveCruda.trim().replace(/^["']|["']$/g, "");
  const diagnostico = {
    secretoCjApiKey: Boolean(apiKey),
    secretosVistos: secretosVistos(),
    formaClave: { longitud: apiKey.length, tieneEspaciosOSaltos: /\s/.test(claveCruda.trim()), contieneArrobaApi: apiKey.includes("@api@"), sobrabanEspaciosAlBorde: claveCruda !== claveCruda.trim() },
  };
  if (!apiKey) return responder({ ok: false, error: "Falta el secreto CJ_API_KEY en las funciones de Supabase", ...diagnostico });

  // ── Fila del proveedor (estado, cuota y token) ──
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
  let ajustes: any = fila.settings ?? {};
  let llamadas = 0;
  // La última llamada a CJ también se recuerda entre una pulsación y la siguiente (CJ limita por segundo y por IP)
  let ultimaLlamada = Number(ajustes.ultimaLlamada) || 0;
  const guardarAjustes = async (extra: Record<string, unknown>) => {
    ajustes = { ...ajustes, ...extra };
    await servicio.from("PlatformCredential").update({ settings: ajustes, updatedAt: ahoraIso() }).eq("provider", PROVEEDOR);
  };

  const marcarError = async (mensaje: string) => {
    await servicio.from("PlatformCredential").update({ status: "ERROR", lastError: mensaje.slice(0, 500), lastTestAt: ahoraIso(), updatedAt: ahoraIso() }).eq("provider", PROVEEDOR);
    await guardarAjustes({ ultimaLlamada });
  };

  /** ÚNICA puerta hacia CJ: respeta 1 petición por segundo. */
  async function http(url: string, init: RequestInit = {}) {
    const espera = ultimaLlamada + PAUSA_MS - Date.now();
    if (espera > 0) await pausa(espera);
    const control = new AbortController();
    const t = setTimeout(() => control.abort(), 25_000);
    try {
      const res = await fetch(url, { ...init, signal: control.signal });
      const json: any = await res.json().catch(() => ({}));
      return { res, json };
    } finally {
      ultimaLlamada = Date.now();
      llamadas += 1;
      clearTimeout(t);
    }
  }

  // ── Token (180 días en CJ; se reutiliza) ──
  let token: string;
  let tokenReutilizado = false;
  if (ajustes.accessToken && ajustes.accessTokenExpira && new Date(ajustes.accessTokenExpira).getTime() > Date.now() + 86_400_000) {
    token = String(ajustes.accessToken);
    tokenReutilizado = true;
  } else {
    const { res, json } = await http(`${BASE}/authentication/getAccessToken`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiKey }) });
    if (!json?.result || !json?.data?.accessToken) {
      const mensaje = `CJ rechazó la clave: ${String(json?.message ?? `HTTP ${res.status}`)}`;
      await marcarError(mensaje);
      return responder({ ok: false, error: mensaje, codigoCj: json?.code ?? null, ...diagnostico });
    }
    token = String(json.data.accessToken);
    await guardarAjustes({ accessToken: token, accessTokenExpira: json.data.accessTokenExpiryDate ?? null, refreshToken: json.data.refreshToken ?? null });
  }

  /** Llamada a un endpoint de CJ con el token. Devuelve { ok, datos, mensaje }. */
  async function cj(ruta: string, opc: { metodo?: "GET" | "POST"; consulta?: Record<string, string | number | undefined>; cuerpo?: unknown } = {}, intento = 1): Promise<{ ok: boolean; datos: any; mensaje: string; codigo: any }> {
    const url = new URL(`${BASE}${ruta}`);
    for (const [k, v] of Object.entries(opc.consulta ?? {})) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    const { res, json } = await http(url.toString(), {
      method: opc.metodo ?? "GET",
      headers: { "CJ-Access-Token": token, "Content-Type": "application/json" },
      body: opc.cuerpo ? JSON.stringify(opc.cuerpo) : undefined,
    });
    if (json?.result === false || !res.ok) {
      const mensaje = String(json?.message ?? `HTTP ${res.status}`);
      // CJ limita las peticiones por segundo y por IP: se espera de verdad y se reintenta (máximo 3 veces)
      if ((res.status === 429 || /too many requests/i.test(mensaje)) && intento < 3) {
        await pausa(2_500 * intento);
        return await cj(ruta, opc, intento + 1);
      }
      return { ok: false, datos: null, mensaje, codigo: json?.code ?? null };
    }
    return { ok: true, datos: json?.data ?? json, mensaje: "", codigo: null };
  }

  const nombresDeCategorias = async () => {
    const mapa = new Map<string, string>();
    const { data } = await servicio.from("CatalogCategory").select("externalId,name").eq("provider", PROVEEDOR).limit(5000);
    for (const c of data ?? []) mapa.set(String(c.externalId), String(c.name));
    return mapa;
  };

  const cerrarOk = async (extra: Record<string, unknown>) => {
    await servicio.from("PlatformCredential").update({ status: "CONNECTED", lastError: null, lastTestAt: ahoraIso(), usedThisMonth: (fila.usedThisMonth ?? 0) + llamadas, updatedAt: ahoraIso() }).eq("provider", PROVEEDOR);
    await guardarAjustes({ ultimaLlamada });
    return responder({ ok: true, tokenReutilizado, llamadasACj: llamadas, ...extra, ...diagnostico });
  };

  if (fila.monthlyQuota && fila.usedThisMonth >= fila.monthlyQuota) {
    return responder({ ok: false, error: `Cuota mensual agotada (${fila.usedThisMonth}/${fila.monthlyQuota})`, ...diagnostico });
  }

  /* ───────────────────────────── probar ───────────────────────────── */
  if (accion === "probar") {
    return await cerrarOk({ mensaje: "Clave de CJ válida: se obtuvo el token" });
  }

  /* ───────────────────────────── categorías ───────────────────────────── */
  if (accion === "categorias") {
    const r = await cj("/product/getCategory");
    if (!r.ok) {
      await marcarError(`CJ respondió con error: ${r.mensaje}`);
      return responder({ ok: false, error: `CJ respondió con error: ${r.mensaje}`, ...diagnostico });
    }
    const d: any = r.datos;
    const raices = d?.categoryFirstList ?? d?.categoryList ?? d?.categories ?? d?.list ?? d ?? [];
    const hojas = aplanarCategorias(Array.isArray(raices) ? raices : []);
    if (!hojas.length) return responder({ ok: false, error: "CJ devolvió las categorías en un formato que no se pudo leer", formaDatos: Object.keys(d ?? {}), ...diagnostico });
    const filas = hojas.map((h, i) => ({ provider: PROVEEDOR, externalId: h.id, name: h.nombre, slug: slug(h.nombre), parentName: h.ruta || null, sortOrder: i, updatedAt: ahoraIso() }));
    for (let i = 0; i < filas.length; i += 300) {
      const { error } = await servicio.from("CatalogCategory").upsert(filas.slice(i, i + 300), { onConflict: "provider,externalId" });
      if (error) return responder({ ok: false, error: `No se pudieron guardar las categorías: ${error.message}`, ...diagnostico });
    }
    // Aplica el nombre a los artículos ya descargados
    const { data: items } = await servicio.from("CatalogItem").select("id,categoryId").eq("provider", PROVEEDOR).not("categoryId", "is", null).limit(5000);
    const mapa = new Map(hojas.map((h) => [h.id, h.nombre]));
    let actualizados = 0;
    for (const it of items ?? []) {
      const nombre = mapa.get(String(it.categoryId));
      if (nombre) {
        await servicio.from("CatalogItem").update({ categoryName: nombre }).eq("id", it.id);
        actualizados += 1;
      }
    }
    return await cerrarOk({ mensaje: `${filas.length} categorías guardadas · ${actualizados} productos con su categoría`, categorias: filas.length, productosActualizados: actualizados });
  }

  /* ───────────────────────────── descargar ───────────────────────────── */
  if (accion === "descargar") {
    const tamano = Math.max(1, Math.min(Number(cuerpo?.tamano ?? 50), 100));
    const paginas = Math.max(1, Math.min(Number(cuerpo?.paginas ?? 1), 5));
    const desde = Math.max(1, Number(cuerpo?.paginaInicial ?? 1));
    const pais: string | null = cuerpo?.pais ? String(cuerpo.pais).toUpperCase().slice(0, 2) : null; // sin país = catálogo global
    const palabra: string | undefined = cuerpo?.palabra ? String(cuerpo.palabra).slice(0, 80) : undefined;
    const categoryId: string | undefined = cuerpo?.categoryId ? String(cuerpo.categoryId) : undefined;
    // Orden de CJ: 0 mejor coincidencia · 1 más listados (populares) · 2 precio · 3 fecha · 4 inventario. Por defecto los más populares.
    const orden = Number.isFinite(Number(cuerpo?.orden)) && cuerpo?.orden !== undefined ? Number(cuerpo.orden) : 1;
    const nombres = await nombresDeCategorias();

    let recibidos = 0;
    let guardados = 0;
    let totalRegistros: number | null = null;
    let primeraForma: string[] = [];
    const avisos: string[] = [];
    for (let p = desde; p < desde + paginas; p += 1) {
      const r = await cj("/product/listV2", {
        consulta: { page: p, size: tamano, countryCode: pais ?? undefined, orderBy: palabra ? 0 : orden, sort: "desc", keyWord: palabra, categoryId },
      });
      if (!r.ok) {
        const mensaje = `CJ respondió con error en la página ${p}: ${r.mensaje}`;
        if (p === desde) {
          await marcarError(mensaje);
          return responder({ ok: false, error: mensaje, codigoCj: r.codigo, ...diagnostico });
        }
        avisos.push(mensaje);
        break;
      }
      const d: any = r.datos;
      if (p === desde) {
        primeraForma = Object.keys(d ?? {});
        totalRegistros = numeroONulo(d?.totalRecords ?? d?.total);
      }
      const lista = extraerLista(d);
      recibidos += lista.length;
      const filas = lista.map((i) => normalizarListado(i, pais, nombres)).filter((f) => f.externalId);
      if (filas.length) {
        const { error } = await servicio.from("CatalogItem").upsert(filas, { onConflict: "provider,externalId" });
        if (error) {
          await marcarError(`No se pudo guardar el catálogo: ${error.message}`);
          return responder({ ok: false, error: `No se pudo guardar el catálogo: ${error.message}`, ...diagnostico });
        }
        guardados += filas.length;
        // Descargar por almacén: CJ solo devuelve productos con existencias en ese país, así que se anota el almacén en cada uno
        if (pais) await servicio.rpc("catalogo_anadir_almacen", { p_provider: PROVEEDOR, p_ids: filas.map((f: any) => f.externalId), p_almacen: pais });
      }
      if (lista.length < tamano) break; // última página
    }
    return await cerrarOk({
      mensaje: `${recibidos} recibidos de CJ · ${guardados} guardados`,
      recibidos, guardados, totalEnCj: totalRegistros, avisos, forma: { claves: primeraForma },
    });
  }

  /* ───────────────────────────── detalle (ficha completa) ───────────────────────────── */
  if (accion === "detalle") {
    const ids: string[] = (Array.isArray(cuerpo?.ids) ? cuerpo.ids : []).map(String).slice(0, 3);
    if (!ids.length) return responder({ ok: false, error: "Indica al menos un artículo", ...diagnostico });

    const { data: items } = await servicio.from("CatalogItem").select("id,externalId,title,images,description").eq("provider", PROVEEDOR).in("id", ids);
    const informe: any[] = [];

    for (const item of items ?? []) {
      const pid = String(item.externalId);
      const avisos: string[] = [];
      const crudo: Record<string, unknown> = {};

      // 1) Detalle del producto
      const q = await cj("/product/query", { consulta: { pid } });
      if (!q.ok) {
        informe.push({ id: item.id, ok: false, error: `Detalle: ${q.mensaje}` });
        continue;
      }
      const prod: any = q.datos ?? {};
      crudo.producto = prod;

      // 2) Variantes (la ruta actual y, si falla, la antigua del cliente original)
      let rv = await cj("/product/variant/query", { consulta: { pid } });
      if (!rv.ok) rv = await cj("/product/variant/queryByPid", { consulta: { pid } });
      const variantesCrudas: any[] = rv.ok ? (Array.isArray(rv.datos) ? rv.datos : extraerLista(rv.datos)) : [];
      if (!rv.ok) avisos.push(`Variantes: ${rv.mensaje}`);
      crudo.variantes = rv.ok ? rv.datos : { error: rv.mensaje };

      // 3) Inventario por almacén
      const ri = await cj("/product/stock/getInventoryByPid", { consulta: { pid } });
      if (!ri.ok) avisos.push(`Inventario: ${ri.mensaje}`);
      crudo.inventario = ri.ok ? ri.datos : { error: ri.mensaje };

      // (El envío mundial se cotiza aparte con la acción «envio»: es una matriz origen × destino.)
      const { data: previa } = await servicio.from("CatalogItemDetail").select("ficha,raw").eq("itemId", item.id).maybeSingle();
      const envioPrevio = (previa?.ficha as any)?.envio ?? { porOrigen: {} };

      // 5) Reseñas
      const rr = await cj("/product/productComments", { consulta: { pid, pageNum: 1, pageSize: 20 } });
      if (!rr.ok) avisos.push(`Reseñas: ${rr.mensaje}`);
      crudo.resenas = rr.ok ? rr.datos : { error: rr.mensaje };
      const listaResenas: any[] = rr.ok ? extraerLista(rr.datos) : [];
      const resenas = listaResenas.map((c: any) => ({
        usuario: c.commentUser ?? c.userName ?? null,
        pais: c.countryCode ?? null,
        puntuacion: numeroONulo(c.score),
        fecha: c.commentDate ?? null,
        texto: String(c.comment ?? c.content ?? ""),
        fotos: listaDeTextos(c.commentUrls),
      }));
      const puntuadas = resenas.filter((r) => r.puntuacion !== null);
      const media = puntuadas.length ? Math.round((puntuadas.reduce((a, r) => a + (r.puntuacion as number), 0) / puntuadas.length) * 100) / 100 : null;
      const totalResenas = numeroONulo((rr.ok ? (rr.datos as any)?.total : null)) ?? resenas.length;

      // ── Inventario normalizado (por variante, si trae identificador) ──
      const inventarioLista: any[] = ri.ok ? (Array.isArray(ri.datos) ? ri.datos : Array.isArray((ri.datos as any)?.inventories) ? (ri.datos as any).inventories : extraerLista(ri.datos)) : [];
      const almacenes = inventarioLista.map((w: any) => ({
        vid: w.vid ?? null,
        almacen: w.areaEn ?? w.warehouseName ?? w.storageName ?? null,
        pais: w.countryCode ?? null,
        total: numeroONulo(w.totalInventoryNum ?? w.totalInventory ?? w.totalNum),
        cj: numeroONulo(w.cjInventoryNum ?? w.cjInventory),
        fabrica: numeroONulo(w.factoryInventoryNum ?? w.factoryInventory),
      }));

      // Existencias de cada variante por país de almacén
      const invVariantes: any[] = ri.ok && Array.isArray((ri.datos as any)?.variantInventories) ? (ri.datos as any).variantInventories : [];
      const stockDeVariante = (vid: string | null) =>
        vid
          ? (invVariantes.find((x: any) => String(x.vid) === vid)?.inventory ?? []).map((w: any) => ({ pais: w.countryCode ?? null, total: numeroONulo(w.totalInventory), cj: numeroONulo(w.cjInventory), fabrica: numeroONulo(w.factoryInventory) }))
          : [];

      // Países con stock (almacenes de origen), de mayor a menor existencias
      const porPaisStock = new Map<string, number>();
      for (const a of almacenes) if (a.pais) porPaisStock.set(String(a.pais).toUpperCase(), (porPaisStock.get(String(a.pais).toUpperCase()) ?? 0) + (a.total ?? 0));
      const origenes = [...porPaisStock.entries()].map(([pais, total]) => ({ pais, total })).sort((x, y) => y.total - x.total);

      const imagenes = sinRepetidos([...listaDeTextos(prod.productImageSet), ...listaDeTextos(prod.productImage), ...listaDeTextos(prod.bigImage)]);
      const variantes = variantesCrudas.map((v: any) => {
        const vid = v.vid ? String(v.vid) : null;
        return {
          vid,
          nombre: String(v.variantKey ?? v.variantNameEn ?? v.variantName ?? "Variante"),
          nombreCompleto: String(v.variantNameEn ?? v.variantName ?? ""),
          sku: v.variantSku ?? null,
          clave: v.variantKey ?? null,
          precio: numeroONulo(v.variantSellPrice),
          pesoGramos: numeroONulo(v.variantWeight),
          largoMm: numeroONulo(v.variantLength),
          anchoMm: numeroONulo(v.variantWidth),
          altoMm: numeroONulo(v.variantHeight),
          volumen: numeroONulo(v.variantVolume),
          imagen: v.variantImage ?? null,
          propiedad: v.variantProperty ?? null,
          estandar: v.variantStandard ?? null,
          stock: stockDeVariante(vid),
        };
      });
      const precios = variantes.map((v) => v.precio).filter((p): p is number => p !== null);

      const ficha = {
        proveedor: PROVEEDOR,
        pid,
        sku: prod.productSku ?? prod.sku ?? null,
        titulo: String(prod.productNameEn ?? prod.nameEn ?? item.title),
        categoria: { id: prod.categoryId ?? null, ruta: String(prod.categoryName ?? "").split("/").map((x) => x.trim()).filter(Boolean) },
        imagenes,
        descripcionHtml: String(prod.description ?? item.description ?? ""),
        peso: { gramos: numeroONulo(prod.productWeight), conEmbalaje: prod.packingWeight ?? null },
        materiales: listaDeTextos(prod.materialNameEnSet ?? prod.materialNameEn ?? prod.materialName),
        embalaje: listaDeTextos(prod.packingNameEnSet ?? prod.packingNameEn ?? prod.packingName),
        caracteristicasEnvio: listaDeTextos(prod.productProEnSet ?? prod.productProEn ?? prod.productPro), // p. ej. HAVE_LIQUID, HAVE_BATTERY
        opcionesProducto: listaDeTextos(prod.productKeyEn ?? prod.productKey), // p. ej. Color, Talla
        precioSugeridoCj: prod.suggestSellPrice ?? null,
        proveedorCj: prod.supplierName ?? null,
        videos: listaDeTextos(prod.productVideo),
        unidad: prod.productUnit ?? null,
        tipo: prod.productType ?? null, // p. ej. SUPPLIER_SHIPPED_PRODUCT
        precio: { moneda: "USD", min: precios.length ? Math.min(...precios) : numeroONulo(prod.sellPrice), max: precios.length ? Math.max(...precios) : numeroONulo(prod.sellPrice) },
        variantes,
        almacenes: almacenes.filter((a) => !a.vid),
        origenes,
        envio: envioPrevio,
        resenas: { total: totalResenas, media, lista: resenas },
        enlace: `https://cjdropshipping.com/product/-p-${pid}.html`,
        fuentes: { detalle: true, variantes: rv.ok, inventario: ri.ok, resenas: rr.ok },
        avisos,
        actualizado: ahoraIso(),
      };

      const { error: eDet } = await servicio.from("CatalogItemDetail").upsert({ itemId: item.id, ficha, raw: { ...((previa?.raw as any) ?? {}), ...crudo }, fetchedAt: ahoraIso() }, { onConflict: "itemId" });
      if (eDet) {
        informe.push({ id: item.id, ok: false, error: `No se pudo guardar la ficha: ${eDet.message}` });
        continue;
      }

      // Los almacenes con existencias de la ficha pasan también al catálogo (es lo que usa el filtro «Almacén de salida»)
      for (const o of origenes) if ((o.total ?? 0) > 0 && o.pais) await servicio.rpc("catalogo_anadir_almacen", { p_provider: PROVEEDOR, p_ids: [String(item.externalId)], p_almacen: String(o.pais).toUpperCase() });

      // Lo más importante sube también a la tarjeta del catálogo
      const cambios: Record<string, unknown> = { updatedAt: ahoraIso() };
      if (imagenes.length) { cambios.images = imagenes.slice(0, 12); cambios.imageUrl = imagenes[0]; }
      if (ficha.descripcionHtml) cambios.description = ficha.descripcionHtml.slice(0, 5000);
      if (media !== null) cambios.rating = media;
      await servicio.from("CatalogItem").update(cambios).eq("id", item.id);

      informe.push({
        id: item.id, ok: true, titulo: ficha.titulo,
        imagenes: imagenes.length, variantes: variantes.length, almacenes: almacenes.length,
        origenes: origenes.map((o) => `${o.pais}:${o.total}`),
        resenas: resenas.length, avisos,
      });
    }
    return await cerrarOk({ mensaje: `${informe.filter((i) => i.ok).length} de ${informe.length} fichas completadas`, informe });
  }

  /* ───────────────────────────── envío mundial (origen × destino) ───────────────────────────── */
  if (accion === "envio") {
    const id = String((Array.isArray(cuerpo?.ids) ? cuerpo.ids[0] : cuerpo?.id) ?? "");
    if (!id) return responder({ ok: false, error: "Indica el artículo", ...diagnostico });
    const destinos: string[] = (Array.isArray(cuerpo?.paises) && cuerpo.paises.length ? cuerpo.paises : DESTINOS_DEFECTO).map((p: string) => String(p).toUpperCase().slice(0, 2));
    const { data: det } = await servicio.from("CatalogItemDetail").select("ficha,raw").eq("itemId", id).maybeSingle();
    if (!det) return responder({ ok: false, error: "Primero hay que completar la ficha de este artículo", ...diagnostico });
    const ficha: any = det.ficha ?? {};
    const variantes: any[] = (ficha.variantes ?? []).filter((v: any) => v?.vid);
    if (!variantes.length) return responder({ ok: false, error: "El artículo no tiene variantes con identificador para cotizar", ...diagnostico });
    const vid = String(cuerpo?.vid ?? [...variantes].sort((a, b) => (a.precio ?? 1e9) - (b.precio ?? 1e9))[0].vid);

    // Almacenes de origen: los pedidos explícitamente, o los que tienen stock, o China por defecto
    const pedidos: string[] = Array.isArray(cuerpo?.origenes) ? cuerpo.origenes.map((p: string) => String(p).toUpperCase().slice(0, 2)) : [];
    const conStock: string[] = (ficha.origenes ?? []).filter((o: any) => (o.total ?? 0) > 0).map((o: any) => String(o.pais));
    const origenes = (pedidos.length ? pedidos : conStock.length ? conStock : ["CN"]).slice(0, MAX_ORIGENES);
    const forzar = cuerpo?.forzar === true;

    const envio: any = { origen: ficha.envio?.origen ?? null, porOrigen: { ...(ficha.envio?.porOrigen ?? {}) } };
    const crudoEnvio: Record<string, any> = { ...(((det.raw as any)?.envio) ?? {}) };
    const avisos: string[] = [];
    let hechas = 0;
    for (const origen of origenes) {
      envio.porOrigen[origen] = { ...(envio.porOrigen[origen] ?? {}) };
      crudoEnvio[origen] = { ...(crudoEnvio[origen] ?? {}) };
      for (const destino of destinos) {
        const previa = envio.porOrigen[origen][destino];
        if (!forzar && previa && Date.now() - new Date(previa.actualizado).getTime() < FRESCURA_ENVIO_MS && !(previa.error && /too many/i.test(previa.error))) continue; // ya cotizado hace poco
        if (hechas >= MAX_COTIZACIONES) { if (!avisos.length) avisos.push(`Se alcanzó el máximo de ${MAX_COTIZACIONES} cotizaciones por vez: vuelve a pulsar para seguir con lo que falta`); break; }
        const rf = await cj("/logistic/freightCalculate", { metodo: "POST", cuerpo: { startCountryCode: origen, endCountryCode: destino, products: [{ quantity: 1, vid }] } });
        hechas += 1;
        if (!rf.ok) {
          envio.porOrigen[origen][destino] = { variante: vid, actualizado: ahoraIso(), opciones: [], error: rf.mensaje };
          crudoEnvio[origen][destino] = { error: rf.mensaje };
          continue;
        }
        crudoEnvio[origen][destino] = rf.datos;
        const opciones = (Array.isArray(rf.datos) ? rf.datos : [rf.datos]).filter(Boolean).map((o: any) => {
          const dias = rangoDias(o.logisticAging ?? o.aging ?? o.arrivalTime);
          return { nombre: String(o.logisticName ?? o.name ?? "Envío CJ"), precio: numeroONulo(o.logisticPrice ?? o.price ?? o.postage), diasMin: dias.min, diasMax: dias.max, textoDias: o.logisticAging ?? o.aging ?? o.arrivalTime ?? null };
        });
        envio.porOrigen[origen][destino] = { variante: vid, actualizado: ahoraIso(), opciones };
      }
    }
    ficha.envio = envio;
    const { error: eEnv } = await servicio.from("CatalogItemDetail").update({ ficha, raw: { ...((det.raw as any) ?? {}), envio: crudoEnvio }, fetchedAt: ahoraIso() }).eq("itemId", id);
    if (eEnv) return responder({ ok: false, error: `No se pudo guardar el envío: ${eEnv.message}`, ...diagnostico });
    const resumen = Object.fromEntries(
      origenes.map((o) => {
        const con: string[] = [];
        const sin: string[] = [];
        const faltan: string[] = [];
        for (const d of destinos) {
          const x = envio.porOrigen[o]?.[d];
          if (!x) faltan.push(d);
          else if (x.error || !x.opciones.length) sin.push(d);
          else {
            const precios = x.opciones.map((p: any) => p.precio).filter((p: any) => p !== null);
            const dMin = Math.min(...x.opciones.map((p: any) => p.diasMin ?? 999));
            const dMax = Math.max(...x.opciones.map((p: any) => p.diasMax ?? 0));
            con.push(`${d} (${x.opciones.length} ${x.opciones.length === 1 ? "método" : "métodos"}, desde ${precios.length ? Math.min(...precios).toFixed(2) : "?"} USD, ${dMin === 999 ? "?" : dMin}-${dMax || "?"} días)`);
          }
        }
        return [o, { conServicio: con, sinServicio: sin, pendientes: faltan }];
      }),
    );
    return await cerrarOk({ mensaje: `${hechas} cotizaciones nuevas (almacenes ${origenes.join(", ")} → ${destinos.length} destinos)`, resumen, avisos });
  }

  return responder({ ok: false, error: `Acción desconocida: ${accion}`, ...diagnostico });
});
