/**
 * src/lib/shopify-oauth.ts — Instalación de la app Shopify por OAuth.
 *
 * Con OAuth el cliente NO tiene que fabricar un token a mano: escribe el
 * dominio de su tienda, Shopify le pide autorizar los permisos y volvemos a
 * guardar el token cifrado en la base de datos. Es el flujo «Install app» que
 * usa cualquier app de la App Store.
 *
 * Requisitos (una vez, gratis):
 *   1. Crear una app en https://partners.shopify.com → Apps → Create app.
 *   2. En «App setup» poner la URL de redirección:
 *        https://TU-DOMINIO/api/shopify/callback
 *   3. Copiar Client ID → SHOPIFY_API_KEY y Client secret → SHOPIFY_API_SECRET.
 *      (En desarrollo Shopify permite `http://localhost:3000` como URL.)
 *
 * Seguridad: el `state` viaja firmado con el secreto (HMAC) y lleva el userId y
 * una marca de tiempo; así un tercero no puede completar el flujo por nosotros
 * ni podemos confundir de quién es la tienda. El `hmac` que devuelve Shopify en
 * el callback también se verifica antes de canjear el código.
 */
import crypto from 'node:crypto';
import { SHOPIFY_REQUIRED_SCOPES } from './shopify';

export function shopifyOAuthConfigured() {
  return Boolean(process.env.SHOPIFY_API_KEY && process.env.SHOPIFY_API_SECRET);
}

export function oauthScopes() {
  return (process.env.SHOPIFY_OAUTH_SCOPES ?? SHOPIFY_REQUIRED_SCOPES.join(',')).trim();
}

/** Dominio válido de tienda Shopify para OAuth: `algo.myshopify.com`. */
export function isValidShopDomain(shop: string) {
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop.trim());
}

export function normalizeOAuthShop(input: string) {
  return input.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
}

/** Firma el `state` con el secreto de la app (HMAC-SHA256 en base64url). */
export function signState(userId: string, nonce = crypto.randomBytes(8).toString('hex')) {
  const payload = `${userId}.${Date.now()}.${nonce}`;
  const sig = crypto.createHmac('sha256', process.env.SHOPIFY_API_SECRET ?? '').update(payload).digest('base64url');
  return `${Buffer.from(payload, 'utf8').toString('base64url')}.${sig}`;
}

/** Verifica y desempaqueta el `state` (caducidad: 15 minutos). */
export function readState(state: string | null): { userId: string } | null {
  if (!state || !process.env.SHOPIFY_API_SECRET) return null;
  const [payloadB64, sig] = state.split('.');
  if (!payloadB64 || !sig) return null;
  const payload = Buffer.from(payloadB64, 'base64url').toString('utf8');
  const expected = crypto.createHmac('sha256', process.env.SHOPIFY_API_SECRET).update(payload).digest('base64url');
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const [userId, ts] = payload.split('.');
  if (!userId || !ts) return null;
  if (Date.now() - Number(ts) > 15 * 60_000) return null;
  return { userId };
}

/** Verifica el `hmac` del callback de Shopify (se firma la query sin `hmac`/`signature`). */
export function verifyCallbackHmac(searchParams: URLSearchParams): boolean {
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) return false;
  const hmac = searchParams.get('hmac');
  if (!hmac) return false;

  const pairs: string[] = [];
  const keys = [...searchParams.keys()].filter((k) => k !== 'hmac' && k !== 'signature').sort();
  for (const key of keys) {
    const values = searchParams.getAll(key);
    for (const value of values) pairs.push(`${key}=${value}`);
  }
  const message = pairs.join('&');
  const expected = crypto.createHmac('sha256', secret).update(message).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(hmac.trim().toLowerCase(), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** URL a la que enviamos al comerciante para autorizar la app. */
export function buildInstallUrl(input: { shop: string; userId: string; appUrl: string }) {
  const redirectUri = `${input.appUrl.replace(/\/$/, '')}/api/shopify/callback`;
  const params = new URLSearchParams({
    client_id: process.env.SHOPIFY_API_KEY ?? '',
    scope: oauthScopes(),
    redirect_uri: redirectUri,
    state: signState(input.userId),
  });
  return `https://${normalizeOAuthShop(input.shop)}/admin/oauth/authorize?${params.toString()}`;
}

/** Canjea el `code` por un token de acceso permanente (offline). */
export async function exchangeCodeForToken(shop: string, code: string): Promise<{ ok: true; accessToken: string; scope: string } | { ok: false; error: string }> {
  if (!shopifyOAuthConfigured()) return { ok: false, error: 'Faltan SHOPIFY_API_KEY / SHOPIFY_API_SECRET en el entorno' };
  try {
    const res = await fetch(`https://${normalizeOAuthShop(shop)}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: process.env.SHOPIFY_API_KEY,
        client_secret: process.env.SHOPIFY_API_SECRET,
        code,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok || !json?.access_token) {
      return { ok: false, error: json?.error_description ?? json?.error ?? `HTTP ${res.status} al canjear el código` };
    }
    return { ok: true, accessToken: String(json.access_token), scope: String(json.scope ?? '') };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
