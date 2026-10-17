'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ESTATICO } from '@/lib/ruta';
import { useSesion } from '@/components/auth/sesion';

/** Botones de la portada: en la versión estática llevan a entrar, crear cuenta o ver la demostración. */
export function PortadaAcciones() {
  const { sesion, entrarDemo } = useSesion();
  const router = useRouter();

  if (!ESTATICO) {
    return (
      <div className="mt-6 flex flex-wrap gap-3">
        <Button asChild variant="gradient" size="lg">
          <Link href="/dashboard">
            Entrar al panel <ArrowRight className="size-4" />
          </Link>
        </Button>
        <Button asChild variant="outline" size="lg">
          <Link href="/catalog">Explorar el catálogo</Link>
        </Button>
      </div>
    );
  }

  return (
    <>
      <div className="mt-6 flex flex-wrap gap-3">
        {sesion ? (
          <Button asChild variant="gradient" size="lg">
            <Link href="/dashboard">
              Ir a mi panel <ArrowRight className="size-4" />
            </Link>
          </Button>
        ) : (
          <>
            <Button asChild variant="gradient" size="lg">
              <Link href="/login">
                Entrar <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href="/register">Crear cuenta</Link>
            </Button>
          </>
        )}
        <Button
          variant="ghost"
          size="lg"
          onClick={() => {
            entrarDemo();
            router.push('/dashboard');
          }}
        >
          Ver la demostración
        </Button>
      </div>
      <p className="mt-3 text-[12px] text-muted-foreground">
        La demostración usa datos de ejemplo y no guarda nada. Con tu cuenta trabajas con datos reales.
      </p>
    </>
  );
}
