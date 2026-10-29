'use client';

import { useSesion } from '@/components/auth/sesion';
import { VERSION_ETIQUETA } from '@/lib/version';

/** Pie del panel: dice con honestidad si se ven datos de ejemplo o datos reales. */
export function PiePanel({ mode }: { mode: 'demo' | 'postgres' }) {
  const { activo, modo, sesion } = useSesion();
  const real = activo ? modo === 'real' && Boolean(sesion) : mode === 'postgres';
  return (
    <footer className="border-t border-white/[0.06] px-6 py-4 text-[11px] text-muted-foreground">
      DropshipPilot {VERSION_ETIQUETA} ·{' '}
      {real ? 'datos reales de tu cuenta' : 'demostración con datos de ejemplo: nada se guarda'}
    </footer>
  );
}
