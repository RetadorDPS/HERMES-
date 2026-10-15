'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { ArrowRight, KeyRound, Loader2, LockKeyhole, Mail, ShieldAlert, Smartphone } from 'lucide-react';
import Link from 'next/link';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';

interface Props {
  callbackUrl: string;
  authEnabled: boolean;
  demoEmail: string;
  showDemoHint: boolean;
}

export function LoginForm({ callbackUrl, authEnabled, demoEmail, showDemoHint }: Props) {
  const router = useRouter();
  const [email, setEmail] = useState(showDemoHint ? demoEmail : '');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [needsCode, setNeedsCode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = await signIn('credentials', { redirect: false, email, password, code, callbackUrl });

    if (res?.error) {
      setLoading(false);
      // ¿Falta el código del segundo factor? Se comprueba y se muestra el campo.
      try {
        const check = await fetch('/api/auth/2fa-check', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email }),
        }).then((r) => r.json());

        if (check?.required) {
          setNeedsCode(true);
          setError(
            code
              ? 'El código de 6 dígitos no es válido o ha caducado. Vuelve a mirarlo en tu aplicación.'
              : 'Esta cuenta tiene el segundo factor activado: escribe el código de tu aplicación de autenticación.',
          );
          return;
        }
      } catch {
        /* si la comprobación falla, mostramos el mensaje genérico */
      }

      setError('Credenciales incorrectas. Revisa el email y la contraseña.');
      return;
    }
    router.push(callbackUrl || '/dashboard');
    router.refresh();
  };

  return (
    <div className="w-full max-w-[420px]">
      <div className="mb-7 flex items-center gap-3">
        <div className="grid size-11 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-xl text-white shadow-lg shadow-indigo-500/25">
          ⚡
        </div>
        <div>
          <h1 className="text-lg font-semibold tracking-tight">DropshipPilot</h1>
          <p className="text-xs text-muted-foreground">Automatización de dropshipping 24/7</p>
        </div>
      </div>

      <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-6 shadow-2xl backdrop-blur-xl">
        <div className="mb-5">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold">
            <LockKeyhole className="size-4 text-indigo-300" />
            Iniciar sesión
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">Accede al panel de control de tus tiendas.</p>
        </div>

        {!authEnabled && (
          <Alert variant="warning" title="La autenticación está desactivada (AUTH_ENABLED=false)" className="mb-4">
            El formulario funciona, pero el dashboard es accesible sin login. Actívala con <code>AUTH_ENABLED=true</code> en <code>.env.local</code>.
          </Alert>
        )}

        {error && (
          <Alert variant="danger" title="No se pudo iniciar sesión" className="mb-4" onDismiss={() => setError(null)}>
            {error}
          </Alert>
        )}

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tu@email.com"
                className="pl-9"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password">Contraseña</Label>
            <div className="relative">
              <KeyRound className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="pl-9"
              />
            </div>
          </div>

          {(needsCode || code) && (
            <div className="space-y-1.5">
              <Label htmlFor="code">Código de verificación</Label>
              <div className="relative">
                <Smartphone className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus={needsCode}
                  placeholder="123456"
                  className="pl-9 font-mono tracking-[0.3em]"
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                De tu aplicación de autenticación, o uno de los códigos de recuperación.
              </p>
            </div>
          )}

          <Button type="submit" variant="gradient" className="w-full" disabled={loading}>
            {loading ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
            {loading ? 'Entrando…' : 'Entrar al panel'}
          </Button>
        </form>

        <div className="mt-4 flex items-center justify-between text-[12px] text-muted-foreground">
          <Link href="/forgot" className="hover:text-foreground hover:underline">
            He olvidado mi contraseña
          </Link>
          <Link href="/register" id="create-account" className="text-indigo-300 hover:underline">
            Crear una cuenta
          </Link>
        </div>

        {showDemoHint && (
          <div className="mt-5 rounded-lg border border-indigo-500/20 bg-indigo-500/[0.07] p-3 text-[11.5px] leading-relaxed text-muted-foreground">
            <p className="flex items-center gap-1.5 font-medium text-indigo-200">
              <ShieldAlert className="size-3.5" />
              Credenciales de demo
            </p>
            <p className="mt-1">
              Email <code>{demoEmail}</code> · contraseña <code>dropshippilot</code> — se desactivan al definir{' '}
              <code>AUTH_EMAIL</code> y <code>AUTH_PASSWORD</code> en el entorno.
            </p>
          </div>
        )}
      </div>

      <p className="mt-5 text-center text-[11px] text-muted-foreground">
        Sesión gestionada con NextAuth · contraseñas con hash scrypt · cookies HttpOnly
      </p>

      <p className="mt-2 text-center text-[11px] text-muted-foreground">
        <Link href="/privacy" className="hover:text-foreground hover:underline">Privacidad</Link>
        {' · '}
        <Link href="/terms" className="hover:text-foreground hover:underline">Términos</Link>
        {' · '}
        <Link href="/cookies" className="hover:text-foreground hover:underline">Cookies</Link>
      </p>
    </div>
  );
}
