'use client';

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCurrency } from '@/lib/utils';

export function RevenueChart({ data, currency = 'EUR' }: { data: { date: string; revenue: number; profit: number; orders: number }[]; currency?: string }) {
  const total = data.reduce((a, d) => a + d.revenue, 0);
  const profit = data.reduce((a, d) => a + d.profit, 0);

  return (
    <Card className="col-span-2">
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle>Ventas y beneficio neto</CardTitle>
          <CardDescription>Últimos 7 días · coste de proveedor y comisiones ya descontados</CardDescription>
        </div>
        <div className="text-right">
          <p className="text-lg font-semibold tabular-nums">{formatCurrency(total, currency)}</p>
          <p className="text-xs text-emerald-400">+{formatCurrency(profit, currency)} beneficio</p>
        </div>
      </CardHeader>
      <CardContent className="h-[248px] pl-0">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 12, left: 8, bottom: 0 }}>
            <defs>
              <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#818cf8" stopOpacity={0.45} />
                <stop offset="100%" stopColor="#818cf8" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="profitGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#34d399" stopOpacity={0.4} />
                <stop offset="100%" stopColor="#34d399" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={(v: string) => new Date(v).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric' })}
              stroke="rgba(255,255,255,0.35)"
              fontSize={11}
              tickLine={false}
              axisLine={false}
            />
            <YAxis stroke="rgba(255,255,255,0.35)" fontSize={11} tickLine={false} axisLine={false} width={48} tickFormatter={(v: number) => `${v}€`} />
            <Tooltip
              contentStyle={{
                background: 'rgba(12,16,30,0.96)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 12,
                fontSize: 12,
                boxShadow: '0 20px 40px -20px rgba(0,0,0,0.9)',
              }}
              labelFormatter={(v: string) => new Date(v).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'short' })}
              formatter={(value: number, name: string) => [formatCurrency(value, currency), name === 'revenue' ? 'Ventas' : name === 'profit' ? 'Beneficio' : 'Pedidos']}
            />
            <Area type="monotone" dataKey="revenue" stroke="#818cf8" strokeWidth={2} fill="url(#revGrad)" />
            <Area type="monotone" dataKey="profit" stroke="#34d399" strokeWidth={2} fill="url(#profitGrad)" />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
