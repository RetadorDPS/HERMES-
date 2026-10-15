import { Topbar } from '@/components/layout/topbar';
import { getPricingRules, getStores, dataMode } from '@/lib/data';
import { ImportWorkspace } from './import-workspace';

import { withCurrentTenant } from '@/lib/tenant';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Importar producto por URL' };

export default async function ImportPage() {
    return withCurrentTenant(async (userId) => {
      const [rules, stores] = await Promise.all([getPricingRules(), getStores()]);
      const mode = dataMode();

      return (
        <>
          <Topbar
            title="Importar por URL"
            subtitle="Extrae un producto del proveedor, ajusta el margen y publícalo en tu tienda en un clic"
            mode={mode}
          />
          <div data-tour="screen:import" className="py-5">
            <ImportWorkspace
              mode={mode}
              rules={rules.map((r) => ({
                id: r.id,
                name: r.name,
                markupPct: Number(r.markupPct),
                fixedFee: Number(r.fixedFee ?? 0),
                minProfit: Number(r.minProfit ?? 0),
                roundTo: Number(r.roundTo ?? 0.99),
                minPrice: r.minPrice ?? null,
                maxPrice: r.maxPrice ?? null,
                includeShipping: r.includeShipping ?? true,
                isDefault: r.isDefault,
              }))}
              stores={stores.map((s) => ({ id: s.id, name: s.name, platform: s.platform, status: s.status }))}
            />
          </div>
        </>
      );

    });
  }
