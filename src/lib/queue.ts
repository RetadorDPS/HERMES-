/**
 * src/lib/queue.ts — Cola de tareas (BullMQ + Redis) con fallback en memoria.
 *
 * Colas:
 *   • sync   → comprobación periódica de precio/stock por producto (24/7)
 *   • orders → envío automático de pedidos al proveedor y tracking
 *
 * Si REDIS_URL no está disponible, se usa una cola en memoria con la misma
 * interfaz, de modo que la app funciona sin infraestructura (modo demo).
 */
import { Queue, QueueEvents, Worker, type JobsOptions } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';
import type { QueueStats, SyncState } from './types';

export const QUEUE_NAMES = { sync: 'sync', orders: 'orders', catalog: 'catalog' } as const;
export type QueueName = keyof typeof QUEUE_NAMES;

export const DEFAULT_JOB_OPTS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { age: 3_600, count: 1_000 },
  removeOnFail: { age: 86_400 },
};

// ───────────────────────────── Conexión Redis ───────────────────────────────

let connection: Redis | null = null;
const redisEnabled = () => Boolean(process.env.REDIS_URL) && process.env.DISABLE_REDIS !== 'true';

export function getRedis(): Redis | null {
  if (!redisEnabled()) return null;
  if (!connection) {
    connection = new IORedis(process.env.REDIS_URL!, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: false,
      retryStrategy: (times) => (times > 5 ? null : Math.min(times * 500, 3_000)),
    });
    connection.on('error', (err) => console.warn('[redis] error:', err.message));
    connection.on('connect', () => console.log('[redis] conectado'));
  }
  return connection;
}

const queues = new Map<QueueName, Queue>();

export function getQueue(name: QueueName): Queue {
  const existing = queues.get(name);
  if (existing) return existing;
  const conn = getRedis();
  if (!conn) throw new Error('Redis no configurado');
  const q = new Queue(QUEUE_NAMES[name], {
    connection: conn,
    defaultJobOptions: DEFAULT_JOB_OPTS,
  });
  queues.set(name, q);
  return q;
}

// ───────────────────── Cola en memoria (fallback demo) ──────────────────────

interface MemJob {
  id: string;
  name: string;
  data: Record<string, unknown>;
  state: SyncState;
  progress: number;
  priority: number;
  createdAt: Date;
  processedAt?: Date;
  finishedAt?: Date;
  attempts: number;
  maxAttempts: number;
  lastError?: string;
}

class InMemoryQueue {
  readonly name: string;
  private jobs: MemJob[] = [];
  private handler?: (job: MemJob) => Promise<void>;
  private processing = false;
  private counter = 0;

  constructor(name: string) {
    this.name = name;
    // Histórico de ejemplo para que el monitor de la UI no aparezca vacío
    const now = Date.now();
    for (let i = 0; i < 24; i++) {
      this.jobs.push({
        id: `mem_${i}`,
        name: 'sync:product',
        data: {},
        state: i % 9 === 7 ? 'FAILED' : 'SUCCESS',
        progress: 100,
        priority: 2,
        createdAt: new Date(now - (i + 1) * 240_000),
        processedAt: new Date(now - (i + 1) * 240_000 + 1_200),
        finishedAt: new Date(now - (i + 1) * 240_000 + 3_400),
        attempts: 1,
        maxAttempts: 3,
        lastError: i % 9 === 7 ? 'Timeout del proveedor (proxy en cooldown)' : undefined,
      });
    }
  }

  setHandler(handler: (job: MemJob) => Promise<void>) {
    this.handler = handler;
    this.pump();
  }

  async add(name: string, data: Record<string, unknown>, opts: { priority?: number; delay?: number; jobId?: string } = {}) {
    const job: MemJob = {
      id: opts.jobId ?? `mem_${Date.now().toString(36)}_${this.counter++}`,
      name,
      data,
      state: 'QUEUED',
      progress: 0,
      priority: opts.priority ?? 5,
      createdAt: new Date(Date.now() + (opts.delay ?? 0)),
      attempts: 0,
      maxAttempts: (DEFAULT_JOB_OPTS.attempts as number) ?? 3,
    };
    this.jobs.push(job);
    if (opts.delay) setTimeout(() => this.pump(), opts.delay);
    else void this.pump();
    return job;
  }

