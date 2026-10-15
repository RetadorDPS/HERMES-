import { Topbar } from '@/components/layout/topbar';
import { dataMode } from '@/lib/data';
import { withCurrentTenant } from '@/lib/tenant';
import { SetupCenter } from './setup-center';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Puesta en marcha' };

export default async function SetupPage() {
  const mode = dataMode();

  return withCurrentTenant(async () => (
    <>
      <Topbar
        title="Puesta en marcha"
        subtitle="Todo lo que hay que conectar, comprobado en vivo: pega las claves y el sistema queda operativo"
        mode={mode}
      />
      <div data-tour="screen:setup" className="py-5">
        <SetupCenter />
      </div>
    </>
  ));
}
