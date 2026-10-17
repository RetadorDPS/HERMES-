import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Boxes, ExternalLink, Image as ImageIcon, Package, RefreshCw, Ship, Star } from 'lucide-react';
import { Topbar } from '@/components/layout/topbar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { SyncLogList } from '@/components/dashboard/sync-log-list';
import { getProduct, getSyncLogs, dataMode } from '@/lib/data';
import { cn, formatCurrency, formatNumber, formatRelative } from '@/lib/utils';
import { ProductEditor } from './product-editor';
import { demoProducts } from '@/lib/demo-data';

import { withCurrentTenant } from '@/lib/tenant';
export const dynamic = 'force-dynamic';

/**
 * Solo la versión estática (GitHub Pages) genera una página por cada producto de
 * demostración. En el servidor normal esta lista va vacía y no cambia nada.
 */
export function generateStaticParams() {
  if (process.env.ESTATICO !== '1') return [];
  return demoProducts.map((p) => ({ id: p.id }));
}

export default async function ProductDetailPage({ params }: { params: { id: string } }) {
    return withCurrentTenant(async (userId) => {
      const product = await getProduct(params.id);
      if (!product) notFound();

      const logs = await getSyncLogs({ productId: params.id, limit: 20 });

      return (
        <>
          <Topbar title={product.title} subtitle={`${product.supplierName} → ${product.storeName} · ${product.variants.length} variantes`} mode={dataMode()} />

          <div className="space-y-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button asChild variant="outline" size="sm">
                <Link href="/products">
                  <ArrowLeft className="size-3.5" />
                  Volver a productos
                </Link>
              </Button>
              <StatusBadge status={product.status} />
              {product.lastSyncStatus && <StatusBadge status={product.lastSyncStatus} />}
              {product.isMonitored && <Badge variant="success">Monitorizado 24/7</Badge>}
              <a href={product.sourceUrl} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-[12px] text-indigo-300 hover:underline">
                Ver en {product.supplierName}
                <ExternalLink className="size-3" />
              </a>
            </div>

            {/* Barra de métricas */}
            <div className="grid grid-cols-2 gap-2.5 sm:gap-3 xl:grid-cols-5 [&>*:last-child:nth-child(odd)]:col-span-2 xl:[&>*:last-child:nth-child(odd)]:col-span-1">
              {[
                { label: 'Coste proveedor', value: formatCurrency(product.costPrice, product.currency), sub: `+ ${formatCurrency(product.shippingCost, product.currency)} envío` },
                { label: 'Precio de venta', value: formatCurrency(product.sellingPrice), sub: product.compareAtPrice > 0 ? `tachado ${formatCurrency(product.compareAtPrice)}` : 'sin precio tachado' },
                { label: 'Beneficio / unidad', value: formatCurrency(product.profitAmount), sub: `${product.marginPct.toFixed(0)}% de margen`, accent: 'text-emerald-400' },
                { label: 'Stock total', value: formatNumber(product.stockTotal), sub: `${product.variants.filter((v) => v.stock === 0).length} variantes agotadas` },
                { label: 'Última sincronización', value: formatRelative(product.lastSyncedAt), sub: `próxima ${formatRelative(product.nextSyncAt)}` },
              ].map((m) => (
                <Card key={m.label} className="p-3 sm:p-4">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{m.label}</p>
                  <p className={cn('mt-1 text-lg font-semibold tabular-nums sm:text-xl', m.accent)}>{m.value}</p>
                  <p className="text-[11px] text-muted-foreground">{m.sub}</p>
                </Card>
              ))}
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
              {/* Columna principal */}
              <div className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <ImageIcon className="size-4 text-indigo-300" />
                      Imágenes ({product.images.length})
                    </CardTitle>
                    <CardDescription>Versiones HD optimizadas para la tienda</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                      {product.images.map((img, i) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          key={i}
                          src={img.hdUrl || img.url}
                          alt=""
                          className="aspect-square rounded-lg border border-white/[0.07] object-cover"
                          loading="lazy"
                        />
                      ))}
                      {product.images.length === 0 && <p className="text-sm text-muted-foreground">Sin imágenes.</p>}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Package className="size-4 text-indigo-300" />
                      Variantes ({product.variants.length})
                    </CardTitle>
                    <CardDescription>SKU, opciones, precio y stock por variante sincronizados con el proveedor</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>SKU</TableHead>
                          <TableHead>Variante</TableHead>
                          <TableHead className="text-right">Coste</TableHead>
                          <TableHead className="text-right">Venta</TableHead>
                          <TableHead className="text-right">Stock</TableHead>
                          <TableHead>ID en tienda</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {product.variants.map((v) => (
                          <TableRow key={v.id}>
                            <TableCell className="font-mono text-[11px] text-muted-foreground">{v.sku}</TableCell>
                            <TableCell className="text-[13px]">{v.title}</TableCell>
                            <TableCell className="text-right text-[12px] tabular-nums">{formatCurrency(v.costPrice, product.currency)}</TableCell>
                            <TableCell className="text-right text-[13px] tabular-nums">{formatCurrency(v.sellingPrice)}</TableCell>
                            <TableCell className="text-right">
                              <span className={cn('text-[13px] tabular-nums', v.stock === 0 ? 'text-rose-400' : v.stock < 20 ? 'text-amber-400' : 'text-emerald-400')}>
                                {v.stock}
                              </span>
                            </TableCell>
                            <TableCell className="truncate font-mono text-[10px] text-muted-foreground">{v.storeVariantId ?? '—'}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>

                <div className="grid gap-4 md:grid-cols-2">
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Ship className="size-4 text-sky-300" />
                        Opciones de envío
                      </CardTitle>
                      <CardDescription>Cotizaciones cacheadas por destino</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {product.shippingOptions.map((o, i) => (
                        <div key={i} className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
                          <div className="min-w-0">
                            <p className="truncate text-[12px] font-medium">{o.method}</p>
                            <p className="text-[11px] text-muted-foreground">
                              {o.carrier} · {o.minDays}-{o.maxDays} días {o.isTracked ? '· tracking' : ''}
                            </p>
                          </div>
                          <span className="text-[12px] font-semibold tabular-nums">{o.cost === 0 ? 'Gratis' : formatCurrency(o.cost, product.currency)}</span>
                        </div>
                      ))}
                      {product.shippingOptions.length === 0 && <p className="text-sm text-muted-foreground">Sin cotizaciones registradas.</p>}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Star className="size-4 text-amber-300" />
                        Reseñas ({product.reviews.length})
                      </CardTitle>
                      <CardDescription>
                        Media {product.ratingAvg.toFixed(1)} ★ sobre {formatNumber(product.ratingCount)} valoraciones
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="max-h-[300px] space-y-2 overflow-y-auto pr-1 scroll-shadow">
                      {product.reviews.map((r) => (
                        <div key={r.id} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5">
                          <div className="flex items-center justify-between">
                            <span className="text-[12px]">
                              {'★'.repeat(Math.max(1, Math.min(5, r.rating)))}
                              <span className="text-muted-foreground">{'★'.repeat(5 - Math.max(1, Math.min(5, r.rating)))}</span>
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                              {r.author} · {r.country} · {formatRelative(r.date)}
                            </span>
                          </div>
                          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{r.text}</p>
                        </div>
                      ))}
                      {product.reviews.length === 0 && <p className="text-sm text-muted-foreground">Sin reseñas importadas.</p>}
                    </CardContent>
                  </Card>
                </div>

                <SyncLogList logs={logs} title={`Historial de sincronización · ${product.title.slice(0, 40)}`} description="Cada cambio de precio/stock aplicado a la tienda queda registrado aquí" />
              </div>

              {/* Columna lateral */}
              <div className="space-y-4 lg:sticky lg:top-[92px] lg:self-start">
                <ProductEditor
                  product={{
                    id: product.id,
                    title: product.title,
                    description: product.description,
                    sellingPrice: product.sellingPrice,
                    compareAtPrice: product.compareAtPrice,
                    marginPct: product.marginPct,
                    costPrice: product.costPrice,
                    shippingCost: product.shippingCost,
                    status: product.status,
                    isMonitored: product.isMonitored,
                    category: product.category,
                    currency: product.currency,
                  }}
                />

                <Card>
                  <CardHeader>
                    <CardTitle className="text-[13px] flex items-center gap-2">
                      <Boxes className="size-4 text-indigo-300" />
                      Ficha técnica
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-1.5 text-[12px]">
                    {[
                      ['ID proveedor', product.supplierProductId],
                      ['Categoría', product.category],
                      ['Marca', product.supplierName],
                      ['Moneda proveedor', product.currency],
                      ['Pedidos históricos', formatNumber(product.ordersCount)],
                      ['ID en tienda', product.storeProductId ?? '—'],
                      ['Etiquetas', product.tags.join(', ') || '—'],
                      ['Creado', formatRelative(product.createdAt)],
                    ].map(([k, v]) => (
                      <div key={k as string} className="flex items-start justify-between gap-3">
                        <span className="text-muted-foreground">{k}</span>
                        <span className="truncate text-right font-mono text-[11px]">{String(v)}</span>
                      </div>
                    ))}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-[13px] flex items-center gap-2">
                      <RefreshCw className="size-4 text-indigo-300" />
                      Automatizaciones activas
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-1.5 text-[12px] text-muted-foreground">
                    <p>✓ Re-check de precio y stock cada hora</p>
                    <p>✓ Recálculo de precio con tu regla de margen cuando cambia el coste</p>
                    <p>✓ Despublicado automático al agotarse (y reactivación al volver stock)</p>
                    <p>✓ Registro de cada cambio en SyncLog con el diff before/after</p>
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        </>
      );

    });
  }
