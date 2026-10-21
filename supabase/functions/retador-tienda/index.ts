/**
 * retador-tienda — Conexión de DropshipPilot con la tienda de un vendedor de Retador.
 *
 * Acciones (POST, JSON, con sesión de usuario):
 *   conectar {token}                       Guarda el token (cifrado) tras probarlo con Retador.
 *   desconectar {storeId}                  Olvida el token; los productos ya publicados siguen en Retador.
 *   config {storeId}                       Pide a Retador sus tarifas, categorías y límites.
 *   preparar {storeId, itemId}             Calcula coste puesto en Cuba y beneficio neto por variante (sin publicar).
 *   publicar {storeId, itemId, variantes, cat, subcat, provincia, contenido?}
 *   actualizar {productId, estado?, variantes?, contenido?}
 *   retirar {productId}
 *   estado {storeId}                       Compara lo que hay en Retador con lo guardado aquí.
 *
 * Reglas: el coste del proveedor nunca se envía a Retador; ningún número se inventa (stock desconocido = null);
 * si falta un dato real para calcular el beneficio, no se publica. Contrato: docs/contrato-retador.md.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  CODIGOS_TOKEN_MUERTO,
  ErrorRetador,
  cifrar,
  descifrar,
  esSimulado,
  htmlATexto,
  imagenPermitida,
  llamarRetador,
  recortar,
  tarifasDeConfig,
  tokenConFormato,
} from "./retador.ts";
import { costeParaPublicar, faltanParaPublicar, liquidacion, precioMinimoSinPerdida, type TarifasRetador } from "./retador-costes.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const responder = (cuerpo: unknown, estado = 200) =>
  new Response(JSON.stringify(cuerpo), { status: estado, headers: { ...CORS, "Content-Type": "application/json" } });

const servicio = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

class ErrorApp extends Error {
  constructor(public codigo: string, mensaje: string, public extra: Record<string, unknown> = {}) {
    super(mensaje);
  }
}

const redondear = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const ahora = () => new Date().toISOString();
const PROVEEDOR_RETADOR: Record<string, "cj" | "aliexpress"> = { CJ_DROPSHIPPING: "cj", ALIEXPRESS: "aliexpress" };
const ID_PROVEEDOR: Record<string, string> = { CJ_DROPSHIPPING: "proveedor-cj", ALIEXPRESS: "proveedor-aliexpress" };

/* ───────────────────────────── Tienda y token ───────────────────────────── */

async function tiendaPropia(uid: string, storeId: unknown, exigirConectada = true) {
  if (typeof storeId !== "string" || !storeId) throw new ErrorApp("datos_invalidos", "Indica la tienda");
  const { data: tienda } = await servicio.from("Store").select("*").eq("id", storeId).eq("userId", uid).maybeSingle();
  if (!tienda || tienda.platform !== "RETADOR") throw new ErrorApp("tienda_no_encontrada", "No se encontró tu tienda de Retador");
  if (exigirConectada && (tienda.status !== "CONNECTED" || !tienda.accessTokenEnc)) {
    throw new ErrorApp("tienda_desconectada", tienda.lastError || "La tienda de Retador no está conectada. Vuelve a conectarla con un token nuevo.");
  }
  return tienda;
}

/** Llama a Retador con el token de la tienda; si el token ya no vale, marca la tienda con error y lo explica. */
async function conRetador(tienda: any, accion: Parameters<typeof llamarRetador>[1], cuerpo: Record<string, unknown> = {}) {
  let token: string;
  try {
    token = await descifrar(tienda.accessTokenEnc);
  } catch (e) {
    await marcarTiendaConError(tienda.id, (e as Error).message);
    throw e;
  }
  try {
    return await llamarRetador(token, accion, cuerpo);
  } catch (e) {
    if (e instanceof ErrorRetador && CODIGOS_TOKEN_MUERTO.has(e.codigo)) await marcarTiendaConError(tienda.id, `${e.message} Vuelve a conectar Retador con un token nuevo.`);
    throw e;
  }
}

/** Si Retador dice que el producto ya no existe o fue eliminado, aquí queda archivado y con el motivo, en vez de seguir «activo». */
async function marcarProductoSiDesaparecio(productId: string, e: unknown) {
  if (e instanceof ErrorRetador && (e.codigo === "ref_no_encontrada" || e.codigo === "producto_eliminado")) {
    await servicio.from("Product").update({ status: "ARCHIVED", lastSyncStatus: "FAILED", lastSyncError: e.message, updatedAt: ahora() }).eq("id", productId);
  }
}

async function marcarTiendaConError(id: string, mensaje: string) {
  await servicio.from("Store").update({ status: "ERROR", lastError: mensaje, updatedAt: ahora() }).eq("id", id);
}

