/**
 * monitor-proveedor — Vigila el precio y las existencias que el proveedor tiene HOY de los productos que los usuarios han publicado.
 *
 * Esta función NO habla con CJ ni con AliExpress: elige qué productos toca revisar y le pide a `cj-catalogo` / `ali-catalogo`
 * (cada una con su propia lógica) acciones internas. Después anota en el registro de cada usuario (SyncLog) los cambios que importan.
 * NUNCA cambia el precio de un producto publicado por su cuenta: solo avisa (el precio automático lo mueve `retador-tienda` con sus frenos).
 *
 * Después de revisar a cada proveedor, le pide a `retador-tienda` (acción interna `sincronizar`, en serie) que empuje a Retador lo que cambió.
 * Esta función no sabe nada de Retador: solo reparte el trabajo.
 *
 * COLA CON PRIORIDAD (cada producto se vuelve a mirar según lo importante que es):
 *   · URGENTE (cada 1 h): tiene pedidos pagados sin comprar o le quedan 5 existencias o menos;
 *   · NORMAL (cada 6 h): ha vendido en los últimos 30 días o se publicó hace menos de 7 días;
 *   · OCIOSO (cada 24 h): el resto.
 * Un mismo producto del proveedor publicado por varias personas se revisa UNA sola vez.
 *
 * PRESUPUESTO POR PROVEEDOR: se cuentan las llamadas de cada día y de cada proveedor (tabla `UsoProveedorDia`). Si el día tiene un tope
 * (`tope`; si no, un freno provisional nuestro), lo que no es urgente espera al día siguiente y lo urgente puede pasarlo un 10 %.
 * Si el proveedor dice que se le llama demasiado, se le deja descansar 20 minutos.
 *
 * UN SOLO PROVEEDOR A LA VEZ: el monitor y la puerta de los usuarios comparten el mismo turno por proveedor (`TurnoProveedor`).
 *
 * MANTENIMIENTO (con lo que sobre de presupuesto, poco a poco):
 *   · cada 14 días se completa de nuevo la ficha (así se renuevan las opiniones y los datos) — como mucho 2 por vuelta;
 *   · el envío por país: las cotizaciones de más de 5 días se renuevan (EE. UU. primero), como mucho 2 países por producto y vuelta.
 *
 * Quién puede llamarla: el barrido programado (clave `monitor_secreto` del almacén de secretos) o el administrador con su sesión.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { describirCambio, esCambioDeRiesgo, esCambioRelevante, type Cambio } from "./cambios.ts";

const FUNCION: Record<string, string> = { CJ_DROPSHIPPING: "cj-catalogo", ALIEXPRESS: "ali-catalogo" };
type Nivel = "urgente" | "normal" | "ocioso";
const INTERVALO_MS: Record<Nivel, number> = { urgente: 3_600_000, normal: 6 * 3_600_000, ocioso: 24 * 3_600_000 };
const ORDEN_NIVEL: Record<Nivel, number> = { urgente: 0, normal: 1, ocioso: 2 };
const REINTENTAR_FALLO_MS = 3_600_000;
const AVISO_RETIRADA_CADA_MS = 24 * 3_600_000;
const STOCK_BAJO = 5;
const NUEVO_DIAS_MS = 7 * 24 * 3_600_000;
const FICHA_COMPLETA_CADA_MS = 14 * 24 * 3_600_000;
const ENVIO_VIEJO_MS = 5 * 24 * 3_600_000;
const MAX_FICHAS_POR_VUELTA = 2;
const MAX_PAISES_ENVIO = 2;
const MAX_ENVIOS_POR_VUELTA = 3;
const REPOSO_LIMITE_MS = 20 * 60_000;
/** Freno provisional NUESTRO (llamadas por día y proveedor) mientras no se conozca el límite real: NO es un dato del proveedor. Se sustituye poniendo `tope` en `UsoProveedorDia`. */
const TOPE_PROVISIONAL: Record<string, number> = { CJ_DROPSHIPPING: 3000, ALIEXPRESS: 6000 };
/** Tiempo máximo (ms) desde que arranca la revisión para empezar nuevos lotes con un proveedor. */
const PRESUPUESTO_PROVEEDOR_MS = 95_000;
/** Tiempo máximo (ms) desde que arranca la revisión para empezar nuevas sincronizaciones con Retador; lo que falte se hace en la próxima vuelta. */
const PRESUPUESTO_SINCRONIZAR_MS = 130_000;
const PAUSA_ENTRE_SINCRONIZACIONES_MS = 400;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-monitor-secreto",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const responder = (cuerpo: unknown, estado = 200) =>
  new Response(JSON.stringify(cuerpo), { status: estado, headers: { ...CORS, "Content-Type": "application/json" } });
