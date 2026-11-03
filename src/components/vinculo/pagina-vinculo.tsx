'use client';

/**
 * Pantallas de la vinculación con Retador (contrato 1.6). Dos direcciones, una sola lógica:
 *  · /vincular/retorno/?codigo=…&state=…  → la persona empezó AQUÍ, aprobó en Retador y vuelve (o canceló: ?error=cancelado).
 *  · /vincular/entrada/?codigo=…          → la persona empezó en RETADOR y entra aquí (puede no tener sesión: «Entrar con Google»).
 * En los dos casos, si el correo de Retador no es el de esta cuenta se pide confirmar, y sin confirmación no se guarda nada.
 * El código es de un solo uso: se canjea una vez en el servidor y se quita de la dirección.
 */
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { AuthShell } from '@/components/auth/auth-shell';
import { BotonGoogle, SeparadorO } from '@/components/auth/boton-google';
import { useSesion } from '@/components/auth/sesion';
import { BloqueVincular } from '@/components/panel/real/vincular-retador';
import { canjearVinculo, entradaVinculo, tomarVolver } from '@/lib/real/retador';
import { mensajeDeError, supabase } from '@/lib/supabase/cliente';

type Fase = 'preparando' | 'sin_sesion' | 'canjeando' | 'confirmar' | 'lista' | 'cancelada' | 'error';

export function PaginaVinculo({ modo }: { modo: 'retorno' | 'entrada' }) {
  const router = useRouter();
  const { cargando, sesion, modo: modoSesion } = useSesion();
  const [fase, setFase] = useState<Fase>('preparando');
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [clave, setClave] = useState('');
  const [entrando, setEntrando] = useState(false);
  const [destinoGoogle, setDestinoGoogle] = useState(`/vincular/${modo}/`);
  const parametros = useRef<{ codigo: string; state: string; cancelado: boolean } | null>(null);
  const canjeado = useRef(false);

  // Se leen los parámetros una sola vez y se quitan de la dirección (el código no debe quedar en el historial)
  useEffect(() => {
    if (parametros.current) return;
    const q = new URLSearchParams(window.location.search);
    parametros.current = { codigo: q.get('codigo') ?? '', state: q.get('state') ?? '', cancelado: q.get('error') === 'cancelado' };
    // Si hay que entrar con Google, se vuelve a esta misma pantalla con el mismo código
    if (parametros.current.codigo) setDestinoGoogle(`/vincular/${modo}/?codigo=${encodeURIComponent(parametros.current.codigo)}${parametros.current.state ? `&state=${encodeURIComponent(parametros.current.state)}` : ''}`);
    if (parametros.current.cancelado) setFase('cancelada');
    else if (!parametros.current.codigo) {
      setError('El enlace no es válido. Vuelve a empezar desde «Vincular con Retador».');
      setFase('error');
    }
  }, [modo]);

  useEffect(() => {
    if (cargando || fase === 'cancelada' || fase === 'error' || fase === 'lista') return;
    const p = parametros.current;
    if (!p) return;
    if (!sesion || modoSesion !== 'real') {
      setFase('sin_sesion');
      return;
    }
    if (canjeado.current) return;
    canjeado.current = true;
    setFase('canjeando');
    window.history.replaceState(null, '', window.location.pathname);
    (async () => {
      try {
        if (modo === 'retorno') {
          const r = await canjearVinculo(p.codigo, p.state);
          setFase(r.vinculada ? 'lista' : 'confirmar');
        } else {
          await entradaVinculo(p.codigo);
          setFase('confirmar');
        }
      } catch (e) {
        setError((e as Error).message);
        setFase('error');
      }
    })();
  }, [cargando, sesion, modoSesion, fase, modo]);

  // Terminada la vinculación, se vuelve a la pantalla desde donde empezó (o a Tiendas)
  useEffect(() => {
    if (fase !== 'lista') return;
    const t = setTimeout(() => router.replace(tomarVolver()), 1800);
    return () => clearTimeout(t);
  }, [fase, router]);

  const entrarConClave = async (e: React.FormEvent) => {
    e.preventDefault();
    setEntrando(true);
    setError(null);
    const { error: err } = await supabase().auth.signInWithPassword({ email: email.trim(), password: clave });
    if (err) setError(mensajeDeError(err));
    setEntrando(false);
  };


  return (
    <AuthShell title="Vincular con Retador" subtitle="Retador y DropshipPilot, una sola plataforma">
      <div className="space-y-4">
        {error && fase !== 'error' && <Alert variant="danger">{error}</Alert>}

        {fase === 'preparando' || fase === 'canjeando' ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> {fase === 'canjeando' ? 'Comprobando el permiso de Retador…' : 'Preparando…'}
          </p>
        ) : null}

        {fase === 'sin_sesion' && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Entra en DropshipPilot para terminar de vincular tu cuenta con Retador. Si todavía no tienes cuenta, «Entrar con Google» te la crea con el plan Gratis.
            </p>
            <BotonGoogle destino={destinoGoogle} texto="Entrar con Google" alError={setError} />
            <SeparadorO />
            <form onSubmit={entrarConClave} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="vinc-email">Correo</Label>
                <Input id="vinc-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@correo.com" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="vinc-clave">Contraseña</Label>
                <Input id="vinc-clave" type="password" autoComplete="current-password" required value={clave} onChange={(e) => setClave(e.target.value)} placeholder="••••••••" />
              </div>
              <Button type="submit" variant="gradient" className="w-full" disabled={entrando}>
                {entrando && <Loader2 className="size-4 animate-spin" />} Entrar
              </Button>
            </form>
          </div>
        )}

        {fase === 'confirmar' && <BloqueVincular alVincular={() => setFase('lista')} />}

        {fase === 'lista' && (
          <Alert variant="success" title="Vinculada con Retador ✓">
            <span className="flex items-center gap-2">
              <CheckCircle2 className="size-4" /> Tu cuenta ya está vinculada. Te llevo de vuelta…
            </span>
          </Alert>
        )}

        {fase === 'cancelada' && (
          <div className="space-y-3">
            <Alert variant="info" title="Vinculación cancelada">
              No se ha vinculado nada. Puedes volver a intentarlo cuando quieras desde Tiendas.
            </Alert>
            <Button asChild variant="outline" className="w-full">
              <Link href="/stores">Ir a Tiendas</Link>
            </Button>
          </div>
        )}

        {fase === 'error' && (
          <div className="space-y-3">
            <Alert variant="danger" title="No se pudo vincular">
              {error ?? 'Ocurrió un error inesperado.'}
            </Alert>
            <Button asChild variant="outline" className="w-full">
              <Link href="/stores">Ir a Tiendas</Link>
            </Button>
          </div>
        )}
      </div>
    </AuthShell>
  );
}