  private async pump() {
    if (this.processing || !this.handler) return;
    this.processing = true;
    try {
      for (;;) {
        const next = this.jobs
          .filter((j) => j.state === 'QUEUED' && j.createdAt.getTime() <= Date.now())
          .sort((a, b) => a.priority - b.priority)[0];
        if (!next) break;
        next.state = 'RUNNING';
        next.processedAt = new Date();
        try {
          await this.handler(next);
          next.state = 'SUCCESS';
          next.progress = 100;
        } catch (err) {
          next.attempts += 1;
          next.lastError = (err as Error).message;
          next.state = next.attempts >= next.maxAttempts ? 'FAILED' : 'QUEUED';
        } finally {
          next.finishedAt = new Date();
        }
      }
    } finally {
      this.processing = false;
    }
  }

  stats(): QueueStats {
    return {
      waiting: this.jobs.filter((j) => j.state === 'QUEUED').length,
      active: this.jobs.filter((j) => j.state === 'RUNNING').length,
      completed: this.jobs.filter((j) => j.state === 'SUCCESS').length,
      failed: this.jobs.filter((j) => j.state === 'FAILED').length,
      delayed: 0,
      paused: false,
      mode: 'demo',
    };
  }

  list(limit = 25) {
    return [...this.jobs]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit)
      .map((j) => ({
        id: j.id,
        name: j.name,
        queue: this.name,
        status: j.state,
        progress: j.progress,
        priority: j.priority,
        productId: (j.data as any).productId ?? null,
        scheduledFor: j.createdAt,
        startedAt: j.processedAt ?? null,
        finishedAt: j.finishedAt ?? null,
        attempts: j.attempts,
        maxAttempts: j.maxAttempts,
        lastError: j.lastError ?? null,
      }));
  }

  clear() {
    this.jobs = this.jobs.filter((j) => j.state === 'RUNNING' || j.state === 'QUEUED');
  }
}

const memoryQueues = new Map<string, InMemoryQueue>();
export function getMemoryQueue(name: QueueName) {
  const key = QUEUE_NAMES[name];
  if (!memoryQueues.has(key)) memoryQueues.set(key, new InMemoryQueue(key));
  return memoryQueues.get(key)!;
}

export const queueMode = (): 'redis' | 'demo' => (redisEnabled() && connection !== null ? 'redis' : 'demo');

// ───────────────────────────── API unificada ────────────────────────────────

export async function enqueueSyncJob(
  data: { productId: string; type?: 'FULL_REFRESH' | 'PRICE_UPDATE' | 'STOCK_UPDATE'; userId?: string; reason?: string; forceStoreUpdate?: boolean },
  opts: { priority?: number; delay?: number; jobId?: string } = {},
) {
  const payload = { ...data, type: data.type ?? 'FULL_REFRESH' };
  try {
    const q = getQueue('sync');
    const job = await q.add('sync:product', payload, {
      priority: opts.priority ?? 5,
      delay: opts.delay,
      jobId: opts.jobId,
    });
    return { id: String(job.id), mode: 'redis' as const };
  } catch {
    const job = await getMemoryQueue('sync').add('sync:product', payload, opts);
    return { id: job.id, mode: 'demo' as const };
  }
}

export async function enqueueOrderJob(data: { orderId: string; userId?: string; action?: 'push' | 'tracking' }) {
  try {
    const q = getQueue('orders');
    const job = await q.add('order:push', data, { priority: 1, attempts: 5 });
    return { id: String(job.id), mode: 'redis' as const };
  } catch {
    const job = await getMemoryQueue('orders').add('order:push', data, { priority: 1 });
    return { id: job.id, mode: 'demo' as const };
  }
}

/**
 * Encola una sincronización del catálogo (descarga de productos del proveedor).
 * La ejecuta `workers/catalogWorker.ts`; si no hay Redis, el llamante decide
 * ejecutarla en línea (`syncCatalog`) para no dejarla sin hacer.
 */
export async function enqueueCatalogJob(data: { provider?: string; pages?: number; keyword?: string; categories?: boolean; reason?: string }) {
  try {
    const q = getQueue('catalog');
    const job = await q.add('catalog:sync', data, { priority: 2, jobId: `catalog-${data.provider ?? 'all'}-${Date.now()}` });
    return { id: String(job.id), mode: 'redis' as const };
  } catch {
    const job = await getMemoryQueue('catalog').add('catalog:sync', data, { priority: 2 });
    return { id: job.id, mode: 'demo' as const };
  }
}

