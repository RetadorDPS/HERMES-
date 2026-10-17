import { ResetForm } from './reset-form';
import { ResetSupabase } from './reset-supabase';
import { ESTATICO, parametrosDeServidor } from '@/lib/ruta';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Nueva contraseña · DropshipPilot' };

export default function ResetPage({ searchParams }: { searchParams: { token?: string } }) {
  if (ESTATICO) return <ResetSupabase />;
  return <ResetForm token={parametrosDeServidor(searchParams).token ?? ''} />;
}
