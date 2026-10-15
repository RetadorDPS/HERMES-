/**
 * POST /api/auth/register — Alta de un nuevo cliente del SaaS.
 * Body: { email, password, name?, plan? }
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { registerUser } from '@/lib/account';
import { clientIp, rateLimit, tooManyRequests } from '@/lib/rate-limit';
import { hasDatabase } from '@/lib/prisma';
import { withSystem } from '@/lib/tenant-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  email: z.string().email('Email no válido'),
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres'),
  name: z.string().max(80).optional(),
  plan: z.enum(['TRIAL', 'STARTER', 'PRO', 'ENTERPRISE']).optional(),
});

export async function POST(req: Request) {
  // 10 registros por hora y IP
  const limit = rateLimit(`register:${clientIp(req)}`, 10, 60 * 60_000, 15 * 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfterSeconds, 'Demasiados registros desde esta IP. Inténtalo más tarde.');

  if (!hasDatabase()) {
    return NextResponse.json({ ok: false, error: 'El registro necesita base de datos (DATABASE_URL no configurada)' }, { status: 503 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.issues.map((i) => i.message).join(', ') }, { status: 422 });
  }

  try {
    // Alta de cuenta: todavía no hay sesión, así que se ejecuta en modo
    // sistema (motivo explícito) sobre las tablas globales de cuentas.
    const { user, mail, verifyUrl } = await withSystem('alta de nuevo cliente (pre-login)', () =>
      registerUser({
        ...parsed.data,
        ip: clientIp(req),
        userAgent: req.headers.get('user-agent'),
      }),
    );

    // En desarrollo, si el correo sale por consola, devolvemos el enlace para
    // que el alta sea verificable sin configurar un servidor de correo.
    const expose = process.env.MAIL_EXPOSE_LINKS === 'true' || mail.transport === 'console';

    return NextResponse.json(
      {
        ok: true,
        user: { id: user.id, email: user.email, name: user.name, plan: user.plan, emailVerified: Boolean(user.emailVerifiedAt) },
        mail: { transport: mail.transport, ok: mail.ok, error: mail.error },
        ...(expose ? { verifyUrl } : {}),
        message:
          mail.ok
            ? 'Cuenta creada. Revisa tu correo para confirmarla.'
            : 'Cuenta creada, pero el correo de verificación no pudo enviarse. Usa «reenviar verificación» desde el panel.',
      },
      { status: 201 },
    );
  } catch (err) {
    const message = (err as Error).message;
    const status = message.includes('Ya existe') ? 409 : 400;
    await rateLimit(`register-fail:${clientIp(req)}`, 30, 60 * 60_000);
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