export async function getQueueStats(): Promise<QueueStats> {
  try {
    const [sync, orders, catalog] = [getQueue('sync'), getQueue('orders'), getQueue('catalog')];
    const [sc, oc, cc, sActive, oActive, cActive, sDelayed, oDelayed, sPaused] = await Promise.all([
      sync.getJobCounts('wait', 'active', 'completed', 'failed', 'delayed'),
      orders.getJobCounts('wait', 'active', 'completed', 'failed', 'delayed'),
      catalog.getJobCounts('wait', 'active', 'completed', 'failed', 'delayed'),
      sync.getActiveCount(),
      orders.getActiveCount(),
      catalog.getActiveCount(),
      sync.getDelayedCount(),
      orders.getDelayedCount(),
      sync.isPaused(),
    ]);
    return {
      waiting: (sc.wait ?? 0) + (oc.wait ?? 0) + (cc.wait ?? 0),
      active: sActive + oActive + cActive,
      completed: (sc.completed ?? 0) + (oc.completed ?? 0) + (cc.completed ?? 0),
      failed: (sc.failed ?? 0) + (oc.failed ?? 0) + (cc.failed ?? 0),
      delayed: sDelayed + oDelayed,
      paused: sPaused,
      mode: 'redis',
    };
  } catch {
    const s = getMemoryQueue('sync').stats();
    const o = getMemoryQueue('orders').stats();
    return {
      waiting: s.waiting + o.waiting,
      active: s.active + o.active,
      completed: s.completed + o.completed,
      failed: s.failed + o.failed,
      delayed: 0,
      paused: false,
      mode: 'demo',
    };
  }
}

export async function listQueueJobs(limit = 25) {
  try {
    const jobs = await getQueue('sync').getJobs(['active', 'waiting', 'completed', 'failed', 'delayed'], 0, limit - 1, false);
    return jobs.map((j) => ({
      id: String(j.id),
      name: j.name,
      queue: QUEUE_NAMES.sync,
      status: (j.finishedOn && 'SUCCESS') || (j.processedOn && 'RUNNING') || (j.failedReason ? 'FAILED' : 'QUEUED'),
      progress: typeof j.progress === 'number' ? j.progress : 0,
      priority: j.opts.priority ?? 5,
      productId: (j.data as any)?.productId ?? null,
      scheduledFor: new Date(j.timestamp),
      startedAt: j.processedOn ? new Date(j.processedOn) : null,
      finishedAt: j.finishedOn ? new Date(j.finishedOn) : null,
      attempts: j.attemptsMade,
      maxAttempts: j.opts.attempts ?? 3,
      lastError: j.failedReason ?? null,
    }));
  } catch {
    return [...getMemoryQueue('sync').list(limit), ...getMemoryQueue('orders').list(limit)]
      .sort((a, b) => b.scheduledFor.getTime() - a.scheduledFor.getTime())
      .slice(0, limit);
  }
}

export async function getSchedulerInfo() {
  const intervalMin = Number(process.env.SYNC_INTERVAL_MINUTES ?? 60);
  try {
    const q = getQueue('sync');
    const repeatable = await q.getRepeatableJobs();
    return {
      enabled: repeatable.length > 0,
      intervalMinutes: intervalMin,
      nextRun: repeatable[0]?.next ? new Date(repeatable[0].next) : null,
      patterns: repeatable.map((r) => r.pattern ?? r.every),
      mode: 'redis' as const,
    };
  } catch {
    return {
      enabled: true,
      intervalMinutes: intervalMin,
      nextRun: new Date(Date.now() + intervalMin * 60_000),
      patterns: [`*/${intervalMin} * * * *`],
      mode: 'demo' as const,
    };
  }
}

/** Registra el planificador: cada SYNC_INTERVAL_MINUTES encola el barrido completo */
export async function registerRepeatableSync() {
  const intervalMin = Number(process.env.SYNC_INTERVAL_MINUTES ?? 60);
  const q = getQueue('sync');
  await q.add(
    'sync:sweep',
    { type: 'sweep', reason: 'scheduler' },
    {
      repeat: { pattern: `*/${intervalMin} * * * *` },
      jobId: 'sync:sweep-repeatable',
      removeOnComplete: true,
    },
  );
  console.log(`[queue] barrido programado cada ${intervalMin} min`);
}

export { Queue, QueueEvents, Worker };
