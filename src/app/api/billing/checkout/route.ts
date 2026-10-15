/**
 * POST /api/billing/checkout — inicia la suscripción de un plan.
 * Body: { plan: 'STARTER'|'PRO'|'ENTERPRISE', interval?: 'monthly'|'yearly', provider?: 'stripe'|'lemon' }
 *
 * Dos cobradores posibles:
 *   • stripe → pasarela propia (requiere alta censal; tú gestionas el IVA)
 *   • lemon  → Lemon Squeezy, «merchant of record»: ellos son el vendedor legal
 *              y liquidan el IVA de cada país (ver PAGOS.md)
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createCheckoutSession } from '@/lib/stripe';
import { createLemonCheckout, lemonCheckoutReady } from '@/lib/lemon';
import { apiTenant } from '@/lib/tenant';
import { appUrl, audit } from '@/lib/account';
import { clientIp } from '@/lib/rate-limit';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  plan: z.enum(['STARTER', 'PRO', 'ENTERPRISE']),
  interval: z.enum(['monthly', 'yearly']).default('monthly'),
  provider: z.enum(['stripe', 'lemon']).default('stripe'),
});

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Plan no válido' }, { status: 422 });
  const { plan, interval, provider } = parsed.data;

  return apiTenant(async (userId) => {
    const result =
      provider === 'lemon'
        ? await (async () => {
            const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, name: true } });
            return createLemonCheckout({
              userId,
              email: user?.email ?? '',
              name: user?.name ?? null,
              tier: plan,
              interval,
              redirectUrl: appUrl('/billing?estado=ok&proveedor=lemon'),
            });
          })()
        : await createCheckoutSession({
            userId,
            tier: plan,
            interval,
            successUrl: appUrl('/billing?estado=ok'),
            cancelUrl: appUrl('/billing?estado=cancelado'),
          });

    if (result.ok) {
      await audit({ userId, action: 'billing.checkout_started', ip: clientIp(req), metadata: { plan, interval, provider } });
    }

    return NextResponse.json({ ...result, provider }, { status: result.ok ? 200 : result.configured ? 400 : 501 });
  });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    providers: {
      stripe: { configured: Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET) },
      lemon: { configured: lemonCheckoutReady() },
    },
    usage: 'POST { plan, interval, provider } → { ok, url }',
  });
}
