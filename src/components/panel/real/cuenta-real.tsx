'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Circle, Loader2, LogOut, ShieldCheck } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { useSesion } from '@/components/auth/sesion';
import { guardarPerfil, obtenerClientes, obtenerPerfil, obtenerResumen, type Perfil } from '@/lib/real/datos';
import { cn, formatRelative } from '@/lib/utils';
import { PantallaReal, useCarga } from './comun';

const ALERTAS: { clave: keyof Perfil['alertas']; titulo: string; texto: string }[] = [
  { clave: 'sync', titulo: 'Fallos de sincronización', texto: 'Un producto no se pudo actualizar en la tienda tras varios intentos.' },
  { clave: 'stock', titulo: 'Cambios de stock', texto: 'Un producto se agotó en el proveedor o volvió a tener existencias.' },
  { clave: 'webhooks', titulo: 'Avisos de tiendas con firma inválida', texto: 'Una tienda envió un aviso sin la firma correcta.' },
  { clave: 'billing', titulo: 'Problemas de pago', texto: 'Un cobro de tu suscripción ha fallado.' },
  { clave: 'onboarding', titulo: 'Primeros pasos', texto: 'Correo de bienvenida y un único recordatorio si quedan pasos por dar.' },
];

export function AjustesReal() {
  const { salir } = useSesion();
  const { datos, error, cargando, recargar } = useCarga(obtenerPerfil);
  const [nombre, setNombre] = useState('');
  const [zona, setZona] = useState('');
  const [alertas, setAlertas] = useState<Perfil['alertas'] | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);

  useEffect(() => {
    const p = datos?.perfil;
    if (p) {
      setNombre(p.name ?? '');
      setZona(p.timezone);
      setAlertas(p.alertas);
    }
  }, [datos]);

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault();
    setGuardando(true);
    setAviso(null);
    try {
      await guardarPerfil({ name: nombre.trim(), timezone: zona.trim() || 'Europe/Madrid' });
      setAviso({ ok: true, texto: 'Datos guardados.' });
    } catch (err) {
      setAviso({ ok: false, texto: (err as Error).message });
    } finally {
      setGuardando(false);
    }
  };

  const cambiarAlerta = async (clave: keyof Perfil['alertas'], valor: boolean) => {
    if (!alertas) return;
    const anterior = alertas;
    setAlertas({ ...alertas, [clave]: valor });
    try {
      await guardarPerfil({ alertas: { [clave]: valor } });
    } catch (err) {
      setAlertas(anterior);
      setAviso({ ok: false, texto: (err as Error).message });
    }
  };

  const p = datos?.perfil;
  return (
    <PantallaReal titulo="Ajustes de la cuenta" subtitulo="Tus datos, avisos por correo y seguridad" cargando={cargando} error={error} alRecargar={recargar} tour="screen:settings">
      {p && (
        <div className="grid gap-3 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Tus datos</CardTitle>
              <CardDescription>
                {p.email} {p.role === 'ADMIN' && <Badge variant="default">Operador</Badge>}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {aviso && (
                <Alert variant={aviso.ok ? 'success' : 'danger'} className="mb-3" onDismiss={() => setAviso(null)}>
                  {aviso.texto}
                </Alert>
              )}
              <form onSubmit={guardar} className="space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="nombre">Nombre</Label>
                  <Input id="nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Tu nombre o empresa" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="zona">Zona horaria</Label>
                  <Input id="zona" value={zona} onChange={(e) => setZona(e.target.value)} placeholder="Europe/Madrid" />
                </div>
                <Button type="submit" variant="gradient" size="sm" disabled={guardando}>
                  {guardando && <Loader2 className="size-4 animate-spin" />}
                  Guardar
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="size-4 text-indigo-300" />
                Seguridad y sesión
              </CardTitle>
              <CardDescription>Acceso con correo y contraseña o con Google.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-[12.5px]">
              <p className="flex items-center gap-2">
                {p.emailVerifiedAt ? <CheckCircle2 className="size-4 text-emerald-400" /> : <Circle className="size-4 text-muted-foreground" />}
                {p.emailVerifiedAt ? 'Correo confirmado' : 'Correo sin confirmar'}
              </p>
              <p className="text-muted-foreground">Cuenta creada {formatRelative(p.createdAt)}.</p>
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline" size="sm">
                  <Link href="/forgot">Cambiar la contraseña</Link>
                </Button>
                <Button variant="outline" size="sm" onClick={() => void salir()}>
                  <LogOut className="size-3.5" />
                  Cerrar sesión
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Avisos por correo</CardTitle>
              <CardDescription>Elige de qué quieres que te avisemos. Se guarda al instante.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2 md:grid-cols-2">
              {alertas &&
                ALERTAS.map((a) => (
                  <label
                    key={a.clave}
                    className={cn(
                      'flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition',
                      alertas[a.clave] ? 'border-emerald-500/20 bg-emerald-500/[0.05]' : 'border-white/[0.07] bg-white/[0.02]',
                    )}
                  >
                    <input type="checkbox" className="mt-0.5 size-4 accent-emerald-500" checked={alertas[a.clave]} onChange={(e) => void cambiarAlerta(a.clave, e.target.checked)} />
                    <span>
                      <span className="block text-[13px] font-medium">{a.titulo}</span>
                      <span className="block text-[11.5px] text-muted-foreground">{a.texto}</span>
                    </span>
                  </label>
                ))}
              <p className="text-[11px] text-muted-foreground md:col-span-2">Por ahora las preferencias se guardan, pero el envío de correos se activará más adelante.</p>
            </CardContent>
          </Card>
        </div>
      )}
    </PantallaReal>
  );
}

