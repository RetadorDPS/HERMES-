'use client';

/**
 * Tutorial guiado: lleva al usuario pestaña por pestaña y le señala dónde tocar.
 *
 * - La tarjeta de bienvenida se ofrece sólo una vez (la decisión se guarda en su
 *   cuenta, y desde Configuración puede volver a verlo o quitarlo).
 * - Para cambiar de pestaña usa el router de Next: el usuario ve la pantalla de
 *   verdad, no una imagen.
 * - El resaltado es un agujero en la capa oscura (box-shadow gigante) y no
 *   bloquea los clics: el usuario puede tocar el botón que se le señala.
 * - Se sale con Escape o con «Saltar»; al terminar o saltar no vuelve a salir.
 */
import { rutaActual } from '@/lib/ruta';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, CheckCircle2, Compass, PartyPopper, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { TourStep } from '@/lib/tour-steps';

type Phase = 'card' | 'steps' | 'done' | null;

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PAD = 8; // aire alrededor de lo señalado
const BUBBLE_MAX = 380;

interface GuidedTourProps {
  /** Qué recorrido es: el del cliente o el del operador */
  scope?: 'user' | 'admin';
  steps: TourStep[];
  intro: { title: string; text: string; accept: string; decline: string };
  shouldOffer: boolean;
  inProgress: boolean;
}

