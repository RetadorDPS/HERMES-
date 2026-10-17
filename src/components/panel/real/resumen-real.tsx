'use client';

import Link from 'next/link';
import { Boxes, CheckCircle2, Circle, CreditCard, Link2, Truck, TrendingUp } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { KpiCard } from '@/components/dashboard/kpi-card';
import { obtenerPerfil, obtenerResumen } from '@/lib/real/datos';
import { cn, formatCurrency, formatNumber } from '@/lib/utils';
import { PantallaReal, useCarga } from './comun';

export function ResumenReal() {
  const { datos, error, cargando, recargar } = useCarga(async () => {
    const [resumen, cuenta] = await Promise.all([obtenerResumen(), obtenerPerfil()]);
    return { resumen, ...cuenta };
  });
  const r = datos?.resumen;
  const suscripcion = datos?.suscripcion;
  const nombre = datos?.perfil?.name || datos?.perfil?.email?.split('@')[0] || '';

  const pasos = r
    ? [
        { hecho: r.reglas > 0, titulo: 'Fija tu regla de margen', texto: 'Decide cuánto ganas por producto.', href: '/pricing' },
        { hecho: r.cuentasProveedor > 0 || r.catalogo > 0, titulo: 'Conecta un proveedor', texto: 'CJ o AliExpress: de ahí salen los productos.', href: '/suppliers' },
        { hecho: r.tiendas > 0, titulo: 'Conecta tu tienda', texto: 'Shopify o WooCommerce.', href: '/stores' },
        { hecho: r.productos > 0, titulo: 'Importa tu primer producto', texto: 'Del catálogo o pegando un enlace.', href: '/catalog' },
      ]
    : [];
  const completados = pasos.filter((p) => p.hecho).length;

  return (
    <PantallaReal
      titulo={nombre ? `Hola, ${nombre}` : 'Resumen'}
      subtitulo={r ? `${formatNumber(r.productos)} productos · ${formatNumber(r.pedidosPendientes)} pedidos pendientes` : 'Tu cuenta'}
      cargando={cargando}
      error={error}
      alRecargar={recargar}
      tour="screen:dashboard"
    >
      {r && (
        <>
          {r.tiendasConError > 0 && (
            <Alert variant="danger" title={`${r.tiendasConError} tienda(s) con error de conexión`}>
              Revisa las credenciales en <Link className="underline" href="/stores">Tiendas</Link>.
            </Alert>
          )}

          <section className="grid grid-cols-2 gap-2.5 sm:gap-3 xl:grid-cols-4">
            <KpiCard label="Productos" value={formatNumber(r.productos)} sub={`${formatNumber(r.productosAgotados)} agotados`} icon={Boxes} accent="sky" />
            <KpiCard label="Tiendas" value={formatNumber(r.tiendas)} sub={r.tiendasConError ? `${r.tiendasConError} con error` : 'conectadas'} icon={Link2} accent="indigo" />
            <KpiCard label="Pedidos pendientes" value={formatNumber(r.pedidosPendientes)} sub={`${formatNumber(r.sinPreparar)} sin preparar`} icon={Truck} accent="amber" />
            <KpiCard label="Beneficio acumulado" value={formatCurrency(r.beneficio)} sub={`${formatCurrency(r.ingresos)} vendidos`} icon={TrendingUp} accent="emerald" />
          </section>

          <section className="grid gap-3 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Primeros pasos</CardTitle>
                <CardDescription>
                  {completados === pasos.length ? 'Todo listo.' : `${completados} de ${pasos.length} completados · te llevará unos minutos`}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {pasos.map((p, i) => (
                  <Link
                    key={p.titulo}
                    href={p.href}
                    className={cn(
                      'flex items-center gap-3 rounded-lg border px-3 py-2.5 transition hover:bg-white/[0.04]',
                      p.hecho ? 'border-emerald-500/20 bg-emerald-500/[0.05]' : 'border-white/[0.07] bg-white/[0.02]',
                    )}
                  >
                    {p.hecho ? <CheckCircle2 className="size-5 shrink-0 text-emerald-400" /> : <Circle className="size-5 shrink-0 text-muted-foreground" />}
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-medium">
                        {i + 1}. {p.titulo}
                      </span>
                      <span className="block text-[11.5px] text-muted-foreground">{p.texto}</span>
                    </span>
                  </Link>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CreditCard className="size-4 text-indigo-300" />
                  Tu plan
                </CardTitle>
                <CardDescription>{suscripcion ? `Plan ${suscripcion.plan}` : 'Sin suscripción'}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-[12.5px]">
                {suscripcion ? (
                  <>
                    <div>
                      <div className="mb-1 flex justify-between text-muted-foreground">
                        <span>Créditos del mes</span>
                        <span className="tabular-nums">
                          {formatNumber(suscripcion.creditsUsed)} / {formatNumber(suscripcion.creditsLimit)}
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-sky-500"
                          style={{ width: `${Math.min(100, (suscripcion.creditsUsed / Math.max(1, suscripcion.creditsLimit)) * 100)}%` }}
                        />
                      </div>
                    </div>
                    <p className="text-muted-foreground">Estado: {suscripcion.status === 'TRIALING' ? 'periodo de prueba' : suscripcion.status.toLowerCase()}</p>
                  </>
                ) : (
                  <p className="text-muted-foreground">Todavía no se ha creado tu suscripción.</p>
                )}
                <Button asChild variant="outline" size="sm" className="w-full">
                  <Link href="/billing">Ver planes</Link>
                </Button>
              </CardContent>
            </Card>
          </section>
        </>
      )}
    </PantallaReal>
  );
}
