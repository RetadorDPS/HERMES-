/**
 * DELETE /api/account — Borrado de la cuenta y de todos mis datos (RGPD art. 17).
 *
 * Requiere confirmación explícita: `{ "confirm": "BORRAR MI CUENTA" }`. Si la
 * cuenta tiene contraseña, se pide también (`password`) para evitar que un
 * descuido o una sesión olvidada en un ordenador ajeno borre la cuenta.
 *
 * No es un «desactivar»: se borran cuenta, tiendas, productos, pedidos, reglas,
 * cuentas de proveedor y suscripción. El registro de auditoría se conserva
 * anonimizado (sin usuario) como rastro de que el borrado se pidió y se hizo.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiTenant } from '@/lib/tenant';
import { deleteUserAccount, CONFIRMATION } from '@/lib/account-data';
import { clientIp, rateLimit, tooManyRequests } from '@/lib/rate-limit';
import { prisma, hasDatabase } from '@/lib/prisma';
import { withSystem } from '@/lib/tenant-context';
import { verifyPassword } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  confirm: z.string(),
  password: z.string().optional(),
  reason: z.string().max(300).optional(),
});

export async function DELETE(req: Request) {
  return apiTenant(async (userId) => {
    const limit = rateLimit(`delete-account:${clientIp(req)}`, 5, 60 * 60_000, 60 * 60_000);
    if (!limit.ok) return tooManyRequests(limit.retryAfterSeconds, 'Demasiados intentos. Prueba en una hora.');

    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ ok: false, error: 'Falta la confirmación' }, { status: 422 });
    if (parsed.data.confirm.trim().toUpperCase() !== CONFIRMATION) {
      return NextResponse.json(
        { ok: false, error: `Para borrar la cuenta escribe exactamente: ${CONFIRMATION}`, code: 'CONFIRMATION_REQUIRED' },
        { status: 400 },
      );
    }

    // Cuentas con contraseña: se comprueba antes de destruir nada.
    if (hasDatabase()) {
      const user = await withSystem('borrado de cuenta: comprobar contraseña', () =>
        prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } }),
      );
      if (user?.passwordHash) {
        if (!parsed.data.password || !verifyPassword(parsed.data.password, user.passwordHash)) {
          return NextResponse.json({ ok: false, error: 'La contraseña no es correcta', code: 'BAD_PASSWORD' }, { status: 403 });
        }
      }
    }

    const result = await deleteUserAccount(userId, {
      ip: clientIp(req),
      userAgent: req.headers.get('user-agent'),
      reason: parsed.data.reason,
    });

    if (!result.ok) return NextResponse.json({ ok: false, error: result.error ?? result.warnings.join(' · ') }, { status: 500 });

    return NextResponse.json({
      ok: true,
      message: 'Tu cuenta y tus datos se han borrado. Sentimos verte marchar.',
      deleted: result.deleted,
      subscriptions: result.subscriptions,
      warnings: result.warnings,
    });
  });
}
