import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { RegisterForm } from './register-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Crear cuenta · DropshipPilot' };

export default async function RegisterPage() {
  const authEnabled = process.env.AUTH_ENABLED === 'true';
  const mailConfigured = Boolean(process.env.RESEND_API_KEY || process.env.MAIL_WEBHOOK_URL);

  if (authEnabled) {
    const session = await getServerSession(authOptions);
    if (session) redirect('/dashboard');
  }

  return <RegisterForm authEnabled={authEnabled} mailConfigured={mailConfigured} />;
}
