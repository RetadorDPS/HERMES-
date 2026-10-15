'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Loader2, Mail, ShieldCheck, UserPlus } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { AuthShell } from '@/components/auth/auth-shell';

const PLANES = [
  { value: 'TRIAL', label: 'Prueba — 0 € (25 productos, 200 créditos)' },
  { value: 'STARTER', label: 'Starter — 29 €/mes (300 productos)' },
  { value: 'PRO', label: 'Pro — 79 €/mes (2.000 productos)' },
  { value: 'ENTERPRISE', label: 'Enterprise — 249 €/mes (ilimitado)' },
];

export function RegisterForm({ mailConfigured, authEnabled }: { mailConfigured: boolean; authEnabled: boolean }) {
  const [form, setForm] = useState({ name: '', email: '', password: '', plan: 'TRIAL' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ verifyUrl?: string; message: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error ?? 'No se pudo crear la cuenta');
        return;
      }
      setDone({ verifyUrl: json.verifyUrl, message: json.message });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <AuthShell title="Revisa tu correo" subtitle="Hemos enviado un enlace de confirmación">
        <div className="space-y-4">
          <Alert variant="success" title="Cuenta creada">
            {done.message}
          </Alert>
          {done.verifyUrl && (
            <div className="rounded-lg border border-white/[0.08] bg-black/30 p-3">
              <p className="text-[11px] text-muted-foreground">
                No hay servidor de correo configurado en esta instalación, así que te damos el enlace directamente:
              </p>
              <Link href={done.verifyUrl.replace(/^https?:\/\/[^/]+/, '')} className="mt-1 block break-all font-mono text-[11px] text-indigo-300 hover:underline">
                {done.verifyUrl}
              </Link>
            </div>
          )}
          <Button asChild variant="outline" className="w-full">
            <Link href="/login">Ir a iniciar sesión</Link>
          </Button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Crear cuenta"
      subtitle="Empieza gratis: 25 productos y 200 extracciones al mes"
      footer={
        <>
          ¿Ya tienes cuenta?{' '}
          <Link href="/login" className="text-indigo-300 hover:underline">
            Inicia sesión
          </Link>
        </>
      }
    >
      {!authEnabled && (
        <Alert variant="info" title="Modo autoevaluación" className="mb-4">
          La autenticación está desactivada (<code>AUTH_ENABLED=false</code>). Puedes registrarte igualmente: al activarla, tu cuenta será la que
          use el panel.
        </Alert>
      )}

      {!mailConfigured && (
        <Alert variant="warning" title="Sin servidor de correo" className="mb-4">
          No hay <code>RESEND_API_KEY</code> configurada: el enlace de verificación se mostrará aquí mismo para que puedas continuar. En producción,
          configura el correo para que llegue a la bandeja de tus clientes.
        </Alert>
      )}

      {error && (
        <Alert variant="danger" title="No se pudo crear la cuenta" className="mb-4" onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}

      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="name">Nombre</Label>
          <Input id="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Tu nombre o empresa" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <div className="relative">
            <Mail className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="tu@email.com"
              className="pl-9"
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Contraseña</Label>
          <Input
            id="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            placeholder="Mínimo 8 caracteres"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="plan">Plan</Label>
          <Select id="plan" value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })}>
            {PLANES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
          <p className="text-[11px] text-muted-foreground">Podrás cambiar de plan desde Facturación. Los planes de pago requieren Stripe configurado.</p>
        </div>

        <Button type="submit" variant="gradient" className="w-full" disabled={loading}>
          {loading ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
          {loading ? 'Creando cuenta…' : 'Crear mi cuenta'}
        </Button>
      </form>

      <p className="mt-4 flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-emerald-400" />
        Contraseñas con hash scrypt, tokens de un solo uso y credenciales de tus tiendas cifradas con AES-256-GCM.
      </p>
    </AuthShell>
  );
}
