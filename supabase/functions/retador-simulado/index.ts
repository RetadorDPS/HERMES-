/**
 * retador-simulado — Retador de mentira que cumple el contrato (docs/contrato-retador.md, versión 1).
 *
 * Sirve para probar de punta a punta la conexión de DropshipPilot sin tocar el Retador real: tokens que empiezan
 * por «dsp_sim_», solo para el administrador. Nada de lo que hace sale de nuestra base de datos y nunca llama a
 * un proveedor. Solo la puede llamar `retador-tienda` (con la clave de servicio).
 *   · dsp_sim_caducado…  → 401 token_caducado        · dsp_sim_revocado… → 401 token_invalido
 *   · precio < 1 USD     → 409 precio_bajo_minimo    · stock null        → 5 y stock_estimado = true
 *   · acción extra `simular_edicion_vendedor` {ref}  → marca el producto como cambiado a mano en Retador
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const servicio = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const responder = (cuerpo: unknown, estado = 200) => new Response(JSON.stringify(cuerpo), { status: estado, headers: { "Content-Type": "application/json" } });
const ok = (extra: object) => responder({ ok: true, version_contrato: 1, ...extra });
const fallo = (estado: number, codigo: string, error: string, extra: object = {}) => responder({ ok: false, codigo, error, ...extra }, estado);

const CATEGORIAS = [
  { cat: "hogar", nombre: "Hogar", subcategorias: ["Cocina", "Baño", "Decoración"] },
  { cat: "electronica", nombre: "Electrónica", subcategorias: ["Accesorios", "Cámaras", "Audio"] },
  { cat: "herramientas", nombre: "Herramientas", subcategorias: ["Medición", "Manuales"] },
  { cat: "belleza", nombre: "Belleza", subcategorias: ["Cuidado personal"] },
];
const PROVINCIAS = ["Pinar del Río", "La Habana", "Matanzas", "Villa Clara", "Camagüey", "Holguín", "Santiago de Cuba"];
const HOSTS = [/(^|\.)alicdn\.com$/i, /(^|\.)aliexpress-media\.com$/i, /(^|\.)cjdropshipping\.com$/i, /(^|\.)supabase\.co$/i];
const imagenValida = (u: unknown) => {
  try { const x = new URL(String(u)); return x.protocol === "https:" && HOSTS.some((r) => r.test(x.hostname)); } catch { return false; }
};
const r2 = (n: number) => Math.round(n * 100) / 100;

async function leer(ref: string) {
  const { data } = await servicio.from("RetadorSimulado").select("data").eq("ref", ref).maybeSingle();
  return (data?.data as any) ?? null;
}
async function guardar(ref: string, data: any) {
  await servicio.from("RetadorSimulado").upsert({ ref, data, updatedAt: new Date().toISOString() }, { onConflict: "ref" });
}
const vistaVariantes = (p: any) => p.variantes.map((v: any) => ({ sku: v.sku, precio_venta_usd: v.precio_venta_usd, stock: v.stock, stock_estimado: v.stock_estimado }));
const estadoDe = (p: any) => (p.estado === "pausado" ? "pausado" : p.variantes.every((v: any) => v.stock === 0) ? "agotado" : "activo");

Deno.serve(async (req) => {
  if (req.method !== "POST") return fallo(405, "metodo", "Usa POST");
  const llave = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (llave !== Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) return fallo(401, "no_autorizado", "Solo la función de tiendas puede llamar al Retador simulado");
  const token = req.headers.get("x-dropship-token") ?? "";
  const accion = req.headers.get("x-accion") ?? "";
  if (!token.startsWith("dsp_sim_")) return fallo(401, "token_invalido", "Token no válido");
  if (token.startsWith("dsp_sim_caducado")) return fallo(401, "token_caducado", "El token ha caducado");
  if (token.startsWith("dsp_sim_revocado")) return fallo(401, "token_invalido", "El token no es válido o fue revocado");
  let c: any = {};
  try { c = await req.json(); } catch { /* cuerpo vacío */ }

  if (accion === "config") {
    return ok({
      vendedor: { plan: "pro", productos_usados: 0, tope_productos: 55, suspendido: false, deuda_comisiones: false },
      tarifas: { hub_usd_por_libra: 1.99, dias_hub_cuba: [8, 15], comision_pct_ganancia: 8, pasarela_pct: 4.4, pasarela_fija_usd: 0.3, ganancia_minima_retador_usd: 1, pasarela_a_cargo: "vendedor", pasarela_base: "total_cobrado", envio: "aparte", comision_base: "precio_venta_menos_costo_producto_menos_pasarela" },
      categorias: CATEGORIAS, provincias: PROVINCIAS,
      limites: { publicar_por_hora: 10, actualizar_por_hora: 60, retirar_por_hora: 60, estado_por_hora: 300 },
      token: { prefijo: token.slice(0, 12), caduca_en: new Date(Date.now() + 90 * 864e5).toISOString() },
    });
  }

  if (accion === "publicar") {
    if (typeof c.ref !== "string" || !c.ref) return fallo(400, "datos_invalidos", "Falta la referencia", { campo: "ref" });
    if (c.proveedor !== "cj" && c.proveedor !== "aliexpress") return fallo(400, "datos_invalidos", "Proveedor no válido", { campo: "proveedor" });
    if (typeof c.pid !== "string" || !c.pid) return fallo(400, "datos_invalidos", "Falta el producto del proveedor", { campo: "pid" });
    if (!Array.isArray(c.variantes) || c.variantes.length < 1 || c.variantes.length > 12) return fallo(400, "datos_invalidos", "Entre 1 y 12 variantes", { campo: "variantes" });
    const categoria = CATEGORIAS.find((x) => x.cat === c.cat);
    if (!categoria) return fallo(400, "datos_invalidos", "Categoría no válida", { campo: "cat" });
    if (!categoria.subcategorias.includes(c.subcat)) return fallo(400, "datos_invalidos", "Subcategoría no válida", { campo: "subcat" });
    if (!PROVINCIAS.includes(c.provincia)) return fallo(400, "datos_invalidos", "Provincia no válida", { campo: "provincia" });
    const ct = c.contenido ?? {};
    if (ct.titulo !== undefined && (typeof ct.titulo !== "string" || ct.titulo.length > 150 || !ct.titulo.trim())) return fallo(400, "datos_invalidos", "Título no válido", { campo: "titulo" });
    if (ct.descripcion !== undefined && (typeof ct.descripcion !== "string" || ct.descripcion.length > 5000)) return fallo(400, "datos_invalidos", "Descripción no válida", { campo: "descripcion" });
    if (ct.imagenes !== undefined && (!Array.isArray(ct.imagenes) || ct.imagenes.length > 9 || ct.imagenes.some((u: unknown) => !imagenValida(u)))) return fallo(400, "datos_invalidos", "Fotos no válidas", { campo: "imagenes" });
    const skus = new Set<string>();
    for (const v of c.variantes) {
      if (typeof v?.sku !== "string" || !v.sku || skus.has(v.sku)) return fallo(400, "datos_invalidos", "Variante no válida o repetida", { campo: "variantes" });
      skus.add(v.sku);
      if (typeof v.precio_venta_usd !== "number" || !(v.precio_venta_usd > 0)) return fallo(400, "datos_invalidos", "Precio no válido", { campo: "variantes", sku: v.sku });
      if (v.precio_venta_usd < 1) return fallo(409, "precio_bajo_minimo", "El precio está por debajo del mínimo", { sku: v.sku, minimo_usd: 1 });
      if (v.stock !== null && v.stock !== undefined && (!Number.isInteger(v.stock) || v.stock < 0)) return fallo(400, "datos_invalidos", "Stock no válido", { campo: "variantes", sku: v.sku });
    }
    const existente = await leer(c.ref);
    if (existente) return fallo(409, "ya_publicado", "Esta referencia ya está publicada", { producto_id: existente.producto_id });
    const producto_id = crypto.randomUUID();
    const p = {
      producto_id, estado: "activo", moderacion: "approved", proveedor: c.proveedor, pid: c.pid, cat: c.cat, subcat: c.subcat, provincia: c.provincia,
      titulo: ct.titulo ?? `Producto ${c.pid}`, descripcion: ct.descripcion ?? "", imagenes: ct.imagenes ?? [], origen_ultimo_cambio: "dropship",
      actualizado_en: new Date().toISOString(), vendidos: 0, pedidos_pendientes: 0,
      variantes: c.variantes.map((v: any) => ({ sku: v.sku, precio_venta_usd: r2(v.precio_venta_usd), stock: v.stock ?? 5, stock_estimado: v.stock === null || v.stock === undefined })),
    };
    await guardar(c.ref, p);
    return ok({ ref: c.ref, producto_id, url: `https://retadormarketplace.es/simulado/${producto_id}`, estado: "activo", moderacion: "approved", variantes: vistaVariantes(p), imagenes: p.imagenes.length, cat: p.cat, subcat: p.subcat });
  }

  if (accion === "actualizar" || accion === "retirar" || accion === "simular_edicion_vendedor") {
    const p = await leer(String(c.ref ?? ""));
    if (!p) return fallo(404, "producto_no_encontrado", "No existe ningún producto con esa referencia");
    if (accion === "simular_edicion_vendedor") {
      p.origen_ultimo_cambio = "vendedor"; p.actualizado_en = new Date().toISOString();
      await guardar(c.ref, p);
      return ok({ ref: c.ref });
    }
    if (accion === "retirar") {
      p.estado = "pausado"; p.origen_ultimo_cambio = "dropship"; p.actualizado_en = new Date().toISOString();
      await guardar(c.ref, p);
      return ok({ ref: c.ref, producto_id: p.producto_id, estado: "pausado" });
    }
    if (c.estado !== undefined) {
      if (c.estado !== "activo" && c.estado !== "pausado") return fallo(400, "datos_invalidos", "Estado no válido", { campo: "estado" });
      p.estado = c.estado;
    }
    for (const v of c.variantes ?? []) {
      const local = p.variantes.find((x: any) => x.sku === v?.sku);
      if (!local) return fallo(404, "sku_no_pertenece", "Esa variante no es de este producto", { sku: v?.sku });
      if (v.precio_venta_usd !== undefined) {
        if (typeof v.precio_venta_usd !== "number" || !(v.precio_venta_usd > 0)) return fallo(400, "datos_invalidos", "Precio no válido", { sku: v.sku });
        if (v.precio_venta_usd < 1) return fallo(409, "precio_bajo_minimo", "El precio está por debajo del mínimo", { sku: v.sku, minimo_usd: 1 });
        local.precio_venta_usd = r2(v.precio_venta_usd);
      }
      if (v.stock !== undefined) {
        if (v.stock !== null && (!Number.isInteger(v.stock) || v.stock < 0)) return fallo(400, "datos_invalidos", "Stock no válido", { sku: v.sku });
        local.stock = v.stock ?? 5; local.stock_estimado = v.stock === null;
      }
    }
    if (c.contenido) {
      if (c.contenido.titulo !== undefined) p.titulo = c.contenido.titulo;
      if (c.contenido.descripcion !== undefined) p.descripcion = c.contenido.descripcion;
      if (c.contenido.imagenes !== undefined) p.imagenes = c.contenido.imagenes;
    }
    p.origen_ultimo_cambio = "dropship"; p.actualizado_en = new Date().toISOString();
    await guardar(c.ref, p);
    return ok({ ref: c.ref, producto_id: p.producto_id, estado: estadoDe(p), moderacion: p.moderacion, variantes: vistaVariantes(p) });
  }

  if (accion === "estado") {
    if (!Array.isArray(c.refs) || c.refs.length > 100) return fallo(400, "datos_invalidos", "Hasta 100 referencias", { campo: "refs" });
    const productos = [];
    for (const ref of c.refs) {
      const p = await leer(String(ref));
      productos.push(p
        ? { ref, existe: true, producto_id: p.producto_id, estado: estadoDe(p), moderacion: p.moderacion, variantes: vistaVariantes(p), vendidos: p.vendidos, pedidos_pendientes: p.pedidos_pendientes, actualizado_en: p.actualizado_en, origen_ultimo_cambio: p.origen_ultimo_cambio }
        : { ref, existe: false });
    }
    return ok({ productos });
  }

  return fallo(400, "accion_desconocida", `Acción desconocida: ${accion}`);
});
