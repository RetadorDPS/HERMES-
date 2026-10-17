import { Calculator, Percent, PiggyBank, Scale } from 'lucide-react';
import { Topbar } from '@/components/layout/topbar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { getPricingRules, dataMode } from '@/lib/data';
import { computeSellingPrice } from '@/lib/pricing';
import { formatCurrency } from '@/lib/utils';

import { withCurrentTenant } from '@/lib/tenant';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Precios y márgenes' };

/** Ejemplos de costo para la previsualización del simulador */
const SAMPLE_COSTS = [3, 8, 15, 35, 60, 120];

export default async function PricingPage() {
    return withCurrentTenant(async (userId) => {
      const rules = await getPricingRules();

      return (
        <>
          <Topbar
            title="Precios y márgenes"
            subtitle="Reglas que el worker aplica automáticamente cuando cambia el coste del proveedor"
            mode={dataMode()}
          />

          <div data-tour="screen:pricing" className="space-y-4 py-3">
            <Alert variant="info" title="Cómo se calcula el precio de venta">
              <p>
                <code className="rounded bg-black/30 px-1">precio = costo × (1 + markup%) + fee fijo (+ envío)</code>, con suelo de beneficio mínimo, límites
                min/max y redondeo psicológico a <code className="rounded bg-black/30 px-1">x,99</code>. Si el proveedor sube el coste, el worker recalcula y
                actualiza la tienda en la siguiente pasada (umbral anti-flapping del 1,5%).
              </p>
            </Alert>

            <div className="grid gap-4 lg:grid-cols-3">
              {rules.map((r) => (
                <Card key={r.id} className={r.isDefault ? 'border-indigo-500/25' : ''}>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      {r.name}
                      {r.isDefault && <Badge variant="default">Predeterminada</Badge>}
                      {!r.isActive && <Badge variant="outline">Inactiva</Badge>}
                    </CardTitle>
                    <CardDescription>{r.applyToCategory ? `Se aplica a la categoría “${r.applyToCategory}”` : 'Se aplica a todos los productos'}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2 text-[12px]">
                    {[
                      { icon: Percent, label: 'Markup', value: `+${Number(r.markupPct).toFixed(0)}%` },
                      { icon: Calculator, label: 'Fee fijo', value: formatCurrency(Number(r.fixedFee ?? 0)) },
                      { icon: PiggyBank, label: 'Beneficio mínimo', value: formatCurrency(Number(r.minProfit ?? 0)) },
                      { icon: Scale, label: 'Límites', value: `${r.minPrice ? formatCurrency(Number(r.minPrice)) : '—'} / ${r.maxPrice ? formatCurrency(Number(r.maxPrice)) : 'sin tope'}` },
                    ].map(({ icon: Icon, label, value }) => (
                      <div key={label} className="flex items-center justify-between">
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                          <Icon className="size-3.5" />
                          {label}
                        </span>
                        <span className="font-medium tabular-nums">{value}</span>
                      </div>
                    ))}
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Redondeo</span>
                      <span className="font-medium tabular-nums">x,{String(Number(r.roundTo ?? 0.99).toFixed(2)).split('.')[1]}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Incluye envío en el cálculo</span>
                      <span className="font-medium">{r.includeShipping ? 'Sí' : 'No'}</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Simulador por coste del proveedor</CardTitle>
                <CardDescription>
                  Compara cómo cada regla convierte un coste en precio de venta y beneficio (suponiendo 2,00 € de envío)
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Coste proveedor</TableHead>
                      {rules.map((r) => (
                        <TableHead key={r.id} className="text-right">
                          {r.name}
                          <span className="block text-[10px] font-normal normal-case text-muted-foreground">precio · beneficio</span>
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {SAMPLE_COSTS.map((cost) => (
                      <TableRow key={cost}>
                        <TableCell className="font-medium tabular-nums">{formatCurrency(cost, 'USD')}</TableCell>
                        {rules.map((r) => {
                          const b = computeSellingPrice(cost, 2, r, r.name);
                          return (
                            <TableCell key={r.id} className="text-right tabular-nums">
                              <span className="font-medium">{formatCurrency(b.sellingPrice)}</span>
                              <span className="block text-[11px] text-emerald-400">+{formatCurrency(b.profit)}</span>
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-[13px]">Editor de reglas</CardTitle>
                <CardDescription>
                  La gestión completa (crear, editar y asignar reglas por producto o categoría) vive en{' '}
                  <code className="rounded bg-black/30 px-1">/api/pricing</code> y en el panel de administración de Prisma Studio.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-[12px] text-muted-foreground">
                <p>
                  Las reglas se guardan en la tabla <code className="rounded bg-black/30 px-1">PricingRule</code> por usuario, y cada producto puede tener su
                  propia regla (<code className="rounded bg-black/30 px-1">Product.pricingRuleId</code>). Resolución de prioridad:
                </p>
                <ol className="list-decimal space-y-1 pl-5">
                  <li>Regla asignada explícitamente al producto</li>
                  <li>Regla de la categoría del producto</li>
                  <li>Regla marcada como predeterminada del usuario</li>
                </ol>
                <p>
                  Puedes editar márgenes masivamente desde la ficha de cada producto (panel de edición rápida) o aplicando una acción masiva desde el listado de
                  productos.
                </p>
              </CardContent>
            </Card>
          </div>
        </>
      );

    });
  }
