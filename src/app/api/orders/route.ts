/**
 * GET  /api/orders → pedidos con estado de fulfillment y tracking (monitor de envíos)
 * POST /api/orders → acciones: enviar al proveedor, forzar re-check de tracking
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getOrders, getOrdersSummary } from '@/lib/data';
import { enqueueOrderJob } from '@/lib/queue';
import { hasDatabase, prisma } from '@/lib/prisma';

import { apiTenant, requireUserId, withCurrentTenant } from '@/lib/tenant';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    return apiTenant(async (userId) => {
      const sp = new URL(req.url).searchParams;
      const [orders, summary] = await Promise.all([
        getOrders({
          status: sp.get('status') ?? undefined,
          fulfillment: sp.get('fulfillment') ?? undefined,
          search: sp.get('search') ?? undefined,
          limit: Number(sp.get('limit') ?? 50),
        }),
        getOrdersSummary(),
      ]);
      return NextResponse.json({ ok: true, orders, summary, mode: hasDatabase() ? 'postgres' : 'demo' });

    });
  }

const postSchema = z.object({
  action: z.enum(['push-to-supplier', 'tracking', 'mark-delivered']),
  orderId: z.string().min(1),
});

export async function POST(req: Request) {
    return apiTenant(async (userId) => {
      const parsed = postSchema.safeParse(await req.json().catch(() => ({})));
      if (!parsed.success) return NextResponse.json({ ok: false, error: 'Acción no válida' }, { status: 422 });
      const { action, orderId } = parsed.data;

      if (!hasDatabase()) {
        return NextResponse.json({
          ok: true,
          mode: 'demo',
          message:
            action === 'push-to-supplier'
              ? `Pedido encolado para envío al proveedor (simulado). Con Redis + PostgreSQL activos el worker lo procesa realmente.`
              : 'Acción simulada en modo demo',
        });
      }

      if (action === 'mark-delivered') {
        await prisma.order.update({ where: { id: orderId }, data: { status: 'DELIVERED', fulfillmentStatus: 'FULFILLED', deliveredAt: new Date() } });
        return NextResponse.json({ ok: true });
      }

      const job = await enqueueOrderJob({ orderId, action: action === 'tracking' ? 'tracking' : 'push' });
      return NextResponse.json({ ok: true, job });

    });
  }