function vistaTienda(t: any) {
  return { id: t.id, platform: t.platform, name: t.name, domain: t.domain, status: t.status, lastPingAt: t.lastPingAt, lastError: t.lastError, settings: t.settings, simulada: Boolean(t.settings?.simulada) };
}

/** Guarda en la tienda lo que Retador dice de sí misma (solo informativo; las decisiones siempre releen la config). */
async function guardarConfig(tienda: any, cfg: any) {
  const ajustes = {
    ...(tienda.settings ?? {}),
    currency: "USD",
    plan: cfg.vendedor?.plan ?? null,
    productosUsados: cfg.vendedor?.productos_usados ?? null,
    topeProductos: cfg.vendedor?.tope_productos ?? null,
    tarifas: cfg.tarifas ?? null,
    categorias: cfg.categorias ?? [],
    provincias: cfg.provincias ?? [],
    limites: cfg.limites ?? null,
    stockSinDato: cfg.stock_sin_dato ?? null,
    cupoProveedorDiario: cfg.cupo_proveedor_diario ?? null,
    token: cfg.token ?? null,
    configActualizada: ahora(),
  };
  await servicio.from("Store").update({ settings: ajustes, status: "CONNECTED", lastError: null, lastPingAt: ahora(), updatedAt: ahora() }).eq("id", tienda.id);
  return ajustes;
}

/* ───────────────────────────── Datos del catálogo ───────────────────────────── */

async function leerCatalogo(itemId: unknown) {
  if (typeof itemId !== "string" || !itemId) throw new ErrorApp("datos_invalidos", "Indica el producto del catálogo");
  const { data: item } = await servicio.from("CatalogItem").select("id,provider,externalId,title,description,imageUrl,images,sourceUrl").eq("id", itemId).maybeSingle();
  if (!item) throw new ErrorApp("producto_no_encontrado", "Ese producto ya no está en el catálogo");
  const { data: detalle } = await servicio.from("CatalogItemDetail").select("ficha").eq("itemId", String(item.id)).maybeSingle();
  const ficha = detalle?.ficha;
  if (!ficha || !Array.isArray(ficha.variantes) || !ficha.variantes.length) {
    throw new ErrorApp("ficha_incompleta", "Primero hay que completar la ficha de este producto (variantes, peso y envío) desde el catálogo.");
  }
  const proveedor = PROVEEDOR_RETADOR[item.provider];
  if (!proveedor) throw new ErrorApp("proveedor_no_soportado", "Retador solo admite productos de CJ y AliExpress.");
  return { item, ficha, proveedor };
}

/** Envío real al hub de EE. UU.: la cotización más barata del producto hacia US entre sus orígenes. */
function envioAlHub(ficha: any): { precio: number; origen: string; dias: [number, number] | null } | null {
  let mejor: { precio: number; origen: string; dias: [number, number] | null } | null = null;
  const porOrigen = ficha?.envio?.porOrigen ?? {};
  for (const [origen, destinos] of Object.entries<any>(porOrigen)) {
    const opciones = destinos?.US?.opciones;
    if (!Array.isArray(opciones)) continue;
    for (const o of opciones) {
      if (typeof o?.precio !== "number" || !Number.isFinite(o.precio)) continue;
      if (!mejor || o.precio < mejor.precio) mejor = { precio: o.precio, origen, dias: typeof o.diasMin === "number" && typeof o.diasMax === "number" ? [o.diasMin, o.diasMax] : null };
    }
  }
  return mejor;
}

/** Stock REAL de una variante: AliExpress informa el de la variante; en CJ solo cuenta el de sus almacenes (no el de fábrica). Null = no se sabe. */
function stockVerificado(variante: any, proveedor: "cj" | "aliexpress"): number | null {
  const filas: any[] = Array.isArray(variante?.stock) ? variante.stock : [];
  if (proveedor === "aliexpress") {
    const totales = filas.map((f) => f?.total).filter((n) => typeof n === "number" && Number.isFinite(n));
    return totales.length ? Math.max(0, ...totales) : null;
  }
  const propios = filas.map((f) => f?.cj).filter((n) => typeof n === "number" && Number.isFinite(n));
  return propios.length ? propios.reduce((a: number, b: number) => a + b, 0) : null;
}

interface VariantePreparada {
  sku: string;
  vid: string | null;
  nombre: string;
  imagen: string | null;
  costeUsd: number | null;
  pesoGramos: number | null;
  stock: number | null;
  coste: ReturnType<typeof costeParaPublicar>;
  faltan: string[];
  precioMinimoUsd: number | null;
}

