'use client';

/**
 * Facturación con cuenta real. Los planes de pago todavía no están activados: se dice con claridad y no se enseñan precios ni
 * características que no existen. (La vista completa de planes sigue en `billing-view.tsx` para cuando se activen los cobros.)
 */
import { CreditCard } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { obtenerPerfil, obtenerResumen } from '@/lib/real/datos';
import { planFor } from '@/lib/plans';
import { PantallaReal, useCarga } from './comun';

export function FacturacionReal() {
  const { datos, error, cargando, recargar } = useCarga(async () => {
    const [resumen, cuenta] = await Promise.all([obtenerResumen(), obtenerPerfil()]);
    return { resumen, ...cuenta };
  });
  const plan = planFor((datos?.suscripcion?.plan ?? datos?.perfil?.plan ?? 'TRIAL') as any);

  return (
    <PantallaReal titulo="Facturación" subtitulo="Tu plan" cargando={cargando} error={error} alRecargar={recargar} tour="screen:billing">
      {datos && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <CreditCard className="size-4 text-indigo-300" /> Tu plan: {plan.name}
            </CardTitle>
            <CardDescription>Los planes de pago se activarán pronto. Hasta entonces no se te cobra nada, y te avisaremos antes de cualquier cambio.</CardDescription>
          </CardHeader>
          <CardContent className="text-[12px] text-muted-foreground">Cuando estén disponibles podrás ver aquí tu plan, tus facturas y cambiar de plan.</CardContent>
        </Card>
      )}
    </PantallaReal>
  );
}
