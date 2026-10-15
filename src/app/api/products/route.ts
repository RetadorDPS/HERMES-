/**
 * GET  /api/products  → listado paginado con filtros (búsqueda, estado, tienda, proveedor)
 * POST /api/products  → acciones masivas: sync masivo, cambiar monitorización, borrar
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getProducts, updateProduct, deleteProduct, getDefaultUserId } from '@/lib/data';
import { enqueueSyncJob } from '@/lib/queue';
import { hasDatabase, prisma } from '@/lib/prisma';

import { apiTenant, requireUserId, withCurrentTenant } from '@/lib/tenant';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    return apiTenant(async (userId) => {
      const sp = new URL(req.url).searchParams;
      const data = await getProducts({
        search: sp.get('search') ?? undefined,
        status: (sp.get('status') as any) ?? undefined,
        storeId: sp.get('storeId') ?? undefined,
        supplierId: sp.get('supplierId') ?? undefined,
        onlyProblems: sp.get('problems') === '1',
        sort: (sp.get('sort') as any) ?? undefined,
        page: Number(sp.get('page') ?? 1),
        limit: Number(sp.get('limit') ?? 12),
      });
      return NextResponse.json({ ok: true, ...data });

    });
  }

const bulkSchema = z.object({
  action: z.enum(['sync', 'monitor-on', 'monitor-off', 'pause', 'activate', 'delete']),
  productIds: z.array(z.string()).min(1, 'Selecciona al menos un producto'),
  priority: z.coerce.number().min(1).max(10).optional(),
});

export async function POST(req: Request) {
    return apiTenant(async (userId) => {
      const parsed = bulkSchema.safeParse(await req.json());
      if (!parsed.success) return NextResponse.json({ ok: false, error: parsed.error.issues.map((i) => i.message).join(', ') }, { status: 422 });

      const { action, productIds, priority } = parsed.data;
      // userId resuelto por el contexto de inquilino
      const results: { productId: string; ok: boolean; detail?: string }[] = [];

      for (const productId of productIds) {
        try {
          switch (action) {
            case 'sync': {
              if (!hasDatabase()) {
                results.push({ productId, ok: true, detail: 'Encolado en cola en memoria (modo demo)' });
                break;
              }
              const job = await enqueueSyncJob({ productId, type: 'FULL_REFRESH', userId, reason: 'manual-bulk' }, { priority: priority ?? 1 });
              results.push({ productId, ok: true, detail: `Job ${job.id} (${job.mode})` });
              break;
            }
            case 'monitor-on':
              await updateProduct(productId, { isMonitored: true });
              results.push({ productId, ok: true });
              break;
            case 'monitor-off':
              await updateProduct(productId, { isMonitored: false });
              results.push({ productId, ok: true });
              break;
            case 'pause':
              await updateProduct(productId, { status: 'PAUSED' });
              results.push({ productId, ok: true });
              break;
            case 'activate':
              await updateProduct(productId, { status: 'ACTIVE' });
              results.push({ productId, ok: true });
              break;
            case 'delete':
              await deleteProduct(productId);
              results.push({ productId, ok: true });
              break;
          }
        } catch (err) {
          results.push({ productId, ok: false, detail: (err as Error).message });
        }
      }

      const failed = results.filter((r) => !r.ok).length;
      return NextResponse.json({ ok: failed === 0, results, summary: { total: productIds.length, failed } });

    });
  }