function prepararVariantes(ficha: any, proveedor: "cj" | "aliexpress", tarifas: TarifasRetador | null) {
  const hub = envioAlHub(ficha);
  const variantes: VariantePreparada[] = ficha.variantes.map((v: any) => {
    const peso = typeof v.pesoGramos === "number" && v.pesoGramos > 0 ? v.pesoGramos : typeof ficha?.peso?.gramos === "number" && ficha.peso.gramos > 0 ? ficha.peso.gramos : null;
    const entrada = { costeUsd: typeof v.precio === "number" ? v.precio : null, envioHubUsd: hub?.precio ?? null, pesoGramos: peso, tarifas };
    const coste = costeParaPublicar(entrada);
    return {
      sku: String(v.sku ?? ""),
      vid: v.vid ? String(v.vid) : null,
      nombre: String(v.nombreCompleto ?? v.nombre ?? v.sku ?? ""),
      imagen: typeof v.imagen === "string" ? v.imagen : null,
      costeUsd: entrada.costeUsd,
      pesoGramos: peso,
      stock: stockVerificado(v, proveedor),
      coste,
      faltan: faltanParaPublicar(entrada),
      precioMinimoUsd: coste && tarifas ? precioMinimoSinPerdida(coste.total, tarifas, coste.producto) : null,
    };
  });
  return { variantes, hub };
}

function contenidoPorDefecto(item: any, ficha: any) {
  const imagenes: string[] = (Array.isArray(ficha.imagenes) ? ficha.imagenes : Array.isArray(item.images) ? item.images : []).filter(imagenPermitida).slice(0, 9);
  const html = typeof ficha.descripcionHtml === "string" ? ficha.descripcionHtml : item.description ?? "";
  return { titulo: recortar(String(ficha.titulo ?? item.title ?? ""), 150), descripcion: htmlATexto(html), imagenes };
}

function validarTitulo(t: unknown): string {
  const titulo = typeof t === "string" ? t.trim() : "";
  if (!titulo) throw new ErrorApp("datos_invalidos", "El título no puede estar vacío", { campo: "titulo" });
  if (titulo.length > 150) throw new ErrorApp("datos_invalidos", "El título no puede pasar de 150 caracteres", { campo: "titulo" });
  return titulo;
}
function validarDescripcion(d: unknown): string {
  const descripcion = typeof d === "string" ? d.trim() : "";
  if (descripcion.length > 5000) throw new ErrorApp("datos_invalidos", "La descripción no puede pasar de 5000 caracteres", { campo: "descripcion" });
  return descripcion;
}
function validarImagenes(i: unknown): string[] {
  const imagenes = Array.isArray(i) ? i : [];
  if (!imagenes.length) throw new ErrorApp("datos_invalidos", "Hace falta al menos una foto", { campo: "imagenes" });
  if (imagenes.length > 9) throw new ErrorApp("datos_invalidos", "Como máximo 9 fotos", { campo: "imagenes" });
  if (imagenes.some((u: unknown) => !imagenPermitida(u))) throw new ErrorApp("datos_invalidos", "Una foto no es válida: solo se aceptan fotos https de AliExpress o CJ", { campo: "imagenes" });
  return imagenes as string[];
}

/** Completa con lo del proveedor lo que el vendedor no haya tocado, y valida todo. */
function contenidoFinal(entrada: any, base: ReturnType<typeof contenidoPorDefecto>) {
  const c = entrada && typeof entrada === "object" ? entrada : {};
  return {
    titulo: validarTitulo(c.titulo !== undefined ? c.titulo : base.titulo),
    descripcion: validarDescripcion(c.descripcion !== undefined ? c.descripcion : base.descripcion),
    imagenes: validarImagenes(c.imagenes !== undefined ? c.imagenes : base.imagenes),
  };
}

/* ───────────────────────────── Acciones ───────────────────────────── */

async function accionConectar(uid: string, cuerpo: any) {
  const token = typeof cuerpo.token === "string" ? cuerpo.token.trim() : "";
  if (!tokenConFormato(token)) throw new ErrorApp("token_invalido", "El token no tiene el formato correcto. Cópialo entero desde Retador (empieza por «dsp_»).");
  if (esSimulado(token)) {
    const { data: yo } = await servicio.from("User").select("role").eq("id", uid).maybeSingle();
    if (yo?.role !== "ADMIN") throw new ErrorApp("token_invalido", "Ese token no es válido.");
  }
  const cfg = await llamarRetador(token, "config");
  const { data: previa } = await servicio.from("Store").select("*").eq("userId", uid).eq("platform", "RETADOR").maybeSingle();
  const nombre = esSimulado(token) ? "Retador (simulado)" : "Retador";
  const base = { name: nombre, domain: "retadormarketplace.es", accessTokenEnc: await cifrar(token), status: "CONNECTED", lastPingAt: ahora(), lastError: null, scopes: ["publicar", "actualizar", "retirar", "estado"], updatedAt: ahora() };
  let tienda = previa;
  if (previa) {
    const { data, error } = await servicio.from("Store").update(base).eq("id", previa.id).select("*").single();
    if (error) throw new ErrorApp("error_interno", "No se pudo guardar la conexión");
    tienda = data;
  } else {
    const { data, error } = await servicio.from("Store").insert({ ...base, userId: uid, platform: "RETADOR", settings: { currency: "USD", simulada: esSimulado(token) } }).select("*").single();
    if (error) throw new ErrorApp("error_interno", "No se pudo guardar la conexión");
    tienda = data;
  }
  const ajustes = await guardarConfig({ ...tienda, settings: { ...(tienda.settings ?? {}), simulada: esSimulado(token) } }, cfg);
  return { tienda: vistaTienda({ ...tienda, settings: ajustes, status: "CONNECTED", lastError: null }) };
}

