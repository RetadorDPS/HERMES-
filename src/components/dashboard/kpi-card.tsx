import { ArrowDownRight, ArrowUpRight, type LucideIcon } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export function KpiCard({
  label,
  value,
  sub,
  trend,
  icon: Icon,
  accent = 'indigo',
}: {
  label: string;
  value: string;
  sub?: string;
  trend?: number;
  icon: LucideIcon;
  accent?: 'indigo' | 'emerald' | 'sky' | 'amber' | 'rose';
}) {
  const accents: Record<string, string> = {
    indigo: 'from-indigo-500/20 to-indigo-500/0 text-indigo-300',
    emerald: 'from-emerald-500/20 to-emerald-500/0 text-emerald-300',
    sky: 'from-sky-500/20 to-sky-500/0 text-sky-300',
    amber: 'from-amber-500/20 to-amber-500/0 text-amber-300',
    rose: 'from-rose-500/20 to-rose-500/0 text-rose-300',
  };

  return (
    <Card className="relative overflow-hidden p-5">
      <div className={cn('pointer-events-none absolute -right-8 -top-10 size-32 rounded-full bg-gradient-to-b opacity-70 blur-2xl', accents[accent])} />
      <div className="relative flex items-start justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="kpi-value mt-2">{value}</p>
          {(sub || trend !== undefined) && (
            <div className="mt-1.5 flex items-center gap-2 text-xs">
              {trend !== undefined && (
                <span className={cn('inline-flex items-center gap-0.5 font-semibold', trend >= 0 ? 'text-emerald-400' : 'text-rose-400')}>
                  {trend >= 0 ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
                  {Math.abs(trend).toFixed(1)}%
                </span>
              )}
              {sub && <span className="text-muted-foreground">{sub}</span>}
            </div>
          )}
        </div>
        <span className={cn('grid size-9 shrink-0 place-items-center rounded-lg border border-white/10 bg-gradient-to-br', accents[accent])}>
          <Icon className="size-4" />
        </span>
      </div>
    </Card>
  );
}
