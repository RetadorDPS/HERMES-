import Link from 'next/link';
import {
  AlertTriangle,
  ArrowUpRight,
  BadgeEuro,
  Boxes,
  Compass,
  Download,
  PackageCheck,
  PackageX,
  RefreshCw,
  ShoppingCart,
  Star,
  Store,
  TrendingUp,
  Truck,
} from 'lucide-react';
import { Topbar } from '@/components/layout/topbar';
import { KpiCard } from '@/components/dashboard/kpi-card';
import { FirstStepsCard } from './first-steps-card';
import { checklistState } from '@/lib/onboarding';
import { RevenueChart } from '@/components/dashboard/revenue-chart';
import { QueueWidget } from '@/components/dashboard/queue-widget';
import { SyncLogList } from '@/components/dashboard/sync-log-list';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/alert';
import { getKpis, getSyncLogs, getStores, getProducts, getOrdersSummary, dataMode } from '@/lib/data';
import { formatCurrency, formatNumber, formatRelative, truncate } from '@/lib/utils';

import { withCurrentTenant } from '@/lib/tenant';
export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
    return withCurrentTenant(async (userId) => {
      const [kpis, logs, stores, topProducts, orders, firstSteps] = await Promise.all([
        getKpis(),
        getSyncLogs({ limit: 14 }),
        getStores(),
        getProducts({ sort: 'profit', limit: 5 }),
        getOrdersSummary(),
        checklistState(),
      ]);
      const mode = dataMode();

      const activeStore = stores.find((s) => s.status === 'CONNECTED');
      const storeErrors = stores.filter((s) => s.status === 'ERROR');
      const outOfStock = kpis.outOfStock;

      return (
        <>
          <Topbar
            title="Dashboard"
            subtitle={`${formatNumber(kpis.monitored)} productos monitorizados · ${formatNumber(orders.toFulfill)} pedidos pendientes de fulfillment`}
            mode={mode}
          />

          <div data-tour="screen:dashboard" className="space-y-5 py-3">
            {/* Primeros pasos: se marcan solos según lo que el cliente va haciendo */}
            <FirstStepsCard state={firstSteps} />

            {/* Alertas operativas */}
            {storeErrors.length > 0 && (
              <Alert variant="danger" title={`${storeErrors.length} tienda(s) con error de conexión`}>
                {storeErrors.map((s) => (
                  <p key={s.id}>
                    <strong>{s.name}</strong> ({s.domain}): {s.lastError}{' '}
                    <Link href="/stores" className="underline underline-offset-2">
                      Revisar credenciales
                    </Link>
                  </p>
                ))}
              </Alert>
            )}
            {outOfStock > 0 && (
              <Alert variant="warning" title={`${outOfStock} producto(s) agotados en el proveedor`}>
                El worker 24/7 los ha despublicado automáticamente en tu tienda para evitar ventas sin stock.{' '}
                <Link href="/products?status=OUT_OF_STOCK" className="underline underline-offset-2">
                  Ver productos agotados
                </Link>
              </Alert>
            )}

            {/* KPIs */}
            <section data-tour="dash:kpis" className="grid grid-cols-2 gap-2.5 sm:gap-3 xl:grid-cols-4">
              <KpiCard
                label="Ventas (7 días)"
                value={formatCurrency(kpis.revenue)}
                trend={kpis.revenueTrend}
                sub={`${formatNumber(kpis.orders)} pedidos`}
                icon={BadgeEuro}
                accent="indigo"
              />
              <KpiCard
                label="Beneficio neto"
                value={formatCurrency(kpis.profit)}
                trend={kpis.profitTrend}
                sub={`margen ${kpis.revenue > 0 ? ((kpis.profit / kpis.revenue) * 100).toFixed(1) : '0'}%`}
                icon={TrendingUp}
                accent="emerald"
              />
              <KpiCard
                label="Productos monitorizados"
                value={formatNumber(kpis.monitored)}
                sub={`${formatNumber(kpis.inStock)} con stock · ${formatNumber(kpis.outOfStock)} agotados`}
                icon={Boxes}
                accent="sky"
              />
              <KpiCard
                label="Sync últimas 24 h"
                value={formatNumber(kpis.syncedLast24h)}
                sub={`${formatNumber(kpis.failedLast24h)} fallos · ${kpis.avgSyncMs} ms de media`}
                icon={RefreshCw}
                accent={kpis.failedLast24h > 5 ? 'rose' : 'amber'}
              />
            </section>

            {/* Chart + cola */}
            <section className="grid gap-3 lg:grid-cols-3">
              <RevenueChart data={kpis.revenueSeries} />
              <div className="space-y-4">
                <QueueWidget />
              </div>
            </section>

            {/* Tiendas + pedidos + top productos */}
            <section className="grid gap-3 lg:grid-cols-3">
              <Card>
                <CardHeader className="flex-row items-center justify-between space-y-0">
                  <div>
                    <CardTitle>Tiendas conectadas</CardTitle>
                    <CardDescription>{stores.length} integraciones</CardDescription>
                  </div>
                  <Button asChild variant="outline" size="sm">
                    <Link href="/stores">
                      <Store className="size-3.5" />
                      Gestionar
                    </Link>
                  </Button>
                </CardHeader>
                <CardContent className="space-y-2">
                  {stores.map((store) => (
                    <div key={store.id} className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{store.name}</p>
                        <p className="truncate text-[11px] text-muted-foreground">
                          {store.platform === 'SHOPIFY' ? '🛍 Shopify' : '🛒 WooCommerce'} · {store.domain}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="text-[11px] text-muted-foreground">{store.productsCount} prod.</span>
                        <StatusBadge status={store.status} />
                      </div>
                    </div>
                  ))}
                  {activeStore && (
                    <p className="pt-1 text-[11px] text-muted-foreground">
                      Última comprobación de {activeStore.name}: {formatRelative(activeStore.lastPingAt)}
                    </p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex-row items-center justify-between space-y-0">
                  <div>
                    <CardTitle>Monitor de envíos</CardTitle>
                    <CardDescription>Pedidos y fulfillment automático</CardDescription>
                  </div>
                  <Button asChild variant="outline" size="sm">
                    <Link href="/orders">
                      <Truck className="size-3.5" />
                      Ver pedidos
                    </Link>
                  </Button>
                </CardHeader>
                <CardContent className="space-y-2">
                  {[
                    { label: 'Pendientes de enviar al proveedor', value: orders.pending, icon: ShoppingCart, tone: 'text-amber-400' },
                    { label: 'Sin preparar (unfulfilled)', value: orders.toFulfill, icon: PackageX, tone: 'text-rose-400' },
                    { label: 'Enviados con tracking', value: orders.shipped, icon: PackageCheck, tone: 'text-emerald-400' },
                    { label: 'Errores de proveedor', value: orders.errors, icon: AlertTriangle, tone: 'text-rose-400' },
                  ].map(({ label, value, icon: Icon, tone }) => (
                    <div key={label} className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
                      <span className="flex items-center gap-2 text-[13px] text-muted-foreground">
                        <Icon className={`size-3.5 ${tone}`} />
                        {label}
                      </span>
                      <span className="text-sm font-semibold tabular-nums">{formatNumber(value)}</span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between rounded-lg border border-emerald-500/20 bg-emerald-500/[0.06] px-3 py-2.5">
                    <span className="text-[13px] text-emerald-200">Beneficio acumulado</span>
                    <span className="text-sm font-semibold tabular-nums text-emerald-300">{formatCurrency(orders.profit)}</span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex-row items-center justify-between space-y-0">
                  <div>
                    <CardTitle>Top productos por beneficio</CardTitle>
                    <CardDescription>Margen después de coste y envío</CardDescription>
                  </div>
                  <Button asChild variant="outline" size="sm">
                    <Link href="/products">
                      <Boxes className="size-3.5" />
                      Todos
                    </Link>
                  </Button>
                </CardHeader>
                <CardContent className="space-y-2">
                  {topProducts.items.map((p) => (
                    <Link key={p.id} href={`/products/${p.id}`} className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 transition hover:bg-white/[0.05]">
                      {p.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.image} alt="" className="size-9 rounded-md object-cover" loading="lazy" />
                      ) : (
                        <span className="grid size-9 place-items-center rounded-md bg-white/[0.06]">
                          <Boxes className="size-4 text-muted-foreground" />
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium">{truncate(p.title, 42)}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {p.supplierName} · coste {formatCurrency(p.costPrice, 'USD')} → venta {formatCurrency(p.sellingPrice)}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-semibold text-emerald-400">+{formatCurrency(p.profitAmount)}</p>
                        <p className="text-[11px] text-muted-foreground">{p.marginPct.toFixed(0)}% margen</p>
                      </div>
                    </Link>
                  ))}
                </CardContent>
              </Card>
            </section>

            {/* Actividad + acciones rápidas */}
            <section className="grid gap-3 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <SyncLogList logs={logs} />
              </div>
              <Card>
                <CardHeader>
                  <CardTitle>Acciones rápidas</CardTitle>
                  <CardDescription>Flujos más usados del panel</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  <Button asChild variant="gradient" className="w-full justify-start">
                    <Link href="/catalog">
                      <Compass className="size-4" />
                      Explorar el catálogo (listo para importar)
                    </Link>
                  </Button>
                  <Button asChild variant="outline" className="w-full justify-start">
                    <Link href="/import">
                      <Download className="size-4" />
                      Importar producto por URL
                    </Link>
                  </Button>
                  <Button asChild variant="outline" className="w-full justify-start">
                    <Link href="/products?problems=1">
                      <AlertTriangle className="size-4" />
                      Revisar productos con problemas
                    </Link>
                  </Button>
                  <Button asChild variant="outline" className="w-full justify-start">
                    <Link href="/monitor">
                      <RefreshCw className="size-4" />
                      Monitorizar la cola de sync
                    </Link>
                  </Button>
                  <Button asChild variant="outline" className="w-full justify-start">
                    <Link href="/stores">
                      <Store className="size-4" />
                      Conectar Shopify / WooCommerce
                    </Link>
                  </Button>

                  <div className="mt-3 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
                    <p className="flex items-center gap-1.5 text-[12px] font-medium">
                      <Star className="size-3.5 text-amber-400" />
                      Proveedores activos
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Badge variant="outline">AliExpress</Badge>
                      <Badge variant="outline">CJ Dropshipping</Badge>
                      <Badge variant="outline">Amazon</Badge>
                      <Badge variant="outline">Alibaba</Badge>
                      <Badge variant="outline">Temu</Badge>
                    </div>
                    <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                      El motor de scraping soporta rotación de proxies y fallback automático a extracción local.
                    </p>
                  </div>

                  <div className="rounded-lg border border-indigo-500/20 bg-indigo-500/[0.06] p-3">
                    <p className="text-[12px] font-medium text-indigo-200">¿Listo para producción?</p>
                    <p className="mt-1 text-[11px] leading-relaxed text-indigo-100/80">
                      Levanta PostgreSQL + Redis (<code className="rounded bg-black/30 px-1">docker compose up -d</code>), ejecuta{' '}
                      <code className="rounded bg-black/30 px-1">npm run prisma:push &amp;&amp; npm run prisma:seed</code> y arranca los workers con{' '}
                      <code className="rounded bg-black/30 px-1">npm run worker</code>.
                    </p>
                    <Link href="/settings" className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-indigo-300 hover:underline">
                      Ver guía completa <ArrowUpRight className="size-3" />
                    </Link>
                  </div>
                </CardContent>
              </Card>
            </section>
          </div>
        </>
      );

    });
  }
