'use client';

/**
 * Protege el panel en la versión estática:
 *   • modo demostración → muestra las pantallas de ejemplo con una franja de aviso
 *   • modo real sin sesión → lleva a iniciar sesión
 *   • modo real con sesión → pantallas con datos reales de Supabase
 * Con sesión real, si la persona todavía no ha elegido plan, la lleva al paso obligatorio «Elige tu plan».
 * En el servidor normal (NextAuth + middleware) no hace nada.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Loader2, PlayCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSesion } from '@/components/auth/sesion';
import { estadoPlan } from '@/lib/real/plan';
import { PanelReal } from './panel-real';

export function GuardiaPanel({ children }: { children: ReactNode }) {
  const { activo, cargando, modo, sesion, salirDemo } = useSesion();
  const router = useRouter();
  const ruta = usePathname();

  // Paso obligatorio «Elige tu plan»: si no se puede comprobar, no se bloquea a nadie
  const [plan, setPlan] = useState<'comprobando' | 'pendiente' | 'listo'>('comprobando');
  const idSesion = sesion?.user?.id ?? null;
  useEffect(() => {
    if (!activo || modo !== 'real' || !idSesion) return;
    let vivo = true;
    setPlan('comprobando');
    estadoPlan().then((e) => {
      if (!vivo) return;
      if (e && !e.elegido) {
        setPlan('pendiente');
        router.replace('/elige-plan');
      } else setPlan('listo');
    });
    return () => {
      vivo = false;
    };
  }, [activo, modo, idSesion, router]);

  const necesitaLogin = activo && modo === 'real' && !cargando && !sesion;
  useEffect(() => {
    if (necesitaLogin) router.replace('/login');
  }, [necesitaLogin, router, ruta]);

  if (!activo) return <>{children}</>;

  if (modo === 'demo') {
    return (
      <>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-400/25 bg-amber-400/[0.07] px-3 py-1.5 text-[12px] text-amber-100">
          <span className="flex items-center gap-1.5">
            <PlayCircle className="size-3.5" />
            Estás viendo la <strong>demostración</strong>: datos de ejemplo, no se guarda nada.
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-7 border-amber-400/30 px-2.5 text-[11.5px]"
            onClick={() => {
              salirDemo();
              router.push('/login');
            }}
          >
            Entrar con mi cuenta
          </Button>
        </div>
        {children}
      </>
    );
  }

  if (cargando || !sesion || plan !== 'listo') {
    return (
      <div className="flex min-h-[60vh] items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        {cargando ? 'Comprobando tu sesión…' : !sesion ? 'Redirigiendo al acceso…' : plan === 'pendiente' ? 'Llevándote a elegir tu plan…' : 'Comprobando tu cuenta…'}
      </div>
    );
  }

  return <PanelReal />;
}
