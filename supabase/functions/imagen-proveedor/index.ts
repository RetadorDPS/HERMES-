/**
 * imagen-proveedor — sirve las fotos de los proveedores (CJ y AliExpress) desde nuestro propio servidor.
 *
 * Por qué: al pedirlas directo al servidor de imágenes del proveedor, en algunos móviles/redes muchas fotos no cargan
 * (se ven rotas o solo el texto). Aquí el navegador solo habla con Supabase, que sí responde.
 *
 * Reglas de seguridad (no es un proxy abierto):
 *  · solo GET, solo https y solo servidores de fotos de CJ y AliExpress (lista cerrada);
 *  · solo devuelve imágenes (nunca SVG ni otros tipos) de hasta 6 MB;
 *  · no manda cookies ni nada del usuario al proveedor, y no llama a la API del proveedor (solo descarga una foto pública),
 *    así que no gasta el cupo de llamadas de CJ ni de AliExpress.
 * Parámetro opcional `w` (240, 480 o 640): pide una versión reducida (más rápida en móvil) a los servidores que lo admiten
 * (AliExpress); si no existe, se sirve la original.
 */
const HOSTS = [/(^|\.)alicdn\.com$/i, /(^|\.)aliexpress-media\.com$/i, /(^|\.)cjdropshipping\.com$/i];
const ANCHOS = new Set([240, 480, 640]);
const MAX_BYTES = 6 * 1024 * 1024;
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "*" };

const fallo = (estado: number, texto: string) => new Response(texto, { status: estado, headers: { ...CORS, "Cache-Control": "no-store" } });

async function traer(url: string, accept: string): Promise<{ cuerpo: ArrayBuffer; tipo: string } | null> {
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36", Accept: accept },
      signal: AbortSignal.timeout(12_000),
    });
    if (!r.ok) return null;
    // Si hubo redirección, el destino también tiene que estar en la lista
    const destino = new URL(r.url);
    if (destino.protocol !== "https:" || !HOSTS.some((h) => h.test(destino.hostname))) return null;
    const tipo = (r.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!tipo.startsWith("image/") || tipo.includes("svg")) return null;
    const cuerpo = await r.arrayBuffer();
    if (cuerpo.byteLength === 0 || cuerpo.byteLength > MAX_BYTES) return null;
    return { cuerpo, tipo };
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "GET") return fallo(405, "Usa GET");

  const params = new URL(req.url).searchParams;
  let origen: URL;
  try {
    origen = new URL(params.get("u") ?? "");
  } catch {
    return fallo(400, "Dirección no válida");
  }
  if (origen.protocol !== "https:" || origen.username || origen.password || (origen.port && origen.port !== "443") || !HOSTS.some((h) => h.test(origen.hostname))) {
    return fallo(400, "Servidor de fotos no permitido");
  }
  const ancho = Number(params.get("w"));
  const accept = req.headers.get("accept") ?? "image/webp,image/*,*/*;q=0.8";

  // Versión reducida solo en los servidores de AliExpress (admiten «.jpg_480x480.jpg»); si no responde, la original
  const candidatas: string[] = [];
  if (ANCHOS.has(ancho) && /(^|\.)(alicdn\.com|aliexpress-media\.com)$/i.test(origen.hostname) && /\.(jpe?g|png|webp)$/i.test(origen.pathname)) {
    candidatas.push(`${origen.href}_${ancho}x${ancho}.jpg`);
  }
  candidatas.push(origen.href);

  for (const c of candidatas) {
    const foto = await traer(c, accept);
    if (foto) {
      return new Response(foto.cuerpo, {
        status: 200,
        headers: { ...CORS, "Content-Type": foto.tipo, "Cache-Control": "public, max-age=2592000, immutable", Vary: "Accept", "X-Content-Type-Options": "nosniff" },
      });
    }
  }
  return fallo(502, "No se pudo traer la foto");
});
