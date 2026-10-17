import { Activity, Clock, Cpu, Database, ServerCog, Timer, Zap } from 'lucide-react';
import { Topbar } from '@/components/layout/topbar';
import { QueueWidget } from '@/components/dashboard/queue-widget';
import { SyncLogList } from '@/components/dashboard/sync-log-list';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/alert';
import { getSyncMonitor, getKpis, dataMode } from '@/lib/data';
import { formatNumber, formatRelative } from '@/lib/utils';

import { withCurrentTenant } from '@/lib/tenant';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Monitor de sincronización' };

export default async function MonitorPage() {
    return withCurrentTenant(async (userId) => {
      const [monitor, kpis] = await Promise.all([getSyncMonitor(), getKpis()]);
      const mode = dataMode();

      return (
        <>
          <Topbar
            title="Monitor de sincronización 24/7"
            subtitle={`Cola BullMQ · barrido cada ${monitor.scheduler.intervalMinutes} min · ${kpis.syncedLast24h} syncs correctas en 24 h`}
            mode={mode}
          />

          <div data-tour="screen:monitor" className="space-y-4 py-3">
            {monitor.stats.mode === 'demo' && (
              <Alert variant="warning" title="Cola en memoria (modo demo)">
                Sin <code className="rounded bg-black/30 px-1">REDIS_URL</code> los jobs no se procesan de verdad. Arranca Redis + PostgreSQL y ejecuta{' '}
                <code className="rounded bg-black/30 px-1">npm run worker</code> para activar el motor 24/7 (BullMQ + Prisma).
              </Alert>
            )}

            <div className="grid grid-cols-2 gap-2.5 sm:gap-3 xl:grid-cols-4">
              {[
                { label: 'Intervalo configurado', value: `${monitor.scheduler.intervalMinutes} min`, sub: 'SYNC_INTERVAL_MINUTES', icon: Timer },
                { label: 'Próximo barrido', value: formatRelative(monitor.scheduler.nextRun as any), sub: monitor.scheduler.mode === 'redis' ? 'BullMQ repeatable job' : 'planificador simulado', icon: Clock },
                { label: 'Sync correctas (24 h)', value: formatNumber(kpis.syncedLast24h), sub: `${formatNumber(kpis.failedLast24h)} fallidas`, icon: Activity },
                { label: 'Latencia media de sync', value: `${kpis.avgSyncMs} ms`, sub: 'scraping + API de tienda', icon: Cpu },
              ].map(({ label, value, sub, icon: Icon }) => (
                <Card key={label} className="p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
                    <Icon className="size-4 text-indigo-300" />
                  </div>
                  <p className="mt-1.5 text-xl font-semibold tabular-nums">{value}</p>
                  <p className="text-[11px] text-muted-foreground">{sub}</p>
                </Card>
              ))}
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <QueueWidget />

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ServerCog className="size-4 text-indigo-300" />
                    Arquitectura del motor 24/7
                  </CardTitle>
                  <CardDescription>Cómo funciona cada hora, paso a paso</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-[12px]">
                  {[
                    { step: '1', title: 'Barrido programado', text: `Un job repeatable encola todos los productos activos cada ${monitor.scheduler.intervalMinutes} min, escalonados para no saturar los proveedores.` },
                    { step: '2', title: 'Re-escaneo del proveedor', text: 'El scraper (Playwright + proxies) relanza la URL y devuelve precio y stock actuales por variante. Si el hash no cambia, se marca SKIPPED y no se llama a la tienda.' },
                    { step: '3', title: 'Recálculo de margen', text: 'Si cambió el coste, se aplica tu regla de pricing (markup, fee fijo, suelo de beneficio, redondeo x,99) y se actualiza el precio en Shopify/Woo.' },
                    { step: '4', title: 'Control de stock', text: 'Stock 0 en el proveedor → el producto se despublica al instante en la tienda. Al volver el stock, se reactiva solo.' },
                    { step: '5', title: 'Auditoría', text: 'Cada operación queda en SyncLog con diff before/after, duración, intentos y proxy utilizado.' },
                  ].map((s) => (
                    <div key={s.step} className="flex gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
                      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-indigo-500/15 text-[11px] font-semibold text-indigo-300">{s.step}</span>
                      <div>
                        <p className="font-medium">{s.title}</p>
                        <p className="mt-0.5 leading-relaxed text-muted-foreground">{s.text}</p>
                      </div>
                    </div>
                  ))}

                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <Badge variant="outline">
                      <Database className="size-3" />
                      PostgreSQL + Prisma
                    </Badge>
                    <Badge variant="outline">
                      <Zap className="size-3" />
                      BullMQ + Redis
                    </Badge>
                    <Badge variant="outline">
                      <Cpu className="size-3" />
                      FastAPI + Playwright
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            </div>

            <SyncLogList logs={monitor.logs} title="Stream de actividad del motor" />

            <Card>
              <CardHeader>
                <CardTitle className="text-[13px]">Comandos útiles del operador</CardTitle>
                <CardDescription>Ejecuta desde la raíz del proyecto</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-2 text-[12px] sm:grid-cols-2">
                {[
                  ['npm run worker', 'Arranca sync + orders workers (BullMQ)'],
                  ['npm run worker:sync', 'Sólo el worker de sincronización 24/7'],
                  ['npm run worker:orders', 'Sólo el worker de pedidos y tracking'],
                  ['npm run scraper:dev', 'Microservicio FastAPI + Playwright en :8000'],
                  ['npm run prisma:push && npm run prisma:seed', 'Crea el esquema y siembra datos de prueba'],
                  ['docker compose up -d', 'PostgreSQL + Redis + scraper service'],
                ].map(([cmd, desc]) => (
                  <div key={cmd} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5">
                    <code className="text-[11px] text-indigo-300">{cmd}</code>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{desc}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </>
      );

    });
  }
