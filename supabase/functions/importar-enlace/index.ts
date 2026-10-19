/**
 * importar-enlace — Punto central de «Importar por enlace».
 *
 * Esta función NO habla con CJ ni con AliExpress: lee el enlace, decide a qué función de proveedor le toca
 * (`cj-catalogo` o `ali-catalogo`, cada una con su propia lógica) y le pasa solo el identificador del producto.
 * Lo compartido (lector de enlaces, límite diario, exclusión mutua) vive aquí; lo de cada proveedor, en su función.
 *
 * Qué comprueba antes de gastar una sola llamada al proveedor:
 *   · sesión válida (cualquier usuario registrado),
 *   · enlace de CJ o AliExpress (solo sus dominios oficiales; un enlace corto de AliExpress se resuelve con salto a salto
 *     y cada salto debe seguir siendo de AliExpress),
 *   · si el producto ya está en el catálogo común con la ficha completa y reciente, no se llama al proveedor,
 *   · límite diario por persona y global (las llamadas gastan la cuota de la plataforma),
 *   · nunca dos importaciones a la vez contra el mismo proveedor (CJ y AliExpress cortan si se les llama en paralelo).
 *
 * Cuerpo: { url: string, destino?: "ES" }  → con destino, cotiza también el envío a ese país (pocas llamadas).
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { analizarEnlace, hostEsEnlaceCortoAli, hostPermitidoAli, type ProveedorEnlace } from "./enlaces.ts";

const FUNCION: Record<ProveedorEnlace, string> = { CJ_DROPSHIPPING: "cj-catalogo", ALIEXPRESS: "ali-catalogo" };
const NOMBRE: Record<ProveedorEnlace, string> = { CJ_DROPSHIPPING: "CJ Dropshipping", ALIEXPRESS: "AliExpress" };
const LIMITE_USUARIO_DIA = 15;
const LIMITE_GLOBAL_DIA = 120;
const VENTANA_BLOQUEO_MS = 120_000;
const FICHA_VIEJA_MS = 7 * 24 * 3_600_000; // una ficha de más de 7 días se vuelve a leer (el precio puede haber cambiado)
const COTIZACION_FRESCA_MS = 24 * 3_600_000;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const responder = (cuerpo: unknown, estado = 200) =>
  new Response(JSON.stringify(cuerpo), { status: estado, headers: { ...CORS, "Content-Type": "application/json" } });
const falla = (error: string, extra: Record<string, unknown> = {}) => responder({ ok: false, error, ...extra });
const ahoraIso = () => new Date().toISOString();

/** Resuelve un enlace corto de AliExpress siguiendo las redirecciones a mano, con tope de saltos y SOLO hacia dominios de AliExpress. */
async function resolverEnlaceCorto(inicial: string): Promise<string | null> {
  let actual = inicial;
  for (let salto = 0; salto < 4; salto += 1) {
    let u: URL;
    try { u = new URL(actual); } catch { return null; }
    if (!hostEsEnlaceCortoAli(u.hostname) && !hostPermitidoAli(u.hostname)) return null;
    if (analizarEnlace(actual).ok) return actual;
    // Las páginas de «compartir» llevan la dirección del producto dentro de un parámetro
    for (const k of ["redirectUrl", "url", "targetUrl"]) {
      const incrustada = u.searchParams.get(k);
      if (incrustada && analizarEnlace(incrustada).ok) return incrustada;
    }
    let res: Response;
    try {
      res = await fetch(actual, { redirect: "manual", headers: { "user-agent": "Mozilla/5.0 (compatible; DropshipPilot)" }, signal: AbortSignal.timeout(6_000) });
    } catch {
      return null;
    }
    await res.body?.cancel().catch(() => {});
    const destino = res.headers.get("location");
    if (!destino) return null;
    try { actual = new URL(destino, actual).toString(); } catch { return null; }
  }
  return null;
}

