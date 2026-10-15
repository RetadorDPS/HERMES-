import { Topbar } from '@/components/layout/topbar';
import { getOrders, getOrdersSummary, dataMode } from '@/lib/data';
import { OrdersTable } from './orders-table';

import { withCurrentTenant } from '@/lib/tenant';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Pedidos y envíos' };

export default async function OrdersPage() {
    return withCurrentTenant(async (userId) => {
      const [orders, summary] = await Promise.all([getOrders({ limit: 60 }), getOrdersSummary()]);

      return (
        <>
          <Topbar
            title="Pedidos y monitor de envíos"
            subtitle="Fulfillment automático: compra al proveedor, tracking y aviso al cliente"
            mode={dataMode()}
          />
          <div data-tour="screen:orders" className="py-5">
            <OrdersTable orders={orders as any} summary={summary} />
          </div>
        </>
      );

    });
  }
