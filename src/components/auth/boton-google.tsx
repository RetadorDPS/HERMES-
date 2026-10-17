'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { mensajeDeError, supabase, urlAbsoluta } from '@/lib/supabase/cliente';

function LogoGoogle() {
  return (
    <svg viewBox="0 0 48 48" className="size-4" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

/** «Continuar con Google». Necesita que el proveedor esté activado en Supabase. */
export function BotonGoogle({ destino = '/dashboard/', texto = 'Continuar con Google', alError }: { destino?: string; texto?: string; alError: (mensaje: string) => void }) {
  const [cargando, setCargando] = useState(false);

  const pulsar = async () => {
    setCargando(true);
    const { error } = await supabase().auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: urlAbsoluta(destino) },
    });
    // Si todo va bien, el navegador sale hacia Google y no llega aquí
    if (error) {
      alError(mensajeDeError(error));
      setCargando(false);
    }
  };

  return (
    <Button type="button" variant="outline" className="w-full" onClick={pulsar} disabled={cargando}>
      {cargando ? <Loader2 className="size-4 animate-spin" /> : <LogoGoogle />}
      {texto}
    </Button>
  );
}

export function SeparadorO() {
  return (
    <div className="my-4 flex items-center gap-3 text-[11px] uppercase tracking-wide text-muted-foreground">
      <span className="h-px flex-1 bg-white/[0.08]" />o con tu correo
      <span className="h-px flex-1 bg-white/[0.08]" />
    </div>
  );
}
