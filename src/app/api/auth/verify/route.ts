/**
 * GET  /api/auth/verify?token=…   → confirma el email (enlace del correo)
 * POST /api/auth/verify           → { email } reenvía el correo de verificación
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resendVerificationEmail, verifyEmailToken } from '@/lib/account';
import { clientIp, rateLimit, tooManyRequests } from '@/lib/rate-limit';
import { withSystem } from '@/lib/tenant-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get('token');
  if (!token) return NextResponse.json({ ok: false, error: 'Falta el token' }, { status: 400 });

  const user = await withSystem('verificación de email (pre-login)', () => verifyEmailToken(token));
  if (!user) {
    return NextResponse.json({ ok: false, error: 'El enlace no es válido o ha caducado. Pide uno nuevo.' }, { status: 400 });
  }
  return NextResponse.json({ ok: true, email: user.email, message: 'Email confirmado. Ya puedes iniciar sesión.' });
}

const resendSchema = z.object({ email: z.string().email() });

export async function POST(req: Request) {
  const limit = rateLimit(`verify-resend:${clientIp(req)}`, 5, 60 * 60_000, 30 * 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfterSeconds, 'Demasiados reenvíos. Prueba en un rato.');

  const parsed = resendSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Email no válido' }, { status: 422 });

  const email = parsed.data.email.trim().toLowerCase();

  // Reutiliza el emisor de tokens del módulo de cuentas (pre-login → modo sistema).
  const result = await withSystem('reenvío de verificación de email (pre-login)', () =>
    resendVerificationEmail(email, { ip: clientIp(req), userAgent: req.headers.get('user-agent') }),
  );

  if (!result) {
    return NextResponse.json({ ok: true, sent: true, message: 'Si la cuenta necesita verificación, recibirás un correo.' });
  }

  const expose = process.env.MAIL_EXPOSE_LINKS === 'true' || result.mail.transport === 'console';
  return NextResponse.json({ ok: true, sent: result.mail.ok, ...(expose ? { verifyUrl: result.verifyUrl } : {}) });
}
