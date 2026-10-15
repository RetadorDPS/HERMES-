/**
 * POST /api/auth/2fa-check — ¿La cuenta pide código de segundo factor?
 *
 * Se consulta ANTES de enviar el formulario para poder mostrar el campo del
 * código sin exponer un error confuso. Devuelve `required: false` tanto si la
 * cuenta no existe como si no tiene 2FA: sólo revela (de forma limitada por IP)
 * que una cuenta concreta usa segundo factor.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { hasDatabase, prisma } from '@/lib/prisma';
import { clientIp, rateLimit, tooManyRequests } from '@/lib/rate-limit';
import { withSystem } from '@/lib/tenant-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ email: z.string().email() });

export async function POST(req: Request) {
  const limit = rateLimit(`2fa-check:${clientIp(req)}`, 30, 10 * 60_000, 5 * 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfterSeconds);

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ ok: true, required: false });

  if (!hasDatabase()) return NextResponse.json({ ok: true, required: false });

  const email = parsed.data.email.trim().toLowerCase();
  const user = await withSystem('consulta pre-login del segundo factor', () =>
    prisma.user.findUnique({ where: { email }, select: { totpEnabledAt: true } }),
  );

  return NextResponse.json({ ok: true, required: Boolean(user?.totpEnabledAt) });
}