/** ¿Hay ya una cotización de envío a ese país hecha hace poco (sin error)? Así no se gasta ninguna llamada. */
function cotizacionFresca(ficha: any, destino: string): boolean {
  const reciente = (x: any) => x?.actualizado && Date.now() - new Date(x.actualizado).getTime() < COTIZACION_FRESCA_MS;
  const porOrigen = ficha?.envio?.porOrigen ?? {};
  if (Object.values(porOrigen).some((m: any) => reciente(m?.[destino]) && !m[destino].error)) return true;
  return Boolean(reciente(ficha?.envio?.sinServicio?.[destino]));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return responder({ ok: false, error: "Usa POST" }, 405);

  const urlSupabase = Deno.env.get("SUPABASE_URL")!;
  const claveServicio = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const servicio = createClient(urlSupabase, claveServicio, { auth: { persistSession: false } });

  // ── Sesión ──
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth } = await servicio.auth.getUser(jwt);
  const uid = auth?.user?.id;
  if (!uid) return responder({ ok: false, error: "Sesión no válida: vuelve a iniciar sesión" }, 401);

  const cuerpo = await req.json().catch(() => ({}));
  const destino: string | null = /^[a-z]{2}$/i.test(String(cuerpo?.destino ?? "")) ? String(cuerpo.destino).toUpperCase() : null;

  // ── Enlace ──
  let lectura = analizarEnlace(String(cuerpo?.url ?? ""));
  if (!lectura.ok && lectura.motivo === "enlace_corto" && lectura.enlaceCorto) {
    const larga = await resolverEnlaceCorto(lectura.enlaceCorto);
    lectura = larga
      ? analizarEnlace(larga)
      : { ok: false, motivo: "enlace_corto", mensaje: "No pude abrir ese enlace corto. Abre el producto en AliExpress, copia la dirección larga de la barra del navegador y pégala aquí." };
  }
  if (!lectura.ok) return falla(lectura.mensaje, { motivo: lectura.motivo });
  const { proveedor, pid, enlaceLimpio } = lectura;

  // ── ¿Ya está en el catálogo común con la ficha completa y reciente? ──
  const { data: item } = await servicio.from("CatalogItem").select("id,title").eq("provider", proveedor).eq("externalId", pid).maybeSingle();
  let ficha: any = null;
  if (item) {
    const { data: det } = await servicio.from("CatalogItemDetail").select("ficha").eq("itemId", item.id).maybeSingle();
    ficha = det?.ficha ?? null;
  }
  const fichaCompleta = ficha?.fuentes?.detalle === true;
  const fichaReciente = fichaCompleta && ficha?.actualizado && Date.now() - new Date(ficha.actualizado).getTime() < FICHA_VIEJA_MS;
  const haceFaltaFicha = !fichaReciente;
  const haceFaltaEnvio = Boolean(destino) && !cotizacionFresca(ficha, destino as string);
  if (!haceFaltaFicha && !haceFaltaEnvio && item) {
    return responder({ ok: true, itemId: item.id, proveedor, titulo: item.title, yaEstaba: true, llamadas: 0, avisos: [], mensaje: "Ese producto ya estaba en el catálogo con su ficha al día: no hizo falta llamar al proveedor." });
  }

  // ── Límites y exclusión mutua ──
  const desde24h = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const { count: delUsuario } = await servicio.from("ImportacionEnlace").select("id", { count: "exact", head: true }).eq("userId", uid).gte("createdAt", desde24h).neq("estado", "sin_llamada");
  if ((delUsuario ?? 0) >= LIMITE_USUARIO_DIA) return falla(`Has llegado al máximo de ${LIMITE_USUARIO_DIA} importaciones por enlace al día. Vuelve a intentarlo mañana; mientras tanto puedes usar el catálogo.`, { motivo: "limite_usuario" });
  const { count: globales } = await servicio.from("ImportacionEnlace").select("id", { count: "exact", head: true }).eq("provider", proveedor).gte("createdAt", desde24h).neq("estado", "sin_llamada");
  if ((globales ?? 0) >= LIMITE_GLOBAL_DIA) return falla(`Hoy ya se han hecho muchas importaciones desde ${NOMBRE[proveedor]} y se pausa para no agotar su cuota. Vuelve a intentarlo mañana.`, { motivo: "limite_global" });

  const { data: registro, error: eReg } = await servicio.from("ImportacionEnlace").insert({ userId: uid, provider: proveedor, externalId: pid, estado: "en_curso" }).select("id,createdAt").single();
  if (eReg || !registro) return falla("No se pudo preparar la importación. Inténtalo de nuevo en unos segundos.");
  const cerrar = async (estado: "ok" | "error" | "sin_llamada", mensaje: string | null) => {
    await servicio.from("ImportacionEnlace").update({ estado, mensaje: mensaje?.slice(0, 500) ?? null, updatedAt: ahoraIso() }).eq("id", registro.id);
  };
  // Solo pasa la importación más antigua que esté en curso contra este proveedor (desempate por identificador)
  const { data: enCurso } = await servicio
    .from("ImportacionEnlace").select("id")
    .eq("provider", proveedor).eq("estado", "en_curso").gte("createdAt", new Date(Date.now() - VENTANA_BLOQUEO_MS).toISOString())
    .order("createdAt", { ascending: true }).order("id", { ascending: true }).limit(1);
  if (enCurso?.[0] && enCurso[0].id !== registro.id) {
    await cerrar("sin_llamada", "Había otra importación en curso");
    return falla(`Hay otra importación en curso contra ${NOMBRE[proveedor]}. Espera unos segundos y vuelve a pulsar «Importar».`, { motivo: "ocupado" });
  }

  const llamarProveedor = async (cuerpoProveedor: Record<string, unknown>) => {
    const res = await fetch(`${urlSupabase}/functions/v1/${FUNCION[proveedor]}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${claveServicio}`, "Content-Type": "application/json" },
      body: JSON.stringify(cuerpoProveedor),
      signal: AbortSignal.timeout(110_000),
    });
    const json: any = await res.json().catch(() => ({}));
    return { res, json };
  };

  try {
    const avisos: string[] = [];
    let llamadas = 0;
    let itemId: string | undefined = item?.id;
    let titulo: string | undefined = item?.title;

    // 1) Producto y ficha completa
    if (haceFaltaFicha) {
      const { res, json } = await llamarProveedor({ accion: "importar", pid, pais: destino ?? "ES" });
      llamadas += Number(json?.llamadasACj ?? json?.llamadasAAliExpress ?? 0);
      const inf = json?.informe?.[0];
      if (!res.ok || !json?.ok || !inf?.ok) {
        const motivo = String(inf?.error ?? json?.error ?? `${NOMBRE[proveedor]} no respondió (HTTP ${res.status})`);
        await cerrar("error", motivo);
        return falla(motivo, { motivo: "proveedor", llamadas });
      }
      itemId = inf.id;
      titulo = inf.titulo ?? titulo;
      for (const a of inf.avisos ?? []) avisos.push(String(a));
    }

    // 2) Envío al país elegido (solo si falta una cotización reciente). Si falla, el producto ya está importado.
    if (destino && itemId) {
      const { data: det } = await servicio.from("CatalogItemDetail").select("ficha").eq("itemId", itemId).maybeSingle();
      if (!cotizacionFresca(det?.ficha, destino)) {
        const cuerpoEnvio: Record<string, unknown> = { accion: "envio", ids: [itemId], paises: [destino] };
        if (proveedor === "CJ_DROPSHIPPING") {
          // Como mucho los dos almacenes con más existencias: cada almacén es una llamada a CJ
          const conStock = ((det?.ficha?.origenes ?? []) as any[]).filter((o) => (o.total ?? 0) > 0).sort((a, b) => b.total - a.total).slice(0, 2).map((o) => String(o.pais));
          if (conStock.length) cuerpoEnvio.origenes = conStock;
        }
        const { res, json } = await llamarProveedor(cuerpoEnvio);
        llamadas += Number(json?.llamadasACj ?? json?.llamadasAAliExpress ?? 0);
        if (!res.ok || !json?.ok) avisos.push(`El producto se importó, pero no pude cotizar el envío a ${destino}: ${json?.error ?? `HTTP ${res.status}`}. Puedes volver a intentarlo.`);
      }
    }

    await cerrar("ok", null);
    return responder({ ok: true, itemId, proveedor, titulo, enlace: enlaceLimpio, yaEstaba: Boolean(item), llamadas, avisos, mensaje: item ? "Ficha del producto actualizada." : "Producto importado al catálogo." });
  } catch (e) {
    const mensaje = (e as Error).name === "TimeoutError" ? `${NOMBRE[proveedor]} tardó demasiado en responder. Inténtalo de nuevo en un momento.` : `Error inesperado: ${(e as Error).message}`;
    await cerrar("error", mensaje);
    return falla(mensaje, { motivo: "interno" });
  }
});
