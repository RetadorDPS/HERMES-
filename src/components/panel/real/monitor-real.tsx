'use client';

/**
 * Monitor de precio y existencias (datos reales).
 * El servidor revisa cada pocas horas el precio y las existencias que el proveedor tiene de tus productos publicados y deja avisos aquí.
 * Nunca cambia un precio ni pausa un producto por su cuenta: te dice qué ha pasado y decides tú.
 */
import { useState } from 'react';
import { AlertTriangle, CheckCircle2, CircleDot, Clock, Eye, Loader2, PackageX, RefreshCw, TrendingUp } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn, formatRelative } from '@/lib/utils';
import { obtenerPerfil } from '@/lib/real/datos';
import type { Atencion } from '@/lib/monitor/atencion';
import { obtenerMonitor, revisarAhora, type ResultadoRevision } from '@/lib/real/monitor';
import { PantallaReal, useCarga } from './comun';

const usd = (n: number | undefined) => (n === undefined ? '—' : `${n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} US$`);
const PUNTO: Record<string, string> = { INFO: 'text-sky-400', WARN: 'text-amber-400', ERROR: 'text-rose-400', DEBUG: 'text-slate-500' };
const HORAS_SIN_REPASO = 8;

function LineaAtencion({ a }: { a: Atencion }) {
  if (a.motivo === 'COSTE_SUBIO') {
    return (
      <li className="flex items-start gap-2 text-[13px]">
        <TrendingUp className="mt-0.5 size-3.5 shrink-0 text-amber-300" />
        <span>
          El coste de <strong>«{a.variante}»</strong> pasó de {usd(a.costeAntes)} a {usd(a.costeAhora)} (+{a.pct?.toLocaleString('es-ES')} %). Tu ganancia por unidad, antes de la comisión de la plataforma, baja de {usd(a.gananciaAntes)} a{' '}
          <strong className={cn(a.vendeAPerdida && 'text-rose-300')}>{usd(a.gananciaAhora)}</strong>.
          {a.vendeAPerdida && <Badge variant="danger" className="ml-2 align-middle">Con tu precio actual pierdes dinero</Badge>}
        </span>
      </li>
    );
  }
  if (a.motivo === 'AGOTADO') {
    return (
      <li className="flex items-start gap-2 text-[13px]">
        <PackageX className="mt-0.5 size-3.5 shrink-0 text-rose-300" />
        <span>
          <strong>«{a.variante}»</strong> está agotada en el proveedor: no vendas más unidades hasta que vuelva a tener existencias.
        </span>
      </li>
    );
  }
  return (
    <li className="flex items-start gap-2 text-[13px]">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-300" />
      <span>Este producto no está en el catálogo común con su ficha, así que no se puede vigilar todavía.</span>
    </li>
  );
}

