import Link from 'next/link';
import { Info } from 'lucide-react';
import { Topbar } from '@/components/layout/topbar';
import { Alert } from '@/components/ui/alert';
import { dataMode } from '@/lib/data';
import { platformCredentialSummary } from '@/lib/catalog/platform-credentials';
import { withCurrentTenant } from '@/lib/tenant';
import { prisma, hasDatabase } from '@/lib/prisma';
import { PROVIDERS } from '@/lib/supplier-apis';
import { planFor } from '@/lib/plans';
import { SupplierWorkspace, type AccountView } from './supplier-workspace';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Proveedores y APIs' };

export default async function SuppliersPage() {
  const mode = dataMode();
  const platformKeys = await platformCredentialSummary().catch(() => []);
  const platformReady = platformKeys.filter((c) => c.configured && c.enabled);

  const data = await withCurrentTenant(async (userId) => {
    // Modo demostración (sin base de datos): ninguna cuenta de proveedor conectada
    if (!hasDatabase()) {
      const demo = planFor('PRO');
      return { view: [] as AccountView[], plan: { tier: demo.tier, name: demo.name, max: demo.maxSupplierAccounts, used: 0 } };
    }
    const [accounts, user, count] = await Promise.all([
      prisma.supplierAccount.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
      prisma.user.findUnique({ where: { id: userId }, select: { plan: true } }),
      prisma.supplierAccount.count({ where: { userId } }),
    ]);

    const plan = planFor(user?.plan);

    const view: AccountView[] = accounts.map((a) => ({
      id: a.id,
      provider: a.provider,
      label: a.label,
      status: a.status,
      isDefault: a.isDefault,
      lastTestAt: a.lastTestAt ? a.lastTestAt.toISOString() : null,
      lastError: a.lastError,
      createdAt: a.createdAt.toISOString(),
    }));

    return { view, plan: { tier: plan.tier, name: plan.name, max: plan.maxSupplierAccounts, used: count } };
  });

  return (
    <>
      <Topbar
        title="Proveedores y APIs"
        subtitle="Conecta las APIs oficiales de AliExpress, CJ y Amazon: datos reales sin captchas y compra automática de pedidos"
        mode={mode}
      />
      <div className="space-y-4 py-5">
        <Alert variant="info" title="Buena noticia: no hace falta que configures nada aquí">
          El catálogo y las importaciones funcionan con las claves de la plataforma
          {platformReady.length > 0 ? ` (${platformReady.map((c) => c.name).join(', ')} ya configuradas por el operador).` : '.'} Esta pantalla sólo sirve
          si quieres conectar <span className="font-medium">tu propia</span> cuenta de proveedor (por ejemplo para facturar a tu nombre o pedidos con tu
          tarjeta). Empieza explorando el{' '}
          <Link className="underline" href="/catalog">
            catálogo listo para importar
          </Link>
          .
        </Alert>
        <SupplierWorkspace providers={PROVIDERS} accounts={data.view} plan={data.plan} />
      </div>
    </>
  );
}
