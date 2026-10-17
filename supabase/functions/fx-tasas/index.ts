/**
 * fx-tasas — Tipos de cambio oficiales (Banco Central Europeo) para convertir el coste de los proveedores a euros.
 *
 * Guarda en la tabla FxRate «cuántos euros vale 1 unidad de cada moneda» con la fecha de publicación del BCE.
 * La puede llamar cualquier usuario con sesión, pero solo consulta al BCE si lo guardado tiene más de 12 horas,
 * así que no se puede abusar de ella. Nunca inventa un tipo: si el BCE no responde, devuelve lo que haya guardado
 * (con su fecha) o el error.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const ORIGEN = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";
const FRESCURA_MS = 12 * 3_600_000;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const responder = (cuerpo: unknown, estado = 200) =>
  new Response(JSON.stringify(cuerpo), { status: estado, headers: { ...CORS, "Content-Type": "application/json" } });

/** El BCE publica «unidades de cada moneda por 1 EUR». Se guarda lo inverso: euros por 1 unidad. */
export function leerBce(xml: string): { fecha: string | null; tasas: Record<string, number> } {
  const fecha = xml.match(/time=['"](\d{4}-\d{2}-\d{2})['"]/)?.[1] ?? null;
  const tasas: Record<string, number> = {};
  for (const m of xml.matchAll(/currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]/g)) {
    const porEuro = Number(m[2]);
    if (Number.isFinite(porEuro) && porEuro > 0) tasas[m[1]] = Math.round((1 / porEuro) * 1e6) / 1e6;
  }
  tasas.EUR = 1;
  return { fecha, tasas };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return responder({ ok: false, error: "Usa POST" }, 405);

  const servicio = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth } = await servicio.auth.getUser(jwt);
  if (!auth?.user?.id) return responder({ ok: false, error: "Sesión no válida" }, 401);

  const { data: previas } = await servicio.from("FxRate").select("currency,eurPerUnit,rateDate,fetchedAt");
  const ultima = Math.max(0, ...(previas ?? []).map((p: any) => new Date(p.fetchedAt).getTime()));
  if ((previas ?? []).length > 1 && Date.now() - ultima < FRESCURA_MS) {
    return responder({ ok: true, actualizadas: false, fecha: previas?.[0]?.rateDate ?? null, monedas: (previas ?? []).length });
  }

  let xml = "";
  try {
    const control = new AbortController();
    const t = setTimeout(() => control.abort(), 15_000);
    const res = await fetch(ORIGEN, { signal: control.signal });
    clearTimeout(t);
    if (!res.ok) throw new Error(`El BCE respondió ${res.status}`);
    xml = await res.text();
  } catch (e) {
    return responder({ ok: false, error: `No se pudo consultar al BCE: ${(e as Error).message}`, guardadas: (previas ?? []).length, ultimaConsulta: ultima ? new Date(ultima).toISOString() : null });
  }
  const { fecha, tasas } = leerBce(xml);
  const filas = Object.entries(tasas).map(([currency, eurPerUnit]) => ({ currency, eurPerUnit, rateDate: fecha, source: "BCE", fetchedAt: new Date().toISOString() }));
  if (filas.length < 10 || !tasas.USD) return responder({ ok: false, error: "La respuesta del BCE no tiene el formato esperado; no se guardó nada" });
  const { error } = await servicio.from("FxRate").upsert(filas, { onConflict: "currency" });
  if (error) return responder({ ok: false, error: `No se pudieron guardar los tipos: ${error.message}` });
  return responder({ ok: true, actualizadas: true, fecha, monedas: filas.length, usdEnEuros: tasas.USD });
});
