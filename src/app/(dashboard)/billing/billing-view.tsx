'use client';

import { useState } from 'react';
import { BadgeEuro, CheckCircle2, CreditCard, ExternalLink, Gauge, Loader2, Sparkles } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export interface PlanView {
  tier: string;
  name: string;
  priceMonthly: number;
  priceYearly: number;
  maxProducts: number;
  maxStores: number;
  maxSupplierAccounts: number;
  creditsPerMonth: number;
  syncIntervalMinutes: number;
  proxiesIncluded: boolean;
  support: string;
  highlights: string[];
}

interface Props {
  plans: PlanView[];
  current: {
    tier: string;
    name: string;
    priceMonthly: number;
    status: string;
    renewsAt: string | null;
    cancelAtPeriodEnd: boolean;
  };
  usage: { products: number; stores: number; supplierAccounts: number; creditsUsed: number; creditsLimit: number };
  stripeConfigured: boolean;
  /** Lemon Squeezy listo para cobrar (API key + tienda + variantes) */
  lemonReady: boolean;
  /** Proveedor con el que ya está pagando este cliente, si se sabe */
  currentProvider?: 'stripe' | 'lemon' | null;
}

export function BillingView({ plans, current, usage, stripeConfigured, lemonReady, currentProvider = null }: Props) {
  const [interval, setInterval] = useState<'monthly' | 'yearly'>('monthly');
  const [provider, setProvider] = useState<'stripe' | 'lemon'>(currentProvider ?? (lemonReady && !stripeConfigured ? 'lemon' : 'stripe'));
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const checkout = async (plan: string) => {
    setBusy(plan);
    setMessage(null);
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan, interval, provider }),
      });
      const json = await res.json();
      if (json.url) {
        window.location.href = json.url;
        return;
      }
      setMessage({ ok: false, text: json.error ?? 'No se pudo iniciar el pago' });
    } finally {
      setBusy(null);
    }
  };

  const portal = async () => {
    setBusy('portal');
    setMessage(null);
    try {
      const res = await fetch('/api/billing/portal', { method: 'POST' });
      const json = await res.json();
      if (json.url) {
        window.location.href = json.url;
        return;
      }
      setMessage({ ok: false, text: json.error ?? 'No se pudo abrir el portal de facturación' });
    } finally {
      setBusy(null);
    }
  };

  const creditPct = Math.min(100, Math.round((usage.creditsUsed / Math.max(usage.creditsLimit, 1)) * 100));
  const currentPlan = plans.find((p) => p.tier === current.tier);

  return (
    <div className="space-y-4">
      {message && (
        <Alert variant={message.ok ? 'success' : 'warning'} title={message.ok ? 'Listo' : 'Atención'} onDismiss={() => setMessage(null)}>
          {message.text}
        </Alert>
      )}

      {!stripeConfigured && (
        <Alert variant="warning" title="Stripe no está configurado en esta instalación">
          Los planes se muestran como referencia. Para cobrar de verdad, añade <code>STRIPE_SECRET_KEY</code>, <code>STRIPE_WEBHOOK_SECRET</code> y los
          precios <code>STRIPE_PRICE_*</code> al entorno, y configura el webhook apuntando a <code>/api/webhooks/stripe</code>.
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* Plan actual + consumo */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="size-4 text-indigo-300" />
              Tu plan actual
              <Badge variant={current.tier === 'TRIAL' ? 'warning' : 'success'}>{current.tier}</Badge>
            </CardTitle>
            <CardDescription>
              {currentPlan?.priceMonthly ? `${currentPlan.priceMonthly} €/mes · ` : 'Gratis · '}
              {current.status === 'ACTIVE' ? 'activo' : current.status === 'PAST_DUE' ? 'pago pendiente' : current.status.toLowerCase()}
              {current.renewsAt ? ` · renueva el ${new Date(current.renewsAt).toLocaleDateString('es-ES')}` : ''}
              {current.cancelAtPeriodEnd ? ' · se cancelará al final del periodo' : ''}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="flex items-center justify-between text-[12px]">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Gauge className="size-3.5" /> Créditos del mes
                </span>
                <span className="tabular-nums">
                  {usage.creditsUsed.toLocaleString('es-ES')} / {usage.creditsLimit.toLocaleString('es-ES')}
                </span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/[0.06]">
                <div
                  className={cn('h-full rounded-full transition-all', creditPct > 90 ? 'bg-rose-500' : creditPct > 70 ? 'bg-amber-400' : 'bg-gradient-to-r from-indigo-500 to-cyan-400')}
                  style={{ width: `${creditPct}%` }}
                />
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Cada extracción cuesta 1 crédito, cada importación 2, cada sincronización 1 y cada compra al proveedor 3.
              </p>
            </div>

            <div className="grid gap-2 sm:grid-cols-3">
              {[
                { label: 'Productos', value: usage.products, max: currentPlan?.maxProducts },
                { label: 'Tiendas', value: usage.stores, max: currentPlan?.maxStores },
                { label: 'Proveedores', value: usage.supplierAccounts, max: currentPlan?.maxSupplierAccounts },
              ].map((item) => (
                <div key={item.label} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
                  <p className="text-[11px] text-muted-foreground">{item.label}</p>
                  <p className="mt-0.5 text-[15px] font-semibold tabular-nums">
                    {item.value}
                    {item.max ? <span className="text-[11px] font-normal text-muted-foreground"> / {item.max >= 100000 ? '∞' : item.max}</span> : null}
                  </p>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={portal} disabled={busy === 'portal' || !stripeConfigured || provider === 'lemon'}>
                {busy === 'portal' ? <Loader2 className="size-3.5 animate-spin" /> : <CreditCard className="size-3.5" />}
                Gestionar pago y facturas
              </Button>
              <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <ExternalLink className="size-3" />
                {provider === 'lemon'
                  ? 'Con Lemon Squeezy, el recibo y el portal de pago llegan por correo desde ellos.'
                  : 'El pago y los datos de tarjeta los gestiona Stripe: aquí nunca se guardan.'}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Ciclo de facturación */}
        <Card>
          <CardHeader>
            <CardTitle className="text-[14px]">Ciclo de facturación</CardTitle>
            <CardDescription>El plan anual incluye dos meses gratis</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              {(['monthly', 'yearly'] as const).map((i) => (
                <Button key={i} variant={interval === i ? 'gradient' : 'outline'} size="sm" className="flex-1" onClick={() => setInterval(i)}>
                  {i === 'monthly' ? 'Mensual' : 'Anual (-17%)'}
                </Button>
              ))}
            </div>
            <div className="space-y-2 text-[12px] text-muted-foreground">
              <p className="flex items-start gap-2">
                <BadgeEuro className="mt-0.5 size-3.5 shrink-0 text-emerald-400" />
                Los precios no incluyen IVA; se aplica en el pago según tu país.
              </p>
              <p className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-400" />
                Puedes cancelar en cualquier momento desde el portal: mantienes el servicio hasta el final del periodo pagado.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ¿Quién cobra? */}
      <Card>
        <CardHeader>
          <CardTitle className="text-[14px]">¿Quién cobra el pago?</CardTitle>
          <CardDescription>
            Dos formas legales de cobrar; puedes cambiar cuando quieras.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 md:grid-cols-2">
          <button
            type="button"
            onClick={() => setProvider('stripe')}
            className={cn(
              'rounded-lg border p-3 text-left transition-colors',
              provider === 'stripe' ? 'border-indigo-500/50 bg-indigo-500/10' : 'border-white/[0.08] bg-white/[0.02] hover:border-white/20',
              !stripeConfigured && 'opacity-60',
            )}
          >
            <span className="flex items-center gap-2 text-[13px] font-medium">
              <CreditCard className="size-4 text-indigo-300" /> Stripe (tu pasarela)
              {provider === 'stripe' && <Badge variant="info">elegido</Badge>}
              {!stripeConfigured && <Badge variant="warning">sin configurar</Badge>}
            </span>
            <span className="mt-1 block text-[12px] text-muted-foreground">
              Comisión ≈1,5-3 %. Necesita alta censal (036) y tú gestionas el IVA. Es la opción más barata a partir de cierto volumen.
            </span>
          </button>
          <button
            type="button"
            onClick={() => setProvider('lemon')}
            className={cn(
              'rounded-lg border p-3 text-left transition-colors',
              provider === 'lemon' ? 'border-indigo-500/50 bg-indigo-500/10' : 'border-white/[0.08] bg-white/[0.02] hover:border-white/20',
              !lemonReady && 'opacity-60',
            )}
          >
            <span className="flex items-center gap-2 text-[13px] font-medium">
              <BadgeEuro className="size-4 text-emerald-300" /> Lemon Squeezy (vendedor legal)
              {provider === 'lemon' && <Badge variant="info">elegido</Badge>}
              {!lemonReady && <Badge variant="warning">sin configurar</Badge>}
            </span>
            <span className="mt-1 block text-[12px] text-muted-foreground">
              Comisión 5 % + 0,50 $. Ellos emiten la factura y liquidan el IVA de cada país; bueno para empezar sin papeleo. Ver <code>PAGOS.md</code>.
            </span>
          </button>
        </CardContent>
      </Card>

      {/* Planes */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {plans.map((p) => {
          const isCurrent = p.tier === current.tier;
          const price = interval === 'monthly' ? p.priceMonthly : p.priceYearly;
          return (
            <Card key={p.tier} className={cn(isCurrent && 'border-indigo-500/40 ring-1 ring-indigo-500/20')}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between text-[14px]">
                  {p.name}
                  {isCurrent && <Badge variant="info">actual</Badge>}
                </CardTitle>
                <CardDescription>{p.support}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-2xl font-semibold tracking-tight">
                  {price === 0 ? 'Gratis' : `${price} €`}
                  {price > 0 && <span className="text-[12px] font-normal text-muted-foreground">{interval === 'monthly' ? '/mes' : '/año'}</span>}
                </p>
                <ul className="space-y-1.5 text-[12px] text-muted-foreground">
                  {p.highlights.map((h) => (
                    <li key={h} className="flex items-start gap-2">
                      <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-400" />
                      {h}
                    </li>
                  ))}
                </ul>
                {isCurrent ? (
                  <Button variant="outline" className="w-full" disabled>
                    Tu plan actual
                  </Button>
                ) : (
                  <Button
                    variant={p.tier === 'PRO' ? 'gradient' : 'outline'}
                    className="w-full"
                    onClick={() => checkout(p.tier)}
                    disabled={busy === p.tier || (provider === 'stripe' ? !stripeConfigured : !lemonReady)}
                  >
                    {busy === p.tier ? <Loader2 className="size-4 animate-spin" /> : <CreditCard className="size-4" />}
                    {p.tier === 'TRIAL' ? 'Bajar a prueba' : 'Cambiar de plan'}
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
