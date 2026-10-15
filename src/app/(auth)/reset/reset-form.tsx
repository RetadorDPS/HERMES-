'use client';

import { useState } from 'react';
import Link from 'next/link';
import { KeyRound, Loader2, ShieldCheck } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { AuthShell } from '@/components/auth/auth-shell';

export function ResetForm({ token }: { token: string }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      setError('Las dos contraseñas no coinciden');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error ?? 'No se pudo cambiar la contraseña');
        return;
      }
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <AuthShell title="Enlace no válido" subtitle="Falta el token de recuperación">
        <Alert variant="warning" title="Abre el enlace completo del correo">
          El enlace debe incluir el parámetro de seguridad. Vuelve a solicitar la recuperación si no lo tienes.
        </Alert>
        <Button asChild variant="outline" className="mt-4 w-full">
          <Link href="/forgot">Solicitar un enlace nuevo</Link>
        </Button>
      </AuthShell>
    );
  }

  if (done) {
    return (
      <AuthShell title="Contraseña actualizada" subtitle="Ya puedes entrar con tu nueva contraseña">
        <Alert variant="success" title="Todo listo">
          Por seguridad, cualquier otro enlace de recuperación ha quedado invalidado.
        </Alert>
        <Button asChild variant="gradient" className="mt-4 w-full">
          <Link href="/login">Iniciar sesión</Link>
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
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="password">Nueva contraseña</Label>
          <div className="relative">
            <KeyRound className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Mínimo 8 caracteres"
              className="pl-9"
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="confirm">Repite la contraseña</Label>
          <Input
            id="confirm"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>
        <Button type="submit" variant="gradient" className="w-full" disabled={loading}>
          {loading ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
          {loading ? 'Guardando…' : 'Cambiar contraseña'}
        </Button>
      </form>
    </AuthShell>
  );
}