async function accionDesconectar(uid: string, cuerpo: any) {
  const tienda = await tiendaPropia(uid, cuerpo.storeId, false);
  await servicio.from("Store").update({ accessTokenEnc: null, status: "DISCONNECTED", lastError: null, updatedAt: ahora() }).eq("id", tienda.id);
  const { count } = await servicio.from("Product").select("id", { count: "exact", head: true }).eq("storeId", tienda.id).not("storeProductId", "is", null);
  return { productosEnRetador: count ?? 0, aviso: count ? "Tus productos siguen publicados en Retador, pero ya no se mantendrán actualizados desde aquí." : null };
}

async function accionConfig(uid: string, cuerpo: any) {
  const tienda = await tiendaPropia(uid, cuerpo.storeId);
  const cfg = await conRetador(tienda, "config");
  const ajustes = await guardarConfig(tienda, cfg);
  return { tienda: vistaTienda({ ...tienda, settings: ajustes, status: "CONNECTED", lastError: null }) };
}

async function accionPreparar(uid: string, cuerpo: any) {
  const tienda = await tiendaPropia(uid, cuerpo.storeId);
  const cfg = await conRetador(tienda, "config");
  await guardarConfig(tienda, cfg);
  const tarifas = tarifasDeConfig(cfg);
  const { item, ficha, proveedor } = await leerCatalogo(cuerpo.itemId);
  const { variantes, hub } = prepararVariantes(ficha, proveedor, tarifas);
  const { data: yaPublicado } = await servicio.from("Product").select("id,storeProductId,status").eq("storeId", tienda.id).eq("supplierProductId", item.externalId).maybeSingle();
  return {
    tarifas,
    categorias: cfg.categorias ?? [],
    provincias: cfg.provincias ?? [],
    vendedor: cfg.vendedor ?? null,
    proveedor,
    envioHub: hub,
    // País para el que se consultó el coste de la ficha: AliExpress en Retador cobra el precio para EE. UU.
    costeReferencia: { pais: typeof ficha?.precio?.pais === "string" ? ficha.precio.pais : null, proveedor },
    contenido: contenidoPorDefecto(item, ficha),
    variantes,
    yaPublicado: yaPublicado ? { productId: yaPublicado.id, estado: yaPublicado.status } : null,
  };
}

async function registrar(uid: string, storeId: string, productId: string | null, tipo: string, estado: "SUCCESS" | "FAILED", mensaje: string, cambios?: unknown) {
  await servicio.from("SyncLog").insert({ userId: uid, storeId, productId, type: tipo, status: estado, level: estado === "SUCCESS" ? "INFO" : "ERROR", message: mensaje, changes: cambios ?? null });
}

