/**
 * src/lib/totp.ts — Segundo factor (TOTP, RFC 6238) sin dependencias externas.
 *
 * Compatible con Google Authenticator, Authy, 1Password, Bitwarden… Genera el
 * secreto (base32), la URI `otpauth://` para el QR y verifica los códigos de 6
 * dígitos aceptando ±1 intervalo de 30 s (relojes ligeramente desajustados).
 */
import crypto from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const DIGITS = 6;
const PERIOD = 30;

/** Codifica bytes en base32 (el formato que esperan las apps de autenticación). */
export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(secret: string): Buffer {
  const clean = secret.replace(/=+$/, '').toUpperCase().replace(/\s/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index === -1) throw new Error('Secreto 2FA no válido');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** Secreto nuevo (160 bits, como recomienda el RFC). */
export function generateSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

/** Código TOTP para un instante concreto. */
export function totpCode(secret: string, at: number = Date.now(), stepOffset = 0): string {
  const counter = Math.floor(at / 1000 / PERIOD) + stepOffset;
  const buffer = Buffer.alloc(8);
  buffer.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buffer.writeUInt32BE(counter >>> 0, 4);

  const hmac = crypto.createHmac('sha1', base32Decode(secret)).update(buffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);

  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

/**
 * Verifica un código. `window` = intervalos de tolerancia (±1 = 30 s antes y
 * después). Comparación en tiempo constante para no filtrar información.
 */
export function verifyTotp(secret: string, token: string, window = 1, at: number = Date.now()): boolean {
  const clean = String(token ?? '').replace(/\D/g, '');
  if (clean.length !== DIGITS) return false;
  if (!secret) return false;

  for (let offset = -window; offset <= window; offset += 1) {
    const expected = totpCode(secret, at, offset);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(clean))) return true;
  }
  return false;
}

/** URI que se convierte en QR para la app de autenticación. */
export function otpauthUrl(secret: string, account: string, issuer = 'DropshipPilot'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(PERIOD),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** Códigos de recuperación de un solo uso (para cuando se pierde el móvil). */
export function generateRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const raw = crypto.randomBytes(5).toString('hex').toUpperCase(); // 10 caracteres
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}

/** Se guardan hasheados: quien lea la base de datos no puede usarlos. */
export function hashRecoveryCode(code: string): string {
  return crypto.createHash('sha256').update(code.replace(/[\s-]/g, '').toUpperCase()).digest('hex');
}