export function MonitorReal() {
  const { datos, error, cargando, recargar } = useCarga(async () => {
    const [monitor, cuenta] = await Promise.all([obtenerMonitor(), obtenerPerfil()]);
    return { monitor, esAdmin: cuenta.perfil?.role === 'ADMIN' };
  });
  const [revisando, setRevisando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoRevision | null>(null);
  const [errorRevision, setErrorRevision] = useState<string | null>(null);

  const m = datos?.monitor;
  const conAtencion = (m?.vigilados ?? []).filter((p) => p.atencion.length > 0);
  const horasSinRepaso = m?.ultimoRepaso ? (Date.now() - m.ultimoRepaso.getTime()) / 3_600_000 : null;
  const repasoParado = Boolean(m && m.vigilados.length > 0 && (horasSinRepaso === null || horasSinRepaso > HORAS_SIN_REPASO));

  async function lanzar() {
    setRevisando(true);
    setErrorRevision(null);
    setResultado(null);
    try {
      setResultado(await revisarAhora());
      await recargar();
    } catch (e) {
      setErrorRevision((e as Error).message);
    } finally {
      setRevisando(false);
    }
  }

  return (
    <PantallaReal titulo="Monitor de precio y existencias" subtitulo="Te avisa cuando el proveedor cambia lo que cobra o lo que tiene" cargando={cargando} error={error} alRecargar={recargar} tour="screen:monitor">
      {m && (
        <>
          <div className="grid grid-cols-2 gap-2.5 sm:gap-3 xl:grid-cols-4">
            {[
              { etiqueta: 'Productos vigilados', valor: String(m.vigilados.length), sub: 'los que tienes publicados', icono: Eye },
              { etiqueta: 'Necesitan atención', valor: String(conAtencion.length), sub: conAtencion.length ? 'revisa tus precios' : 'todo en orden', icono: AlertTriangle },
              { etiqueta: 'Último repaso', valor: m.ultimoRepaso ? formatRelative(m.ultimoRepaso) : '—', sub: 'del proveedor', icono: Clock },
              { etiqueta: 'Frecuencia', valor: 'cada 6 h', sub: 'por producto', icono: RefreshCw },
            ].map(({ etiqueta, valor, sub, icono: Icono }) => (
              <Card key={etiqueta} className="p-4">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{etiqueta}</p>
                  <Icono className="size-4 text-indigo-300" />
                </div>
                <p className="mt-1.5 text-xl font-semibold tabular-nums">{valor}</p>
                <p className="text-[11px] text-muted-foreground">{sub}</p>
              </Card>
            ))}
          </div>

          {repasoParado && (
            <Alert variant="warning" title="Hace tiempo que no se revisa el proveedor">
              {horasSinRepaso === null ? 'Todavía no se ha hecho ningún repaso de tus productos.' : `El último repaso fue ${formatRelative(m.ultimoRepaso)}.`} Debería hacerse solo cada pocas horas. Si no se arregla solo, avisa al administrador.
            </Alert>
          )}

          {m.vigilados.length === 0 ? (
            <Alert variant="info" title="Todavía no hay productos que vigilar">
              Cuando publiques un producto en tu tienda, el monitor empezará a vigilar su coste y sus existencias en el proveedor y te avisará aquí de cualquier cambio importante. Para empezar, importa uno desde «Importar por enlace» o desde el catálogo.
            </Alert>
          ) : conAtencion.length === 0 ? (
            <Alert variant="success" title="Todo en orden">
              El coste y las existencias de tus {m.vigilados.length} productos coinciden con los del proveedor.
            </Alert>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlertTriangle className="size-4 text-amber-300" />
                  Necesitan tu atención ({conAtencion.length})
                </CardTitle>
                <CardDescription>Lo que cobra el proveedor ya no es lo que había cuando publicaste. Cuentas en dólares, antes de la comisión de la plataforma.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {conAtencion.map((p) => (
                  <div key={p.id} className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="min-w-0 flex-1 break-words text-[13px] font-medium">{p.titulo}</p>
                      <Badge variant="outline">{p.proveedor}</Badge>
                    </div>
                    <ul className="mt-2 space-y-1.5">
                      {p.atencion.map((a, i) => (
                        <LineaAtencion key={`${a.motivo}-${a.variante}-${i}`} a={a} />
                      ))}
                    </ul>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Registro de avisos</CardTitle>
              <CardDescription>Lo que el servidor ha ido detectando en tus productos (los más recientes primero)</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="max-h-[420px] space-y-1 overflow-y-auto pr-1">
                {m.avisos.map((a) => (
                  <div key={a.id} className="rounded-lg border border-transparent px-3 py-2.5 hover:border-white/[0.07] hover:bg-white/[0.02]">
                    <div className="flex items-start gap-2.5">
                      <CircleDot className={cn('mt-0.5 size-3.5 shrink-0', PUNTO[a.nivel] ?? 'text-slate-500')} />
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] leading-snug text-foreground/90">{a.mensaje}</p>
                        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                          {formatRelative(a.fecha)}
                          {a.productoTitulo ? ` · ${a.productoTitulo}` : ''}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
                {m.avisos.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted-foreground">Todavía no hay avisos: el proveedor no ha cambiado nada importante.</p>}
              </div>
            </CardContent>
          </Card>

          {datos?.esAdmin && (
            <Card>
              <CardHeader>
                <CardTitle className="text-[13px]">Para el administrador</CardTitle>
                <CardDescription>El servidor revisa solo, cada 30 minutos, hasta 3 productos que toquen. Si quieres adelantarlo, pulsa aquí: gasta pocas llamadas, una detrás de otra.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button onClick={lanzar} disabled={revisando} variant="outline" size="sm">
                  {revisando ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                  {revisando ? 'Revisando…' : 'Revisar ahora (hasta 3 productos)'}
                </Button>
                {errorRevision && (
                  <Alert variant="danger" title="No se pudo revisar">
                    {errorRevision}
                  </Alert>
                )}
                {resultado && (
                  <Alert variant={resultado.fallos ? 'warning' : 'success'} title={resultado.ocupado ? 'Ya había una revisión en marcha' : 'Revisión terminada'}>
                    <span className="flex items-start gap-1.5">
                      <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
                      <span>
                        {resultado.mensaje}
                        {resultado.llamadas > 0 ? ` · ${resultado.llamadas} llamadas al proveedor` : ''}
                      </span>
                    </span>
                  </Alert>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </PantallaReal>
  );
}
