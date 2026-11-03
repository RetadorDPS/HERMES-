'use client';

/**
 * Paso OBLIGATORIO «Elige tu plan» al registrarse. Todos empiezan con el plan Gratis (entras al momento si lo eliges).
 * Pro y Premium se contratan en Retador (es el mismo plan en las dos apps): al vincular la cuenta, el plan llega solo.
 * No se enseñan precios que no estén decididos aquí: los de Retador se ven en Retador.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, ExternalLink, Loader2 } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AuthShell } from '@/components/auth/auth-shell';
import { useSesion } from '@/components/auth/sesion';
import { BloqueVincular } from '@/components/panel/real/vincular-retador';
import { elegirPlanGratis, estadoPlan } from '@/lib/real/plan';

const PLANES = [
  { id: 'gratis', nombre: 'Gratis', productos: 'Hasta 10 productos', herramientas: '5 fichas completas y 10 cotizaciones de envío para probar', gratis: true },
  { id: 'pro', nombre: 'Pro', productos: 'Hasta 50 productos', herramientas: '20 fichas completas y 60 cotizaciones de envío al mes', gratis: false },
  { id: 'premium', nombre: 'Premium', productos: 'Hasta 500 productos', herramientas: '80 fichas completas y 300 cotizaciones de envío al mes', gratis: false },
];

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
    <AuthShell title="Elige tu plan" subtitle="Todos empiezan gratis. Pro y Premium se contratan en Retador y sirven en las dos apps.">
      <div className="space-y-4">
        {error && <Alert variant="danger">{error}</Alert>}
        <div className="space-y-3">
          {PLANES.map((p) => (
            <Card key={p.id} className={p.gratis ? 'border-indigo-500/30' : ''}>
              <CardHeader className="pb-2">
                <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                  {p.nombre}
                  {p.gratis && <Badge variant="success">Entras al momento</Badge>}
                </CardTitle>
                <CardDescription>{p.productos}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-[13px]">
                <p className="flex items-start gap-2 text-muted-foreground">
                  <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-300" /> {p.herramientas}
                </p>
                {p.gratis ? (
                  <Button variant="gradient" className="w-full" disabled={ocupado} onClick={() => void empezarGratis()}>
                    {ocupado && <Loader2 className="size-4 animate-spin" />} Empezar con el plan Gratis
                  </Button>
                ) : (
                  <Button asChild variant="outline" className="w-full">
                    <a href="https://retadormarketplace.es/" target="_blank" rel="noopener noreferrer">
                      Contratar en Retador <ExternalLink className="size-3.5" />
                    </a>
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="space-y-2 rounded-lg border border-white/10 bg-white/[0.03] p-3">
          <p className="text-[13px] font-medium">¿Ya tienes un plan en Retador?</p>
          <p className="text-[12px] text-muted-foreground">Vincula tu cuenta y tu plan llega solo, sin pagar dos veces.</p>
          <BloqueVincular alVincular={() => router.replace('/dashboard')} />
        </div>
      </div>
    </AuthShell>
  );
}
