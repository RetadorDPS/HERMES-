'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2, Mail, UserPlus } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { AuthShell } from '@/components/auth/auth-shell';
import { BotonGoogle, SeparadorO } from '@/components/auth/boton-google';
import { mensajeDeError, supabase, urlAbsoluta } from '@/lib/supabase/cliente';

export function RegisterSupabase() {
  const router = useRouter();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revisarCorreo, setRevisarCorreo] = useState(false);

  const crear = async (e: React.FormEvent) => {
    e.preventDefault();
    setCargando(true);
    setError(null);
    const { data, error: err } = await supabase().auth.signUp({
      email: form.email.trim(),
      password: form.password,
      options: { data: { name: form.name.trim() || undefined }, emailRedirectTo: urlAbsoluta('/dashboard/') },
    });
    setCargando(false);
    if (err) {
      setError(mensajeDeError(err));
      return;
    }
    // Con la confirmación por correo activa, Supabase devuelve un usuario sin identidades si el correo ya existe
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      setError('Ese correo ya tiene una cuenta. Inicia sesión o recupera tu contraseña.');
      return;
    }
    if (data.session) {
      router.push('/dashboard');
      return;
    }
    setRevisarCorreo(true);
  };

  if (revisarCorreo) {
    return (
      <AuthShell title="Revisa tu correo" subtitle="Te hemos enviado un enlace de confirmación">
        <div className="space-y-4">
          <Alert variant="success" title="Cuenta creada">
            Abre el correo que enviamos a <strong>{form.email}</strong> y pulsa el enlace para confirmar tu cuenta. Si no llega en unos minutos, mira en
            Spam.
          </Alert>
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
      subtitle="Empieza gratis con el plan de prueba"
      footer={
        <>
          ¿Ya tienes cuenta?{' '}
          <Link href="/login" className="text-indigo-300 hover:underline">Inicia sesión</Link>
        </>
      }
    >
      {error && (
        <Alert variant="danger" title="No se pudo crear la cuenta" className="mb-4" onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}

      <BotonGoogle alError={setError} texto="Registrarme con Google" />
      <SeparadorO />

      <form onSubmit={crear} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="name">Nombre</Label>
          <Input id="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Tu nombre o empresa" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="email">Correo</Label>
          <div className="relative">
            <Mail className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input id="email" type="email" required autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="tu@correo.com" className="pl-9" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Contraseña</Label>
          <Input id="password" type="password" required minLength={8} autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Mínimo 8 caracteres" />
        </div>
        <Button type="submit" variant="gradient" className="w-full" disabled={cargando}>
          {cargando ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
          {cargando ? 'Creando cuenta…' : 'Crear mi cuenta'}
        </Button>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Al crear la cuenta aceptas los <Link href="/terms" className="underline">términos</Link> y la <Link href="/privacy" className="underline">política de privacidad</Link>.
        </p>
      </form>
    </AuthShell>
  );
}
