'use client';

/**
 * Proveedores y APIs (datos reales).
 * Dice si CJ Dropshipping y AliExpress están respondiendo. Las claves viven solo en el servidor: aquí nunca se ven ni se escriben.
 */
import Link from 'next/link';
import { CheckCircle2, CircleHelp, Factory, KeyRound, XCircle } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatRelative } from '@/lib/utils';
import { obtenerPerfil } from '@/lib/real/datos';
import { obtenerEstadoProveedores, type EstadoProveedor } from '@/lib/real/monitor';
import { PantallaReal, useCarga } from './comun';

function Estado({ p }: { p: EstadoProveedor }) {
  if (p.estado === 'CONNECTED') return <Badge variant="success"><CheckCircle2 className="size-3" /> Responde</Badge>;
  if (p.estado === 'ERROR') return <Badge variant="danger"><XCircle className="size-3" /> Falló la última comprobación</Badge>;
  return <Badge variant="outline"><CircleHelp className="size-3" /> Sin comprobar</Badge>;
}

export function ProveedoresReal() {
  const { datos, error, cargando, recargar } = useCarga(async () => {
    const [proveedores, cuenta] = await Promise.all([obtenerEstadoProveedores(), obtenerPerfil()]);
    return { proveedores, esAdmin: cuenta.perfil?.role === 'ADMIN' };
  });

  return (
    <PantallaReal titulo="Proveedores y APIs" subtitulo="Si CJ y AliExpress están respondiendo" cargando={cargando} error={error} alRecargar={recargar} tour="screen:suppliers">
      {datos && (
        <>
          <Alert variant="info" title="Tus claves están a salvo">
            Las claves de tus proveedores están protegidas: desde esta pantalla no se pueden ver ni cambiar.
            {datos.esAdmin && (
              <>
                {' '}
                Para probarlas o descargar productos, ve a{' '}
                <Link href="/admin" className="underline underline-offset-2">
                  Administración
                </Link>
                .
              </>
            )}
          </Alert>

          <div className="grid gap-3 md:grid-cols-2">
            {datos.proveedores.map((p) => (
              <Card key={p.proveedor}>
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-center gap-2">
                    <Factory className="size-4 text-indigo-300" />
                    {p.nombre}
                    <Estado p={p} />
                  </CardTitle>
                  <CardDescription>{p.ultimaComprobacion ? `Última comprobación ${formatRelative(p.ultimaComprobacion)}` : 'Todavía no se ha comprobado'}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 text-[13px]">
                  {p.proveedor === 'ALIEXPRESS' && (
                    <p className="flex items-start gap-1.5">
                      <KeyRound className="mt-0.5 size-3.5 shrink-0 text-indigo-300" />
                      <span>
                        {p.cuentaAutorizada
                          ? 'Cuenta de AliExpress autorizada: se pueden leer fichas y cotizar envíos.'
                          : 'La cuenta de AliExpress todavía no está autorizada, así que no se pueden leer fichas ni cotizar envíos. El administrador debe autorizarla.'}
                      </span>
                    </p>
                  )}
                  {datos.esAdmin && p.llamadasMes !== null && <p className="text-muted-foreground">Llamadas este mes: {p.llamadasMes.toLocaleString('es-ES')}</p>}
                  {datos.esAdmin && p.ultimoError && <p className="break-words text-rose-300">Último error: {p.ultimoError}</p>}
                </CardContent>
              </Card>
            ))}
          </div>

          <Alert variant="info" title="Qué viene después">
            Más adelante podrás conectar tu propia cuenta de proveedor para que los pedidos se compren solos. Hoy los productos y los precios salen del catálogo común.
          </Alert>
        </>
      )}
    </PantallaReal>
  );
}
