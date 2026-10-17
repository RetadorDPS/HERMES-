import { Sidebar } from '@/components/layout/sidebar';
import { GuidedTour } from '@/components/tour/guided-tour';
import { TOUR_INTRO, TOUR_STEPS } from '@/lib/tour-steps';
import { dataMode } from '@/lib/data';
import { currentAdmin } from '@/lib/admin';
import { tourState } from '@/lib/tour';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const mode = dataMode();
  // El enlace de administración sólo aparece para operadores (la ruta se
  // comprueba también en el servidor: la interfaz no es la seguridad).
  const admin = await currentAdmin().catch(() => null);
  // Tutorial de bienvenida: aparece una sola vez (la decisión vive en la cuenta)
  const tour = await tourState().catch(() => ({ shouldOffer: false, inProgress: false, completed: false }));
  return (
    <div className="flex min-h-screen">
      <Sidebar mode={mode} isAdmin={Boolean(admin)} />
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="mx-auto w-full max-w-[1600px] flex-1 px-3 py-2 sm:px-5">{children}</div>
        <footer className="border-t border-white/[0.06] px-6 py-4 text-[11px] text-muted-foreground">
          DropshipPilot · Next.js 14 + Prisma + BullMQ + FastAPI/Playwright ·{' '}
          {mode === 'demo' ? 'ejecutándose en modo demo con datos sintéticos' : 'conectado a PostgreSQL'}
        </footer>
      </main>
      <GuidedTour scope="user" steps={TOUR_STEPS} intro={TOUR_INTRO} shouldOffer={tour.shouldOffer} inProgress={tour.inProgress} />
    </div>
  );
}