async function accionPublicar(uid: string, cuerpo: any) {
  const tienda = await tiendaPropia(uid, cuerpo.storeId);
  const cfg = await conRetador(tienda, "config");
  await guardarConfig(tienda, cfg);
  const tarifas = tarifasDeConfig(cfg);
  if (!tarifas) throw new ErrorApp("config_incompleta", "Retador no ha enviado sus tarifas, así que no se puede calcular tu beneficio. Inténtalo más tarde.");
  const { item, ficha, proveedor } = await leerCatalogo(cuerpo.itemId);

  // Categoría, subcategoría y provincia deben existir en Retador
  const cat = String(cuerpo.cat ?? "");
  const categoria = (cfg.categorias ?? []).find((c: any) => c.cat === cat);
  if (!categoria) throw new ErrorApp("datos_invalidos", "Elige una categoría de Retador", { campo: "cat" });
  const subcat = String(cuerpo.subcat ?? "");
  if (!subcat || !(categoria.subcategorias ?? []).includes(subcat)) throw new ErrorApp("datos_invalidos", "Elige una subcategoría de Retador", { campo: "subcat" });
  const provincia = String(cuerpo.provincia ?? "");
  if (!(cfg.provincias ?? []).includes(provincia)) throw new ErrorApp("datos_invalidos", "Elige una provincia", { campo: "provincia" });

  // Variantes elegidas: cada sku debe existir y tener beneficio calculable y positivo
  const elegidas: any[] = Array.isArray(cuerpo.variantes) ? cuerpo.variantes : [];
  if (!elegidas.length || elegidas.length > 12) throw new ErrorApp("datos_invalidos", "Elige entre 1 y 12 variantes", { campo: "variantes" });
  const { variantes } = prepararVariantes(ficha, proveedor, tarifas);
  const porSku = new Map(variantes.map((v) => [v.sku, v]));
  const vistos = new Set<string>();
  const lineas = elegidas.map((e) => {
    const v = porSku.get(String(e?.sku ?? ""));
    if (!v) throw new ErrorApp("sku_inexistente", `La variante «${e?.sku}» no existe en este producto`, { sku: e?.sku });
    if (vistos.has(v.sku)) throw new ErrorApp("datos_invalidos", `La variante «${v.sku}» está repetida`, { campo: "variantes" });
    vistos.add(v.sku);
    const precio = Number(e.precioVentaUsd);
    if (!Number.isFinite(precio) || precio <= 0) throw new ErrorApp("datos_invalidos", `Pon un precio válido a «${v.nombre}»`, { sku: v.sku });
    if (!v.coste) throw new ErrorApp("faltan_datos", `No se puede calcular tu beneficio de «${v.nombre}»: falta ${v.faltan.join(", ")}. Completa la ficha del producto y vuelve a intentarlo.`, { sku: v.sku, faltan: v.faltan });
    const liq = liquidacion(redondear(precio), v.coste.total, tarifas, v.coste.producto);
    if (liq.neto < 0 || precio < precioMinimoSinPerdida(v.coste.total, tarifas, v.coste.producto)) throw new ErrorApp("precio_bajo_minimo", `«${v.nombre}»: ese precio queda por debajo del mínimo. Mínimo: ${precioMinimoSinPerdida(v.coste.total, tarifas, v.coste.producto).toFixed(2)} USD (coste puesto en Cuba y sin pérdida tras comisión).`, { sku: v.sku, minimoUsd: precioMinimoSinPerdida(v.coste.total, tarifas, v.coste.producto) });
    return { v, precio: redondear(precio), liq };
  });

  const contenido = contenidoFinal(cuerpo.contenido, contenidoPorDefecto(item, ficha));
  const { data: yaExiste } = await servicio.from("Product").select("id").eq("storeId", tienda.id).eq("supplierProductId", item.externalId).maybeSingle();
  if (yaExiste) throw new ErrorApp("ya_publicado", "Este producto ya está publicado en tu tienda de Retador. Edítalo desde «Productos».", { productId: yaExiste.id });

  // Registro local en borrador (la restricción única evita publicar dos veces a la vez).
  // Product tiene un índice único (usuario, sourceUrl): el fragmento «#tienda-…» (no cambia el enlace) permite el mismo producto en tiendas distintas.
  const productId = crypto.randomUUID();
  const ref = `dsp:${tienda.id}:${productId}`;
  const minima = lineas.reduce((a, b) => (b.precio < a.precio ? b : a));
  const { error: eProd } = await servicio.from("Product").insert({
    id: productId, userId: uid, storeId: tienda.id, supplierId: ID_PROVEEDOR[item.provider], supplierProductId: item.externalId,
    sourceUrl: `${ficha.enlace ?? item.sourceUrl ?? ""}#tienda-${tienda.id.slice(0, 8)}`, title: contenido.titulo, description: contenido.descripcion, category: categoria.nombre ?? cat,
    currency: "USD", costPrice: minima.v.coste!.producto, shippingCost: redondear(minima.v.coste!.envioHub + minima.v.coste!.hubCuba), sellingPrice: minima.precio,
    marginPct: minima.liq.margenNetoPct, profitAmount: minima.liq.neto, stockTotal: 0, status: "DRAFT", lastSyncStatus: "RUNNING", updatedAt: ahora(),
  });
  if (eProd) {
    if (eProd.code === "23505") throw new ErrorApp("ya_publicado", "Este producto ya se está publicando en tu tienda. Espera un momento.");
    throw new ErrorApp("error_interno", "No se pudo preparar la publicación");
  }
  await servicio.from("ProductVariant").insert(lineas.map(({ v, precio }, i) => ({
    productId, supplierVariantId: v.vid, sku: v.sku, title: v.nombre, costPrice: v.coste!.producto, shippingCost: redondear(v.coste!.envioHub + v.coste!.hubCuba),
    sellingPrice: precio, stock: v.stock ?? 0, stockVerificado: v.stock === null ? null : true, weightGrams: v.pesoGramos ? Math.round(v.pesoGramos) : null,
    imageUrl: v.imagen, position: i, storeVariantId: v.sku, isActive: true, updatedAt: ahora(),
  })));
  await servicio.from("ProductImage").insert(contenido.imagenes.map((url, i) => ({ productId, url, position: i, isMain: i === 0 })));

  const deshacer = async () => {
    await servicio.from("ProductImage").delete().eq("productId", productId);
    await servicio.from("ProductVariant").delete().eq("productId", productId);
    await servicio.from("Product").delete().eq("id", productId);
  };

  let remoto: any;
  try {
    remoto = await conRetador(tienda, "publicar", {
      ref, proveedor, pid: item.externalId,
      variantes: lineas.map(({ v, precio }) => ({ sku: v.sku, precio_venta_usd: precio, stock: v.stock })),
      cat, subcat, provincia, contenido,
    });
  } catch (e) {
    await deshacer();
    const mensaje = e instanceof ErrorRetador ? e.message : (e as Error).message;
    await registrar(uid, tienda.id, null, "IMPORT", "FAILED", `No se pudo publicar «${contenido.titulo}» en Retador: ${mensaje}`);
    throw e;
  }

  // Lo que Retador confirma manda sobre lo que pedimos (stock estimado, precios finales)
  const confirmadas = new Map<string, any>((remoto.variantes ?? []).map((x: any) => [String(x.sku), x]));
  for (const { v, precio } of lineas) {
    const r = confirmadas.get(v.sku);
    await servicio.from("ProductVariant").update({
      sellingPrice: typeof r?.precio_venta_usd === "number" ? r.precio_venta_usd : precio,
      stock: typeof r?.stock === "number" ? r.stock : v.stock ?? 0,
      stockVerificado: r ? (r.stock_estimado ? false : v.stock === null ? null : true) : v.stock === null ? null : true,
      lastSyncedAt: ahora(), updatedAt: ahora(),
    }).eq("productId", productId).eq("sku", v.sku);
  }
  const stockTotal = lineas.reduce((s, { v }) => s + (confirmadas.get(v.sku)?.stock ?? v.stock ?? 0), 0);
  await servicio.from("Product").update({
    storeProductId: remoto.producto_id, storeHandle: remoto.url ?? null, status: remoto.estado === "pausado" ? "PAUSED" : remoto.estado === "agotado" ? "OUT_OF_STOCK" : "ACTIVE", stockTotal,
    lastSyncedAt: ahora(), lastSyncStatus: "SUCCESS", lastSyncError: null,
    rawPayload: { retador: { ref, moderacion: remoto.moderacion ?? null, publicadoEn: ahora(), origenUltimoCambio: "dropship" } }, updatedAt: ahora(),
  }).eq("id", productId);
  await registrar(uid, tienda.id, productId, "IMPORT", "SUCCESS", `Publicado en Retador: «${contenido.titulo}»`, { variantes: lineas.length, ref });
  return { productId, productoRetador: remoto.producto_id, url: remoto.url ?? null, estado: remoto.estado, moderacion: remoto.moderacion ?? null, variantes: remoto.variantes ?? [] };
}

