import { Topbar } from '@/components/layout/topbar';
import { getStores, getSuppliers, dataMode } from '@/lib/data';
import { StoreManager } from './store-manager';
import { shopifyOAuthConfigured } from '@/lib/shopify-oauth';

import { withCurrentTenant } from '@/lib/tenant';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Tiendas conectadas' };

export default async function StoresPage() {
    return withCurrentTenant(async (userId) => {
      const [stores, suppliers] = await Promise.all([getStores(), getSuppliers()]);

      return (
        <>
          <Topbar
            title="Tiendas conectadas"
            subtitle={`${stores.length} integraciones · Shopify (GraphQL Admin API) y WooCommerce (REST v3)`}
            mode={dataMode()}
          />
          <div data-tour="screen:stores" className="py-5">
            <StoreManager stores={stores as any} suppliers={suppliers} shopifyOAuth={shopifyOAuthConfigured()} />
          </div>
        </>
      );

    });
  }
