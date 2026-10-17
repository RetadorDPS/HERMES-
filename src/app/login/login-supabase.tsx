'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, KeyRound, Loader2, LockKeyhole, Mail, PlayCircle } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { BotonGoogle, SeparadorO } from '@/components/auth/boton-google';
import { useSesion } from '@/components/auth/sesion';
import { mensajeDeError, supabase } from '@/lib/supabase/cliente';

/** Pantalla de entrada de la versión estática: correo + contraseña, Google y modo demostración. */
export function LoginSupabase() {
  const router = useRouter();
  const { sesion, cargando: cargandoSesion, entrarDemo, modo } = useSesion();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Si ya hay sesión, no tiene sentido pedir credenciales
  useEffect(() => {
    if (!cargandoSesion && sesion && modo === 'real') router.replace('/dashboard');
  }, [cargandoSesion, sesion, modo, router]);

  const entrar = async (e: React.FormEvent) => {
    e.preventDefault();
    setCargando(true);
    setError(null);
    const { error: err } = await supabase().auth.signInWithPassword({ email: email.trim(), password });
    if (err) {
      setError(mensajeDeError(err));
      setCargando(false);
      return;
    }
    router.push('/dashboard');
  };

  const verDemo = () => {
    entrarDemo();
    router.push('/dashboard');
  };

  return (
    <div className="w-full max-w-[420px]">
      <div className="mb-6 flex items-center gap-3">
        <div className="grid size-11 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-xl text-white shadow-lg shadow-indigo-500/25">⚡</div>
        <div>
          <h1 className="text-lg font-semibold tracking-tight">DropshipPilot</h1>
          <p className="text-xs text-muted-foreground">Automatización de dropshipping 24/7</p>
        </div>
      </div>

      <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5 shadow-2xl backdrop-blur-xl sm:p-6">
        <div className="mb-4">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold">
            <LockKeyhole className="size-4 text-indigo-300" />
            Iniciar sesión
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">Accede al panel de control de tus tiendas.</p>
        </div>

        {error && (
          <Alert variant="danger" title="No se pudo iniciar sesión" className="mb-4" onDismiss={() => setError(null)}>
            {error}
          </Alert>
        )}

        <BotonGoogle alError={setError} />
        <SeparadorO />

        <form onSubmit={entrar} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">Correo</Label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@correo.com" className="pl-9" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Contraseña</Label>
            <div className="relative">
              <KeyRound className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className="pl-9" />
            </div>
          </div>
          <Button type="submit" variant="gradient" className="w-full" disabled={cargando}>
            {cargando ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
            {cargando ? 'Entrando…' : 'Entrar al panel'}
          </Button>
        </form>

        <div className="mt-4 flex items-center justify-between text-[12px] text-muted-foreground">
          <Link href="/forgot" className="hover:text-foreground hover:underline">He olvidado mi contraseña</Link>
          <Link href="/register" id="create-account" className="text-indigo-300 hover:underline">Crear una cuenta</Link>
        </div>

        <div className="mt-5 border-t border-white/[0.06] pt-4">
          <Button type="button" variant="ghost" className="w-full text-muted-foreground" onClick={verDemo}>
            <PlayCircle className="size-4" />
            Ver la demostración (sin cuenta)
          </Button>
        </div>
      </div>

      <p className="mt-4 text-center text-[11px] text-muted-foreground">
        <Link href="/privacy" className="hover:text-foreground hover:underline">Privacidad</Link>
        {' · '}
        <Link href="/terms" className="hover:text-foreground hover:underline">Términos</Link>
        {' · '}
        <Link href="/cookies" className="hover:text-foreground hover:underline">Cookies</Link>
      </p>
    </div>
  );
}
