'use client';

/**
 * Sesión de la versión estática (Supabase Auth) y modo demostración.
 * En el servidor normal (con NextAuth) este proveedor no hace nada.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { ESTATICO } from '@/lib/ruta';
import { guardarModo, leerModo, type Modo } from '@/lib/modo';
import { supabase } from '@/lib/supabase/cliente';

interface ContextoSesion {
  /** true solo en la versión estática */
  activo: boolean;
  cargando: boolean;
  modo: Modo;
  sesion: Session | null;
  email: string | null;
  nombre: string | null;
  /** Evento de la sesión más reciente (p. ej. «PASSWORD_RECOVERY») */
  evento: string | null;
  entrarDemo: () => void;
  salirDemo: () => void;
  salir: () => Promise<void>;
}

const INERTE: ContextoSesion = {
  activo: false,
  cargando: false,
  modo: 'real',
  sesion: null,
  email: null,
  nombre: null,
  evento: null,
  entrarDemo: () => undefined,
  salirDemo: () => undefined,
  salir: async () => undefined,
};

const Contexto = createContext<ContextoSesion>(INERTE);

export function useSesion() {
  return useContext(Contexto);
}

export function SesionProvider({ children }: { children: ReactNode }) {
  const [cargando, setCargando] = useState(ESTATICO);
  const [modo, setModo] = useState<Modo>('real');
  const [sesion, setSesion] = useState<Session | null>(null);
  const [evento, setEvento] = useState<string | null>(null);

  useEffect(() => {
    if (!ESTATICO) return;
    setModo(leerModo());
    const cliente = supabase();
    let vivo = true;

    // Con el modo demostración no hace falta sesión
    cliente.auth.getSession().then(({ data }) => {
      if (!vivo) return;
      setSesion(data.session);
      setCargando(false);
    });

    const { data: suscripcion } = cliente.auth.onAuthStateChange((ev, nueva) => {
      if (!vivo) return;
      setEvento(ev);
      setSesion(nueva);
      setCargando(false);
    });
    return () => {
      vivo = false;
      suscripcion.subscription.unsubscribe();
    };
  }, []);

  const entrarDemo = useCallback(() => {
    guardarModo('demo');
    setModo('demo');
  }, []);
  const salirDemo = useCallback(() => {
    guardarModo('real');
    setModo('real');
  }, []);
  const salir = useCallback(async () => {
    guardarModo('real');
    setModo('real');
    await supabase().auth.signOut();
  }, []);

  const valor = useMemo<ContextoSesion>(() => {
    if (!ESTATICO) return INERTE;
    const meta = (sesion?.user?.user_metadata ?? {}) as Record<string, unknown>;
    return {
      activo: true,
      cargando,
      modo,
      sesion,
      email: sesion?.user?.email ?? null,
      nombre: (typeof meta.name === 'string' && meta.name) || (typeof meta.full_name === 'string' && meta.full_name) || null,
      evento,
      entrarDemo,
      salirDemo,
      salir,
    };
  }, [cargando, modo, sesion, evento, entrarDemo, salirDemo, salir]);

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}
