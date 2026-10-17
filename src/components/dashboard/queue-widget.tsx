'use client';

import { useEffect, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, Clock, Play, Pause, RefreshCw, Zap } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/primitives';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/alert';
import type { QueueStats } from '@/lib/types';
import { cn, formatRelative } from '@/lib/utils';

interface MonitorPayload {
  stats: QueueStats;
  jobs: {
    id: string;
    name: string;
    status: string;
    progress: number;
    productId: string | null;
    scheduledFor: string | Date;
    attempts: number;
    maxAttempts: number;
    lastError: string | null;
  }[];
  scheduler: { enabled: boolean; intervalMinutes: number; nextRun: string | Date | null; patterns: (string | undefined)[]; mode: string };
  dataMode: string;
}

export function QueueWidget({ compact = false }: { compact?: boolean }) {
  const [data, setData] = useState<MonitorPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ variant: 'info' | 'success' | 'danger'; text: string } | null>(null);

  const load = async () => {
    try {
      const res = await fetch('/api/sync', { cache: 'no-store' });
      const json = await res.json();
      setData(json);
    } catch {
      /* reintenta en el siguiente tick */
    }
  };

  useEffect(() => {
    void load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, []);

  const action = async (body: Record<string, unknown>, successText: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const json = await res.json();
      setMessage({ variant: json.ok ? 'success' : 'danger', text: json.message ?? json.error ?? successText });
      await load();
    } catch (err) {
      setMessage({ variant: 'danger', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const stats = data?.stats;

  return (
    <Card className={compact ? '' : 'col-span-1'}>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-2 space-y-0">
        <div className="min-w-0 flex-1 basis-[200px]">
          <CardTitle className="flex flex-wrap items-center gap-x-2 gap-y-1">
            Cola de sincronización
            <Badge variant={stats?.mode === 'redis' ? 'success' : 'warning'}>{stats?.mode === 'redis' ? 'BullMQ + Redis' : 'en memoria'}</Badge>
          </CardTitle>
          <CardDescription>
            {data?.scheduler
              ? `Barrido automático cada ${data.scheduler.intervalMinutes} min · próxima ejecución ${formatRelative(data.scheduler.nextRun as any)}`
              : 'Cargando planificador…'}
          </CardDescription>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={() => action({ action: 'sweep' }, 'Barrido encolado')} disabled={busy}>
            <Zap className="size-3.5" />
            Barrido ahora
          </Button>
          <Button variant="outline" size="icon" onClick={load} aria-label="Refrescar" title="Refrescar">
            <RefreshCw className={cn('size-4', busy && 'animate-spin')} />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: 'En espera', value: stats?.waiting ?? 0, icon: Clock, tone: 'text-amber-400' },
            { label: 'En proceso', value: stats?.active ?? 0, icon: Activity, tone: 'text-sky-400' },
            { label: 'Completados', value: stats?.completed ?? 0, icon: CheckCircle2, tone: 'text-emerald-400' },
            { label: 'Fallidos', value: stats?.failed ?? 0, icon: AlertTriangle, tone: 'text-rose-400' },
          ].map(({ label, value, icon: Icon, tone }) => (
            <div key={label} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
                <Icon className={cn('size-3.5', tone)} />
              </div>
              <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
            </div>
          ))}
        </div>

        {message && (
          <Alert variant={message.variant} onDismiss={() => setMessage(null)}>
            {message.text}
          </Alert>
        )}

        {data && data.jobs.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px] uppercase tracking-wide text-muted-foreground">
              <span>Jobs recientes</span>
              <span>{data.jobs.length} mostrados</span>
            </div>
            <div className="max-h-[260px] space-y-1.5 overflow-y-auto pr-1 scroll-shadow">
              {data.jobs.slice(0, 8).map((job) => (
                <div key={job.id} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <StatusBadge status={job.status} />
                      <span className="truncate font-mono text-[11px] text-muted-foreground">{job.name} · {job.id.slice(0, 14)}</span>
                    </div>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {job.attempts}/{job.maxAttempts} · {formatRelative(job.scheduledFor as any)}
                    </span>
                  </div>
                  {job.status === 'RUNNING' && <Progress value={job.progress} className="mt-2" />}
                  {job.lastError && <p className="mt-1 truncate text-[11px] text-rose-400">{job.lastError}</p>}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-1.5">
          <Button variant="outline" size="sm" onClick={() => action({ action: 'retry-failed', limit: 50 }, 'Fallidos reintentados')} disabled={busy}>
            Reintentar fallidos
          </Button>
          <Button variant="outline" size="sm" onClick={() => action({ action: 'clear-completed' }, 'Histórico limpiado')} disabled={busy}>
            Limpiar completados
          </Button>
          <Button variant="ghost" size="sm" onClick={() => action({ action: stats?.paused ? 'resume' : 'pause' }, 'Estado cambiado')} disabled={busy}>
            {stats?.paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
            {stats?.paused ? 'Reanudar' : 'Pausar'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
