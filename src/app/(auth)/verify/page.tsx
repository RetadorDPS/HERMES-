import Link from 'next/link';
import { CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AuthShell } from '@/components/auth/auth-shell';
import { verifyEmailToken } from '@/lib/account';
import { hasDatabase } from '@/lib/prisma';
import { parametrosDeServidor } from '@/lib/ruta';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Confirmar cuenta · DropshipPilot' };

export default async function VerifyPage({ searchParams }: { searchParams: { token?: string } }) {
  const token = parametrosDeServidor(searchParams).token;
  let ok = false;
  let message = 'Falta el token de verificación. Abre el enlace completo que recibiste por correo.';

  if (token && hasDatabase()) {
    try {
      const user = await verifyEmailToken(token);
      if (user) {
        ok = true;
        message = `Cuenta confirmada: ${user.email}. Ya puedes iniciar sesión.`;
      } else {
        message = 'El enlace no es válido, ya se ha usado o ha caducado. Puedes pedir uno nuevo desde la pantalla de inicio de sesión.';
      }
    } catch (err) {
      message = `No se pudo confirmar la cuenta: ${(err as Error).message}`;
    }
  } else if (!hasDatabase()) {
    message = 'Esta instalación funciona sin base de datos: la verificación no es necesaria.';
  }

  return (
    <AuthShell title={ok ? 'Cuenta confirmada' : 'Confirmación de cuenta'} subtitle="Verificación de email">
      <div className="space-y-5">
        <div className="flex items-start gap-3">
          {ok ? (
            <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-400" />
          ) : (
            <XCircle className="mt-0.5 size-5 shrink-0 text-amber-400" />
          )}
          <p className="text-[13px] leading-relaxed text-muted-foreground">{message}</p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant={ok ? 'gradient' : 'outline'} className="flex-1">
            <Link href="/login">{ok ? 'Iniciar sesión' : 'Volver al acceso'}</Link>
          </Button>
          {!ok && (
            <Button asChild variant="ghost" className="flex-1">
              <Link href="/forgot">Recuperar contraseña</Link>
            </Button>
          )}
        </div>
      </div>
    </AuthShell>
  );
}
