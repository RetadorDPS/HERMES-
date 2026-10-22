/**
 * pedidos-barrido — Barrido programado (cada 5 minutos) de los pedidos de Retador.
 *
 * 1) Por cada tienda de Retador conectada (y que no sea la simulada) pide a `retador-tienda` la acción `pedidos_sincronizar`
 *    (una sola llamada a Retador por tienda).
 * 2) Solo para los usuarios que tienen el modo AUTOMATICO (que exige 3 compras reales antes), pide a `compras-proveedor` comprar
 *    los pedidos pagados que sigan pendientes (máximo 5 por barrido). Con cualquier otro modo NO compra nada.
 *
 * Quién puede llamarla: solo el barrido programado, con la clave `monitor_secreto` del almacén de secretos (la misma del monitor).
 * Todo va de una en una. Esta función no habla con ningún proveedor: la compra la hace `compras-proveedor`.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-monitor-secreto",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const responder = (cuerpo: unknown, estado = 200) => new Response(JSON.stringify(cuerpo), { status: estado, headers: { ...CORS, "Content-Type": "application/json" } });
const MAX_TIENDAS = 20;
const MAX_COMPRAS = 5;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return responder({ ok: false, error: "Usa POST" }, 405);
  const url = Deno.env.get("SUPABASE_URL")!;
  const clave = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const servicio = createClient(url, clave, { auth: { persistSession: false } });

  const secreto = req.headers.get("x-monitor-secreto");
  if (!secreto) return responder({ ok: false, error: "Falta la clave del barrido" }, 401);
  const { data: valido } = await servicio.rpc("monitor_secreto_valido", { p_secreto: secreto });
  if (valido !== true) return responder({ ok: false, error: "Clave del barrido no válida" }, 401);

  const llamar = async (funcion: string, usuario: string, cuerpo: Record<string, unknown>) => {
    const res = await fetch(`${url}/functions/v1/${funcion}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${clave}`, "x-usuario": usuario },
      body: JSON.stringify(cuerpo),
    });
    return await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  };

  const informe: Record<string, unknown> = { tiendas: 0, pedidosNuevos: 0, errores: [] as string[], compras: 0 };
  const errores = informe.errores as string[];

  // 1) Sincronizar los pedidos de cada tienda de Retador real y conectada
  const { data: tiendas } = await servicio.from("Store").select("id,userId,settings").eq("platform", "RETADOR").eq("status", "CONNECTED").limit(MAX_TIENDAS);
  for (const t of tiendas ?? []) {
    if ((t.settings as any)?.simulada) continue;
    const r = await llamar("retador-tienda", t.userId, { accion: "pedidos_sincronizar", storeId: t.id });
    informe.tiendas = (informe.tiendas as number) + 1;
    if (r?.ok) informe.pedidosNuevos = (informe.pedidosNuevos as number) + Number(r.nuevos ?? 0);
    else errores.push(`${t.id}: ${String(r?.error ?? "sin detalle").slice(0, 120)}`);
  }

  // 2) Compra automática, solo para quien la activó (la tabla puede no existir todavía: entonces no se hace nada)
  const { data: autos, error: eCfg } = await servicio.from("ConfigCompras").select("userId").eq("modo", "AUTOMATICO");
  if (!eCfg) {
    let hechas = 0;
    for (const a of autos ?? []) {
      const { data: ordenes } = await servicio.from("Order").select("id,errorMessage").eq("userId", a.userId).eq("status", "PAID").order("orderedAt", { ascending: true }).limit(10);
      for (const o of ordenes ?? []) {
        if (hechas >= MAX_COMPRAS) break;
        if (o.errorMessage) continue; // con aviso o con una compra fallida: lo revisa una persona
        const r = await llamar("compras-proveedor", a.userId, { accion: "comprar", orderId: o.id, aprobar: false });
        if (r?.comprado) hechas += 1;
        else if (r?.ok === false) errores.push(`compra ${o.id}: ${String(r?.error ?? "sin detalle").slice(0, 120)}`);
      }
    }
    informe.compras = hechas;
  }
  return responder({ ok: true, ...informe });
});
