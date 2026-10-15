/**
 * Cifrado simétrico (AES-256-GCM) para credenciales sensibles:
 * tokens de Shopify, consumer secrets de Woo, API keys de proveedores.
 *
 * Formato almacenado: v1:<iv-b64>:<tag-b64>:<ciphertext-b64>
 */
import crypto from 'crypto';

const KEY_SOURCE = process.env.ENCRYPTION_KEY || process.env.NEXTAUTH_SECRET || 'dev-insecure-key-change-me';
const KEY = crypto.createHash('sha256').update(KEY_SOURCE).digest(); // 32 bytes

export function encryptSecret(plain: string): string {
  if (!plain) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

export function decryptSecret(payload: string | null | undefined): string {
  if (!payload) return '';
  if (!payload.startsWith('v1:')) return payload; // legacy / no cifrado
  try {
    const [, ivB64, tagB64, dataB64] = payload.split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

/** Enmascara un secreto para mostrarlo en UI: shpat_abcd…9f2c */
export function maskSecret(secret: string | null | undefined, visible = 4) {
  if (!secret) return '—';
  if (secret.length <= visible * 2) return '•'.repeat(secret.length);
  return `${secret.slice(0, visible)}${'•'.repeat(8)}${secret.slice(-visible)}`;
}

/** Verificación de firma HMAC de webhooks (Shopify / Stripe / Woo) */
export function verifyHmac(rawBody: string, hmacHeader: string, secret: string, algo: 'sha256' | 'base64' = 'base64') {
  if (!hmacHeader || !secret) return false;
  const digest = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest(algo === 'base64' ? 'base64' : 'hex');
  const a = Buffer.from(digest);
  const b = Buffer.from(hmacHeader);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
