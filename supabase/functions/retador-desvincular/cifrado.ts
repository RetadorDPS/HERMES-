/**
 * Lectura de la clave de Retador guardada (AES-GCM; la clave de cifrado sale del secreto del servidor, nunca de la base de datos).
 * Es EXACTAMENTE el mismo formato y la misma derivación que usa `retador-tienda` (retador.ts): `v1.<iv>.<datos>` en base64.
 */
export const esSimulado = (t: string): boolean => t.startsWith("dsp_sim_");

async function claveDerivada(): Promise<CryptoKey> {
  const base = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!base) throw new Error("Falta el secreto del servidor para descifrar");
  const enc = new TextEncoder();
  const material = await crypto.subtle.importKey("raw", enc.encode(base), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: enc.encode("dropshippilot"), info: enc.encode("token-tienda-v1") },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
}
const deB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function descifrar(valor: string): Promise<string> {
  const [version, iv, datos] = valor.split(".");
  if (version !== "v1" || !iv || !datos) throw new Error("clave ilegible");
  const claro = await crypto.subtle.decrypt({ name: "AES-GCM", iv: deB64(iv) }, await claveDerivada(), deB64(datos));
  return new TextDecoder().decode(claro);
}
