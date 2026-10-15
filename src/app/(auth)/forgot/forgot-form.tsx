'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Loader2, MailCheck, Send } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { AuthShell } from '@/components/auth/auth-shell';

export function ForgotForm() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState<{ message: string; resetUrl?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/forgot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error ?? 'No se pudo procesar la solicitud');
        return;
      }
      setSent({ message: json.message, resetUrl: json.resetUrl });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <AuthShell title="Revisa tu correo" subtitle="Si la cuenta existe, hemos enviado un enlace">
        <div className="space-y-4">
          <Alert variant="success" title="Solicitud registrada">
            {sent.message}
          </Alert>
          {sent.resetUrl && (
            <div className="rounded-lg border border-white/[0.08] bg-black/30 p-3">
              <p className="text-[11px] text-muted-foreground">Enlace directo (sin servidor de correo configurado):</p>
              <Link href={sent.resetUrl.replace(/^https?:\/\/[^/]+/, '')} className="mt-1 block break-all font-mono text-[11px] text-indigo-300 hover:underline">
                {sent.resetUrl}
              </Link>
            </div>
          )}
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
      subtitle="Te enviaremos un enlace de un solo uso (caduca en 1 hora)"
      footer={
        <Link href="/login" className="text-indigo-300 hover:underline">
          Volver a iniciar sesión
        </Link>
      }
    >
      {error && (
        <Alert variant="danger" title="Error" className="mb-4" onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="email">Email de tu cuenta</Label>
          <div className="relative">
            <MailCheck className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="tu@email.com"
              className="pl-9"
            />
          </div>
        </div>
        <Button type="submit" variant="gradient" className="w-full" disabled={loading}>
          {loading ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          {loading ? 'Enviando…' : 'Enviar enlace de recuperación'}
        </Button>
      </form>
    </AuthShell>
  );
}
