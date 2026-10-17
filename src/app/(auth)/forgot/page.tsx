import { ForgotForm } from './forgot-form';
import { ForgotSupabase } from './forgot-supabase';
import { ESTATICO } from '@/lib/ruta';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Recuperar contraseña · DropshipPilot' };

export default function ForgotPage() {
  return ESTATICO ? <ForgotSupabase /> : <ForgotForm />;
}
