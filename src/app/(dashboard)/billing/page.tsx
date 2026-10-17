import { Topbar } from '@/components/layout/topbar';
import { dataMode } from '@/lib/data';
import { withCurrentTenant, getCurrentUser } from '@/lib/tenant';
import { prisma, hasDatabase } from '@/lib/prisma';
import { PLANS, planFor } from '@/lib/plans';
import { stripeConfigured } from '@/lib/stripe';
import { lemonCheckoutReady, lemonCustomerPortalUrl } from '@/lib/lemon';
import { BillingView, type PlanView } from './billing-view';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Facturación' };

export default async function BillingPage() {
  const mode = dataMode();

  const data = await withCurrentTenant(async (userId) => {
    // Modo demostración (sin base de datos): plan Pro de ejemplo, en periodo de prueba
    if (!hasDatabase()) {
      const demo = planFor('PRO');
      return {
        tier: demo.tier,
        planName: demo.name,
        priceMonthly: demo.priceMonthly,
        status: 'TRIALING' as const,
        renewsAt: new Date('2026-11-01T00:00:00.000Z').toISOString(),
        cancelAtPeriodEnd: false,
        provider: null as 'lemon' | 'stripe' | null,
      };
    }
    const [user, subscription] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { plan: true } }),
      prisma.subscription.findUnique({ where: { userId } }),
    ]);
    const plan = planFor(user?.plan);
    return {
      tier: plan.tier,
      planName: plan.name,
      priceMonthly: plan.priceMonthly,
      status: subscription?.status ?? 'TRIALING',
      renewsAt: subscription?.currentPeriodEnd?.toISOString() ?? null,
      cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
      provider: subscription?.lemonSubscriptionId ? ('lemon' as const) : subscription?.stripeSubscriptionId ? ('stripe' as const) : null,
    };
  });

  const user = await getCurrentUser();

  const plans: PlanView[] = Object.values(PLANS).map((p) => ({
    tier: p.tier,
    name: p.name,
    priceMonthly: p.priceMonthly,
    priceYearly: p.priceYearly,
    maxProducts: p.maxProducts,
    maxStores: p.maxStores,
    maxSupplierAccounts: p.maxSupplierAccounts,
    creditsPerMonth: p.creditsPerMonth,
    syncIntervalMinutes: p.syncIntervalMinutes,
    proxiesIncluded: p.proxiesIncluded,
    support: p.support,
    highlights: p.highlights,
  }));

  return (
    <>
      <Topbar title="Facturación" subtitle="Plan, consumo de créditos, método de pago y facturas" mode={mode} />
      <div data-tour="screen:billing" className="py-3">
        <BillingView
          plans={plans}
          lemonReady={lemonCheckoutReady()}
          currentProvider={data.provider}
          current={{
            tier: data.tier,
            name: data.planName,
            priceMonthly: data.priceMonthly,
            status: data.status,
            renewsAt: data.renewsAt,
            cancelAtPeriodEnd: data.cancelAtPeriodEnd,
          }}
          usage={{
            products: user?.usage.products ?? 0,
            stores: user?.usage.stores ?? 0,
            supplierAccounts: user?.usage.supplierAccounts ?? 0,
            creditsUsed: user?.usage.creditsUsed ?? 0,
            creditsLimit: user?.usage.creditsLimit ?? 0,
          }}
          stripeConfigured={stripeConfigured()}
        />
      </div>
    </>
  );
}
