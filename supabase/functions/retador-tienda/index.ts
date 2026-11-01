/**
 * retador-tienda — Conexión de DropshipPilot con la tienda de un vendedor de Retador.
 *
 * Acciones (POST, JSON, con sesión de usuario):
 *   conectar {token}                       Guarda el token (cifrado) tras probarlo con Retador.
 *   desconectar {storeId}                  Olvida el token; los productos ya publicados siguen en Retador.
 *   config {storeId}                       Pide a Retador sus tarifas, categorías y límites.
 *   preparar {storeId, itemId}             Calcula coste puesto en Cuba y beneficio neto por variante (sin publicar).
 *   publicar {storeId, itemId, variantes, cat, subcat, contenido?}  (provincia ya no: los importados se envían desde fuera)
 *   actualizar {productId, estado?, variantes?, contenido?, resenas?, envio?}
 *   retirar {productId}
 *   estado {storeId}                       Compara lo que hay en Retador con lo guardado aquí.
 *   precio_auto {productId, activo, confirmar?}  Activa o apaga el precio automático de un producto (sigue la regla de precios del vendedor
 *                                          con frenos). Sin `confirmar` solo enseña cómo quedarían los precios; con `confirmar` los aplica.
 *   sincronizar {productId, retirado?}     Empuja a Retador lo que cambió en el proveedor (stock, variantes retiradas, envío por país,
 *                                          opiniones). Con el precio automático apagado el precio NUNCA se cambia solo: si el coste sube y el precio ya no vale, se pausa y se avisa.
 *                                          Lo pide `monitor-proveedor` (vía interna) tras revisar al proveedor.
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
import { envioAlHub, stockPorOrigen } from "./retador-stock.ts";
import { efectoDeCancelacion, normalizarPedido, parsearRef } from "./retador-pedidos.ts";
import { resenasParaRetador } from "./resenas.ts";
import { envioParaRetador, huellaEnvio, type EnvioParaRetador } from "./retador-envio.ts";
import { huellaResenas, planificarSincronizacion } from "./retador-sync.ts";
import { decidirPrecioAuto } from "./retador-precio-auto.ts";
import { reglaDeFila } from "./reglas-precio.ts";

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

/**
 * Deja un producto «fuera de Retador» sin bloquear que se vuelva a importar: si nunca tuvo pedidos se borra la fila
 * (sus variantes e imágenes se van con ella); si tuvo pedidos se conserva archivada para no perder el historial, pero se le
 * libera el identificador del proveedor y el enlace (que son únicos), sale de la lista de productos de Retador y se guarda el original en `rawPayload.archivado`.
 */
async function liberarProducto(productId: string, motivo: string) {
  const { data: p } = await servicio.from("Product").select("id,supplierProductId,storeProductId,sourceUrl,rawPayload").eq("id", productId).maybeSingle();
  if (!p) return;
  const { count } = await servicio.from("OrderItem").select("id", { count: "exact", head: true }).eq("productId", productId);
  if (!count) {
    await servicio.from("Product").delete().eq("id", productId);
    return;
  }
  await servicio.from("Product").update({
    status: "ARCHIVED", supplierProductId: null, storeProductId: null, sourceUrl: `${String(p.sourceUrl ?? "").split("#archivado-")[0]}#archivado-${productId.slice(0, 8)}`,
    rawPayload: { ...(p.rawPayload ?? {}), archivado: { supplierProductId: p.supplierProductId ?? p.rawPayload?.archivado?.supplierProductId ?? null, storeProductId: p.storeProductId ?? p.rawPayload?.archivado?.storeProductId ?? null, en: ahora(), motivo } },
    lastSyncStatus: "FAILED", lastSyncError: motivo, updatedAt: ahora(),
  }).eq("id", productId);
}

async function marcarProductoSiDesaparecio(productId: string, e: unknown) {
  if (e instanceof ErrorRetador && (e.codigo === "ref_no_encontrada" || e.codigo === "producto_eliminado")) await liberarProducto(productId, e.message);
}

/**
 * ¿Sigue el producto publicado en Retador? Si Retador dice que ya no existe (el vendedor lo eliminó allí), se libera aquí
 * y se devuelve null para que se pueda volver a importar. Ante cualquier duda (fallo de red) se supone que sigue publicado.
 */
