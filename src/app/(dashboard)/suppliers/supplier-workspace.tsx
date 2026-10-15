'use client';

import { useState } from 'react';
import {
  AlertTriangle,
  BadgeCheck,
  BookOpen,
  CheckCircle2,
  ExternalLink,
  KeyRound,
  Loader2,
  Plug,
  ShoppingCart,
  Star,
  Trash2,
  Zap,
} from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface ProviderView {
  provider: string;
  name: string;
  tagline: string;
  canPlaceOrders: boolean;
  docsUrl: string;
  signupUrl: string;
  notes: string;
  available: boolean;
}

export interface AccountView {
  id: string;
  provider: string;
  label: string;
  status: 'PENDING' | 'CONNECTED' | 'ERROR' | 'DISABLED';
  isDefault: boolean;
  lastTestAt: string | null;
  lastError: string | null;
  createdAt: string;
}

interface Props {
  providers: ProviderView[];
  accounts: AccountView[];
  plan: { tier: string; name: string; max: number; used: number };
}

/** Campos que espera cada proveedor (deben coincidir con supplier-apis/*.ts) */
const FIELDS: Record<string, { key: string; label: string; hint?: string; secret?: boolean }[]> = {
  ALIEXPRESS: [
    { key: 'appKey', label: 'App Key', hint: 'Consola de desarrollador de AliExpress' },
    { key: 'appSecret', label: 'App Secret', secret: true },
    { key: 'accessToken', label: 'Access Token (OAuth)', hint: 'Necesario para precios reales y crear pedidos', secret: true },
    { key: 'apiRegion', label: 'Región del gateway', hint: 'sg (por defecto) o eu' },
  ],
  CJ_DROPSHIPPING: [
    { key: 'email', label: 'Email de tu cuenta CJ' },
    { key: 'apiKey', label: 'API Key', hint: 'CJ → Autorización → API Key', secret: true },
  ],
  AMAZON: [
    { key: 'accessKey', label: 'Access Key', hint: 'Amazon Associates → PA-API' },
    { key: 'secretKey', label: 'Secret Key', secret: true },
    { key: 'partnerTag', label: 'Partner Tag', hint: 'Tu ID de afiliado, ej. mitienda-21' },
    { key: 'marketplace', label: 'Marketplace', hint: 'es | de | fr | it | uk | us' },
  ],
};

const STATUS: Record<AccountView['status'], { label: string; variant: 'success' | 'warning' | 'danger' | 'info' | 'outline' }> = {
  CONNECTED: { label: 'conectada', variant: 'success' },
  PENDING: { label: 'pendiente', variant: 'warning' },
  ERROR: { label: 'con error', variant: 'danger' },
  DISABLED: { label: 'desactivada', variant: 'outline' },
};

