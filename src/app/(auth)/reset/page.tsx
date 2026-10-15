import { ResetForm } from './reset-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Nueva contraseña · DropshipPilot' };

export default function ResetPage({ searchParams }: { searchParams: { token?: string } }) {
  return <ResetForm token={searchParams.token ?? ''} />;
}