async function publicadoVigente(tienda: any, supplierProductId: string) {
  const { data: y } = await servicio.from("Product").select("id,storeProductId,status").eq("storeId", tienda.id).eq("supplierProductId", supplierProductId).maybeSingle();
  if (!y) return null;
  if (y.status === "ARCHIVED") {
    await liberarProducto(y.id, "Producto archivado");
    return null;
  }
  if (!y.storeProductId) return y;
  try {
    const r = await conRetador(tienda, "estado", { refs: [`dsp:${tienda.id}:${y.id}`] });
    const f = (r.productos ?? [])[0];
    if (f && (f.existe === false || f.estado === "eliminado")) {
      await liberarProducto(y.id, "Ya no existe en Retador");
      return null;
    }
  } catch {
    /* sin respuesta de Retador: se mantiene como publicado */
  }
  return y;
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
    capacidades: cfg.capacidades ?? null,
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

interface VariantePreparada {
  sku: string;
  vid: string | null;
  nombre: string;
  imagen: string | null;
  costeUsd: number | null;
  pesoGramos: number | null;
  stock: number | null;
  stockAlmacen: number | null;
  stockFabrica: number | null;
  /** Almacenes que tienen existencias de esta variante (solo CJ; en AliExpress el almacén lo decide cada cotización). */
  origenesConStock: string[];
  coste: ReturnType<typeof costeParaPublicar>;
  faltan: string[];
  precioMinimoUsd: number | null;
}

function prepararVariantes(ficha: any, proveedor: "cj" | "aliexpress", tarifas: TarifasRetador | null) {
  const hub = envioAlHub(ficha);
  const variantes: VariantePreparada[] = ficha.variantes.map((v: any) => {
    const peso = typeof v.pesoGramos === "number" && v.pesoGramos > 0 ? v.pesoGramos : typeof ficha?.peso?.gramos === "number" && ficha.peso.gramos > 0 ? ficha.peso.gramos : null;
    const existencias = stockPorOrigen(v, proveedor);
    // El envío debe estar cotizado DESDE el almacén que tiene el stock (en AliExpress lo decide la cotización)
    const origenesConStock = new Set([...existencias.origenes].filter(([, n]) => n > 0).map(([o]) => o));
    const hubVariante = proveedor === "cj" ? envioAlHub(ficha, origenesConStock) : hub;
    const entrada = { costeUsd: typeof v.precio === "number" ? v.precio : null, envioHubUsd: hubVariante?.precio ?? null, pesoGramos: peso, tarifas };
    // Sin stock no se publica (da igual si está en almacén o en fábrica) y tampoco sin envío cotizado desde donde sale
    const bloqueos: string[] = [];
    if (existencias.total === null) bloqueos.push("existencias (el proveedor no informa su stock)");
    else if (existencias.total <= 0) bloqueos.push("existencias (sin stock ni en almacén ni en fábrica)");
    else if (!hubVariante) bloqueos.push("envío cotizado desde el almacén que tiene el stock");
    const costeCalculado = costeParaPublicar(entrada);
    const faltan = bloqueos.length ? bloqueos : faltanParaPublicar(entrada);
    const coste = bloqueos.length ? null : costeCalculado;
    return {
      sku: String(v.sku ?? ""),
      vid: v.vid ? String(v.vid) : null,
      nombre: String(v.nombreCompleto ?? v.nombre ?? v.sku ?? ""),
      imagen: typeof v.imagen === "string" ? v.imagen : null,
      costeUsd: entrada.costeUsd,
      pesoGramos: peso,
      stock: existencias.total,
      stockAlmacen: existencias.almacen,
      stockFabrica: existencias.fabrica,
      origenesConStock: [...origenesConStock],
      coste,
      faltan,
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
  const yaPublicado = await publicadoVigente(tienda, item.externalId);
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

async function registrar(uid: string, storeId: string, productId: string | null, tipo: string, estado: "SUCCESS" | "FAILED", mensaje: string, cambios?: unknown, nivel?: "INFO" | "WARN" | "ERROR") {
  await servicio.from("SyncLog").insert({ userId: uid, storeId, productId, type: tipo, status: estado, level: nivel ?? (estado === "SUCCESS" ? "INFO" : "ERROR"), message: mensaje, changes: cambios ?? null });
}

/** Mezcla datos en `rawPayload.retador` sin pisar el resto (un valor `null` borra la clave). */
async function fusionarRetador(productId: string, parche: Record<string, unknown>) {
  const { data } = await servicio.from("Product").select("rawPayload").eq("id", productId).maybeSingle();
  const raw: any = data?.rawPayload ?? {};
  const retador: Record<string, unknown> = { ...(raw.retador ?? {}), ...parche };
  for (const k of Object.keys(retador)) if (retador[k] === null) delete retador[k];
  await servicio.from("Product").update({ rawPayload: { ...raw, retador }, updatedAt: ahora() }).eq("id", productId);
}

/** Regla de precios del vendedor (la predeterminada, o la primera), igual que la que usa la pantalla; sin regla propia, la de por defecto (40 %). */
async function reglaDelUsuario(uid: string) {
  const { data } = await servicio.from("PricingRule").select("*").eq("userId", uid).order("isDefault", { ascending: false }).order("name", { ascending: true }).limit(1).maybeSingle();
  return { regla: reglaDeFila(data), propia: Boolean(data), nombre: data?.name ?? null };
}

/** Ficha del catálogo común que corresponde a un producto publicado, o null si ya no está o no tiene la ficha completa. */
async function catalogoDeProducto(p: any) {
  const provider = p.supplierId === ID_PROVEEDOR.CJ_DROPSHIPPING ? "CJ_DROPSHIPPING" : p.supplierId === ID_PROVEEDOR.ALIEXPRESS ? "ALIEXPRESS" : null;
  if (!provider || !p.supplierProductId) return null;
  const { data: item } = await servicio.from("CatalogItem").select("id").eq("provider", provider).eq("externalId", p.supplierProductId).maybeSingle();
  if (!item) return null;
  try {
    return await leerCatalogo(String(item.id));
  } catch {
    return null;
  }
}

/** Envío por país para Retador (contrato v1.5): solo cotizaciones reales del almacén que tiene el stock; Cuba la calcula Retador. */
function envioDeVariantes(ficha: any, proveedor: "cj" | "aliexpress", variantes: VariantePreparada[]): EnvioParaRetador | null {
  if (proveedor === "aliexpress") return envioParaRetador(ficha, null);
  return envioParaRetador(ficha, new Set(variantes.flatMap((v) => v.origenesConStock)));
}

async function accionPublicar(uid: string, cuerpo: any) {
  const tienda = await tiendaPropia(uid, cuerpo.storeId);
  const cfg = await conRetador(tienda, "config");
  await guardarConfig(tienda, cfg);
  const tarifas = tarifasDeConfig(cfg);
  if (!tarifas) throw new ErrorApp("config_incompleta", "Retador no ha enviado sus tarifas, así que no se puede calcular tu beneficio. Inténtalo más tarde.");
  const { item, ficha, proveedor } = await leerCatalogo(cuerpo.itemId);

  // Categoría y subcategoría deben existir en Retador. La provincia ya no se pide:
  // los productos importados se envían desde fuera (Retador la deja vacía).
  const cat = String(cuerpo.cat ?? "");
  const categoria = (cfg.categorias ?? []).find((c: any) => c.cat === cat);
  if (!categoria) throw new ErrorApp("datos_invalidos", "Elige una categoría de Retador", { campo: "cat" });
  const subcat = String(cuerpo.subcat ?? "");
  if (!subcat || !(categoria.subcategorias ?? []).includes(subcat)) throw new ErrorApp("datos_invalidos", "Elige una subcategoría de Retador", { campo: "subcat" });

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
    if (!v.coste) throw new ErrorApp("faltan_datos", `«${v.nombre}» no se puede publicar: falta ${v.faltan.join(", ")}.`, { sku: v.sku, faltan: v.faltan });
    const liq = liquidacion(redondear(precio), v.coste.total, tarifas, v.coste.producto);
    if (liq.neto < 0 || precio < precioMinimoSinPerdida(v.coste.total, tarifas, v.coste.producto)) throw new ErrorApp("precio_bajo_minimo", `«${v.nombre}»: ese precio queda por debajo del mínimo. Mínimo: ${precioMinimoSinPerdida(v.coste.total, tarifas, v.coste.producto).toFixed(2)} USD (mínimo de Retador y sin pérdida tras la comisión).`, { sku: v.sku, minimoUsd: precioMinimoSinPerdida(v.coste.total, tarifas, v.coste.producto) });
    return { v, precio: redondear(precio), liq };
  });

  const contenido = contenidoFinal(cuerpo.contenido, contenidoPorDefecto(item, ficha));
  const yaExiste = await publicadoVigente(tienda, item.externalId);
  if (yaExiste) throw new ErrorApp("ya_publicado", yaExiste.status === "PAUSED" ? "Este producto ya está en tu tienda de Retador, pausado. Reactívalo desde «Productos», o elimínalo allí para volver a importarlo." : "Este producto ya está publicado en tu tienda de Retador. Edítalo desde «Productos».", { productId: yaExiste.id });

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

  // Envío por país (contrato v1.5): solo si Retador lo admite, y solo con cotizaciones reales del almacén que tiene el stock
  const envioPublicar = cfg.capacidades?.envio_resumen === true ? envioDeVariantes(ficha, proveedor, lineas.map(({ v }) => v)) : null;
  const opinionesPublicar = cfg.capacidades?.resenas_proveedor === true ? resenasParaRetador(ficha, proveedor) : null;

  let remoto: any;
  try {
    remoto = await conRetador(tienda, "publicar", {
      ref, proveedor, pid: item.externalId,
      variantes: lineas.map(({ v, precio }) => ({ sku: v.sku, precio_venta_usd: precio, stock: v.stock })),
      cat, subcat, contenido,
      // Opiniones reales del proveedor (con su origen), solo si Retador dice que las acepta
      ...(opinionesPublicar ? { resenas_proveedor: opinionesPublicar } : {}),
      ...(envioPublicar ? { envio: envioPublicar } : {}),
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
    rawPayload: {
      retador: {
        ref, moderacion: remoto.moderacion ?? null, publicadoEn: ahora(), origenUltimoCambio: "dropship",
        // Lo que ya se mandó a Retador, para que la sincronización automática solo mande lo que cambie
        stockProveedor: Object.fromEntries(lineas.map(({ v }) => [v.sku, v.stock])),
        ...(envioPublicar && typeof remoto.envio_paises === "number" && remoto.envio_paises > 0 ? { envioHash: huellaEnvio(envioPublicar), envioEnviadoEn: ahora() } : {}),
        ...(opinionesPublicar ? { resenasHash: huellaResenas(opinionesPublicar) } : {}),
        // Precio automático (decisión del vendedor al publicar): los precios publicados son el punto de partida
        ...(cuerpo.precioAuto === true ? { autoPrecio: { activo: true, desde: ahora(), ultimoCambio: null, precios: Object.fromEntries(lineas.map(({ v, precio }) => [v.sku, typeof confirmadas.get(v.sku)?.precio_venta_usd === "number" ? confirmadas.get(v.sku).precio_venta_usd : precio])) } } : {}),
      },
    }, updatedAt: ahora(),
  }).eq("id", productId);
  await registrar(uid, tienda.id, productId, "IMPORT", "SUCCESS", `Publicado en Retador: «${contenido.titulo}»`, {
    variantes: lineas.length, ref,
    envio: envioPublicar ? { paisesEnviados: envioPublicar.destinos.length, paisesConfirmados: remoto.envio_paises ?? null } : null,
  });
  return { productId, productoRetador: remoto.producto_id, url: remoto.url ?? null, estado: remoto.estado, moderacion: remoto.moderacion ?? null, variantes: remoto.variantes ?? [], envioPaises: typeof remoto.envio_paises === "number" ? remoto.envio_paises : null };
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
  // La configuración de Retador se lee una sola vez, y solo si hace falta
  let cfgLeida: any = null;
  const leerCfg = async () => (cfgLeida ??= await conRetador(tienda, "config"));
  // Ficha actual del proveedor (si sigue en el catálogo): con ella se comprueba el precio mínimo con el coste de HOY, no con el de cuando se publicó
  let catLeido: Awaited<ReturnType<typeof catalogoDeProducto>> | undefined;
  const leerCat = async () => (catLeido === undefined ? (catLeido = await catalogoDeProducto(p)) : catLeido);
  let huellaEnvioNueva: string | null = null;
  let huellaResenasNueva: string | null = null;

  if (cuerpo.estado !== undefined) {
    if (cuerpo.estado !== "activo" && cuerpo.estado !== "pausado") throw new ErrorApp("datos_invalidos", "El estado debe ser «activo» o «pausado»", { campo: "estado" });
    envio.estado = cuerpo.estado;
    cambios.push(`estado → ${cuerpo.estado}`);
  }
  if (Array.isArray(cuerpo.variantes) && cuerpo.variantes.length) {
    const cfg = await leerCfg();
    const tarifas = tarifasDeConfig(cfg);
    const { data: locales } = await servicio.from("ProductVariant").select("sku,costPrice,shippingCost,sellingPrice,stock").eq("productId", p.id);
    const porSku = new Map((locales ?? []).map((v: any) => [v.sku, v]));
    const cat = tarifas ? await leerCat() : null;
    const vigentes = cat ? new Map(prepararVariantes(cat.ficha, cat.proveedor, tarifas).variantes.map((v) => [v.sku, v])) : new Map<string, VariantePreparada>();
    envio.variantes = cuerpo.variantes.map((e: any) => {
      const local: any = porSku.get(String(e?.sku ?? ""));
      if (!local) throw new ErrorApp("sku_no_pertenece", `La variante «${e?.sku}» no es de este producto`, { sku: e?.sku });
      const salida: Record<string, unknown> = { sku: local.sku };
      if (e.precioVentaUsd !== undefined) {
        const precio = redondear(Number(e.precioVentaUsd));
        if (!Number.isFinite(precio) || precio <= 0) throw new ErrorApp("datos_invalidos", "Pon un precio válido", { sku: local.sku });
        if (tarifas) {
          // Con el coste de hoy si la ficha lo permite; si no, con el que se guardó al publicar
          const hoy = vigentes.get(local.sku)?.coste;
          const coste = hoy ? hoy.total : Number(local.costPrice) + Number(local.shippingCost);
          const producto = hoy ? hoy.producto : Number(local.costPrice);
          const minimo = precioMinimoSinPerdida(coste, tarifas, producto);
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
  if (cuerpo.resenas === true) {
    const cfgR = await leerCfg();
    if (cfgR.capacidades?.resenas_proveedor !== true) throw new ErrorApp("resenas_no_disponible", "Retador todavía no admite las opiniones del proveedor. Cuando lo active podrás enviarlas desde aquí.");
    const cat = await leerCat();
    const opiniones = cat ? resenasParaRetador(cat.ficha, cat.proveedor) : null;
    if (!opiniones) throw new ErrorApp("sin_resenas", "El proveedor no informa opiniones de este producto.");
    envio.resenas_proveedor = opiniones;
    huellaResenasNueva = huellaResenas(opiniones);
    cambios.push("opiniones del proveedor");
  }
  // Envío por país (contrato v1.5): si lo pides (envio: true) o junto a un cambio de precio o de stock, y solo si Retador lo admite y hay algo nuevo
  const pideEnvio = cuerpo.envio === true;
  if (pideEnvio || (Array.isArray(cuerpo.variantes) && cuerpo.variantes.length)) {
    const cfgE = await leerCfg();
    if (cfgE.capacidades?.envio_resumen !== true) {
      if (pideEnvio) throw new ErrorApp("envio_no_disponible", "Retador todavía no admite el envío por país. Cuando lo active podrás enviarlo desde aquí.");
    } else {
      const cat = await leerCat();
      if (cat) {
        const { data: propias } = await servicio.from("ProductVariant").select("sku").eq("productId", p.id);
        const skus = new Set((propias ?? []).map((v: any) => v.sku));
        const lista = prepararVariantes(cat.ficha, cat.proveedor, tarifasDeConfig(cfgE)).variantes.filter((v) => skus.has(v.sku));
        const e = envioDeVariantes(cat.ficha, cat.proveedor, lista);
        if (e) {
          const h = huellaEnvio(e);
          if (pideEnvio || h !== p.rawPayload?.retador?.envioHash) {
            envio.envio = e;
            huellaEnvioNueva = h;
            cambios.push("envío por país");
          }
        } else if (pideEnvio) {
          throw new ErrorApp("sin_envio", "Este producto todavía no tiene envíos cotizados desde el almacén que tiene el stock. Cotiza el envío desde la ficha del catálogo.");
        }
      } else if (pideEnvio) {
        throw new ErrorApp("sin_envio", "Este producto ya no tiene ficha en el catálogo, así que no hay envíos que mandar.");
      }
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
  // Lo que Retador ya tiene: la próxima sincronización solo mandará lo que cambie. Reactivar a mano borra el aviso de «precio en riesgo» (si sigue valiendo, se vuelve a avisar).
  const parche: Record<string, unknown> = {};
  if (huellaEnvioNueva && typeof remoto.envio_paises === "number" && remoto.envio_paises > 0) { parche.envioHash = huellaEnvioNueva; parche.envioEnviadoEn = ahora(); }
  if (huellaResenasNueva) parche.resenasHash = huellaResenasNueva;
  if (cuerpo.estado === "activo") parche.precioEnRiesgo = null;
  // Si el vendedor pone un precio a mano, el precio automático de ese producto se apaga: su decisión manda (puede volver a activarlo cuando quiera)
  const precioAMano = Array.isArray(cuerpo.variantes) && cuerpo.variantes.some((x: any) => x?.precioVentaUsd !== undefined);
  const autoPrevio = p.rawPayload?.retador?.autoPrecio;
  const autoApagado = precioAMano && autoPrevio?.activo === true;
  if (autoApagado) parche.autoPrecio = { ...autoPrevio, activo: false, apagadoPor: "vendedor", en: ahora() };
  if (Object.keys(parche).length) await fusionarRetador(p.id, parche);
  await registrar(uid, tienda.id, p.id, "PRICE_UPDATE", "SUCCESS", `Actualizado en Retador (${cambios.join("; ")})`, {
    cambios, ...(envio.envio ? { envio: { paisesEnviados: huellaEnvioNueva ? (envio.envio as EnvioParaRetador).destinos.length : null, paisesConfirmados: remoto.envio_paises ?? null } } : {}),
  });
  return { productId: p.id, estado: remoto.estado, variantes: remoto.variantes ?? [], envioPaises: typeof remoto.envio_paises === "number" ? remoto.envio_paises : null, precioAutomaticoApagado: autoApagado };
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

/** Elimina el producto de Retador (mercado y perfil del vendedor) y lo quita de aquí para poder importarlo otra vez cuando se quiera. */
async function accionEliminar(uid: string, cuerpo: any) {
  if (typeof cuerpo.productId !== "string" || !cuerpo.productId) throw new ErrorApp("datos_invalidos", "Indica el producto");
  const { data: p } = await servicio.from("Product").select("id,storeId,storeProductId,status").eq("id", cuerpo.productId).eq("userId", uid).maybeSingle();
  if (!p) throw new ErrorApp("producto_no_encontrado", "No se encontró ese producto");
  // Ya archivado o nunca llegó a publicarse: solo se limpia aquí
  if (p.status === "ARCHIVED" || !p.storeProductId || !p.storeId) {
    await liberarProducto(p.id, "Quitado de la lista");
    return { productId: p.id, eliminado: true };
  }
  const tienda = await tiendaPropia(uid, p.storeId);
  try {
    await conRetador(tienda, "eliminar", { ref: `dsp:${tienda.id}:${p.id}` });
  } catch (e) {
    if (e instanceof ErrorRetador && (e.codigo === "ref_no_encontrada" || e.codigo === "producto_eliminado")) {
      // Ya no estaba en Retador: basta con limpiarlo aquí
    } else if (e instanceof ErrorRetador && (e.codigo === "http_404" || e.codigo === "accion_desconocida")) {
      throw new ErrorApp("eliminar_no_disponible", "Retador todavía no permite eliminar desde DropshipPilot. Por ahora pausa el producto y elimínalo en tu perfil de Retador: aquí se quitará solo.");
    } else {
      throw e;
    }
  }
  await liberarProducto(p.id, "Eliminado");
  await registrar(uid, tienda.id, null, "DELETE", "SUCCESS", "Producto eliminado de Retador");
  return { productId: p.id, eliminado: true };
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
    if (!r.existe || r.estado === "eliminado") {
      await liberarProducto(id, "Ya no existe en Retador (lo eliminaste allí)");
      diferencias.push({ productId: id, tipo: "no_existe", mensaje: "Este producto ya no existe en Retador" });
      continue;
    }
    if (r.origen_ultimo_cambio === "vendedor") diferencias.push({ productId: id, tipo: "cambiado_en_retador", mensaje: "Cambiaste este producto a mano en Retador. Revisa precio y stock antes de volver a sincronizarlo." });
    await aplicarRemotoALocal(id, r);
    await fusionarRetador(id, { moderacion: r.moderacion ?? null, vendidos: r.vendidos ?? 0, pedidosPendientes: r.pedidos_pendientes ?? 0, origenUltimoCambio: r.origen_ultimo_cambio ?? null, actualizadoEn: r.actualizado_en ?? null });
  }
  return { productos: remoto.productos ?? [], diferencias };
}

/* ───────────────────────────── Sincronización automática ───────────────────────────── */

const usdTexto = (n: number) => `${n.toFixed(2)} USD`;

/**
 * Empuja a Retador lo que cambió en el proveedor de un producto ya publicado. Lo pide `monitor-proveedor` (vía interna) después de refrescar
 * la ficha; esta función NO habla con CJ ni con AliExpress, solo lee la ficha ya guardada.
 *  · stock por variante (0 = Retador lo deja agotado solo; desconocido = null; variante retirada = 0) sin pisar las ventas que Retador ya descontó;
 *  · producto que el proveedor ya no devuelve (`retirado`): se pausa en Retador;
 *  · envío por país y opiniones, solo si cambiaron desde la última vez;
 *  · el PRECIO nunca se cambia solo: si el coste sube y el precio ya no vale (mínimo de Retador o pérdida), se pausa y se avisa.
 * Cada envío a Retador queda anotado en el registro (qué se mandó y qué respondió Retador).
 */
async function accionSincronizar(uid: string, cuerpo: any) {
  const { data: p } = await servicio.from("Product").select("*").eq("id", String(cuerpo.productId ?? "")).eq("userId", uid).maybeSingle();
  if (!p || !p.storeId || !p.storeProductId || p.status === "ARCHIVED" || p.status === "DRAFT") return { omitido: "no_publicado" };
  const { data: tienda } = await servicio.from("Store").select("*").eq("id", p.storeId).eq("userId", uid).maybeSingle();
  if (!tienda || tienda.platform !== "RETADOR" || tienda.status !== "CONNECTED" || !tienda.accessTokenEnc) return { omitido: "tienda_desconectada" };
  const ref = `dsp:${tienda.id}:${p.id}`;
  const previo: any = p.rawPayload?.retador ?? {};

  // El proveedor ya no devuelve el producto: se pausa en Retador para que no se venda lo que no se puede comprar
  if (cuerpo.retirado === true) {
    if (p.status === "PAUSED") return { omitido: "ya_pausado" };
    try {
      await conRetador(tienda, "retirar", { ref });
    } catch (e) {
      await marcarProductoSiDesaparecio(p.id, e);
      await registrar(uid, tienda.id, p.id, "FULL_REFRESH", "FAILED", `El proveedor ya no devuelve «${p.title}» y no se pudo pausar en Retador: ${(e as Error).message}`, { sincronizacion: true, accion: "retirar" });
      throw e;
    }
    await servicio.from("Product").update({ status: "PAUSED", lastSyncedAt: ahora(), lastSyncStatus: "SUCCESS", lastSyncError: null, updatedAt: ahora() }).eq("id", p.id);
    await fusionarRetador(p.id, { pausadoPorProveedor: ahora() });
    await registrar(uid, tienda.id, p.id, "FULL_REFRESH", "SUCCESS", `El proveedor ya no devuelve «${p.title}»: lo hemos pausado en Retador para que no se venda. Si compruebas que sigue disponible, puedes reactivarlo desde «Productos».`, { sincronizacion: true, accion: "retirar" }, "WARN");
    return { productId: p.id, pausado: true };
  }

  const cat = await catalogoDeProducto(p);
  if (!cat) return { omitido: "sin_ficha" };
  const cfg = await conRetador(tienda, "config");
  const tarifas = tarifasDeConfig(cfg);
  const admiteEnvio = cfg.capacidades?.envio_resumen === true;
  const admiteResenas = cfg.capacidades?.resenas_proveedor === true;

  // Lo que Retador tiene AHORA (con sus ventas ya descontadas); si el producto ya no existe allí, se libera aquí
  const estadoRemoto = await conRetador(tienda, "estado", { refs: [ref] });
  const fila: any = (estadoRemoto.productos ?? [])[0];
  if (!fila || fila.existe === false || fila.estado === "eliminado") {
    await liberarProducto(p.id, "Ya no existe en Retador");
    return { omitido: "ya_no_existe" };
  }
  // Se lee lo local ANTES de copiar lo de Retador, para saber qué existencias del proveedor se mandaron la última vez
  const { data: locales } = await servicio.from("ProductVariant").select("sku,title,stock,stockVerificado,sellingPrice,costPrice,shippingCost").eq("productId", p.id).eq("isActive", true);
  const propias: any[] = locales ?? [];
  await aplicarRemotoALocal(p.id, fila);

  // Precio automático (solo si el vendedor lo activó para este producto)
  let auto: any = previo.autoPrecio?.activo === true ? previo.autoPrecio : null;
  if (auto) {
    // Si el vendedor cambió un precio a mano en Retador, el automático se apaga para este producto: su decisión manda
    const referencia: Record<string, number> = auto.precios ?? {};
    const movido = (fila.variantes ?? []).find((v: any) => {
      if (typeof v.precio_venta_usd !== "number") return false;
      const antes = referencia[String(v.sku)] ?? Number(propias.find((l) => l.sku === v.sku)?.sellingPrice);
      return Number.isFinite(antes) && Math.abs(v.precio_venta_usd - antes) > 0.005;
    });
    if (movido) {
      await fusionarRetador(p.id, { autoPrecio: { ...auto, activo: false, apagadoPor: "vendedor", en: ahora() } });
      await registrar(uid, tienda.id, p.id, "PRICE_UPDATE", "SUCCESS", `Has cambiado a mano el precio de «${p.title}» en Retador: el precio automático de este producto se ha apagado y se respeta tu precio. Puedes volver a activarlo desde «Productos».`, { sincronizacion: true, tipo: "PRECIO_AUTO_APAGADO" }, "WARN");
      auto = null;
    }
  }
  const reglaAuto = auto ? await reglaDelUsuario(uid) : null;

  const { variantes: hoy } = prepararVariantes(cat.ficha, cat.proveedor, tarifas);
  const hoyPorSku = new Map(hoy.map((v) => [v.sku, v]));
  const skusPropios = new Set(propias.map((v) => v.sku));
  const envioHoy = admiteEnvio ? envioDeVariantes(cat.ficha, cat.proveedor, hoy.filter((v) => skusPropios.has(v.sku))) : null;
  const plan = planificarSincronizacion({
    locales: propias.map((l) => ({
      sku: l.sku,
      titulo: String(l.title ?? l.sku),
      // Sin registro de lo último que se mandó (productos publicados antes de la sincronización) no se supone nada: la primera vez solo se baja y se anota la referencia
      stockProveedorPrevio: previo.stockProveedor && l.sku in previo.stockProveedor ? previo.stockProveedor[l.sku] : null,
      precioActual: Number(l.sellingPrice),
      costeAntes: Number(l.costPrice) + Number(l.shippingCost),
    })),
    remotas: new Map((fila.variantes ?? []).map((v: any) => [String(v.sku), { stock: typeof v.stock === "number" ? v.stock : null, estimado: v.stock_estimado === true, precio: typeof v.precio_venta_usd === "number" ? v.precio_venta_usd : null }])),
    actuales: new Map(hoy.map((v) => [v.sku, { stock: v.stock, coste: v.coste ? { total: v.coste.total, producto: v.coste.producto } : null }])),
    tarifas,
    estadoRemoto: String(fila.estado ?? "activo"),
    admiteEnvio, envio: envioHoy, huellaEnvioPrevia: previo.envioHash ?? null,
    admiteResenas, resenas: admiteResenas ? resenasParaRetador(cat.ficha, cat.proveedor) : null, huellaResenasPrevia: previo.resenasHash ?? null,
    ...(auto && reglaAuto ? { auto: { regla: reglaAuto.regla, ultimoCambioMs: auto.ultimoCambio ? Date.parse(auto.ultimoCambio) : null, ahoraMs: Date.now() } } : {}),
  });

  // «Precio en riesgo»: se avisa una sola vez mientras sea el mismo problema (no cada 6 horas)
  const riesgoActual = plan.riesgos.length ? { desde: previo.precioEnRiesgo?.desde ?? ahora(), pausadoSolo: plan.pausar || previo.precioEnRiesgo?.pausadoSolo === true, variantes: plan.riesgos } : null;
  const mismoRiesgo = Boolean(previo.precioEnRiesgo) && JSON.stringify((previo.precioEnRiesgo.variantes ?? []).map((v: any) => v.sku).sort()) === JSON.stringify(plan.riesgos.map((v) => v.sku).sort());
  const avisarRiesgo = plan.riesgos.length > 0 && (!mismoRiesgo || plan.pausar);
  if (avisarRiesgo) {
    const r = plan.riesgos[0];
    const otras = plan.riesgos.length > 1 ? ` (y ${plan.riesgos.length - 1} variante${plan.riesgos.length > 2 ? "s" : ""} más)` : "";
    await registrar(uid, tienda.id, p.id, "PRICE_UPDATE", "SUCCESS",
      `El coste de «${r.titulo}»${otras} subió de ${usdTexto(r.costeAntes)} a ${usdTexto(r.costeAhora)} y tu precio (${usdTexto(r.precioActual)}) ya no vale: ${r.pierde ? "perderías dinero" : "queda por debajo del mínimo de Retador"}. El mínimo ahora es ${usdTexto(r.minimoUsd)}. ${plan.pausar ? "Hemos pausado el producto en Retador para que no se venda así. " : ""}Sube el precio en «Productos» y reactívalo.`,
      { sincronizacion: true, tipo: "PRECIO_EN_RIESGO", variantes: plan.riesgos }, "WARN");
  }

  // Cambios de precio grandes (más del 25 %) que el sistema NO hace solo: se avisa una vez por cada objetivo distinto
  const yaAvisados: Record<string, number> = auto?.avisados ?? {};
  const porAvisar = plan.revisiones.filter((r) => Math.abs((yaAvisados[r.sku] ?? 0) - r.nuevo) > 0.005);
  if (auto && porAvisar.length) {
    const r = porAvisar[0];
    await registrar(uid, tienda.id, p.id, "PRICE_UPDATE", "SUCCESS",
      `El coste de «${r.titulo}» cambió mucho y tu regla pediría pasar el precio de ${usdTexto(r.antes)} a ${usdTexto(r.nuevo)} (${r.cambioPct > 0 ? "+" : ""}${r.cambioPct.toLocaleString("es-ES")} %). Un cambio tan grande no lo hago solo, por si es un error del proveedor: revisa el producto y ajusta el precio si es correcto.`,
      { sincronizacion: true, tipo: "PRECIO_AUTO_REVISAR", variantes: porAvisar }, "WARN");
  }
  const avisadosNuevos = auto ? { ...yaAvisados, ...Object.fromEntries(porAvisar.map((r) => [r.sku, r.nuevo])) } : undefined;
  // Precios que Retador tiene ahora (referencia para detectar un cambio a mano del vendedor la próxima vez)
  const preciosDe = (vs: any[]) => Object.fromEntries((vs ?? []).filter((v: any) => typeof v.precio_venta_usd === "number").map((v: any) => [String(v.sku), v.precio_venta_usd]));
  const parcheAuto = (precios: Record<string, number>, cambio: boolean) => (auto ? { autoPrecio: { ...auto, precios: { ...(auto.precios ?? {}), ...precios }, avisados: avisadosNuevos, ...(cambio ? { ultimoCambio: ahora() } : {}) } } : {});

  if (!plan.hayCambios) {
    await fusionarRetador(p.id, { stockProveedor: plan.stockProveedorNuevo, ultimaSincronizacion: ahora(), precioEnRiesgo: riesgoActual, ...parcheAuto(preciosDe(fila.variantes), false) });
    return { productId: p.id, sinCambios: true, precioEnRiesgo: plan.riesgos.length > 0 };
  }

  // Lo que se manda a Retador: stock y precio de cada variante van juntos en la misma línea
  const construirEnvio = (conPrecios: boolean) => {
    const e: Record<string, unknown> = { ref };
    const lineas = new Map<string, Record<string, unknown>>();
    for (const v of plan.variantes) lineas.set(v.sku, { sku: v.sku, stock: v.stock });
    if (conPrecios) for (const pr of plan.precios) lineas.set(pr.sku, { ...(lineas.get(pr.sku) ?? { sku: pr.sku }), precio_venta_usd: pr.nuevo });
    if (lineas.size) e.variantes = [...lineas.values()];
    if (plan.pausar) e.estado = "pausado";
    if (plan.envio) e.envio = plan.envio;
    if (plan.resenas) e.resenas_proveedor = plan.resenas;
    return e;
  };
  let envio = construirEnvio(true);
  let preciosAplicados = plan.precios.length > 0;

  let remoto: any;
  try {
    try {
      remoto = await conRetador(tienda, "actualizar", envio);
    } catch (e) {
      // Retador tiene su propio mínimo: si no acepta el precio nuevo, se manda todo lo demás y se avisa
      if (preciosAplicados && e instanceof ErrorRetador && e.codigo === "precio_bajo_minimo") {
        await registrar(uid, tienda.id, p.id, "PRICE_UPDATE", "FAILED", `Retador no aceptó el precio automático de «${p.title}» (queda por debajo de su mínimo). Se mantiene el precio actual: revísalo en «Productos».`, { sincronizacion: true, tipo: "PRECIO_AUTO_RECHAZADO", extra: e.extra }, "WARN");
        preciosAplicados = false;
        envio = construirEnvio(false);
        remoto = Object.keys(envio).length > 1 ? await conRetador(tienda, "actualizar", envio) : fila;
      } else {
        throw e;
      }
    }
  } catch (e) {
    await servicio.from("Product").update({ lastSyncStatus: "FAILED", lastSyncError: (e as Error).message, updatedAt: ahora() }).eq("id", p.id);
    await marcarProductoSiDesaparecio(p.id, e);
    await registrar(uid, tienda.id, p.id, "FULL_REFRESH", "FAILED", `No se pudo sincronizar «${p.title}» con Retador (${plan.resumen.join("; ")}): ${(e as Error).message}`, { sincronizacion: true, enviado: resumenEnvio(envio) });
    throw e;
  }
  await aplicarRemotoALocal(p.id, remoto);
  const parche: Record<string, unknown> = { stockProveedor: plan.stockProveedorNuevo, ultimaSincronizacion: ahora(), precioEnRiesgo: riesgoActual, ...parcheAuto(preciosDe(remoto.variantes), preciosAplicados) };
  // Solo se da por mandado el envío si Retador confirma cuántos países guardó (si no, se vuelve a intentar en la próxima revisión)
  if (plan.huellaEnvio && typeof remoto.envio_paises === "number" && remoto.envio_paises > 0) { parche.envioHash = plan.huellaEnvio; parche.envioEnviadoEn = ahora(); }
  if (plan.huellaResenas) parche.resenasHash = plan.huellaResenas;
  await fusionarRetador(p.id, parche);
  if (preciosAplicados && reglaAuto) {
    const lista = plan.precios.map((x) => `«${x.titulo}»: de ${usdTexto(x.antes)} a ${usdTexto(x.nuevo)}`).join("; ");
    await registrar(uid, tienda.id, p.id, "PRICE_UPDATE", "SUCCESS", `Precio ajustado con tu regla (${reglaAuto.regla.markupPct} % de margen) porque cambió el coste del proveedor: ${lista}.`, { sincronizacion: true, tipo: "PRECIO_AUTOMATICO", regla: reglaAuto.regla, precios: plan.precios });
  }
  await registrar(uid, tienda.id, p.id, "FULL_REFRESH", "SUCCESS", `Sincronizado con Retador: ${plan.resumen.join("; ")}.`, {
    sincronizacion: true,
    enviado: resumenEnvio(envio),
    respuesta: { estado: remoto.estado ?? null, variantes: remoto.variantes ?? [], envio_actualizado_en: remoto.envio_actualizado_en ?? null, envio_paises: remoto.envio_paises ?? null },
  }, plan.pausar ? "WARN" : "INFO");
  return { productId: p.id, enviado: true, resumen: plan.resumen, pausado: plan.pausar, preciosCambiados: preciosAplicados ? plan.precios.length : 0, estado: remoto.estado ?? null, envioPaises: typeof remoto.envio_paises === "number" ? remoto.envio_paises : null };
}

/**
 * Precio automático de un producto: activarlo o apagarlo. Al activarlo, SIN `confirmar` solo se enseña cómo quedarían los precios con la regla
 * del vendedor (para que decida con los números delante); CON `confirmar` se aplican a Retador y queda activado. Apagarlo es inmediato.
 */
async function accionPrecioAuto(uid: string, cuerpo: any) {
  const { p, tienda, ref } = await productoPropio(uid, cuerpo.productId);
  const previo: any = p.rawPayload?.retador ?? {};
  if (cuerpo.activo !== true) {
    await fusionarRetador(p.id, { autoPrecio: { ...(previo.autoPrecio ?? {}), activo: false, apagadoPor: "vendedor", en: ahora() } });
    await registrar(uid, tienda.id, p.id, "PRICE_UPDATE", "SUCCESS", `Precio automático apagado en «${p.title}»: el precio ya solo cambia cuando tú lo cambies.`, { tipo: "PRECIO_AUTO_APAGADO" });
    return { productId: p.id, activo: false };
  }
  const cat = await catalogoDeProducto(p);
  if (!cat) throw new ErrorApp("sin_ficha", "Este producto ya no tiene ficha en el catálogo, así que no se puede calcular su precio con la regla.");
  const cfg = await conRetador(tienda, "config");
  const tarifas = tarifasDeConfig(cfg);
  if (!tarifas) throw new ErrorApp("config_incompleta", "Retador no ha enviado sus tarifas, así que no se puede calcular el precio mínimo. Inténtalo más tarde.");
  const estadoRemoto = await conRetador(tienda, "estado", { refs: [ref] });
  const fila: any = (estadoRemoto.productos ?? [])[0];
  if (!fila || fila.existe === false || fila.estado === "eliminado") {
    await liberarProducto(p.id, "Ya no existe en Retador");
    throw new ErrorApp("producto_no_encontrado", "Este producto ya no existe en Retador.");
  }
  const { data: locales } = await servicio.from("ProductVariant").select("sku,title,sellingPrice").eq("productId", p.id).eq("isActive", true);
  const { variantes: hoy } = prepararVariantes(cat.ficha, cat.proveedor, tarifas);
  const hoyPorSku = new Map(hoy.map((v) => [v.sku, v]));
  const { regla, propia, nombre } = await reglaDelUsuario(uid);
  const remotoPorSku = new Map<string, number>((fila.variantes ?? []).filter((v: any) => typeof v.precio_venta_usd === "number").map((v: any) => [String(v.sku), v.precio_venta_usd]));
  const lista: { sku: string; titulo: string; precioActual: number; precioNuevo: number; minimo: number | null }[] = [];
  for (const l of locales ?? []) {
    const actual = remotoPorSku.get(l.sku) ?? Number(l.sellingPrice);
    const c = hoyPorSku.get(l.sku)?.coste;
    if (!c) continue; // sin coste de hoy no se puede calcular: esa variante no cambia
    const d = decidirPrecioAuto({ precioActual: actual, coste: c, tarifas, regla, ultimoCambioMs: null, ahoraMs: Date.now(), forzar: true });
    lista.push({ sku: l.sku, titulo: String(l.title ?? l.sku), precioActual: actual, precioNuevo: d.tipo === "cambiar" ? d.nuevo : actual, minimo: d.minimo });
  }
  const cambian = lista.filter((x) => Math.abs(x.precioNuevo - x.precioActual) > 0.005);
  if (cuerpo.confirmar !== true) {
    return { productId: p.id, vistaPrevia: true, regla: { markupPct: regla.markupPct, propia, nombre }, variantes: lista, cambian: cambian.length };
  }

  let remoto: any = fila;
  if (cambian.length) {
    try {
      remoto = await conRetador(tienda, "actualizar", { ref, variantes: cambian.map((x) => ({ sku: x.sku, precio_venta_usd: x.precioNuevo })) });
    } catch (e) {
      await marcarProductoSiDesaparecio(p.id, e);
      throw e;
    }
    await aplicarRemotoALocal(p.id, remoto);
  }
  const precios = Object.fromEntries(((remoto.variantes ?? fila.variantes) ?? []).filter((v: any) => typeof v.precio_venta_usd === "number").map((v: any) => [String(v.sku), v.precio_venta_usd]));
  await fusionarRetador(p.id, { autoPrecio: { activo: true, desde: ahora(), ultimoCambio: cambian.length ? ahora() : null, precios }, precioEnRiesgo: null });
  await registrar(uid, tienda.id, p.id, "PRICE_UPDATE", "SUCCESS", cambian.length
    ? `Precio automático activado en «${p.title}»: ${cambian.map((x) => `«${x.titulo}» pasa de ${usdTexto(x.precioActual)} a ${usdTexto(x.precioNuevo)}`).join("; ")}. A partir de ahora el precio sigue tu regla (${regla.markupPct} % de margen) cuando cambie el coste del proveedor.`
    : `Precio automático activado en «${p.title}»: los precios ya coinciden con tu regla (${regla.markupPct} % de margen).`,
    { tipo: "PRECIO_AUTO_ACTIVADO", regla, cambios: cambian });
  return { productId: p.id, activo: true, cambiados: cambian.length, variantes: lista };
}

/** Lo que se mandó a Retador, en versión corta para el registro (sin repetir las 100 filas del envío ni los textos de las opiniones). */
function resumenEnvio(e: Record<string, unknown>) {
  const envio = e.envio as EnvioParaRetador | undefined;
  const op = e.resenas_proveedor as any;
  return {
    ...(e.estado ? { estado: e.estado } : {}),
    ...(e.variantes ? { variantes: e.variantes } : {}),
    ...(envio ? { envio: { paises: envio.destinos.length, cotizado_en: envio.cotizado_en } } : {}),
    ...(op ? { opiniones: { media: op.media ?? null, total: op.total ?? null, textos: Array.isArray(op.muestra) ? op.muestra.length : 0 } } : {}),
  };
}

/* ───────────────────────────── Pedidos (docs/contrato-pedidos.md) ───────────────────────────── */

/** Trae los pedidos PAGADOS de Retador y los guarda en `Order` / `OrderItem`. Nunca compra nada: solo anota. */
async function accionPedidosSincronizar(uid: string, cuerpo: any) {
  const tienda = await tiendaPropia(uid, cuerpo.storeId);
  const desde = typeof tienda.settings?.pedidosDesde === "string" ? tienda.settings.pedidosDesde : undefined;
  let resp: any;
  try {
    resp = await conRetador(tienda, "pedidos", { ...(desde ? { desde } : {}), limite: 50 });
  } catch (e) {
    // Retador todavía no ha activado los pedidos: no es un fallo de nadie
    if (e instanceof ErrorRetador && (e.codigo === "http_404" || e.codigo === "accion_desconocida")) {
      return { disponible: false, nuevos: 0, actualizados: 0, revision: 0, problemas: [], mensaje: "Retador todavía no ofrece los pedidos a DropshipPilot. Cuando lo active, aparecerán aquí solos." };
    }
    throw e;
  }
  const lista: any[] = Array.isArray(resp.pedidos) ? resp.pedidos : [];
  let nuevos = 0, actualizados = 0, revision = 0;
  const problemas: string[] = [];

  for (const crudo of lista) {
    const n = normalizarPedido(crudo);
    if (!n.ok) {
      revision += 1;
      problemas.push(n.motivo);
      continue;
    }
    const p = n.pedido;
    const { data: existente } = await servicio.from("Order").select("id,status").eq("storeId", tienda.id).eq("storeOrderId", p.pedidoId).maybeSingle();
    if (existente) {
      if (p.estadoCompra === "cancelado") {
        const efecto = efectoDeCancelacion(String(existente.status));
        if (efecto.estado) {
          await servicio.from("Order").update({ status: efecto.estado, updatedAt: ahora() }).eq("id", existente.id);
          actualizados += 1;
        } else if (efecto.aviso) {
          await servicio.from("Order").update({ errorMessage: efecto.aviso, updatedAt: ahora() }).eq("id", existente.id);
          actualizados += 1;
        }
      }
      continue;
    }
    if (p.estadoCompra === "cancelado") continue; // un pedido que nunca vimos y ya está cancelado no hace falta guardarlo

    // Cruzar cada línea con el producto y la variante publicados desde DropshipPilot (por ref + sku)
    const productosIds = [...new Set(p.lineas.map((l) => parsearRef(l.ref)).filter((r) => r && r.tiendaId === tienda.id).map((r) => r!.productoId))];
    const { data: productos } = productosIds.length ? await servicio.from("Product").select("id,supplierId,title").eq("userId", uid).eq("storeId", tienda.id).in("id", productosIds) : { data: [] as any[] };
    const { data: variantes } = productosIds.length ? await servicio.from("ProductVariant").select("id,productId,sku,supplierVariantId,costPrice,title,imageUrl").in("productId", productosIds) : { data: [] as any[] };
    const productoPorId = new Map<string, any>((productos ?? []).map((x: any) => [x.id, x]));
    const sinReconocer: string[] = [];
    const items = p.lineas.map((l) => {
      const ref = parsearRef(l.ref);
      const producto = ref && ref.tiendaId === tienda.id ? productoPorId.get(ref.productoId) : undefined;
      const variante = producto ? (variantes ?? []).find((v: any) => v.productId === producto.id && v.sku === l.sku) : undefined;
      if (!producto || !variante) sinReconocer.push(l.sku);
      return { linea: l, producto, variante };
    });
    const subtotal = redondear(p.lineas.reduce((s, l) => s + l.precioVentaUsd * l.cantidad, 0));
    const costeConocido = items.every((i) => i.variante && Number.isFinite(Number(i.variante.costPrice)));
    const costeProveedor = costeConocido ? redondear(items.reduce((s, i) => s + Number(i.variante!.costPrice) * i.linea.cantidad, 0)) : 0;
    const orderId = crypto.randomUUID();
    const { error: eOrden } = await servicio.from("Order").insert({
      id: orderId, userId: uid, storeId: tienda.id, supplierId: items.find((i) => i.producto)?.producto.supplierId ?? null,
      storeOrderId: p.pedidoId, storeOrderNumber: p.numero, status: "PAID", fulfillmentStatus: "UNFULFILLED",
      customerName: p.entrega.nombre, customerPhone: p.entrega.telefono, shippingName: p.entrega.nombre,
      shippingAddress1: p.entrega.direccion1, shippingAddress2: p.entrega.direccion2, shippingCity: p.entrega.ciudad,
      shippingProvince: p.entrega.provincia, shippingCountry: p.entrega.pais, shippingZip: p.entrega.codigoPostal,
      currency: p.moneda, subtotal, shippingTotal: 0, taxTotal: 0, total: subtotal, supplierCost: costeProveedor, profitAmount: 0,
      notes: `Entrega: ${p.entrega.tipo === "centro_logistico" ? "centro logístico" : "directa al comprador"}${p.entrega.referencia ? ` · referencia ${p.entrega.referencia}` : ""}`,
      errorMessage: sinReconocer.length ? `Necesita revisión: ${sinReconocer.join(", ")} no corresponde a ningún producto publicado desde DropshipPilot. No se comprará hasta revisarlo.` : null,
      orderedAt: p.pagadoEn, updatedAt: ahora(),
    });
    if (eOrden) {
      if (eOrden.code === "23505") continue; // otra sincronización la guardó a la vez
      throw new ErrorApp("error_interno", "No se pudo guardar un pedido");
    }
    await servicio.from("OrderItem").insert(items.map((i) => ({
      orderId, productId: i.producto?.id ?? null, variantId: i.variante?.id ?? null, supplierVariantId: i.variante?.supplierVariantId ?? null,
      title: i.variante?.title ?? i.producto?.title ?? i.linea.sku, sku: i.linea.sku, quantity: i.linea.cantidad,
      unitPrice: i.linea.precioVentaUsd, unitCost: i.variante ? Number(i.variante.costPrice) || 0 : 0, totalPrice: redondear(i.linea.precioVentaUsd * i.linea.cantidad), imageUrl: i.variante?.imageUrl ?? null,
    })));
    nuevos += 1;
    if (sinReconocer.length) revision += 1;
  }

  if (typeof resp.siguiente_desde === "string" && resp.siguiente_desde) {
    await servicio.from("Store").update({ settings: { ...(tienda.settings ?? {}), pedidosDesde: resp.siguiente_desde }, updatedAt: ahora() }).eq("id", tienda.id);
  }
  return { disponible: true, nuevos, actualizados, revision, problemas };
}

/** Informa a Retador de la compra / envío de un pedido (idempotente). */
async function informarRetador(tienda: any, orden: any, estado: "comprado" | "enviado" | "entregado" | "error", extra: Record<string, unknown> = {}) {
  return await conRetador(tienda, "pedido_estado", { pedido_id: orden.storeOrderId, estado, ...extra });
}

async function accionPedidoInformar(uid: string, cuerpo: any) {
  const { data: orden } = await servicio.from("Order").select("*").eq("id", String(cuerpo.orderId ?? "")).eq("userId", uid).maybeSingle();
  if (!orden) throw new ErrorApp("pedido_no_encontrado", "No se encontró ese pedido");
  const tienda = await tiendaPropia(uid, orden.storeId);
  const estado = cuerpo.estado;
  if (!["comprado", "enviado", "entregado", "error"].includes(estado)) throw new ErrorApp("datos_invalidos", "Estado no válido", { campo: "estado" });
  const extra: Record<string, unknown> = {};
  if (typeof cuerpo.proveedor === "string") extra.proveedor = cuerpo.proveedor;
  if (typeof orden.supplierOrderId === "string" && orden.supplierOrderId) extra.proveedor_pedido_id = orden.supplierOrderId;
  if (orden.trackingNumber) extra.seguimiento = { numero: orden.trackingNumber, empresa: orden.trackingCompany ?? null, url: orden.trackingUrl ?? null };
  if (typeof cuerpo.mensaje === "string") extra.mensaje = cuerpo.mensaje.slice(0, 300);
  await informarRetador(tienda, orden, estado, extra);
  return { orderId: orden.id, estado };
}

/** SOLO PRUEBAS con Retador simulado y administrador: crea un pedido pagado de mentira con un producto ya publicado. */
async function accionSimularPedido(uid: string, cuerpo: any) {
  const tienda = await tiendaPropia(uid, cuerpo.storeId);
  if (!tienda.settings?.simulada) throw new ErrorApp("solo_simulador", "Los pedidos de prueba solo existen con el Retador simulado.");
  const { data: yo } = await servicio.from("User").select("role").eq("id", uid).maybeSingle();
  if (yo?.role !== "ADMIN") throw new ErrorApp("solo_admin", "Solo el administrador puede crear pedidos de prueba.");
  const { data: producto } = await servicio.from("Product").select("id").eq("userId", uid).eq("storeId", tienda.id).not("storeProductId", "is", null).order("createdAt", { ascending: false }).limit(1).maybeSingle();
  if (!producto) throw new ErrorApp("sin_productos", "Publica primero un producto en el Retador simulado para poder probar un pedido.");
  const { data: variante } = await servicio.from("ProductVariant").select("sku").eq("productId", producto.id).order("position").limit(1).maybeSingle();
  await conRetador(tienda, "simular_pedido", { ref: `dsp:${tienda.id}:${producto.id}`, sku: variante?.sku, cantidad: Number.isInteger(cuerpo.cantidad) ? cuerpo.cantidad : 1 });
  return { creado: true };
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
      sincronizar: accionSincronizar, precio_auto: accionPrecioAuto, eliminar: accionEliminar, pedidos_sincronizar: accionPedidosSincronizar, pedido_informar: accionPedidoInformar, simular_pedido: accionSimularPedido,
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
