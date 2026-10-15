'use client';

/**
 * «Tus primeros pasos»: la lista de la portada que se va marcando sola.
 *
 * Cada fila lleva a la pantalla que toca; la del recorrido guiado arranca el
 * tutorial directamente. Cuando están todas hechas desaparece, y si el cliente
 * no la quiere puede ocultarla (se recupera desde Configuración → Ayuda).
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Check, Compass, EyeOff, ListChecks, Loader2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { ChecklistState } from '@/lib/onboarding';

export function FirstStepsCard({ state }: { state: ChecklistState }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  if (!state.visible) return null;

  const pct = Math.round((state.done / state.total) * 100);

  const hide = async () => {
    setBusy('hide');
    try {
      await fetch('/api/account/onboarding', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'hide' }) });
      router.refresh();
    } finally {
      setBusy(null);
    }
  };

  const startTour = async () => {
    setBusy('tour');
    // «accept» deja el recorrido en curso: al refrescar, se abre en el paso 1
    await fetch('/api/account/tour', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'accept' }) });
    router.refresh();
    setOpening(true);
    window.setTimeout(() => setOpening(false), 2500);
  };

  return (
    <Card data-tour="first-steps" className="border-indigo-500/25 bg-indigo-500/[0.04]">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ListChecks className="size-4 text-indigo-300" /> Tus primeros pasos
            </CardTitle>
            <CardDescription>
              Se marcan solos: en cuanto conectas la tienda, importas un producto o el robot trabaja, la casilla se pone verde. Cuando estén los
              {' '}{state.total}, esta tarjeta desaparece.
            </CardDescription>
          </div>
          <button
            type="button"
            onClick={() => void hide()}
            disabled={busy !== null}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11.5px] text-muted-foreground transition hover:bg-white/[0.05] hover:text-foreground"
            title="Ocultar (puedes recuperarla en Configuración)"
          >
            {busy === 'hide' ? <Loader2 className="size-3.5 animate-spin" /> : <EyeOff className="size-3.5" />} Ocultar
          </button>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="flex items-center gap-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.07]">
            <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all" style={{ width: `${pct}%` }} />
          </div>
          <span className="text-[11.5px] text-muted-foreground">
            {state.done} de {state.total}
          </span>
        </div>

        <ul className="grid gap-2 sm:grid-cols-2">
          {state.tasks.map((task) => (
            <li
              key={task.key}
              className={`flex items-start gap-2.5 rounded-lg border p-2.5 ${
                task.done ? 'border-emerald-500/20 bg-emerald-500/[0.05]' : 'border-white/[0.07] bg-white/[0.02]'
              }`}
            >
              <span
                className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border ${
                  task.done ? 'border-emerald-400/60 bg-emerald-400/20 text-emerald-300' : 'border-white/20 text-transparent'
                }`}
              >
                <Check className="size-3" />
              </span>

              <div className="min-w-0 flex-1">
                <p className={`text-[13px] ${task.done ? 'text-emerald-100/80 line-through decoration-emerald-400/40' : 'text-foreground'}`}>
                  {task.label}
                </p>
                <p className="text-[11.5px] text-muted-foreground">{task.hint}</p>
              </div>

              {!task.done &&
                (task.action === 'tour' ? (
                  <Button size="sm" variant="gradient" className="shrink-0" disabled={busy !== null} onClick={() => void startTour()}>
                    {busy === 'tour' || opening ? <Loader2 className="size-3.5 animate-spin" /> : <Compass className="size-3.5" />} Ver
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" className="shrink-0" onClick={() => router.push(task.href)}>
                    Ir <ArrowRight className="size-3.5" />
                  </Button>
                ))}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
