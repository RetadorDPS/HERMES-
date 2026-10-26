/**
 * Cliente del contrato DropshipPilot ⇄ Retador (docs/contrato-retador.md, versión 1), cifrado del token
 * y utilidades de contenido. Sin acceso a la base de datos: es solo lo que habla con Retador.
 */

const URL_RETADOR = "https://qsxtjuhueqdxoduyroli.supabase.co/functions/v1";
export const VERSION_CONTRATO = 1;
export const PREFIJO_SIMULADO = "dsp_sim_";
const FORMATO_TOKEN = /^dsp_[A-Za-z0-9_-]{16,80}$/;

export class ErrorRetador extends Error {
  constructor(public codigo: string, mensaje: string, public http = 0, public extra: Record<string, unknown> = {}) {
    super(mensaje);
  }
}

export const tokenConFormato = (t: string): boolean => FORMATO_TOKEN.test(t);
export const esSimulado = (t: string): boolean => t.startsWith(PREFIJO_SIMULADO);

/* ─────────────── Cifrado del token (AES-GCM; la clave sale del secreto del servidor, nunca de la base de datos) ─────────────── */

async function claveDerivada(): Promise<CryptoKey> {
  const base = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!base) throw new Error("Falta el secreto del servidor para cifrar");
  const enc = new TextEncoder();
  const material = await crypto.subtle.importKey("raw", enc.encode(base), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: enc.encode("dropshippilot"), info: enc.encode("token-tienda-v1") },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
const aB64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const deB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function cifrar(texto: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cifrado = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await claveDerivada(), new TextEncoder().encode(texto)));
  return `v1.${aB64(iv)}.${aB64(cifrado)}`;
}
export async function descifrar(valor: string): Promise<string> {
  const [version, iv, datos] = valor.split(".");
  if (version !== "v1" || !iv || !datos) throw new ErrorRetador("token_ilegible", "El token guardado no se puede leer. Vuelve a conectar Retador.");
  try {
    const claro = await crypto.subtle.decrypt({ name: "AES-GCM", iv: deB64(iv) }, await claveDerivada(), deB64(datos));
    return new TextDecoder().decode(claro);
  } catch {
    throw new ErrorRetador("token_ilegible", "El token guardado no se puede leer. Vuelve a conectar Retador.");
  }
}

/* ─────────────── Llamadas a Retador ─────────────── */

export type Accion = "config" | "publicar" | "actualizar" | "retirar" | "eliminar" | "estado" | "pedidos" | "pedido_estado" | "simular_pedido";

export async function llamarRetador(token: string, accion: Accion, cuerpo: Record<string, unknown> = {}): Promise<any> {
  const simulado = esSimulado(token);
  const url = simulado ? `${Deno.env.get("SUPABASE_URL")}/functions/v1/retador-simulado` : `${URL_RETADOR}/dropship-${accion.replaceAll("_", "-")}`;
  const cabeceras: Record<string, string> = { "Content-Type": "application/json", "x-dropship-token": token };
  if (simulado) {
    cabeceras["Authorization"] = `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`;
    cabeceras["x-accion"] = accion;
  }
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: cabeceras, body: JSON.stringify(cuerpo), signal: AbortSignal.timeout(90_000) });
  } catch (e) {
    throw new ErrorRetador("retador_no_responde", `No se pudo contactar con Retador (${(e as Error).name === "TimeoutError" ? "tardó demasiado" : "sin conexión"}). Inténtalo de nuevo en un momento.`);
  }
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* sin JSON legible */
  }
  if (!json || typeof json !== "object") {
    throw new ErrorRetador("respuesta_invalida", `Retador respondió algo que no se entiende (HTTP ${res.status}).`, res.status);
  }
  if (json.ok !== true) {
    const { ok: _ok, codigo, error, ...extra } = json;
    throw new ErrorRetador(String(codigo ?? `http_${res.status}`), String(error ?? `Retador rechazó la petición (HTTP ${res.status}).`), res.status, extra);
  }
  if (json.version_contrato !== VERSION_CONTRATO) {
    throw new ErrorRetador("version_contrato", `Retador usa la versión ${json.version_contrato ?? "desconocida"} del contrato y esta app espera la ${VERSION_CONTRATO}. Hay que actualizar uno de los dos lados.`);
  }
  return json;
}

/** Códigos que significan «este token ya no sirve»: la tienda pasa a error y se pide reconectar. */
export const CODIGOS_TOKEN_MUERTO = new Set(["token_invalido", "token_caducado", "token_ilegible", "vendedor_suspendido"]);

/** Config de Retador → tarifas en el formato de las cuentas. */
export function tarifasDeConfig(cfg: any) {
  const t = cfg?.tarifas ?? {};
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const hub = num(t.hub_usd_por_libra);
  const com = num(t.comision_pct_ganancia);
  const pct = num(t.pasarela_pct);
  const fija = num(t.pasarela_fija_usd);
  if (hub === null || com === null || pct === null || fija === null) return null;
  const dias = Array.isArray(t.dias_hub_cuba) && t.dias_hub_cuba.length === 2 ? [Number(t.dias_hub_cuba[0]), Number(t.dias_hub_cuba[1])] as [number, number] : ([0, 0] as [number, number]);
  return {
    hubUsdPorLibra: hub,
    diasHubCuba: dias,
    comisionPctGanancia: com,
    pasarelaPct: pct,
    pasarelaFijaUsd: fija,
    pasarelaACargo: t.pasarela_a_cargo === "comprador" ? ("comprador" as const) : t.pasarela_a_cargo === "retador" ? ("retador" as const) : ("vendedor" as const),
    comisionBase: t.comision_base === "precio_venta_menos_costo_cuba"
      ? ("precio_venta_menos_costo_cuba" as const)
      : t.comision_base === "precio_venta_menos_costo_producto_menos_pasarela"
        ? ("precio_venta_menos_costo_producto_menos_pasarela" as const)
        : ("precio_venta_menos_costo_producto" as const),
    ...(num(t.ganancia_minima_retador_usd) !== null ? { gananciaMinimaRetadorUsd: num(t.ganancia_minima_retador_usd) as number } : {}),
  };
}

/* ─────────────── Contenido ─────────────── */

const ORIGENES_IMAGEN = [/(^|\.)alicdn\.com$/i, /(^|\.)aliexpress-media\.com$/i, /(^|\.)cjdropshipping\.com$/i, /(^|\.)supabase\.co$/i];

export function imagenPermitida(url: unknown): url is string {
  if (typeof url !== "string") return false;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && ORIGENES_IMAGEN.some((r) => r.test(u.hostname));
  } catch {
    return false;
  }
}

const ENTIDADES: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'" };

/** HTML del proveedor → texto plano (Retador no admite HTML en la descripción). */
export function htmlATexto(html: string, max = 5000): string {
  const texto = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#?\w+);/g, (m, e) => ENTIDADES[e] ?? (/^#\d+$/.test(e) ? String.fromCharCode(Number(e.slice(1))) : m))
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return texto.length <= max ? texto : `${texto.slice(0, max - 1).trimEnd()}…`;
}

/** Recorta en el último espacio para no partir una palabra. */
export function recortar(texto: string, max: number): string {
  const t = texto.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const corte = t.slice(0, max - 1);
  const ultimo = corte.lastIndexOf(" ");
  return `${(ultimo > max * 0.6 ? corte.slice(0, ultimo) : corte).trimEnd()}…`;
}
