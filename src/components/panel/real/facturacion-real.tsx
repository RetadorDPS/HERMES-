'use client';

import { BillingView, type PlanView } from '@/app/(dashboard)/billing/billing-view';
import { obtenerPerfil, obtenerResumen } from '@/lib/real/datos';
import { PLANS, planFor } from '@/lib/plans';
import { PantallaReal, useCarga } from './comun';

export function FacturacionReal() {
  const { datos, error, cargando, recargar } = useCarga(async () => {
    const [resumen, cuenta] = await Promise.all([obtenerResumen(), obtenerPerfil()]);
    return { resumen, ...cuenta };
  });

  const planes: PlanView[] = Object.values(PLANS).map((p) => ({
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
  const plan = planFor((datos?.suscripcion?.plan ?? datos?.perfil?.plan ?? 'TRIAL') as any);

  return (
    <PantallaReal titulo="Facturación" subtitulo="Plan, consumo de créditos, método de pago y facturas" cargando={cargando} error={error} alRecargar={recargar} tour="screen:billing">
      {datos && (
        <BillingView
          plans={planes}
          lemonReady={false}
          currentProvider={datos.suscripcion?.stripeSubscriptionId ? 'stripe' : datos.suscripcion?.lemonSubscriptionId ? 'lemon' : null}
          current={{
            tier: plan.tier,
            name: plan.name,
            priceMonthly: plan.priceMonthly,
            status: datos.suscripcion?.status ?? 'TRIALING',
            renewsAt: datos.suscripcion?.currentPeriodEnd?.toISOString() ?? null,
            cancelAtPeriodEnd: datos.suscripcion?.cancelAtPeriodEnd ?? false,
          }}
          usage={{
            products: datos.resumen.productos,
            stores: datos.resumen.tiendas,
            supplierAccounts: datos.resumen.cuentasProveedor,
            creditsUsed: datos.suscripcion?.creditsUsed ?? 0,
            creditsLimit: datos.suscripcion?.creditsLimit ?? plan.creditsPerMonth,
          }}
          stripeConfigured={false}
        />
      )}
    </PantallaReal>
  );
}
