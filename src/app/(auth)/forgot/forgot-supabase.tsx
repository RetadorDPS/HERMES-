'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Loader2, Mail, Send } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { AuthShell } from '@/components/auth/auth-shell';
import { mensajeDeError, supabase, urlAbsoluta } from '@/lib/supabase/cliente';

export function ForgotSupabase() {
  const [email, setEmail] = useState('');
  const [cargando, setCargando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setCargando(true);
    setError(null);
    const { error: err } = await supabase().auth.resetPasswordForEmail(email.trim(), { redirectTo: urlAbsoluta('/reset/') });
    setCargando(false);
    if (err) {
      setError(mensajeDeError(err));
      return;
    }
    setEnviado(true);
  };

  if (enviado) {
    return (
      <AuthShell title="Revisa tu correo" subtitle="Si la cuenta existe, te hemos enviado un enlace">
        <div className="space-y-4">
          <Alert variant="success" title="Solicitud enviada">
            Si <strong>{email}</strong> tiene una cuenta, recibirás un enlace para elegir una contraseña nueva. Puede tardar unos minutos; mira también en Spam.
          </Alert>
          <Button asChild variant="outline" className="w-full">
            <Link href="/login">Volver al acceso</Link>
          </Button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Recuperar contraseña"
      subtitle="Te enviaremos un enlace para elegir una contraseña nueva"
      footer={<Link href="/login" className="text-indigo-300 hover:underline">Volver a iniciar sesión</Link>}
    >
      {error && (
        <Alert variant="danger" title="Error" className="mb-4" onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}
      <form onSubmit={enviar} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="email">Correo de tu cuenta</Label>
          <div className="relative">
            <Mail className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@correo.com" className="pl-9" />
          </div>
        </div>
        <Button type="submit" variant="gradient" className="w-full" disabled={cargando}>
          {cargando ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          Enviar enlace de recuperación
        </Button>
      </form>
    </AuthShell>
  );
}
