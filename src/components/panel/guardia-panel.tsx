'use client';

/**
 * Protege el panel en la versión estática:
 *   • modo demostración → muestra las pantallas de ejemplo con una franja de aviso
 *   • modo real sin sesión → lleva a iniciar sesión
 *   • modo real con sesión → pantallas con datos reales de Supabase
 * En el servidor normal (NextAuth + middleware) no hace nada.
 */
import { useEffect, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Loader2, PlayCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSesion } from '@/components/auth/sesion';
import { PanelReal } from './panel-real';

export function GuardiaPanel({ children }: { children: ReactNode }) {
  const { activo, cargando, modo, sesion, salirDemo } = useSesion();
  const router = useRouter();
  const ruta = usePathname();

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

  if (cargando || !sesion) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        {cargando ? 'Comprobando tu sesión…' : 'Redirigiendo al acceso…'}
      </div>
    );
  }

  return <PanelReal />;
}
