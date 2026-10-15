/**
 * POST /api/auth/reset — fija una contraseña nueva con el token del correo.
 * Body: { token, password }
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resetPassword } from '@/lib/account';
import { clientIp, rateLimit, tooManyRequests } from '@/lib/rate-limit';
import { withSystem } from '@/lib/tenant-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  token: z.string().min(10, 'Token no válido'),
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres'),
});

export async function POST(req: Request) {
  const limit = rateLimit(`reset:${clientIp(req)}`, 10, 60 * 60_000, 30 * 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfterSeconds);

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ ok: false, error: parsed.error.issues.map((i) => i.message).join(', ') }, { status: 422 });

  try {
    // Cambio de contraseña con token: también pre-login.
    const user = await withSystem('restablecimiento de contraseña con token (pre-login)', () =>
      resetPassword(parsed.data.token, parsed.data.password, { ip: clientIp(req) }),
    );
    if (!user) return NextResponse.json({ ok: false, error: 'El enlace no es válido o ha caducado. Solicita uno nuevo.' }, { status: 400 });
    return NextResponse.json({ ok: true, email: user.email, message: 'Contraseña actualizada. Ya puedes iniciar sesión.' });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 400 });
  }
}