async function productoPropio(uid: string, productId: unknown) {
  if (typeof productId !== "string" || !productId) throw new ErrorApp("datos_invalidos", "Indica el producto");
  const { data: p } = await servicio.from("Product").select("*").eq("id", productId).eq("userId", uid).maybeSingle();
  if (!p || !p.storeId || !p.storeProductId) throw new ErrorApp("producto_no_encontrado", "Ese producto no está publicado en Retador");
  const tienda = await tiendaPropia(uid, p.storeId);
  return { p, tienda, ref: `dsp:${tienda.id}:${p.id}` };
}

async function accionActualizar(uid: string, cuerpo: any) {
  const { p, tienda, ref } = await productoPropio(uid, cuerpo.productId);
  const envio: Record<string, unknown> = { ref };
  const cambios: string[] = [];
  if (cuerpo.estado !== undefined) {
    if (cuerpo.estado !== "activo" && cuerpo.estado !== "pausado") throw new ErrorApp("datos_invalidos", "El estado debe ser «activo» o «pausado»", { campo: "estado" });
    envio.estado = cuerpo.estado;
    cambios.push(`estado → ${cuerpo.estado}`);
  }
  if (Array.isArray(cuerpo.variantes) && cuerpo.variantes.length) {
    const cfg = await conRetador(tienda, "config");
    const tarifas = tarifasDeConfig(cfg);
    const { data: locales } = await servicio.from("ProductVariant").select("sku,costPrice,shippingCost,sellingPrice,stock").eq("productId", p.id);
    const porSku = new Map((locales ?? []).map((v: any) => [v.sku, v]));
    envio.variantes = cuerpo.variantes.map((e: any) => {
      const local: any = porSku.get(String(e?.sku ?? ""));
      if (!local) throw new ErrorApp("sku_no_pertenece", `La variante «${e?.sku}» no es de este producto`, { sku: e?.sku });
      const salida: Record<string, unknown> = { sku: local.sku };
      if (e.precioVentaUsd !== undefined) {
        const precio = redondear(Number(e.precioVentaUsd));
        if (!Number.isFinite(precio) || precio <= 0) throw new ErrorApp("datos_invalidos", "Pon un precio válido", { sku: local.sku });
        if (tarifas) {
          const coste = Number(local.costPrice) + Number(local.shippingCost);
          const minimo = precioMinimoSinPerdida(coste, tarifas, Number(local.costPrice));
          if (precio < minimo) throw new ErrorApp("precio_bajo_minimo", `Con ${precio.toFixed(2)} USD queda por debajo del mínimo en «${local.sku}». Mínimo: ${minimo.toFixed(2)} USD.`, { sku: local.sku, minimoUsd: minimo });
        }
        salida.precio_venta_usd = precio;
        cambios.push(`${local.sku}: precio ${precio.toFixed(2)}`);
      }
      if (e.stock !== undefined) {
        if (e.stock !== null && (!Number.isInteger(e.stock) || e.stock < 0)) throw new ErrorApp("datos_invalidos", "El stock debe ser un entero de 0 o más (o null si no se sabe)", { sku: local.sku });
        salida.stock = e.stock;
        cambios.push(`${local.sku}: stock ${e.stock ?? "sin dato"}`);
      }
      return salida;
    });
  }
  if (cuerpo.contenido && typeof cuerpo.contenido === "object") {
    const c = cuerpo.contenido;
    const parcial: Record<string, unknown> = {};
    if (c.titulo !== undefined) parcial.titulo = validarTitulo(c.titulo);
    if (c.descripcion !== undefined) parcial.descripcion = validarDescripcion(c.descripcion);
    if (c.imagenes !== undefined) parcial.imagenes = validarImagenes(c.imagenes);
    if (Object.keys(parcial).length) {
      envio.contenido = parcial;
      cambios.push("contenido");
    }
  }
  if (cambios.length === 0) throw new ErrorApp("datos_invalidos", "No hay nada que actualizar");

  let remoto: any;
  try {
    remoto = await conRetador(tienda, "actualizar", envio);
  } catch (e) {
    await servicio.from("Product").update({ lastSyncStatus: "FAILED", lastSyncError: (e as Error).message, updatedAt: ahora() }).eq("id", p.id);
    await marcarProductoSiDesaparecio(p.id, e);
    await registrar(uid, tienda.id, p.id, "PRICE_UPDATE", "FAILED", `No se pudo actualizar en Retador: ${(e as Error).message}`);
    throw e;
  }
  await aplicarRemotoALocal(p.id, remoto);
  if ((envio.contenido as any)?.titulo) await servicio.from("Product").update({ title: (envio.contenido as any).titulo }).eq("id", p.id);
  if ((envio.contenido as any)?.descripcion !== undefined) await servicio.from("Product").update({ description: (envio.contenido as any).descripcion }).eq("id", p.id);
  if ((envio.contenido as any)?.imagenes) {
    await servicio.from("ProductImage").delete().eq("productId", p.id);
    await servicio.from("ProductImage").insert((envio.contenido as any).imagenes.map((url: string, i: number) => ({ productId: p.id, url, position: i, isMain: i === 0 })));
  }
  await registrar(uid, tienda.id, p.id, "PRICE_UPDATE", "SUCCESS", `Actualizado en Retador (${cambios.join("; ")})`, { cambios });
  return { productId: p.id, estado: remoto.estado, variantes: remoto.variantes ?? [] };
}

