/**
 * POST /api/auth/forgot — solicita el enlace de restablecimiento de contraseña.
 * Body: { email }
 * Respuesta siempre neutra para no revelar qué emails están registrados.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requestPasswordReset } from '@/lib/account';
import { clientIp, rateLimit, tooManyRequests } from '@/lib/rate-limit';
import { hasDatabase } from '@/lib/prisma';
import { withSystem } from '@/lib/tenant-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ email: z.string().email() });

export async function POST(req: Request) {
  const limit = rateLimit(`forgot:${clientIp(req)}`, 5, 60 * 60_000, 30 * 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfterSeconds, 'Demasiadas solicitudes. Inténtalo más tarde.');

  if (!hasDatabase()) return NextResponse.json({ ok: false, error: 'Requiere base de datos' }, { status: 503 });

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Email no válido' }, { status: 422 });

  // Recuperación de contraseña: pre-login, sin inquilino en contexto.
  const result = await withSystem('solicitud de recuperación de contraseña (pre-login)', () =>
    requestPasswordReset(parsed.data.email, { ip: clientIp(req), userAgent: req.headers.get('user-agent') }),
  );
  const expose = process.env.MAIL_EXPOSE_LINKS === 'true';

  return NextResponse.json({
    ok: true,
    message: 'Si existe una cuenta con ese email, recibirás un enlace para restablecer la contraseña.',
    ...(expose && result.previewUrl ? { resetUrl: result.previewUrl } : {}),
  });
}
