import { ArrowRight, CircleDot } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge, statusLabel } from '@/components/ui/badge';
import { cn, formatRelative } from '@/lib/utils';

export interface SyncLogRow {
  id: string;
  type: string;
  status: string;
  level: string;
  message: string;
  productTitle?: string | null;
  storeName?: string | null;
  changes?: { field: string; from: string | number; to: string | number } | null;
  durationMs: number;
  createdAt: Date | string;
}

const LEVEL_DOT: Record<string, string> = {
  INFO: 'text-sky-400',
  WARN: 'text-amber-400',
  ERROR: 'text-rose-400',
  DEBUG: 'text-slate-500',
};

export function SyncLogList({ logs, title = 'Actividad de sincronización', description }: { logs: SyncLogRow[]; title?: string; description?: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description ?? 'Últimas operaciones registradas en SyncLog (precio, stock, pedidos, errores)'}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-1">
        <div className="max-h-[420px] space-y-1 overflow-y-auto pr-1 scroll-shadow">
          {logs.map((l) => (
            <div key={l.id} className="group rounded-lg border border-transparent px-3 py-2.5 transition hover:border-white/[0.07] hover:bg-white/[0.02]">
              <div className="flex items-start gap-2.5">
                <CircleDot className={cn('mt-0.5 size-3.5 shrink-0', LEVEL_DOT[l.level] ?? 'text-slate-500')} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={l.type} />
                    <StatusBadge status={l.status} />
                    <span className="text-[11px] text-muted-foreground">{formatRelative(l.createdAt as any)}</span>
                    {l.durationMs > 0 && <span className="text-[11px] text-muted-foreground">· {l.durationMs} ms</span>}
                    {l.storeName && <span className="text-[11px] text-muted-foreground">· {l.storeName}</span>}
                  </div>
                  <p className="mt-1 text-[13px] leading-snug text-foreground/90">{l.message}</p>
                  {l.productTitle && <p className="mt-0.5 truncate text-[11px] text-muted-foreground">↳ {l.productTitle}</p>}
                  {l.changes?.field && (
                    <p className="mt-1 inline-flex items-center gap-1.5 rounded border border-white/[0.06] bg-white/[0.02] px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
                      {l.changes.field}
                      <ArrowRight className="size-3" />
                      {String(l.changes.from)} → <span className="text-foreground">{String(l.changes.to)}</span>
                    </p>
                  )}
                </div>
              </div>
            </div>
          ))}
          {logs.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted-foreground">Sin actividad registrada todavía.</p>}
        </div>
      </CardContent>
    </Card>
  );
}

export { statusLabel };
