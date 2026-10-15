/**
 * /api/security/totp — Segundo factor (TOTP) para la cuenta del cliente.
 *
 *   GET  → estado: { enabled, enabledAt, recoveryCodesLeft }
 *   POST → { action: 'setup' }                     → secreto + QR (sin activar)
 *          { action: 'enable', secret, code }      → activa y devuelve códigos
 *          { action: 'disable', password, code }   → desactiva
 *          { action: 'regenerate', password, code }→ nuevos códigos de recuperación
 *
 * El secreto se guarda CIFRADO (AES-256-GCM) y los códigos de recuperación
 * hasheados: ni leyendo la base de datos se puede entrar a la cuenta.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import QRCode from 'qrcode';
import { apiTenant } from '@/lib/tenant';
import { hasDatabase, prisma } from '@/lib/prisma';
import { decryptSecret, encryptSecret } from '@/lib/crypto';
import { audit } from '@/lib/audit';
import { clientIp, rateLimit, tooManyRequests } from '@/lib/rate-limit';
import { verifyPassword } from '@/lib/auth';
import { generateRecoveryCodes, generateSecret, hashRecoveryCode, otpauthUrl, verifyTotp } from '@/lib/totp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('setup') }),
  z.object({ action: z.literal('enable'), secret: z.string().min(16), code: z.string().min(6) }),
  z.object({ action: z.literal('disable'), password: z.string().min(1), code: z.string().min(6) }),
  z.object({ action: z.literal('regenerate'), password: z.string().min(1), code: z.string().min(6) }),
]);

export async function GET() {
  return apiTenant(async (userId) => {
    if (!hasDatabase()) return NextResponse.json({ ok: false, error: 'Sin base de datos' }, { status: 503 });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { totpEnabledAt: true, totpRecoveryCodes: true },
    });

    return NextResponse.json({
      ok: true,
      enabled: Boolean(user?.totpEnabledAt),
      enabledAt: user?.totpEnabledAt ?? null,
      recoveryCodesLeft: user?.totpRecoveryCodes.length ?? 0,
    });
  });
}

export async function POST(req: Request) {
  const limit = rateLimit(`totp:${clientIp(req)}`, 20, 10 * 60_000, 10 * 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfterSeconds);

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.issues.map((i) => i.message).join(', ') }, { status: 422 });
  }
  const body = parsed.data;

  return apiTenant(async (userId) => {
    if (!hasDatabase()) return NextResponse.json({ ok: false, error: 'Sin base de datos' }, { status: 503 });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, passwordHash: true, totpSecretEnc: true, totpEnabledAt: true, totpRecoveryCodes: true },
    });
    if (!user) return NextResponse.json({ ok: false, error: 'Cuenta no encontrada' }, { status: 404 });

    // ── 1. Generar secreto y QR (todavía sin activar) ──────────────────────
    if (body.action === 'setup') {
      if (user.totpEnabledAt) {
        return NextResponse.json({ ok: false, error: 'El segundo factor ya está activo. Desactívalo antes de generar uno nuevo.' }, { status: 409 });
      }

      const secret = generateSecret();
      const uri = otpauthUrl(secret, user.email);
      // El QR se genera como SVG en el servidor: la app no pide nada a Internet.
      const qrSvg = await QRCode.toString(uri, { type: 'svg', margin: 1, width: 220 });

      return NextResponse.json({ ok: true, secret, uri, qrSvg, digits: 6, period: 30 });
    }

    // ── 2. Activar comprobando un código real ─────────────────────────────
    if (body.action === 'enable') {
      if (user.totpEnabledAt) return NextResponse.json({ ok: false, error: 'El segundo factor ya está activo' }, { status: 409 });
      if (!verifyTotp(body.secret, body.code)) {
        return NextResponse.json({ ok: false, error: 'El código no es válido. Comprueba la hora del móvil y vuelve a intentarlo.' }, { status: 400 });
      }

      const codes = generateRecoveryCodes();
      await prisma.user.update({
        where: { id: userId },
        data: {
          totpSecretEnc: encryptSecret(body.secret),
          totpEnabledAt: new Date(),
          totpRecoveryCodes: codes.map(hashRecoveryCode),
        },
      });
      await audit({ userId, action: 'security.2fa_enabled', ip: clientIp(req) });

      return NextResponse.json({
        ok: true,
        recoveryCodes: codes,
        message: 'Segundo factor activado. Guarda los códigos de recuperación en un sitio seguro.',
      });
    }

    // ── 3. Desactivar / regenerar: exige contraseña + código válido ───────
    if (!user.totpEnabledAt || !user.totpSecretEnc) {
      return NextResponse.json({ ok: false, error: 'El segundo factor no está activo' }, { status: 409 });
    }
    if (!user.passwordHash || !verifyPassword(body.password, user.passwordHash)) {
      await audit({ userId, action: 'security.2fa_bad_password', ip: clientIp(req) });
      return NextResponse.json({ ok: false, error: 'Contraseña incorrecta' }, { status: 403 });
    }
    if (!verifyTotp(decryptSecret(user.totpSecretEnc), body.code)) {
      return NextResponse.json({ ok: false, error: 'El código del autenticador no es válido' }, { status: 403 });
    }

    if (body.action === 'disable') {
      await prisma.user.update({
        where: { id: userId },
        data: { totpSecretEnc: null, totpEnabledAt: null, totpRecoveryCodes: [] },
      });
      await audit({ userId, action: 'security.2fa_disabled', ip: clientIp(req) });
      return NextResponse.json({ ok: true, message: 'Segundo factor desactivado.' });
    }

    const codes = generateRecoveryCodes();
    await prisma.user.update({ where: { id: userId }, data: { totpRecoveryCodes: codes.map(hashRecoveryCode) } });
    await audit({ userId, action: 'security.2fa_codes_regenerated', ip: clientIp(req) });
    return NextResponse.json({ ok: true, recoveryCodes: codes, message: 'Códigos de recuperación renovados.' });
  });
}