/** Copia a las tablas locales lo que Retador confirma tras publicar o actualizar. */
async function aplicarRemotoALocal(productId: string, remoto: any) {
  const estado = remoto.estado === "pausado" ? "PAUSED" : remoto.estado === "agotado" ? "OUT_OF_STOCK" : remoto.estado === "eliminado" ? "ARCHIVED" : "ACTIVE";
  let total = 0;
  for (const r of remoto.variantes ?? []) {
    const cambios: Record<string, unknown> = { lastSyncedAt: ahora(), updatedAt: ahora() };
    if (typeof r.precio_venta_usd === "number") cambios.sellingPrice = r.precio_venta_usd;
    if (typeof r.stock === "number") {
      cambios.stock = r.stock;
      cambios.stockVerificado = r.stock_estimado ? false : true;
      total += r.stock;
    }
    await servicio.from("ProductVariant").update(cambios).eq("productId", productId).eq("sku", r.sku);
  }
  await servicio.from("Product").update({
    status: estado, stockTotal: total, lastSyncedAt: ahora(), lastSyncStatus: "SUCCESS", lastSyncError: null, updatedAt: ahora(),
  }).eq("id", productId);
}

async function accionRetirar(uid: string, cuerpo: any) {
  const { p, tienda, ref } = await productoPropio(uid, cuerpo.productId);
  let remoto: any;
  try {
    remoto = await conRetador(tienda, "retirar", { ref });
  } catch (e) {
    await marcarProductoSiDesaparecio(p.id, e);
    throw e;
  }
  await servicio.from("Product").update({ status: "PAUSED", lastSyncedAt: ahora(), lastSyncStatus: "SUCCESS", lastSyncError: null, updatedAt: ahora() }).eq("id", p.id);
  await registrar(uid, tienda.id, p.id, "DELETE", "SUCCESS", "Producto retirado (pausado) en Retador");
  return { productId: p.id, estado: remoto.estado ?? "pausado" };
}

