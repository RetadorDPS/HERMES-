'use client';

/**
 * Facturación con cuenta real. Los planes de pago todavía no están activados: se dice con claridad y no se enseñan precios ni
 * características que no existen. (La vista completa de planes sigue en `billing-view.tsx` para cuando se activen los cobros.)
 */
import { CreditCard } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { obtenerPerfil, obtenerResumen } from '@/lib/real/datos';
import { planFor } from '@/lib/plans';
import { TarjetasPlanes } from '@/components/planes/tarjetas-planes';
import { estadoPlan } from '@/lib/real/plan';
import { PantallaReal, useCarga } from './comun';

const NOMBRE_PLAN: Record<string, string> = { TRIAL: 'Prueba', STARTER: 'Starter', PRO: 'Pro', ENTERPRISE: 'A medida' };

export function FacturacionReal() {
  const { datos, error, cargando, recargar } = useCarga(async () => {
    const [resumen, cuenta, estado] = await Promise.all([obtenerResumen(), obtenerPerfil(), estadoPlan()]);
    return { resumen, ...cuenta, vieneDeRetador: estado?.origen === 'RETADOR' };
  });
  const plan = planFor((datos?.suscripcion?.plan ?? datos?.perfil?.plan ?? 'TRIAL') as any);

  return (
    <PantallaReal titulo="Facturación" subtitulo="Tu plan y los planes disponibles" cargando={cargando} error={error} alRecargar={recargar} tour="screen:billing">
      {datos && (
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <CreditCard className="size-4 text-indigo-300" /> Tu plan: {plan.name}
              </CardTitle>
              <CardDescription>
                {datos.vieneDeRetador
                  ? 'Tu plan viene de Retador: es el mismo en las dos apps y aquí no se te cobra nada. Para cambiarlo, hazlo en Retador.'
                  : 'Hoy no se te cobra nada. Los planes de pago se activan muy pronto y te avisaremos antes de cualquier cambio. Si ya tienes un plan en Retador, vincula tu cuenta en Tiendas y llegará solo.'}
              </CardDescription>
            </CardHeader>
          </Card>
          <TarjetasPlanes modo="facturacion" planActual={NOMBRE_PLAN[plan.tier] ?? 'Prueba'} />
        </div>
      )}
    </PantallaReal>
  );
}
