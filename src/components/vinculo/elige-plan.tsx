'use client';

/**
 * Paso OBLIGATORIO «Elige tu plan» al registrarse. Todos empiezan con el plan Gratis (entras al momento si lo eliges).
 * Pro y Premium se contratan en Retador (es el mismo plan en las dos apps): al vincular la cuenta, el plan llega solo.
 * No se enseñan precios que no estén decididos aquí: los de Retador se ven en Retador.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { AuthShell } from '@/components/auth/auth-shell';
import { useSesion } from '@/components/auth/sesion';
import { BloqueVincular } from '@/components/panel/real/vincular-retador';
import { TarjetasPlanes } from '@/components/planes/tarjetas-planes';
import { elegirPlanGratis, estadoPlan } from '@/lib/real/plan';

export function ElegirPlan() {
  const router = useRouter();
  const { cargando, sesion, modo } = useSesion();
  const [listo, setListo] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cargando) return;
    if (!sesion || modo !== 'real') {
      router.replace('/login');
      return;
    }
    let vivo = true;
    estadoPlan().then((e) => {
      if (!vivo) return;
      // Si ya eligió (o no se puede comprobar), no hay nada que elegir
      if (!e || e.elegido) router.replace('/dashboard');
      else setListo(true);
    });
    return () => {
      vivo = false;
    };
  }, [cargando, sesion, modo, router]);

  async function empezarGratis() {
    setOcupado(true);
    setError(null);
    try {
      await elegirPlanGratis();
      router.replace('/dashboard');
    } catch (e) {
      setError((e as Error).message);
      setOcupado(false);
    }
  }

  if (!listo) {
    return (
      <AuthShell title="Elige tu plan" subtitle="Un momento…">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Preparando tu cuenta…
        </p>
      </AuthShell>
    );
  }

  return (
    <main className="relative min-h-screen overflow-x-clip px-4 py-10 sm:px-6">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -left-32 -top-32 size-[520px] rounded-full bg-indigo-600/20 blur-[120px]" />
        <div className="absolute -bottom-40 -right-24 size-[520px] rounded-full bg-cyan-500/10 blur-[120px]" />
      </div>
      <div className="mx-auto w-full max-w-6xl space-y-8">
        <header className="text-center">
          <div className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-xl text-white shadow-lg shadow-indigo-500/25">⚡</div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Elige tu plan</h1>
          <p className="mx-auto mt-2 max-w-2xl text-sm text-muted-foreground">
            Empiezas gratis y sin tarjeta. Cuando tu tienda crezca, un plan conjunto te da tu tienda de Retador y las herramientas de DropshipPilot en una sola cuenta y con un solo pago.
          </p>
        </header>
        {error && <Alert variant="danger">{error}</Alert>}
        <TarjetasPlanes modo="elegir" alEmpezarGratis={() => void empezarGratis()} ocupado={ocupado} />
        <div className="mx-auto max-w-xl space-y-2 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <p className="text-[13px] font-medium">¿Ya tienes un plan en Retador?</p>
          <p className="text-[12px] text-muted-foreground">Vincula tu cuenta y tu plan llega solo, sin pagar dos veces.</p>
          <BloqueVincular alVincular={() => router.replace('/dashboard')} />
        </div>
      </div>
    </main>
  );
}
