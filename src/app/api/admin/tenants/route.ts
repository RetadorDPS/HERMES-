/**
 * GET /api/admin/tenants — panel del operador: métricas globales + clientes.
 * Sólo responde a usuarios con rol ADMIN (403 para el resto).
 */
import { NextResponse } from 'next/server';
import { currentAdmin, canOperate, platformOverview, tenantList } from '@/lib/admin';
import { fxStatus, toEur } from '@/lib/fx';

/** En modo evaluación los correos de clientes no se muestran en claro. */
function redact(email: string) {
  const [name, domain] = email.split('@');
  return `${name.slice(0, 2)}${'•'.repeat(Math.max(name.length - 2, 2))}@${domain ?? ''}`;
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const admin = await currentAdmin();
  if (!admin) {
    return NextResponse.json({ ok: false, error: 'Sólo el administrador de la plataforma puede abrir esta sección', code: 'FORBIDDEN' }, { status: 403 });
  }

  const [overview, tenants] = await Promise.all([platformOverview(), tenantList()]);

  // Cambio de divisa: el operador ve de dónde salen las tasas y si toca refrescar
  const fx = fxStatus();

  const masked = !canOperate(admin);

  return NextResponse.json({
    ok: true,
    admin: { email: masked ? redact(admin.email) : admin.email, source: admin.source, readOnly: admin.readOnly },
    fx: {
      source: fx.source,
      fetchedAt: fx.fetchedAt,
      ageHours: fx.ageHours,
      stale: fx.stale,
      refreshHours: fx.refreshHours,
      usd: fx.rates.USD ?? null,
      gbp: fx.rates.GBP ?? null,
      usdEur: toEur(1, 'USD'),
    },
    overview,
    tenants: tenants.map((t) => ({
      id: t.id,
      email: masked ? redact(t.email) : t.email,
      name: t.name,
      role: t.role,
      plan: t.plan,
      createdAt: t.createdAt,
      lastLoginAt: t.lastLoginAt,
      verified: Boolean(t.emailVerifiedAt),
      twoFactor: Boolean(t.totpEnabledAt),
      stores: t._count.stores,
      products: t._count.products,
      orders: t._count.orders,
      supplierAccounts: t._count.supplierAccounts,
      status: t.subscription?.status ?? 'TRIALING',
      provider: t.subscription?.lemonSubscriptionId ? 'lemon' : t.subscription?.stripeSubscriptionId ? 'stripe' : null,
      creditsUsed: t.subscription?.creditsUsed ?? 0,
      creditsLimit: t.subscription?.creditsLimit ?? 200,
      renewsAt: t.subscription?.currentPeriodEnd ?? null,
    })),
  });
}
