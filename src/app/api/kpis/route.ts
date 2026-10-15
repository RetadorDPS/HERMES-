/**
 * GET /api/kpis — KPIs del dashboard (ventas, beneficio, cola de sync, alertas)
 * Pensado para polling ligero desde el cliente cada 15 s.
 */
import { NextResponse } from 'next/server';
import { getKpis, getSyncLogs, getOrdersSummary } from '@/lib/data';
import { hasDatabase } from '@/lib/prisma';

import { apiTenant, requireUserId, withCurrentTenant } from '@/lib/tenant';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
    return apiTenant(async (userId) => {
      const [kpis, logs, orders] = await Promise.all([getKpis(), getSyncLogs({ limit: 25 }), getOrdersSummary()]);
      return NextResponse.json({ ok: true, kpis, logs, orders, mode: hasDatabase() ? 'postgres' : 'demo', at: new Date().toISOString() });

    });
  }
