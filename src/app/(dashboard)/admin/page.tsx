import { ShieldAlert } from 'lucide-react';
import { Topbar } from '@/components/layout/topbar';
import { Alert } from '@/components/ui/alert';
import { dataMode } from '@/lib/data';
import { currentAdmin } from '@/lib/admin';
import { AdminConsole } from './admin-console';
import { GuidedTour } from '@/components/tour/guided-tour';
import { ADMIN_TOUR_INTRO, ADMIN_TOUR_STEPS } from '@/lib/tour-steps';
import { tourState } from '@/lib/tour';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Administración' };

export default async function AdminPage() {
  const mode = dataMode();
  const admin = await currentAdmin();

  if (!admin) {
    return (
      <>
        <Topbar title="Administración de la plataforma" subtitle="Sólo para el operador del servicio" mode={mode} />
        <div className="py-5">
          <Alert variant="warning" title="Esta sección es sólo para el administrador">
            Tu cuenta no tiene el rol <code>ADMIN</code>. Si eres el propietario del servicio, ejecuta en el servidor:{' '}
            <code>npx tsx scripts/make-admin.ts tu@correo.com</code> y vuelve a entrar. Los clientes de la plataforma no necesitan esta sección.
          </Alert>
          <div className="mt-4 flex items-center gap-2 text-[12px] text-muted-foreground">
            <ShieldAlert className="size-4 text-amber-400" />
            El panel permite cambiar planes, créditos y permisos de cualquier cliente: se auditan todos los cambios.
          </div>
        </div>
      </>
    );
  }

  // El tutorial del operador se ofrece aquí dentro (y sólo cuando ya resolvió el
  // recorrido del cliente, para no solaparle dos tarjetas de golpe).
  const [adminTour, userTour] = await Promise.all([tourState('admin'), tourState('user')]);
  const ofrecerTutorialOperador = !userTour.shouldOffer && !userTour.inProgress;

  return (
    <>
      <Topbar title="Administración de la plataforma" subtitle={`Operador: ${admin.email} · métricas globales y gestión de clientes`} mode={mode} />
      <div className="py-5">
        <AdminConsole />
      </div>
      {ofrecerTutorialOperador && (
        <GuidedTour
          scope="admin"
          steps={ADMIN_TOUR_STEPS}
          intro={ADMIN_TOUR_INTRO}
          shouldOffer={adminTour.shouldOffer}
          inProgress={adminTour.inProgress}
        />
      )}
    </>
  );
}