export function AdminReal() {
  const { datos: cuenta, error: e1, cargando: c1 } = useCarga(obtenerPerfil);
  const esAdmin = cuenta?.perfil?.role === 'ADMIN';
  const { datos, error, cargando, recargar } = useCarga(async () => (esAdmin ? obtenerClientes() : []));
  useEffect(() => {
    if (esAdmin) void recargar();
  }, [esAdmin, recargar]);

  return (
    <PantallaReal titulo="Administración de la plataforma" subtitulo="Solo para el operador del servicio" cargando={c1 || cargando} error={e1 || error} alRecargar={recargar} tour="screen:admin">
      {!esAdmin ? (
        <Alert variant="warning" title="Esta sección es solo para el administrador">
          Tu cuenta no tiene el rol de operador. Si eres el propietario del servicio, el rol se concede desde la base de datos.
        </Alert>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Clientes ({datos?.length ?? 0})</CardTitle>
            <CardDescription>Cuentas registradas. El cambio de plan y créditos se activará más adelante.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {(datos ?? []).map((u) => (
              <div key={u.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium">{u.name || u.email}</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {u.email} · alta {formatRelative(u.createdAt)} · último acceso {formatRelative(u.lastLoginAt)}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <Badge variant="default">{u.plan}</Badge>
                  {u.role === 'ADMIN' && <Badge variant="success">operador</Badge>}
                  {!u.emailVerified && <Badge variant="outline">sin confirmar</Badge>}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </PantallaReal>
  );
}

export function PuestaEnMarchaReal() {
  const { datos, error, cargando, recargar } = useCarga(async () => {
    const [r, cuenta] = await Promise.all([obtenerResumen(), obtenerPerfil()]);
    return { r, cuenta };
  });
  const r = datos?.r;
  const filas = r
    ? [
        { ok: true, titulo: 'Base de datos', texto: 'Conectada a Supabase (Irlanda), con seguridad por cliente.' },
        { ok: Boolean(datos?.cuenta.perfil), titulo: 'Tu cuenta', texto: datos?.cuenta.perfil?.email ?? '' },
        { ok: r.reglas > 0, titulo: 'Regla de margen', texto: r.reglas > 0 ? `${r.reglas} regla(s) definida(s).`  : 'Crea una en Precios y márgenes.', href: '/pricing' },
        { ok: r.cuentasProveedor > 0 || r.catalogo > 0, titulo: 'Proveedores', texto: 'Se conectarán CJ y AliExpress con sus APIs oficiales (siguiente fase).', href: '/suppliers' },
        { ok: r.tiendas > 0, titulo: 'Tiendas', texto: r.tiendas > 0 ? `${r.tiendas} conectada(s).` : 'Shopify o WooCommerce (siguiente fase).', href: '/stores' },
        { ok: r.productos > 0, titulo: 'Productos', texto: r.productos > 0 ? `${r.productos} importado(s).` : 'Se importarán desde el catálogo o por enlace.', href: '/catalog' },
        { ok: false, titulo: 'Cobros', texto: 'Stripe o Lemon Squeezy: pendiente de configurar.', href: '/billing' },
        { ok: false, titulo: 'Correo de salida', texto: 'Resend o Brevo: pendiente de configurar.' },
      ]
    : [];
  return (
    <PantallaReal titulo="Puesta en marcha" subtitulo="Qué está conectado y qué falta" cargando={cargando} error={error} alRecargar={recargar} tour="screen:setup">
      <div className="grid gap-2 md:grid-cols-2">
        {filas.map((f) => {
          const contenido = (
            <>
              {f.ok ? <CheckCircle2 className="size-5 shrink-0 text-emerald-400" /> : <Circle className="size-5 shrink-0 text-muted-foreground" />}
              <span className="min-w-0">
                <span className="block text-[13px] font-medium">{f.titulo}</span>
                <span className="block text-[11.5px] text-muted-foreground">{f.texto}</span>
              </span>
            </>
          );
          const clase = cn('flex items-start gap-3 rounded-lg border px-3 py-2.5', f.ok ? 'border-emerald-500/20 bg-emerald-500/[0.05]' : 'border-white/[0.07] bg-white/[0.02]');
          return f.href ? (
            <Link key={f.titulo} href={f.href} className={cn(clase, 'transition hover:bg-white/[0.04]')}>
              {contenido}
            </Link>
          ) : (
            <div key={f.titulo} className={clase}>
              {contenido}
            </div>
          );
        })}
      </div>
    </PantallaReal>
  );
}
