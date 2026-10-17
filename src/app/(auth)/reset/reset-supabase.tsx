'use client';

import { useState } from 'react';
import Link from 'next/link';
import { KeyRound, Loader2, ShieldCheck } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { AuthShell } from '@/components/auth/auth-shell';
import { useSesion } from '@/components/auth/sesion';
import { mensajeDeError, supabase } from '@/lib/supabase/cliente';

/** El enlace del correo abre esta pantalla con una sesión de recuperación; con ella se cambia la contraseña. */
export function ResetSupabase() {
  const { sesion, cargando: cargandoSesion } = useSesion();
  const [password, setPassword] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState(false);

  const cambiar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmar) {
      setError('Las dos contraseñas no coinciden.');
      return;
    }
    setCargando(true);
    setError(null);
    const { error: err } = await supabase().auth.updateUser({ password });
    setCargando(false);
    if (err) {
      setError(mensajeDeError(err));
      return;
    }
    setHecho(true);
  };

  if (cargandoSesion) {
    return (
      <AuthShell title="Comprobando el enlace…">
        <div className="flex justify-center py-6">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      </AuthShell>
    );
  }

  if (hecho) {
    return (
      <AuthShell title="Contraseña actualizada" subtitle="Ya puedes usar tu nueva contraseña">
        <Alert variant="success" title="Todo listo">Tu contraseña se ha cambiado correctamente.</Alert>
        <Button asChild variant="gradient" className="mt-4 w-full">
          <Link href="/dashboard">Entrar al panel</Link>
        </Button>
      </AuthShell>
    );
  }

  if (!sesion) {
    return (
      <AuthShell title="Enlace no válido" subtitle="El enlace ha caducado o ya se usó">
        <Alert variant="warning" title="Abre el enlace completo del correo">
          Los enlaces de recuperación funcionan una sola vez y caducan. Pide uno nuevo.
        </Alert>
        <Button asChild variant="outline" className="mt-4 w-full">
          <Link href="/forgot">Solicitar un enlace nuevo</Link>
        </Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Nueva contraseña" subtitle="Elige una contraseña que no uses en otros sitios">
      {error && (
        <Alert variant="danger" title="No se pudo cambiar" className="mb-4" onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}
      <form onSubmit={cambiar} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="password">Nueva contraseña</Label>
          <div className="relative">
            <KeyRound className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input id="password" type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mínimo 8 caracteres" className="pl-9" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="confirmar">Repite la contraseña</Label>
          <Input id="confirmar" type="password" required minLength={8} autoComplete="new-password" value={confirmar} onChange={(e) => setConfirmar(e.target.value)} />
        </div>
        <Button type="submit" variant="gradient" className="w-full" disabled={cargando}>
          {cargando ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
          Guardar la contraseña
        </Button>
      </form>
    </AuthShell>
  );
}
