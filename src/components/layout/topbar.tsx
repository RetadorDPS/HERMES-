'use client';

import { useEffect, useState } from 'react';
import { Activity, ChevronRight, CircleDollarSign, Menu, Server, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useSesion } from '@/components/auth/sesion';
import { UserMenu } from './user-menu';
import { EVENTO_ABRIR_MENU } from './sidebar';

interface HealthCheck {
  ok: boolean;
  detail: string;
  latencyMs?: number;
}

export function Topbar({ title, subtitle, mode, authEnabled = false }: { title: string; subtitle?: string; mode: 'demo' | 'postgres'; authEnabled?: boolean }) {
  const [health, setHealth] = useState<Record<string, HealthCheck> | null>(null);
  const [open, setOpen] = useState(false);
  // Con una cuenta real no se enseñan etiquetas internas (estado de servicios, «Producción», un plan escrito a mano): solo lo propio del usuario
  const { activo, modo: modoSesion, sesion } = useSesion();
  const real = activo && modoSesion === 'real' && Boolean(sesion);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/health', { cache: 'no-store' });
        const json = await res.json();
        if (!cancelled) setHealth(json.checks);
      } catch {
        /* silencioso: el widget es informativo */
      }
    };
    void load();
    const t = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  const unhealthy = health ? Object.values(health).filter((c) => !c.ok).length : 0;
  const allOk = health ? unhealthy === 0 : false;

  return (
    <header className="sticky top-0 z-30 flex flex-wrap items-center gap-3 border-b border-white/[0.06] bg-background/70 px-3 py-2 backdrop-blur-xl sm:px-5 sm:py-2.5">
      <button
        type="button"
        aria-label="Abrir el menú"
        onClick={() => window.dispatchEvent(new Event(EVENTO_ABRIR_MENU))}
        className="grid size-9 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/[0.03] text-foreground transition hover:bg-white/[0.08] lg:hidden"
      >
        <Menu className="size-5" />
      </button>
      <div className="min-w-0 flex-1">
        <div className="hidden items-center gap-1.5 text-[11px] text-muted-foreground sm:flex">
          <span>DropshipPilot</span>
          <ChevronRight className="size-3" />
          <span className="text-foreground/80">{title}</span>
        </div>
        <h1 className="text-lg font-semibold leading-tight tracking-tight sm:truncate sm:text-xl">{title}</h1>
        {subtitle && <p className="line-clamp-2 text-xs text-muted-foreground sm:truncate">{subtitle}</p>}
      </div>

      <div className="flex items-center gap-2">
        {!real && (
        <button
          onClick={() => setOpen((v) => !v)}
          className="hidden items-center gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-2.5 py-1.5 text-xs text-muted-foreground transition hover:bg-white/[0.06] sm:flex"
        >
          <span className={cn('relative flex size-2', allOk ? 'text-emerald-400' : 'text-amber-400')}>
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-60" />
            <span className="relative inline-flex size-2 rounded-full bg-current" />
          </span>
          {health ? (allOk ? 'Sistema operativo' : (mode === 'postgres' ? `${unhealthy} servicio(s) por conectar` : `${unhealthy} servicio(s) en modo demo`)) : 'Comprobando…'}
        </button>
        )}

        {!real && (
          <>
            <Badge variant={mode === 'postgres' ? 'success' : 'warning'} className="capitalize">
              <Server className="size-3" />
              {mode === 'postgres' ? 'Producción' : 'Demo'}
            </Badge>

            <Badge variant="info" className="hidden md:inline-flex">
              <Sparkles className="size-3" />
              Plan PRO
            </Badge>

            <Button variant="outline" size="sm" className="hidden lg:inline-flex">
              <CircleDollarSign className="size-3.5" />
              Facturación
            </Button>
          </>
        )}

        <UserMenu authEnabled={authEnabled} />
      </div>

      {!real && open && health && (
        <div className="w-full animate-in-up rounded-xl border border-white/[0.07] bg-popover/95 p-3 text-xs shadow-2xl">
          <div className="mb-2 flex items-center gap-2 font-medium">
            <Activity className="size-3.5 text-indigo-300" />
            Estado de los servicios
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {Object.entries(health).map(([name, check]) => (
              <div key={name} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5">
                <div className="flex items-center justify-between">
                  <span className="font-semibold capitalize">{name}</span>
                  <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-semibold', check.ok ? 'bg-emerald-500/15 text-emerald-400' : 'bg-amber-500/15 text-amber-400')}>
                    {check.ok ? 'OK' : 'DEMO'}
                  </span>
                </div>
                <p className="mt-1 leading-relaxed text-muted-foreground">{check.detail}</p>
                {check.latencyMs !== undefined && <p className="mt-1 text-[10px] text-muted-foreground">latencia {check.latencyMs} ms</p>}
              </div>
            ))}
          </div>
        </div>
      )}
    </header>
  );
}
