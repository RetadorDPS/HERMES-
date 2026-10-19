/**
 * monitor-proveedor — Vigila el precio y las existencias que el proveedor tiene HOY de los productos que los usuarios han publicado.
 *
 * Esta función NO habla con CJ ni con AliExpress: elige qué productos toca revisar y le pide a `cj-catalogo` / `ali-catalogo`
 * (cada una con su propia lógica) la acción interna `refrescar`. Después anota en el registro de cada usuario (SyncLog) los cambios que importan.
 * NUNCA cambia el precio ni el estado de un producto publicado: solo avisa. Decidir qué hacer con el aviso es del vendedor.
 *
 * Quién puede llamarla:
 *   · el barrido programado (cada 30 min), con la clave `monitor_secreto` guardada en el almacén de secretos de Supabase,
 *   · el administrador con su sesión (botón «Revisar ahora»).
 *
 * Presupuesto de llamadas: como mucho `maximo` productos por vez (3 por defecto, tope 5); cada producto se vuelve a mirar a las 6 horas
 * (1 hora si falló). Una sola revisión a la vez (bloqueo en base de datos) y los proveedores siempre uno detrás de otro.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { describirCambio, esCambioDeRiesgo, esCambioRelevante, type Cambio } from "./cambios.ts";

const FUNCION: Record<string, string> = { CJ_DROPSHIPPING: "cj-catalogo", ALIEXPRESS: "ali-catalogo" };
const REVISAR_CADA_MS = 6 * 3_600_000;
const REINTENTAR_FALLO_MS = 3_600_000;
const AVISO_RETIRADA_CADA_MS = 24 * 3_600_000;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-monitor-secreto",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const responder = (cuerpo: unknown, estado = 200) =>
  new Response(JSON.stringify(cuerpo), { status: estado, headers: { ...CORS, "Content-Type": "application/json" } });
const iso = (ms = 0) => new Date(Date.now() + ms).toISOString();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return responder({ ok: false, error: "Usa POST" }, 405);

  const urlSupabase = Deno.env.get("SUPABASE_URL")!;
  const claveServicio = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const servicio = createClient(urlSupabase, claveServicio, { auth: { persistSession: false } });

  // ── Quién llama ──
  let origen = "";
  const secreto = req.headers.get("x-monitor-secreto");
  if (secreto) {
    const { data } = await servicio.rpc("monitor_secreto_valido", { p_secreto: secreto });
    if (data !== true) return responder({ ok: false, error: "Clave del barrido no válida" }, 401);
    origen = "barrido programado";
  } else {
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: auth } = await servicio.auth.getUser(jwt);
    const uid = auth?.user?.id;
    if (!uid) return responder({ ok: false, error: "Sesión no válida" }, 401);
    const { data: yo } = await servicio.from("User").select("role").eq("id", uid).maybeSingle();
    if (yo?.role !== "ADMIN") return responder({ ok: false, error: "Solo el administrador puede lanzar una revisión a mano" }, 403);
    origen = "administrador";
  }

  const cuerpo = await req.json().catch(() => ({}));
  const maximo = Math.max(1, Math.min(Number(cuerpo?.maximo ?? 3) || 3, 5));

  // ── Una sola revisión a la vez ──
  const { data: libre } = await servicio.rpc("monitor_adquirir", { p_segundos: 170 });
  if (libre !== true) return responder({ ok: true, ocupado: true, mensaje: "Ya hay una revisión en marcha; no se lanza otra." });

  try {
    // ── Qué productos publicados hay que vigilar ──
    const { data: proveedores } = await servicio.from("Supplier").select("id,type");
    const tipoDe = new Map<string, string>((proveedores ?? []).map((p: any) => [String(p.id), String(p.type)]));
    const { data: productos } = await servicio
      .from("Product")
      .select("id,userId,storeId,supplierId,supplierProductId,status")
      .eq("isMonitored", true)
      .in("status", ["ACTIVE", "OUT_OF_STOCK", "PAUSED"])
      .not("supplierProductId", "is", null)
      .limit(2000);
    const vigilados = (productos ?? []).filter((p: any) => tipoDe.has(String(p.supplierId)));
    if (!vigilados.length) return responder({ ok: true, origen, vigilados: 0, revisados: 0, mensaje: "No hay productos publicados que vigilar." });

    // Un mismo producto del proveedor puede estar publicado por varias personas: se revisa UNA vez y el aviso llega a todas
    const grupos = new Map<string, { provider: string; externalId: string; productos: any[] }>();
    for (const p of vigilados) {
      const provider = tipoDe.get(String(p.supplierId)) as string;
      const k = `${provider}|${p.supplierProductId}`;
      if (!grupos.has(k)) grupos.set(k, { provider, externalId: String(p.supplierProductId), productos: [] });
      grupos.get(k)!.productos.push(p);
    }

    // Artículos del catálogo común que corresponden, con su próxima revisión
    const externalIds = [...new Set([...grupos.values()].map((g) => g.externalId))];
    const { data: items } = await servicio.from("CatalogItem").select("id,provider,externalId,refreshDueAt").in("externalId", externalIds).in("provider", Object.keys(FUNCION));
    const itemDe = new Map<string, any>((items ?? []).map((i: any) => [`${i.provider}|${i.externalId}`, i]));

    const ahora = Date.now();
    const pendientes = [...grupos.entries()]
      .map(([k, g]) => ({ ...g, item: itemDe.get(k) }))
      .filter((g) => g.item && (!g.item.refreshDueAt || new Date(g.item.refreshDueAt + (String(g.item.refreshDueAt).endsWith("Z") ? "" : "Z")).getTime() <= ahora))
      .sort((a, b) => new Date(a.item.refreshDueAt ?? 0).getTime() - new Date(b.item.refreshDueAt ?? 0).getTime())
      .slice(0, maximo);
    const sinCatalogo = [...grupos.entries()].filter(([k]) => !itemDe.has(k)).length;

    // ── Revisión: un proveedor detrás de otro, en lotes de hasta 3 productos ──
    const resumen = { revisados: 0, conCambios: 0, cambios: 0, fallos: 0, llamadas: 0, avisosEnviados: 0 };
    const detalle: any[] = [];
    for (const provider of Object.keys(FUNCION)) {
      const delProveedor = pendientes.filter((g) => g.provider === provider);
      if (!delProveedor.length) continue;
      let res: Response;
      let json: any = {};
      try {
        res = await fetch(`${urlSupabase}/functions/v1/${FUNCION[provider]}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${claveServicio}`, "Content-Type": "application/json" },
          body: JSON.stringify({ accion: "refrescar", ids: delProveedor.map((g) => g.item.id) }),
          signal: AbortSignal.timeout(120_000),
        });
        json = await res.json().catch(() => ({}));
        if (!res.ok || !json?.ok) json = { ok: false, error: json?.error ?? `HTTP ${res.status}`, informe: [] };
      } catch (e) {
        json = { ok: false, error: (e as Error).message, informe: [] };
      }
      resumen.llamadas += Number(json?.llamadasACj ?? json?.llamadasAAliExpress ?? 0);

      for (const g of delProveedor) {
        const inf = (json.informe ?? []).find((x: any) => x.id === g.item.id);
        if (!inf?.ok) {
          resumen.fallos += 1;
          detalle.push({ provider, externalId: g.externalId, ok: false, error: inf?.error ?? json?.error ?? "Sin respuesta" });
          await servicio.from("CatalogItem").update({ refreshDueAt: iso(inf?.posibleRetirada ? 12 * 3_600_000 : REINTENTAR_FALLO_MS) }).eq("id", g.item.id);
          // Si el proveedor ya no devuelve el producto, se avisa a quienes lo tienen publicado (una vez al día como mucho)
          if (inf?.posibleRetirada) resumen.avisosEnviados += await avisarRetirada(servicio, g.productos, String(inf.error));
          continue;
        }
        resumen.revisados += 1;
        // Se descartan las oscilaciones de céntimos (la ficha sí se actualizó con el precio nuevo; solo no se avisa por ellas)
        const cambios: Cambio[] = ((inf.cambios ?? []) as Cambio[]).filter(esCambioRelevante);
        if (cambios.length) resumen.conCambios += 1;
        resumen.cambios += cambios.length;
        resumen.avisosEnviados += await anotarCambios(servicio, g.productos, cambios);
        await servicio.from("CatalogItem").update({ refreshDueAt: iso(REVISAR_CADA_MS) }).eq("id", g.item.id);
        await servicio.from("Product").update({ lastSyncedAt: iso(), lastSyncStatus: "SUCCESS", lastSyncError: null }).in("id", g.productos.map((p: any) => p.id));
        detalle.push({ provider, externalId: g.externalId, ok: true, cambios: cambios.map((c) => `${c.tipo}:${c.nombre}`) });
      }
    }

    return responder({
      ok: true, origen, vigilados: grupos.size, pendientesAntes: pendientes.length, sinCatalogo, ...resumen, detalle,
      mensaje: pendientes.length ? `${resumen.revisados} revisados · ${resumen.cambios} cambios · ${resumen.fallos} fallos` : "Todo está al día: ningún producto toca revisarse todavía.",
    });
  } catch (e) {
    return responder({ ok: false, error: `Error inesperado: ${(e as Error).message}` }, 500);
  } finally {
    await servicio.rpc("monitor_liberar");
  }
});

/** Escribe en el registro de cada persona que tiene publicado el producto un aviso por cada cambio. Devuelve cuántos avisos creó. */
async function anotarCambios(servicio: any, productos: any[], cambios: Cambio[]): Promise<number> {
  if (!cambios.length || !productos.length) return 0;
  const { data: variantes } = await servicio.from("ProductVariant").select("id,productId,supplierVariantId,sku").in("productId", productos.map((p) => p.id));
  const filas: any[] = [];
  for (const p of productos) {
    for (const c of cambios) {
      const v = (variantes ?? []).find((x: any) => x.productId === p.id && ((c.vid && x.supplierVariantId === c.vid) || (c.sku && x.sku === c.sku)));
      filas.push({
        userId: p.userId, storeId: p.storeId, supplierId: p.supplierId, productId: p.id, variantId: v?.id ?? null,
        type: c.tipo === "PRECIO_SUBE" || c.tipo === "PRECIO_BAJA" ? "PRICE_UPDATE" : c.tipo === "VARIANTE_NUEVA" || c.tipo === "VARIANTE_RETIRADA" ? "FULL_REFRESH" : "STOCK_UPDATE",
        status: "SUCCESS", level: esCambioDeRiesgo(c) ? "WARN" : "INFO",
        message: describirCambio(c),
        changes: { tipo: c.tipo, vid: c.vid, sku: c.sku, nombre: c.nombre, desde: c.antes, hasta: c.despues, pct: c.pct, field: c.tipo.startsWith("PRECIO") ? "costPrice" : "stock" },
      });
    }
  }
  const { error } = await servicio.from("SyncLog").insert(filas);
  return error ? 0 : filas.length;
}

/** Aviso de «el proveedor ya no devuelve este producto», sin repetirlo si ya se avisó en las últimas 24 horas. */
async function avisarRetirada(servicio: any, productos: any[], motivo: string): Promise<number> {
  let creados = 0;
  for (const p of productos) {
    const { count } = await servicio.from("SyncLog").select("id", { count: "exact", head: true }).eq("productId", p.id).eq("level", "WARN").eq("type", "FULL_REFRESH").contains("changes", { tipo: "RETIRADO" }).gte("createdAt", iso(-AVISO_RETIRADA_CADA_MS).slice(0, 19));
    if ((count ?? 0) > 0) continue;
    const { error } = await servicio.from("SyncLog").insert({
      userId: p.userId, storeId: p.storeId, supplierId: p.supplierId, productId: p.id, type: "FULL_REFRESH", status: "FAILED", level: "WARN",
      message: `El proveedor ya no devuelve este producto (${motivo}). Comprueba si sigue disponible antes de vender más unidades.`,
      changes: { tipo: "RETIRADO" },
    });
    if (!error) creados += 1;
  }
  return creados;
}
