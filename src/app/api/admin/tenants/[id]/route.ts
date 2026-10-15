/**
 * PATCH /api/admin/tenants/[id] — acciones del operador sobre un cliente.
 *
 * Body (todos opcionales):
 *   { plan?: 'TRIAL'|'STARTER'|'PRO'|'ENTERPRISE',   // cambia el plan (y sus límites)
 *     creditsLimit?: number,                         // fija el tope de créditos
 *     addCredits?: number,                           // suma (o resta) créditos disponibles
 *     resetCredits?: boolean,                        // reinicia el contador del ciclo
 *     role?: 'ADMIN'|'OWNER',                        // da/quita permisos de operador
 *     verifyEmail?: boolean }                        // marca el correo como verificado a mano
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { withSystem } from '@/lib/tenant-context';
import { currentAdmin, canOperate } from '@/lib/admin';
import { planFor } from '@/lib/plans';
import { audit } from '@/lib/account';
import { clientIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  plan: z.enum(['TRIAL', 'STARTER', 'PRO', 'ENTERPRISE']).optional(),
  creditsLimit: z.number().int().min(0).max(10_000_000).optional(),
  addCredits: z.number().int().min(-1_000_000).max(1_000_000).optional(),
  resetCredits: z.boolean().optional(),
  role: z.enum(['ADMIN', 'OWNER', 'MEMBER', 'SUPPORT']).optional(),
  verifyEmail: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const admin = await currentAdmin();
  if (!admin) return NextResponse.json({ ok: false, error: 'Sólo el administrador de la plataforma', code: 'FORBIDDEN' }, { status: 403 });
  if (!canOperate(admin)) {
    return NextResponse.json(
      { ok: false, error: 'Modo evaluación: no se pueden cambiar planes, créditos ni permisos sin iniciar sesión como administrador.', code: 'READ_ONLY' },
      { status: 403 },
    );
  }

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ ok: false, error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' · ') }, { status: 422 });
  const body = parsed.data;

  const target = await withSystem('admin: leer cliente antes de modificarlo', () =>
    prisma.user.findUnique({ where: { id: params.id }, select: { id: true, email: true, plan: true, role: true, subscription: { select: { creditsUsed: true, creditsLimit: true } } } }),
  );
  if (!target) return NextResponse.json({ ok: false, error: 'Ese cliente no existe' }, { status: 404 });

  // Protección: no dejarse sin operadores por accidente
  if (body.role && target.id === admin.userId && body.role !== 'ADMIN') {
    return NextResponse.json({ ok: false, error: 'No puedes quitarte a ti mismo el rol de administrador' }, { status: 400 });
  }

  const applied: string[] = [];

  await withSystem(`admin: modificar cliente ${target.email}`, async () => {
    if (body.plan) {
      const plan = planFor(body.plan);
      await prisma.user.update({ where: { id: target.id }, data: { plan: body.plan } });
      await prisma.subscription.upsert({
        where: { userId: target.id },
        update: { plan: body.plan, creditsLimit: body.creditsLimit ?? plan.creditsPerMonth },
        create: { userId: target.id, plan: body.plan, creditsLimit: body.creditsLimit ?? plan.creditsPerMonth },
      });
      applied.push(`plan=${body.plan}`);
    }

    const subPatch: { creditsLimit?: number; creditsUsed?: number } = {};
    if (typeof body.creditsLimit === 'number') {
      subPatch.creditsLimit = body.creditsLimit;
      applied.push(`límite de créditos=${body.creditsLimit}`);
    }
    if (body.resetCredits) {
      subPatch.creditsUsed = 0;
      applied.push('créditos reiniciados');
    }
    if (typeof body.addCredits === 'number' && body.addCredits !== 0) {
      const current = target.subscription?.creditsLimit ?? planFor(target.plan).creditsPerMonth;
      const used = target.subscription?.creditsUsed ?? 0;
      const remaining = Math.max(0, current - used) + body.addCredits;
      subPatch.creditsLimit = Math.max(0, used + remaining);
      applied.push(`${body.addCredits > 0 ? '+' : ''}${body.addCredits} créditos`);
    }
    if (Object.keys(subPatch).length) {
      await prisma.subscription.upsert({ where: { userId: target.id }, update: subPatch, create: { userId: target.id, plan: target.plan, ...subPatch } });
    }

    if (body.role) {
      await prisma.user.update({ where: { id: target.id }, data: { role: body.role } });
      applied.push(`rol=${body.role}`);
    }

    if (body.verifyEmail) {
      await prisma.user.update({ where: { id: target.id }, data: { emailVerifiedAt: new Date() } });
      applied.push('correo verificado a mano');
    }
  });

  await audit({
    userId: admin.userId,
    action: 'admin.tenant_updated',
    ip: clientIp(req),
    metadata: { target: target.email, applied },
  }).catch(() => undefined);

  const updated = await withSystem('admin: releer cliente modificado', () =>
    prisma.user.findUnique({
      where: { id: target.id },
      select: { id: true, email: true, plan: true, role: true, subscription: { select: { status: true, creditsUsed: true, creditsLimit: true } } },
    }),
  );

  return NextResponse.json({ ok: true, applied, tenant: updated });
}