async function accionEstado(uid: string, cuerpo: any) {
  const tienda = await tiendaPropia(uid, cuerpo.storeId);
  const { data: productos } = await servicio.from("Product").select("id,title,status,storeProductId,sellingPrice,updatedAt").eq("storeId", tienda.id).not("storeProductId", "is", null).limit(100);
  if (!productos?.length) return { productos: [], diferencias: [] };
  const remoto = await conRetador(tienda, "estado", { refs: productos.map((p: any) => `dsp:${tienda.id}:${p.id}`) });
  const diferencias: any[] = [];
  for (const r of remoto.productos ?? []) {
    const id = String(r.ref ?? "").split(":")[2];
    if (!id) continue;
    if (!r.existe) {
      diferencias.push({ productId: id, tipo: "no_existe", mensaje: "Este producto ya no existe en Retador" });
      continue;
    }
    if (r.origen_ultimo_cambio === "vendedor") diferencias.push({ productId: id, tipo: "cambiado_en_retador", mensaje: "Cambiaste este producto a mano en Retador. Revisa precio y stock antes de volver a sincronizarlo." });
    await aplicarRemotoALocal(id, r);
    await servicio.from("Product").update({ rawPayload: { retador: { moderacion: r.moderacion ?? null, vendidos: r.vendidos ?? 0, pedidosPendientes: r.pedidos_pendientes ?? 0, origenUltimoCambio: r.origen_ultimo_cambio ?? null, actualizadoEn: r.actualizado_en ?? null } } }).eq("id", id);
  }
  return { productos: remoto.productos ?? [], diferencias };
}

/* ───────────────────────────── Entrada ───────────────────────────── */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return responder({ ok: false, codigo: "metodo", error: "Usa POST" }, 405);

  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  // Llamada interna del servidor (monitor programado y pruebas): con la clave de servicio, que solo vive en el servidor,
  // se puede actuar en nombre de un usuario concreto indicado en la cabecera `x-usuario`.
  const interna = jwt !== "" && jwt === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  let uid: string | undefined;
  if (interna) uid = req.headers.get("x-usuario") ?? undefined;
  else uid = (await servicio.auth.getUser(jwt)).data?.user?.id;
  if (!uid) return responder({ ok: false, codigo: "sesion", error: "Sesión no válida" }, 401);

  let cuerpo: any = {};
  try {
    cuerpo = await req.json();
  } catch {
    return responder({ ok: false, codigo: "datos_invalidos", error: "El cuerpo no es JSON" });
  }
  const accion = String(cuerpo?.accion ?? "");

  try {
    const acciones: Record<string, (uid: string, c: any) => Promise<unknown>> = {
      conectar: accionConectar, desconectar: accionDesconectar, config: accionConfig, preparar: accionPreparar,
      publicar: accionPublicar, actualizar: accionActualizar, retirar: accionRetirar, estado: accionEstado,
    };
    const f = acciones[accion];
    if (!f) return responder({ ok: false, codigo: "accion_desconocida", error: `Acción desconocida: ${accion}` });
    const resultado = await f(uid, cuerpo);
    return responder({ ok: true, ...(resultado as object) });
  } catch (e) {
    if (e instanceof ErrorApp) return responder({ ok: false, codigo: e.codigo, error: e.message, ...e.extra });
    if (e instanceof ErrorRetador) return responder({ ok: false, codigo: e.codigo, error: e.message, ...e.extra, origen: "retador" });
    console.error("retador-tienda", accion, (e as Error)?.message);
    return responder({ ok: false, codigo: "error_interno", error: "Ocurrió un error inesperado. Inténtalo de nuevo; si sigue igual, avisa a soporte." });
  }
});