export function GuidedTour({ scope = 'user', steps, intro, shouldOffer, inProgress }: GuidedTourProps) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>(shouldOffer ? 'card' : inProgress ? 'steps' : null);

  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [mobile, setMobile] = useState(false);
  const [saving, setSaving] = useState(false);
  const travelling = useRef(false);
  /** El usuario lo cerró él mismo: no debe reabrirse hasta que alguien lo arranque */
  const userClosed = useRef(false);

  const step: TourStep | null = phase === 'steps' ? (steps[index] ?? null) : null;

  const save = useCallback(
    async (action: 'accept' | 'complete' | 'dismiss' | 'restart') => {
    setSaving(true);
    try {
      await fetch('/api/account/tour', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, scope }) });
    } catch {
      /* si falla el guardado, el tutorial no debe quedarse colgado */
    } finally {
      setSaving(false);
    }
    },
    [scope],
  );

  /**
   * Sigue el estado que manda el servidor: si el recorrido se arranca desde otro
   * sitio (la lista de primeros pasos, Configuración) o se resuelve, el tutorial
   * se abre o se cierra sin recargar la página.
   */
  useEffect(() => {
    if (shouldOffer) {
      if (phase === null && !userClosed.current) setPhase('card');
      return;
    }
    if (inProgress && (phase === null || phase === 'card')) {
      userClosed.current = false;
      setPhase('steps');
    }
  }, [shouldOffer, inProgress, phase]);

  // Medir y seguir el objetivo del paso actual
  const measure = useCallback(() => {
    if (!step) return;
    setMobile(window.innerWidth < 820);
    const target = step.targets.map((sel) => document.querySelector(sel)).find((el): el is Element => Boolean(el));
    const el = target ?? document.querySelector('main');
    if (!el) return setRect(null);
    const r = el.getBoundingClientRect();
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    // Si el objetivo está fuera de la vista, lo traemos
    if (r.top < 0 || r.bottom > window.innerHeight) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [step]);

  // Al cambiar de paso: navegar si hace falta y luego medir
  useEffect(() => {
    if (!step) return;
    const path = rutaActual();
    if (step.route !== path) {
      travelling.current = true;
      router.push(step.route);
    }
    const timers = [150, 600, 1200, 2000].map((ms) => window.setTimeout(measure, ms));
    return () => timers.forEach(window.clearTimeout);
  }, [step, measure, router]);

  useEffect(() => {
    if (!step) return;
    const onResize = () => measure();
    const onScroll = () => measure();
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [step, measure]);

  // Brillo temporal en la pestaña del menú lateral que toca en este paso
  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `
      .dp-tour-glow { box-shadow: 0 0 0 2px rgba(139,92,246,.9), 0 0 22px rgba(139,92,246,.55) !important; border-radius: 8px; }
      @keyframes dp-tour-pulse { 0%,100% { opacity: 1 } 50% { opacity: .45 } }
      .dp-tour-dot { animation: dp-tour-pulse 1.6s ease-in-out infinite; }
      @media (prefers-reduced-motion: reduce) { .dp-tour-dot { animation: none } }
    `;
    document.head.appendChild(style);
    return () => style.remove();
  }, []);

  useEffect(() => {
    document.querySelectorAll('.dp-tour-glow').forEach((el) => el.classList.remove('dp-tour-glow'));
    if (!step) return;
    const link = document.querySelector(`a[href="${step.route}"]`);
    link?.classList.add('dp-tour-glow');
    return () => link?.classList.remove('dp-tour-glow');
  }, [step]);

  const finish = useCallback(
    async (action: 'complete' | 'dismiss') => {
      userClosed.current = true;
      setPhase(action === 'complete' ? 'done' : null);
      await save(action);
      if (action === 'dismiss') router.refresh();
      else window.setTimeout(() => router.refresh(), 3200);
    },
    [router, save],
  );

  // Teclado: Escape sale, flechas avanzan y retroceden
  useEffect(() => {
    if (!phase) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') void finish('dismiss');
      if (phase !== 'steps') return;
      if (e.key === 'ArrowRight' || e.key === 'Enter') {
        e.preventDefault();
        setIndex((i) => (i + 1 >= steps.length ? i : i + 1));
        if (index + 1 >= steps.length) void finish('complete');
      }
      if (e.key === 'ArrowLeft') setIndex((i) => Math.max(0, i - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, index, finish, steps.length]);

  // En modo pasos, si el usuario navega por su cuenta seguimos el paso
  useEffect(() => {
    if (!step) return;
    const t = window.setTimeout(() => {
      const here = rutaActual();
      const at = steps.findIndex((s) => s.route === here);
      if (at >= 0 && at !== index && !travelling.current) setIndex(at);
      travelling.current = false;
    }, 900);
    return () => window.clearTimeout(t);
  }, [rect, index, step, steps]);

  const bubbleStyle = useMemo(() => {
    if (mobile || !rect) return { left: 12, right: 12, bottom: 12, width: undefined } as const;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(BUBBLE_MAX, vw - 24);
    const below = rect.top + rect.height + PAD + 12;
    const room = vh - below;
    const height = 210;
    const top = room > height ? below : Math.max(12, rect.top - height - PAD);
    const left = Math.min(Math.max(12, rect.left), vw - width - 12);
    return { top, left, width } as const;
  }, [rect, mobile]);

  if (!phase) return null;

  // ── Tarjeta de bienvenida ────────────────────────────────────────────────
  if (phase === 'card') {
    return (
      <div className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-950/60 p-4 backdrop-blur-[2px] sm:items-center" data-tour-card>
        <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0d1420] p-6 shadow-2xl">
          <div className="mb-3 flex items-center gap-2 text-violet-300">
            <Compass className="size-5" />
            <span className="text-[12px] font-semibold uppercase tracking-wide">Primeros pasos</span>
          </div>
          <h2 className="text-lg font-semibold">{intro.title}</h2>
          <p className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground">{intro.text}</p>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <Button
              variant="gradient"
              className="sm:flex-1"
              disabled={saving}
              onClick={async () => {
                setIndex(0);
                setPhase('steps');
                await save('accept');
              }}
            >
              <Compass className="size-4" /> {intro.accept}
            </Button>
            <Button variant="ghost" disabled={saving} onClick={() => void finish('dismiss')}>
              {intro.decline}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ── Despedida ────────────────────────────────────────────────────────────
  if (phase === 'done') {
    return (
      <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-[2px]">
        <div className="w-full max-w-sm rounded-2xl border border-emerald-500/25 bg-[#0d1420] p-6 text-center shadow-2xl">
          <PartyPopper className="mx-auto mb-3 size-7 text-emerald-300" />
          <h2 className="text-lg font-semibold">{scope === 'admin' ? 'Panel de operador, visto' : 'Ya conoces la casa'}</h2>
          <p className="mt-2 text-[13.5px] text-muted-foreground">
            {scope === 'admin'
              ? 'Ya está. Lo que toca ahora es pegar las claves de AliExpress y CJdropshipping cuando las tengas: el resto de la plataforma se encarga solo.'
              : 'Ya está. Lo normal es mirar el catálogo, importar un producto y dejar que el robot trabaje. Si un día te pierdes, en Configuración → Ayuda tienes este mismo recorrido.'}
          </p>
          <Button variant="outline" className="mt-5 w-full" onClick={() => setPhase(null)}>
            <CheckCircle2 className="size-4" /> Empezar a usar la plataforma
          </Button>
        </div>
      </div>
    );
  }

  // ── Pasos ────────────────────────────────────────────────────────────────
  return (
    <div className="pointer-events-none fixed inset-0 z-[90]" aria-live="polite">
      {rect ? (
        <div
          className="pointer-events-none fixed rounded-xl transition-all duration-300"
          style={{
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            boxShadow: '0 0 0 9999px rgba(3,6,12,.72), 0 0 0 2px rgba(139,92,246,.85)',
            border: '1px solid rgba(167,139,250,.5)',
          }}
        />
      ) : (
        <div className="pointer-events-none fixed inset-0 bg-slate-950/70" />
      )}

      <div className="pointer-events-auto fixed rounded-2xl border border-violet-500/30 bg-[#0d1420] p-4 shadow-2xl" style={bubbleStyle}>
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="flex items-center gap-1.5 text-[11px] font-medium text-violet-300">
            <span className="dp-tour-dot inline-block size-2 rounded-full bg-violet-400" />
            Paso {index + 1} de {steps.length} · {step?.tab}
          </span>
          <button type="button" onClick={() => void finish('dismiss')} className="rounded p-1 text-muted-foreground transition hover:text-foreground" title="Cerrar y no volver a verlo">
            <X className="size-3.5" />
          </button>
        </div>

        <h3 className="text-[15px] font-semibold">{step?.title}</h3>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{step?.text}</p>
        {step?.tip && (
          <p className="mt-2 rounded-lg border border-white/[0.07] bg-white/[0.03] px-2.5 py-1.5 text-[12px] text-amber-200/90">{step.tip}</p>
        )}

        <div className="mt-3 flex items-center justify-between gap-2">
          <button type="button" onClick={() => void finish('dismiss')} className="text-[11.5px] text-muted-foreground underline-offset-2 hover:underline">
            Saltar el tutorial
          </button>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" disabled={index === 0} onClick={() => setIndex((i) => Math.max(0, i - 1))}>
              <ArrowLeft className="size-3.5" /> Atrás
            </Button>
            {index + 1 >= steps.length ? (
              <Button size="sm" variant="gradient" onClick={() => void finish('complete')}>
                Terminar <CheckCircle2 className="size-3.5" />
              </Button>
            ) : (
              <Button size="sm" variant="gradient" onClick={() => setIndex((i) => i + 1)}>
                Siguiente <ArrowRight className="size-3.5" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Botón para volver a verlo (lo usa la tarjeta de Configuración) */
export function RestartTourButton({ className, scope = 'user' }: { className?: string; scope?: 'user' | 'admin' }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      className={className}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        // «accept» lo deja en curso: al refrescar se abre en el paso 1, sin preguntar otra vez
        await fetch('/api/account/tour', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'accept', scope }) });
        router.refresh();
        window.setTimeout(() => setBusy(false), 1500);
      }}
    >
      <Compass className="size-4" /> {busy ? 'Preparando…' : 'Ver el tutorial otra vez'}
    </Button>
  );
}