export function SupplierWorkspace({ providers, accounts, plan }: Props) {
  const [list, setList] = useState(accounts);
  const [openProvider, setOpenProvider] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; title: string; detail?: string } | null>(null);

  const refresh = async () => {
    const res = await fetch('/api/supplier-accounts', { cache: 'no-store' });
    const json = await res.json();
    if (json.ok) setList(json.accounts);
  };

  const connect = async (provider: string) => {
    setBusy(provider);
    setResult(null);
    try {
      const res = await fetch('/api/supplier-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          label: label.trim() || providers.find((p) => p.provider === provider)?.name || provider,
          credentials: form,
        }),
      });
      const json = await res.json();
      if (!json.ok) {
        setResult({ ok: false, title: 'No se pudo guardar', detail: json.error });
        return;
      }
      setResult({
        ok: Boolean(json.test?.ok),
        title: json.test?.ok ? '¡Conexión validada!' : 'Guardada, pero con avisos',
        detail: json.test?.message,
      });
      setOpenProvider(null);
      setForm({});
      setLabel('');
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  const test = async (id: string) => {
    setBusy(id);
    setResult(null);
    try {
      const res = await fetch(`/api/supplier-accounts/${id}/test?action=test`, { method: 'POST' });
      const json = await res.json();
      setResult({
        ok: Boolean(json.test?.ok),
        title: json.test?.ok ? 'Credenciales correctas' : 'La verificación ha fallado',
        detail: json.test?.message,
      });
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: string) => {
    if (!confirm('¿Eliminar esta conexión? Las credenciales cifradas se borrarán.')) return;
    setBusy(id);
    await fetch(`/api/supplier-accounts/${id}`, { method: 'DELETE' });
    await refresh();
    setBusy(null);
  };

  const makeDefault = async (id: string) => {
    setBusy(id);
    await fetch(`/api/supplier-accounts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isDefault: true }),
    });
    await refresh();
    setBusy(null);
  };

  const accountsFor = (provider: string) => list.filter((a) => a.provider === provider);

  return (
    <div className="space-y-4">
      {/* Cómo funciona */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="size-4 text-indigo-300" />
            API oficial primero, scraping como respaldo
            <Badge variant="info">
              {plan.used}/{plan.max} conexiones · plan {plan.name}
            </Badge>
          </CardTitle>
          <CardDescription>
            Cuando conectas la API de un proveedor, las importaciones se hacen con datos estructurados (sin captchas, sin proxies y con
            envíos y stock exactos) y los pedidos se pueden <strong>comprar automáticamente</strong> al proveedor. Si no hay API conectada para
            un producto, DropshipPilot usa el extractor web con tus proxies residenciales.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 text-[12px] text-muted-foreground md:grid-cols-3">
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
            <p className="font-medium text-foreground">1 · Consigue las credenciales</p>
            <p className="mt-1 leading-relaxed">Cada proveedor te da sus claves (gratis). En la tarjeta tienes el enlace directo a su consola y a su documentación.</p>
          </div>
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
            <p className="font-medium text-foreground">2 · Pega y valida</p>
            <p className="mt-1 leading-relaxed">Se guardan cifradas (AES-256-GCM) y se validan al instante contra la API real, con el error exacto si algo falla.</p>
          </div>
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
            <p className="font-medium text-foreground">3 · Importa y vende</p>
            <p className="mt-1 leading-relaxed">El importador usará la API por delante del scraping y los pedidos podrán enviarse al proveedor sin intervención.</p>
          </div>
        </CardContent>
      </Card>

      {result && (
        <Alert variant={result.ok ? 'success' : 'warning'} title={result.title} onDismiss={() => setResult(null)}>
          {result.detail}
        </Alert>
      )}

      {/* Cuentas conectadas */}
      {list.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-[14px]">Tus conexiones</CardTitle>
            <CardDescription>Las credenciales están cifradas y no se muestran nunca en pantalla.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {list.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-medium">{a.label}</span>
                    <Badge variant={STATUS[a.status].variant}>{STATUS[a.status].label}</Badge>
                    {a.isDefault && (
                      <Badge variant="info">
                        <Star className="size-3" /> predeterminada
                      </Badge>
                    )}
                    <span className="text-[11px] text-muted-foreground">{providers.find((p) => p.provider === a.provider)?.name}</span>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {a.lastTestAt ? `Última verificación: ${new Date(a.lastTestAt).toLocaleString('es-ES')}` : 'Sin verificar'}
                    {a.lastError ? ` · ${a.lastError.slice(0, 120)}` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => test(a.id)} disabled={busy === a.id}>
                    {busy === a.id ? <Loader2 className="size-3.5 animate-spin" /> : <Plug className="size-3.5" />}
                    Probar
                  </Button>
                  {!a.isDefault && (
                    <Button variant="ghost" size="sm" onClick={() => makeDefault(a.id)} disabled={busy === a.id}>
                      <Star className="size-3.5" />
                      Predeterminada
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => remove(a.id)} disabled={busy === a.id} className="text-rose-300 hover:text-rose-200">
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Catálogo de proveedores */}
      <div className="grid gap-4 xl:grid-cols-3">
        {providers.map((p) => {
          const connected = accountsFor(p.provider);
          const open = openProvider === p.provider;
          const fields = FIELDS[p.provider] ?? [];

          return (
            <Card key={p.provider} className={cn(!p.available && 'opacity-70')}>
              <CardHeader>
                <CardTitle className="flex items-start justify-between gap-2 text-[14px]">
                  <span className="flex items-center gap-2">
                    <KeyRound className="size-4 text-indigo-300" />
                    {p.name}
                  </span>
                  {p.canPlaceOrders ? (
                    <Badge variant="success">
                      <ShoppingCart className="size-3" /> pedidos
                    </Badge>
                  ) : (
                    <Badge variant="outline">sólo lectura</Badge>
                  )}
                </CardTitle>
                <CardDescription>{p.tagline}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-[11.5px] leading-relaxed text-muted-foreground">{p.notes}</p>

                {p.available ? (
                  !open ? (
                    <div className="space-y-2">
                      <Button variant={connected.length ? 'outline' : 'gradient'} className="w-full" onClick={() => { setOpenProvider(p.provider); setForm({}); setLabel(''); }}>
                        <Plug className="size-4" />
                        {connected.length ? 'Añadir otra conexión' : 'Conectar API'}
                      </Button>
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <a href={p.signupUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-indigo-300 hover:underline">
                          <ExternalLink className="size-3" /> Conseguir credenciales
                        </a>
                        <a href={p.docsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
                          <BookOpen className="size-3" /> Documentación
                        </a>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3 rounded-lg border border-indigo-500/20 bg-indigo-500/[0.05] p-3">
                      <div className="space-y-2">
                        {fields.map((f) => (
                          <div key={f.key} className="space-y-1">
                            <Label htmlFor={`${p.provider}-${f.key}`} className="text-[11.5px]">
                              {f.label}
                            </Label>
                            <Input
                              id={`${p.provider}-${f.key}`}
                              type={f.secret ? 'password' : 'text'}
                              value={form[f.key] ?? ''}
                              onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                              placeholder={f.hint}
                              className="h-8 text-[12px]"
                              autoComplete="off"
                            />
                          </div>
                        ))}
                        <div className="space-y-1">
                          <Label htmlFor={`${p.provider}-label`} className="text-[11.5px]">
                            Nombre de la conexión
                          </Label>
                          <Input
                            id={`${p.provider}-label`}
                            value={label}
                            onChange={(e) => setLabel(e.target.value)}
                            placeholder={`${p.name} principal`}
                            className="h-8 text-[12px]"
                          />
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="gradient" size="sm" className="flex-1" onClick={() => connect(p.provider)} disabled={busy === p.provider}>
                          {busy === p.provider ? <Loader2 className="size-3.5 animate-spin" /> : <BadgeCheck className="size-3.5" />}
                          {busy === p.provider ? 'Validando…' : 'Guardar y validar'}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setOpenProvider(null)}>
                          Cancelar
                        </Button>
                      </div>
                      <p className="text-[10.5px] leading-relaxed text-muted-foreground">
                        Al guardar se hace una llamada real a la API del proveedor para comprobar las credenciales. Tus claves viajan cifradas y nunca
                        se muestran de nuevo.
                      </p>
                    </div>
                  )
                ) : (
                  <Alert variant="warning" title="Sin API pública">
                    {p.notes}
                  </Alert>
                )}

                {connected.length > 0 && (
                  <p className="flex items-center gap-1.5 text-[11px] text-emerald-300">
                    <CheckCircle2 className="size-3.5" />
                    {connected.length} conexión(es) activas — el importador ya usa esta API
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Sin presupuesto: qué hacer */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-[13px]">
            <AlertTriangle className="size-4 text-amber-300" />
            Si un proveedor no tiene API: proxies residenciales
          </CardTitle>
          <CardDescription>Alibaba y Temu, por ejemplo, sólo se pueden extraer con navegador y proxies rotativos</CardDescription>
        </CardHeader>
        <CardContent className="text-[12px] leading-relaxed text-muted-foreground">
          Los extractores funcionan igual, pero necesitan salir desde IPs residenciales para no ser bloqueados. Configúralos en la sección{' '}
          <a href="/proxies" className="text-indigo-300 hover:underline">
            Proxies y anti-bot
          </a>{' '}
          y DropshipPilot los usará automáticamente para los productos sin API conectada.
        </CardContent>
      </Card>
    </div>
  );
}
