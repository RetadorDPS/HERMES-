/**
 * GET  /api/sync           → monitor: estado de la cola, jobs, planificador y logs
 * POST /api/sync           → acciones: encolar sync de un producto, disparar barrido,
 *                            pausar/reanudar la cola, reprocesar fallidos
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSyncMonitor, getDefaultUserId } from '@/lib/data';
import { enqueueSyncJob, getQueue, getMemoryQueue, getQueueStats } from '@/lib/queue';
import { hasDatabase, prisma } from '@/lib/prisma';

import { apiTenant, requireUserId, withCurrentTenant } from '@/lib/tenant';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
    return apiTenant(async (userId) => {
      const monitor = await getSyncMonitor();
      return NextResponse.json({ ok: true, ...monitor, dataMode: hasDatabase() ? 'postgres' : 'demo' });

    });
  }

const postSchema = z.union([
  z.object({ action: z.literal('sync-product'), productId: z.string(), priority: z.coerce.number().min(1).max(10).optional() }),
  z.object({ action: z.literal('sweep'), priority: z.coerce.number().min(1).max(10).optional() }),
  z.object({ action: z.literal('pause') }),
  z.object({ action: z.literal('resume') }),
  z.object({ action: z.literal('retry-failed'), limit: z.coerce.number().min(1).max(200).optional() }),
  z.object({ action: z.literal('clear-completed') }),
]);

export async function POST(req: Request) {
    return apiTenant(async (userId) => {
      const parsed = postSchema.safeParse(await req.json().catch(() => ({})));
      if (!parsed.success) return NextResponse.json({ ok: false, error: 'Acción no válida' }, { status: 422 });
      const action = parsed.data;

      const useRedis = (() => {
        try {
          getQueue('sync');
          return true;
        } catch {
          return false;
        }
      })();

      // ── Modo demo (sin Redis ni PostgreSQL)
      if (!useRedis || !hasDatabase()) {
        const mem = getMemoryQueue('sync');
        switch (action.action) {
          case 'sync-product':
            await mem.add('sync:product', { productId: action.productId, type: 'FULL_REFRESH' }, { priority: action.priority ?? 1 });
            return NextResponse.json({ ok: true, mode: 'demo', message: `Job de sincronización encolado (modo demo) para ${action.productId}` });
          case 'sweep':
            for (let i = 0; i < 5; i++) await mem.add('sync:product', { productId: `demo-${i}`, type: 'FULL_REFRESH' }, { priority: 2 });
            return NextResponse.json({ ok: true, mode: 'demo', message: 'Barrido simulado: 5 productos encolados. Arranca los workers con `npm run worker` para procesarlos de verdad.' });
          case 'retry-failed':
            return NextResponse.json({ ok: true, mode: 'demo', message: 'Reintento no aplicable en modo demo' });
          case 'clear-completed':
            mem.clear();
            return NextResponse.json({ ok: true, mode: 'demo', message: 'Histórico de la cola demo limpiado' });
          default:
            return NextResponse.json({ ok: true, mode: 'demo', message: 'Acción simulada en modo demo' });
        }
      }

      // ── Modo real (Redis + PostgreSQL)
      const queue = getQueue('sync');

      switch (action.action) {
        case 'sync-product': {
          const job = await enqueueSyncJob(
            { productId: action.productId, type: 'FULL_REFRESH', userId: userId, reason: 'manual' },
            { priority: action.priority ?? 1 },
          );
          return NextResponse.json({ ok: true, mode: 'redis', job });
        }
        case 'sweep': {
          const job = await queue.add('sync:sweep', { type: 'sweep', reason: 'manual-sweep' }, { priority: action.priority ?? 1 });
          return NextResponse.json({ ok: true, mode: 'redis', job: { id: String(job.id) }, message: 'Barrido completo encolado' });
        }
        case 'pause':
          await queue.pause();
          return NextResponse.json({ ok: true, message: 'Cola pausada' });
        case 'resume':
          await queue.resume();
          return NextResponse.json({ ok: true, message: 'Cola reanudada' });
        case 'retry-failed': {
          const failed = await queue.getFailed(0, (action.limit ?? 50) - 1);
          await Promise.all(failed.map((j) => j.retry()));
          return NextResponse.json({ ok: true, retried: failed.length });
        }
        case 'clear-completed':
          await queue.clean(0, 1000, 'completed');
          return NextResponse.json({ ok: true });
      }

    });
  }

// health-check interno: evita tree-shaking de imports usados en runtime
void prisma;
void getQueueStats;
