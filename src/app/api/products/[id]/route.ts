/**
 * GET    /api/products/:id → ficha completa (variantes, imágenes, reseñas, logs, envíos)
 * PATCH  /api/products/:id → editar título, descripción, precio, margen, monitorización
 * POST   /api/products/:id → acción: sync inmediato / publicar / inyectar reseñas
 * DELETE /api/products/:id → borrar producto
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getProduct, updateProduct, deleteProduct, getDefaultUserId } from '@/lib/data';
import { enqueueSyncJob } from '@/lib/queue';
import { computeSellingPrice } from '@/lib/pricing';
import { hasDatabase, prisma } from '@/lib/prisma';

import { apiTenant, requireUserId, withCurrentTenant } from '@/lib/tenant';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
    return apiTenant(async (userId) => {
      const product = await getProduct(params.id);
      if (!product) return NextResponse.json({ ok: false, error: 'Producto no encontrado' }, { status: 404 });
      return NextResponse.json({ ok: true, product });

    });
  }

const patchSchema = z.object({
  title: z.string().min(3).max(255).optional(),
  description: z.string().optional(),
  sellingPrice: z.coerce.number().min(0.01).optional(),
  compareAtPrice: z.coerce.number().min(0).optional(),
  marginPct: z.coerce.number().min(0).max(2000).optional(),
  status: z.enum(['DRAFT', 'ACTIVE', 'PAUSED', 'OUT_OF_STOCK', 'ERROR', 'ARCHIVED']).optional(),
  isMonitored: z.boolean().optional(),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  autoUpdatePrice: z.boolean().optional(),
  autoUpdateStock: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
    return apiTenant(async (userId) => {
      const parsed = patchSchema.safeParse(await req.json());
      if (!parsed.success) return NextResponse.json({ ok: false, error: parsed.error.issues.map((i) => i.message).join(', ') }, { status: 422 });

      const patch = parsed.data;
      const current = await getProduct(params.id);
      if (!current) return NextResponse.json({ ok: false, error: 'Producto no encontrado' }, { status: 404 });

      // Si se cambia el margen, recalculamos precio de venta
      let recomputed: { sellingPrice: number; profit: number; marginPct: number } | undefined;
      if (patch.marginPct !== undefined && patch.sellingPrice === undefined) {
        const b = computeSellingPrice(current.costPrice, current.shippingCost, { markupPct: patch.marginPct });
        recomputed = { sellingPrice: b.sellingPrice, profit: b.profit, marginPct: patch.marginPct };
      }

      const updated = await updateProduct(params.id, {
        ...patch,
        ...(recomputed ? { sellingPrice: recomputed.sellingPrice, marginPct: recomputed.marginPct } : {}),
      });

      if (hasDatabase()) {
        const { writeSyncLog } = await import('@worker/lib');
        await writeSyncLog({
          userId: userId,
          productId: params.id,
          type: 'PRICE_UPDATE',
          status: 'SUCCESS',
          level: 'DEBUG',
          message: `Producto editado desde el panel: ${Object.keys(patch).join(', ')}`,
          changes: { from: { price: current.sellingPrice, title: current.title }, to: patch },
        });
      }

      return NextResponse.json({ ok: true, product: updated ?? null, recomputed });

    });
  }

const actionSchema = z.object({ action: z.enum(['sync', 'delete']), priority: z.coerce.number().min(1).max(10).optional() });

export async function POST(req: Request, { params }: { params: { id: string } }) {
    return apiTenant(async (userId) => {
      const parsed = actionSchema.safeParse(await req.json());
      if (!parsed.success) return NextResponse.json({ ok: false, error: 'Acción no válida' }, { status: 422 });

      if (parsed.data.action === 'delete') {
        const res = await deleteProduct(params.id);
        return NextResponse.json({ ok: res.ok });
      }

      if (!hasDatabase()) {
        return NextResponse.json({
          ok: true,
          job: { id: `mem_${Date.now().toString(36)}`, mode: 'demo' },
          message: 'Encolado en la cola en memoria (modo demo sin Redis). Levanta Redis + PostgreSQL para procesar de verdad.',
        });
      }

      const job = await enqueueSyncJob(
        { productId: params.id, type: 'FULL_REFRESH', userId: userId, reason: 'manual-single' },
        { priority: parsed.data.priority ?? 1 },
      );
      return NextResponse.json({ ok: true, job });

    });
  }

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
    return apiTenant(async (userId) => {
      const res = await deleteProduct(params.id);
      return NextResponse.json({ ok: res.ok });

    });
  }

// Evita warning de TS por prisma sin uso cuando el modo demo está activo
void prisma;