const iso = (ms = 0) => new Date(Date.now() + ms).toISOString();
const aMs = (v: unknown) => (v ? new Date(String(v) + (String(v).endsWith("Z") || /[+-]\d\d:?\d\d$/.test(String(v)) ? "" : "Z")).getTime() : 0);
const LIMITE_DEL_PROVEEDOR = /call.?limit|too many|frequency|rate.?limit/i;

interface Grupo {
  provider: string;
  externalId: string;
  productos: any[];
  item: any;
  nivel: Nivel;
}

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

  const inicio = Date.now();
  const cuerpo = await req.json().catch(() => ({}));
  const maximo = Math.max(1, Math.min(Number(cuerpo?.maximo ?? 6) || 6, 15));

  // ── Una sola revisión a la vez ──
  const { data: libre } = await servicio.rpc("monitor_adquirir", { p_segundos: 170 });
  if (libre !== true) return responder({ ok: true, ocupado: true, mensaje: "Ya hay una revisión en marcha; no se lanza otra." });

  try {
    // ── Qué productos publicados hay que vigilar ──
    const { data: proveedores } = await servicio.from("Supplier").select("id,type");
    const tipoDe = new Map<string, string>((proveedores ?? []).map((p: any) => [String(p.id), String(p.type)]));
    const { data: productos } = await servicio
      .from("Product")
      .select("id,userId,storeId,supplierId,supplierProductId,storeProductId,status,stockTotal,createdAt")
      .eq("isMonitored", true)
      .in("status", ["ACTIVE", "OUT_OF_STOCK", "PAUSED"])
      .not("supplierProductId", "is", null)
      .limit(2000);
    const vigilados = (productos ?? []).filter((p: any) => tipoDe.has(String(p.supplierId)));
    if (!vigilados.length) return responder({ ok: true, origen, vigilados: 0, revisados: 0, mensaje: "No hay productos publicados que vigilar." });

    // ── Importancia de cada producto: pedidos sin comprar, ventas recientes, poco stock ──
    const idsProductos = vigilados.map((p: any) => p.id);
    const { data: lineas } = await servicio.from("OrderItem").select("productId,orderId").in("productId", idsProductos).limit(5000);
    const idsPedidos = [...new Set((lineas ?? []).map((l: any) => l.orderId))];
    const { data: pedidos } = idsPedidos.length ? await servicio.from("Order").select("id,status,orderedAt").in("id", idsPedidos) : { data: [] as any[] };
    const estadoPedido = new Map<string, { status: string; en: number }>((pedidos ?? []).map((o: any) => [o.id, { status: String(o.status), en: aMs(o.orderedAt) }]));
    const abiertos = new Set<string>();
    const conVentas = new Set<string>();
    for (const l of lineas ?? []) {
      const o = estadoPedido.get(l.orderId);
      if (!o) continue;
      if (["PAID", "SUPPLIER_ERROR"].includes(o.status)) abiertos.add(l.productId);
      if (Date.now() - o.en < 30 * 24 * 3_600_000 && !["CANCELED", "REFUNDED"].includes(o.status)) conVentas.add(l.productId);
    }
    const nivelDeProducto = (p: any): Nivel => {
      if (abiertos.has(p.id) || (typeof p.stockTotal === "number" && p.stockTotal <= STOCK_BAJO && p.status === "ACTIVE")) return "urgente";
      if (conVentas.has(p.id) || Date.now() - aMs(p.createdAt) < NUEVO_DIAS_MS) return "normal";
      return "ocioso";
    };

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
    const { data: items } = await servicio.from("CatalogItem").select("id,provider,externalId,refreshDueAt,lastSyncedAt,rawPayload").in("externalId", externalIds).in("provider", Object.keys(FUNCION));
    const itemDe = new Map<string, any>((items ?? []).map((i: any) => [`${i.provider}|${i.externalId}`, i]));

    const ahora = Date.now();
    const completos: Grupo[] = [...grupos.entries()]
      .map(([k, g]) => ({ ...g, item: itemDe.get(k), nivel: g.productos.map(nivelDeProducto).sort((a, b) => ORDEN_NIVEL[a] - ORDEN_NIVEL[b])[0] as Nivel }))
      .filter((g) => g.item) as Grupo[];
    const sinCatalogo = grupos.size - completos.length;
    // Toca revisarlo si ya venció su plazo; y un producto que se ha vuelto URGENTE no espera a su plazo antiguo (24 h o 6 h)
    const tocaRevisar = (g: Grupo) => {
      const vence = aMs(g.item.refreshDueAt);
      if (!vence || vence <= ahora) return true;
      return g.nivel === "urgente" && vence - ahora > INTERVALO_MS.urgente && ahora - aMs(g.item.lastSyncedAt) > INTERVALO_MS.urgente;
    };
    const pendientes = completos
      .filter(tocaRevisar)
      .sort((a, b) => ORDEN_NIVEL[a.nivel] - ORDEN_NIVEL[b.nivel] || aMs(a.item.refreshDueAt) - aMs(b.item.refreshDueAt))
      .slice(0, maximo);

    const resumen = { revisados: 0, conCambios: 0, cambios: 0, fallos: 0, llamadas: 0, avisosEnviados: 0, sincronizados: 0, sincPausados: 0, sincSinCambios: 0, sincFallos: 0, fichasRenovadas: 0, enviosRenovados: 0, proveedoresOcupados: [] as string[], proveedoresEnReposo: [] as string[], omitidosPorPresupuesto: 0 };
    const sumarSync = (r: ResultadoSync) => {
      resumen.sincronizados += r.enviados;
      resumen.sincPausados += r.pausados;
      resumen.sincSinCambios += r.sinCambios;
      resumen.sincFallos += r.fallos;
    };
    const detalle: any[] = [];

    /** Llamada a un proveedor (cada uno con su propia función). Cuenta las llamadas del día y deja descansar al proveedor si dice que se le llama demasiado. */
    const llamarProveedor = async (provider: string, cuerpoLlamada: Record<string, unknown>): Promise<any> => {
      let json: any = {};
      try {
        const res = await fetch(`${urlSupabase}/functions/v1/${FUNCION[provider]}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${claveServicio}`, "Content-Type": "application/json" },
          body: JSON.stringify(cuerpoLlamada),
          signal: AbortSignal.timeout(120_000),
        });
        json = await res.json().catch(() => ({}));
        if (!res.ok || !json?.ok) json = { ...json, ok: false, error: json?.error ?? `HTTP ${res.status}`, informe: json?.informe ?? [] };
      } catch (e) {
        json = { ok: false, error: (e as Error).message, informe: [] };
      }
      const n = Number(json?.llamadasACj ?? json?.llamadasAAliExpress ?? 0);
      resumen.llamadas += n;
      const textos = [json?.error, ...(json?.informe ?? []).map((x: any) => x?.error)].filter(Boolean).join(" | ");
      const limite = LIMITE_DEL_PROVEEDOR.test(textos);
      await servicio.rpc("sumar_llamadas_proveedor", { p_proveedor: provider, p_llamadas: n, p_rechazos: limite ? 1 : 0 });
      if (limite) {
        await servicio.from("TurnoProveedor").update({ hasta: iso(REPOSO_LIMITE_MS) }).eq("proveedor", provider);
        resumen.proveedoresEnReposo.push(provider);
      }
      json.__limite = limite;
      return json;
    };

    /** ¿Cabe una llamada más de este proveedor hoy? Lo URGENTE puede pasarse un 10 % del tope. */
    const presupuesto = async (provider: string) => {
      const { data } = await servicio.from("UsoProveedorDia").select("llamadas").eq("proveedor", provider).eq("dia", new Date().toISOString().slice(0, 10)).maybeSingle();
      // El tope vigente es el último que se puso (vale hasta que se cambie); sin ninguno, el freno provisional
      const { data: ultimoTope } = await servicio.from("UsoProveedorDia").select("tope").eq("proveedor", provider).not("tope", "is", null).order("dia", { ascending: false }).limit(1).maybeSingle();
      const tope = typeof ultimoTope?.tope === "number" ? ultimoTope.tope : TOPE_PROVISIONAL[provider];
      const usadas = Number(data?.llamadas ?? 0);
      return { usadas, tope, holgado: usadas < tope, urgenteCabe: usadas < tope * 1.1 };
    };

    // ── Revisión: un proveedor detrás de otro, en lotes de 3 productos, mientras haya tiempo y presupuesto ──
    const hechosEstaVuelta = new Set<string>();
    for (const provider of Object.keys(FUNCION)) {
      const delProveedor = pendientes.filter((g) => g.provider === provider);
      // Aunque no toque revisar ningún precio, puede tocar el mantenimiento (ficha de hace 14 días o envío viejo)
      const haceFaltaMantenimiento = completos.some((g) => {
        const m = ((g.item.rawPayload ?? {}) as any).monitor ?? {};
        return g.provider === provider && g.nivel !== "ocioso" && (ahora - aMs(m.fichaCompletaEn) > FICHA_COMPLETA_CADA_MS || ahora - aMs(m.envioRevisadoEn) > ENVIO_VIEJO_MS);
      });
      if (!delProveedor.length && !haceFaltaMantenimiento) continue;
      const { data: turno } = await servicio.rpc("tomar_turno_proveedor", { p_proveedor: provider, p_segundos: 160 });
      if (turno !== true) {
        resumen.proveedoresOcupados.push(provider); // otra consulta (de un usuario) o el reposo tras un límite: se hará en la próxima vuelta
        continue;
      }
      try {
        for (let i = 0; i < delProveedor.length; i += 3) {
          if (Date.now() - inicio > PRESUPUESTO_PROVEEDOR_MS) break;
          const pres = await presupuesto(provider);
          const lote = delProveedor.slice(i, i + 3).filter((g) => (g.nivel === "urgente" ? pres.urgenteCabe : pres.holgado));
          resumen.omitidosPorPresupuesto += delProveedor.slice(i, i + 3).length - lote.length;
          if (!lote.length) continue;
          const json = await llamarProveedor(provider, { accion: "refrescar", ids: lote.map((g) => g.item.id) });

          for (const g of lote) {
            const inf = (json.informe ?? []).find((x: any) => x.id === g.item.id);
            if (!inf?.ok) {
              resumen.fallos += 1;
              detalle.push({ provider, externalId: g.externalId, nivel: g.nivel, ok: false, error: inf?.error ?? json?.error ?? "Sin respuesta" });
              await servicio.from("CatalogItem").update({ refreshDueAt: iso(inf?.posibleRetirada ? 12 * 3_600_000 : REINTENTAR_FALLO_MS) }).eq("id", g.item.id);
              // Si el proveedor ya no devuelve el producto, se avisa a quienes lo tienen publicado (una vez al día como mucho)
              if (inf?.posibleRetirada) {
                resumen.avisosEnviados += await avisarRetirada(servicio, g.productos, String(inf.error));
                // Y en Retador el producto se pausa: no se puede vender lo que el proveedor ya no tiene
                sumarSync(await sincronizarConRetador(urlSupabase, claveServicio, g.productos, { retirado: true }, inicio));
              }
              continue;
            }
            resumen.revisados += 1;
            hechosEstaVuelta.add(g.item.id);
            // Se descartan las oscilaciones de céntimos (la ficha sí se actualizó con el precio nuevo; solo no se avisa por ellas)
            const cambios: Cambio[] = ((inf.cambios ?? []) as Cambio[]).filter(esCambioRelevante);
            if (cambios.length) resumen.conCambios += 1;
            resumen.cambios += cambios.length;
            resumen.avisosEnviados += await anotarCambios(servicio, g.productos, cambios);
            await servicio.from("CatalogItem").update({ refreshDueAt: iso(INTERVALO_MS[g.nivel]) }).eq("id", g.item.id);
            await servicio.from("Product").update({ lastSyncedAt: iso(), lastSyncStatus: "SUCCESS", lastSyncError: null }).in("id", g.productos.map((p: any) => p.id));
            // Con la ficha ya al día, se empuja a Retador lo que haya cambiado (la propia función compara y solo manda lo nuevo)
            sumarSync(await sincronizarConRetador(urlSupabase, claveServicio, g.productos, {}, inicio));
            detalle.push({ provider, externalId: g.externalId, nivel: g.nivel, ok: true, cambios: cambios.map((c) => `${c.tipo}:${c.nombre}`) });
          }
          if (json.__limite) break; // el proveedor pide calma: se para con él
        }

        // ── Mantenimiento con lo que sobre (opiniones cada 14 días y envío viejo), solo con este proveedor y su turno ──
        if (!resumen.proveedoresEnReposo.includes(provider) && Date.now() - inicio < PRESUPUESTO_PROVEEDOR_MS) {
          const marca = (g: Grupo) => ((g.item.rawPayload ?? {}) as any).monitor ?? {};
          const delMismo = completos.filter((g) => g.provider === provider && g.nivel !== "ocioso").sort((a, b) => ORDEN_NIVEL[a.nivel] - ORDEN_NIVEL[b.nivel]);
          // a) Ficha completa de nuevo cada 14 días: renueva opiniones y datos
          const fichas = delMismo.filter((g) => ahora - aMs(marca(g).fichaCompletaEn) > FICHA_COMPLETA_CADA_MS).slice(0, MAX_FICHAS_POR_VUELTA);
          for (const g of fichas) {
            if (Date.now() - inicio > PRESUPUESTO_PROVEEDOR_MS || !(await presupuesto(provider)).holgado) break;
            const json = await llamarProveedor(provider, { accion: "detalle", ids: [g.item.id] });
            const ok = json?.ok && (json.informe ?? []).some((x: any) => x.id === g.item.id && x.ok);
            if (ok) {
              resumen.fichasRenovadas += 1;
              await servicio.from("CatalogItem").update({ rawPayload: { ...((g.item.rawPayload ?? {}) as any), monitor: { ...marca(g), fichaCompletaEn: iso() } } }).eq("id", g.item.id);
              sumarSync(await sincronizarConRetador(urlSupabase, claveServicio, g.productos, {}, inicio));
            }
            if (json.__limite) break;
          }
          // b) Envío por país: se renuevan las cotizaciones de más de 5 días (EE. UU. primero), máximo 2 países por producto y vuelta
          const candidatos = delMismo.filter((g) => ahora - aMs(marca(g).envioRevisadoEn) > ENVIO_VIEJO_MS && !fichas.includes(g)).slice(0, MAX_ENVIOS_POR_VUELTA);
          for (const g of candidatos) {
            if (Date.now() - inicio > PRESUPUESTO_PROVEEDOR_MS || !(await presupuesto(provider)).holgado) break;
            const { data: det } = await servicio.from("CatalogItemDetail").select("ficha").eq("itemId", g.item.id).maybeSingle();
            const viejos: { pais: string; en: number }[] = [];
            for (const porPais of Object.values((det?.ficha as any)?.envio?.porOrigen ?? {}) as any[]) {
              for (const [pais, q] of Object.entries(porPais ?? {}) as [string, any][]) {
                const en = aMs(q?.actualizado);
                if (/^[A-Z]{2}$/.test(pais) && pais !== "CU" && en && ahora - en > ENVIO_VIEJO_MS) viejos.push({ pais, en });
              }
            }
            const paises = [...new Map(viejos.sort((a, b) => (a.pais === "US" ? -1 : b.pais === "US" ? 1 : a.en - b.en)).map((v) => [v.pais, v])).keys()].slice(0, MAX_PAISES_ENVIO);
            if (paises.length) {
              const json = await llamarProveedor(provider, { accion: "envio", ids: [g.item.id], paises, forzar: true });
              if (json?.ok) {
                resumen.enviosRenovados += paises.length;
                sumarSync(await sincronizarConRetador(urlSupabase, claveServicio, g.productos, {}, inicio));
              }
              if (json.__limite) break;
            }
            // Se anota la revisión (aunque no hubiera nada viejo) para no volver a mirarlo en cada vuelta; si aún quedan países viejos, se mira antes
            const aunQuedan = viejos.length > paises.length;
            await servicio.from("CatalogItem").update({ rawPayload: { ...((g.item.rawPayload ?? {}) as any), monitor: { ...marca(g), envioRevisadoEn: aunQuedan ? iso(-ENVIO_VIEJO_MS + 3_600_000) : iso() } } }).eq("id", g.item.id);
          }
        }
      } finally {
        // Si el proveedor pidió descanso, el turno se queda ocupado hasta que pase; si no, se libera para los demás
        if (!resumen.proveedoresEnReposo.includes(provider)) await servicio.rpc("soltar_turno_proveedor", { p_proveedor: provider });
      }
    }

    const trabajo = resumen.revisados + resumen.fichasRenovadas + resumen.enviosRenovados;
    return responder({
      ok: true, origen, vigilados: grupos.size, pendientesAntes: pendientes.length, sinCatalogo, ...resumen, detalle,
      niveles: { urgente: completos.filter((g) => g.nivel === "urgente").length, normal: completos.filter((g) => g.nivel === "normal").length, ocioso: completos.filter((g) => g.nivel === "ocioso").length },
      mensaje: trabajo || pendientes.length
        ? `${resumen.revisados} revisados · ${resumen.cambios} cambios · ${resumen.fallos} fallos` + (resumen.fichasRenovadas ? ` · ${resumen.fichasRenovadas} fichas renovadas` : "") + (resumen.enviosRenovados ? ` · ${resumen.enviosRenovados} envíos renovados` : "") + (resumen.sincronizados || resumen.sincFallos ? ` · ${resumen.sincronizados} actualizados en Retador` + (resumen.sincPausados ? ` (${resumen.sincPausados} pausados por coste)` : "") + (resumen.sincFallos ? ` · ${resumen.sincFallos} sin poder sincronizar` : "") : "")
        : "Todo está al día: ningún producto toca revisarse todavía.",
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

interface ResultadoSync {
  enviados: number;
  pausados: number;
  sinCambios: number;
  fallos: number;
}

/**
 * Pide a `retador-tienda` que sincronice con Retador cada producto publicado (uno detrás de otro, con una pausa corta).
 * Nunca lanza: un fallo de Retador no debe parar la revisión de los proveedores; queda anotado en el registro del usuario por `retador-tienda`.
 * Si se acaba el tiempo de la revisión, lo que falte se hará en la próxima vuelta (la sincronización compara y solo manda lo nuevo).
 */
async function sincronizarConRetador(urlSupabase: string, claveServicio: string, productos: any[], opciones: { retirado?: boolean }, inicio: number): Promise<ResultadoSync> {
  const r: ResultadoSync = { enviados: 0, pausados: 0, sinCambios: 0, fallos: 0 };
  for (const p of productos) {
    if (!p.storeProductId) continue; // no está publicado en ninguna tienda
    if (Date.now() - inicio > PRESUPUESTO_SINCRONIZAR_MS) break;
    try {
      const res = await fetch(`${urlSupabase}/functions/v1/retador-tienda`, {
        method: "POST",
        headers: { Authorization: `Bearer ${claveServicio}`, "x-usuario": String(p.userId), "Content-Type": "application/json" },
        body: JSON.stringify({ accion: "sincronizar", productId: p.id, ...(opciones.retirado ? { retirado: true } : {}) }),
        signal: AbortSignal.timeout(45_000),
      });
      const json: any = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok !== true) r.fallos += 1;
      else if (json.pausado) { r.pausados += 1; r.enviados += 1; }
      else if (json.enviado) r.enviados += 1;
      else r.sinCambios += 1;
    } catch {
      r.fallos += 1;
    }
    await new Promise((fin) => setTimeout(fin, PAUSA_ENTRE_SINCRONIZACIONES_MS));
  }
  return r;
}
