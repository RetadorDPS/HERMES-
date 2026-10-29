'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertCircle, CheckCircle2, Loader2, Plus, RefreshCw, ShieldCheck, Sparkles, Store as StoreIcon, Trash2, Webhook } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/input';
import { cn, formatRelative } from '@/lib/utils';
import { ESTATICO } from '@/lib/ruta';

interface StoreRow {
  id: string;
  platform: 'SHOPIFY' | 'WOOCOMMERCE';
  name: string;
  domain: string;
  status: string;
  currency: string;
  productsCount: number;
  ordersCount: number;
  lastPingAt: Date | string | null;
  lastError: string | null;
}

export function StoreManager({
  stores: initial,
  suppliers,
  shopifyOAuth = false,
}: {
  stores: StoreRow[];
  suppliers: { id: string; name: string; type: string; productsCount: number; avgDelivery: string; isEnabled: boolean }[];
  /** true = la app de Shopify está configurada y se puede instalar con un clic */
  shopifyOAuth?: boolean;
}) {
  const router = useRouter();
  const search = useSearchParams();
  const [oauthShop, setOauthShop] = useState('');
  const [stores, setStores] = useState(initial);
  const [platform, setPlatform] = useState<'SHOPIFY' | 'WOOCOMMERCE'>('SHOPIFY');
  const [form, setForm] = useState({ shopUrl: '', accessToken: '', consumerKey: '', consumerSecret: '', name: '' });
  const [registerWebhooks, setRegisterWebhooks] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ variant: 'success' | 'danger' | 'warning' | 'info'; title: string; text?: string } | null>(null);

  // Mensaje de vuelta del flujo OAuth (?shopify=conectada | ?shopify=error)
  useEffect(() => {
    const result = search.get('shopify');
    if (!result) return;
    if (result === 'conectada') {
      setMsg({ variant: 'success', title: 'Tienda conectada con Shopify', text: `Shopify autorizó la app para ${search.get('tienda') ?? 'tu tienda'}. El token se guardó cifrado y los webhooks de pedidos ya están registrados.` });
    } else {
      setMsg({ variant: 'danger', title: 'No se pudo completar la instalación', text: search.get('motivo') ?? 'Revisa SHOPIFY_API_KEY / SHOPIFY_API_SECRET y la URL de redirección en Shopify Partners.' });
    }
    router.replace('/stores');
  }, [search, router]);

  const installShopify = () => {
    const shop = oauthShop.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!shop) return;
    if (ESTATICO) {
      setMsg({ variant: 'info', title: 'Modo demostración', text: 'La conexión real con Shopify se activa cuando conectemos el servidor. Aquí no se instala nada.' });
      return;
    }
    window.location.href = `/api/shopify/install?shop=${encodeURIComponent(shop)}`;
  };

  const connect = async () => {
    setBusy('connect');
    setMsg(null);
    try {
      const body =
        platform === 'SHOPIFY'
          ? { platform, shopUrl: form.shopUrl, accessToken: form.accessToken, name: form.name || undefined, registerWebhooks }
          : { platform, shopUrl: form.shopUrl, consumerKey: form.consumerKey, consumerSecret: form.consumerSecret, name: form.name || undefined, registerWebhooks };

      const res = await fetch('/api/stores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const json = await res.json();

      if (!json.ok) {
        setMsg({ variant: 'danger', title: 'No se pudo conectar la tienda', text: json.error });
        return;
      }

      setMsg({
        variant: json.missingScopes?.length ? 'warning' : 'success',
        title: `Tienda validada${json.shop?.name ? `: ${json.shop.name}` : ''}`,
        text: [
          json.shop?.myshopifyDomain ? `Dominio ${json.shop.myshopifyDomain} · moneda ${json.shop.currencyCode}` : json.shop?.siteUrl ? `Sitio ${json.shop.siteUrl}` : null,
          json.scopes?.length ? `Scopes: ${json.scopes.join(', ')}` : null,
          json.missingScopes?.length ? `Faltan scopes: ${json.missingScopes.join(', ')}` : null,
          json.webhooks?.data?.registered?.length ? `Webhooks registrados: ${json.webhooks.data.registered.map((w: any) => w.topic).join(', ')}` : null,
          json.message ?? null,
        ]
          .filter(Boolean)
          .join(' · '),
      });

      if (json.store) {
        setStores((prev) => [
          ...prev.filter((s) => s.id !== json.store.id),
          { ...json.store, currency: json.shop?.currencyCode ?? 'EUR', productsCount: 0, ordersCount: 0, lastPingAt: new Date(), lastError: null },
        ]);
      }
      setForm({ shopUrl: '', accessToken: '', consumerKey: '', consumerSecret: '', name: '' });
      router.refresh();
    } catch (err) {
      setMsg({ variant: 'danger', title: 'Error de red', text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const test = async (id: string) => {
    setBusy(id);
    setMsg(null);
    try {
      const res = await fetch(`/api/stores/${id}/test`, { method: 'POST' });
      const json = await res.json();
      setStores((prev) =>
        prev.map((s) => (s.id === id ? { ...s, status: json.ok ? 'CONNECTED' : 'ERROR', lastPingAt: new Date(), lastError: json.ok ? null : json.error } : s)),
      );
      setMsg({
        variant: json.ok ? 'success' : 'danger',
        title: json.ok ? `Conexión correcta (${json.latencyMs ?? '—'} ms)` : 'La tienda devuelve error',
        text: [json.message, json.error, json.primaryLocationId ? `Almacén principal: ${json.primaryLocationId}` : null].filter(Boolean).join(' · '),
      });
      router.refresh();
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async (id: string) => {
    if (!confirm('¿Desconectar la tienda? Los productos publicados se quedan en la tienda pero dejan de sincronizarse.')) return;
    setBusy(id);
    const res = await fetch(`/api/stores/${id}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.ok) {
      setStores((prev) => prev.map((s) => (s.id === id ? { ...s, status: 'DISCONNECTED' } : s)));
      setMsg({ variant: 'info', title: 'Tienda desconectada', text: json.warning });
    }
    setBusy(null);
    router.refresh();
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
      <div className="space-y-4">
        {msg && (
          <Alert variant={msg.variant} title={msg.title} onDismiss={() => setMsg(null)}>
            {msg.text}
          </Alert>
        )}

        {stores.map((s) => (
          <Card key={s.id} className={cn(s.status === 'ERROR' && 'border-rose-500/25')}>
            <CardHeader className="flex-row items-start justify-between space-y-0">
              <div className="flex items-start gap-3">
                <span
                  className={cn(
                    'grid size-10 place-items-center rounded-xl border',
                    s.platform === 'SHOPIFY' ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-400' : 'border-violet-500/25 bg-violet-500/10 text-violet-400',
                  )}
                >
                  <StoreIcon className="size-5" />
                </span>
                <div>
                  <CardTitle className="flex items-center gap-2">
                    {s.name}
                    <StatusBadge status={s.status} />
                  </CardTitle>
                  <CardDescription>
                    {s.platform === 'SHOPIFY' ? 'Shopify · GraphQL Admin API' : 'WooCommerce · REST API v3'} · {s.domain} · {s.currency}
                  </CardDescription>
                </div>
              </div>
              <div className="flex gap-1">
                <Button variant="outline" size="sm" onClick={() => test(s.id)} disabled={busy === s.id}>
                  {busy === s.id ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                  Probar
                </Button>
                <Button variant="ghost" size="icon" onClick={() => disconnect(s.id)} disabled={busy === s.id} title="Desconectar">
                  <Trash2 className="size-3.5 text-rose-400" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: 'Productos', value: s.productsCount },
                  { label: 'Pedidos', value: s.ordersCount },
                  { label: 'Último ping', value: formatRelative(s.lastPingAt as any) },
                ].map((k) => (
                  <div key={k.label} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{k.label}</p>
                    <p className="mt-0.5 text-[13px] font-semibold tabular-nums">{k.value}</p>
                  </div>
                ))}
              </div>

              {s.lastError && (
                <Alert variant="danger" title="Error de conexión">
                  {s.lastError}
                </Alert>
              )}

              <div className="flex flex-wrap gap-1.5">
                <Badge variant="outline">
                  <ShieldCheck className="size-3" />
                  Token cifrado AES-256-GCM
                </Badge>
                <Badge variant="outline">
                  <Webhook className="size-3" />
                  Webhooks: orders/create, orders/paid, fulfillments/update
                </Badge>
                <Badge variant="outline">Sync de stock en tiempo real</Badge>
              </div>
            </CardContent>
          </Card>
        ))}

        <Card>
          <CardHeader>
            <CardTitle>Proveedores configurados</CardTitle>
            <CardDescription>Fuentes desde las que se importan productos</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {suppliers.map((s) => (
              <div key={s.id} className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
                <div>
                  <p className="text-[13px] font-medium">{s.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {s.type.replace('_', ' ')} · entrega {s.avgDelivery} · {s.productsCount} productos importados
                  </p>
                </div>
                <StatusBadge status={s.isEnabled ? 'ACTIVE' : 'PAUSED'} label={s.isEnabled ? 'Activo' : 'Desactivado'} />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Formulario de conexión */}
      <Card className="lg:sticky lg:top-[92px] lg:self-start">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plus className="size-4 text-indigo-300" />
            Conectar tienda
          </CardTitle>
          <CardDescription>Tus credenciales se guardan cifradas y no se vuelven a mostrar</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-1 rounded-lg border border-white/[0.06] bg-white/[0.02] p-1">
            {(['SHOPIFY', 'WOOCOMMERCE'] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPlatform(p)}
                className={cn(
                  'rounded-md px-3 py-1.5 text-[12px] font-medium transition',
                  platform === p ? 'bg-white/[0.08] text-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {p === 'SHOPIFY' ? 'Shopify' : 'WooCommerce'}
              </button>
            ))}
          </div>

          {platform === 'SHOPIFY' && shopifyOAuth && (
            <div className="space-y-2 rounded-lg border border-indigo-500/30 bg-indigo-500/[0.07] p-3">
              <p className="flex items-center gap-1.5 text-[12px] font-medium text-indigo-200">
                <Sparkles className="size-3.5" /> Instalación en 1 clic (recomendado)
              </p>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Escribe el dominio interno de tu tienda y autoriza la app en Shopify: no necesitas crear ningún token a mano.
              </p>
              <div className="flex gap-2">
                <Input
                  value={oauthShop}
                  onChange={(e) => setOauthShop(e.target.value)}
                  placeholder="mi-tienda.myshopify.com"
                  className="font-mono text-[12px]"
                />
                <Button variant="gradient" onClick={installShopify} disabled={!oauthShop.trim()} className="shrink-0">
                  Instalar
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">…o pega un token manualmente aquí abajo.</p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="shop">Dominio de la tienda</Label>
            <Input
              id="shop"
              value={form.shopUrl}
              onChange={(e) => setForm({ ...form, shopUrl: e.target.value })}
              placeholder={platform === 'SHOPIFY' ? 'mi-tienda.myshopify.com' : 'https://mi-tienda.es'}
              className="font-mono text-[12px]"
            />
          </div>

          {platform === 'SHOPIFY' ? (
            <div className="space-y-1.5">
              <Label htmlFor="token">Admin API access token</Label>
              <Input
                id="token"
                type="password"
                value={form.accessToken}
                onChange={(e) => setForm({ ...form, accessToken: e.target.value })}
                placeholder="shpat_..."
                className="font-mono text-[12px]"
              />
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Crea una app personalizada en Shopify (Ajustes → Apps → Desarrollar apps) con scopes{' '}
                <code className="rounded bg-black/30 px-1">write_products, read_orders, write_inventory</code>.
              </p>
            </div>
          ) : (
            <div className="grid gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="ck">Consumer key</Label>
                <Input id="ck" value={form.consumerKey} onChange={(e) => setForm({ ...form, consumerKey: e.target.value })} placeholder="ck_..." className="font-mono text-[12px]" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cs">Consumer secret</Label>
                <Input id="cs" type="password" value={form.consumerSecret} onChange={(e) => setForm({ ...form, consumerSecret: e.target.value })} placeholder="cs_..." className="font-mono text-[12px]" />
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                WooCommerce → Ajustes → Avanzado → REST API → Crear clave con permisos de lectura/escritura.
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="name">Nombre interno (opcional)</Label>
            <Input id="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Mi tienda principal" />
          </div>

          <label className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 text-[12px]">
            <input type="checkbox" checked={registerWebhooks} onChange={(e) => setRegisterWebhooks(e.target.checked)} className="size-3.5 accent-indigo-500" />
            Registrar webhooks de pedidos automáticamente
          </label>

          <Button variant="gradient" className="w-full" onClick={connect} disabled={busy === 'connect' || !form.shopUrl}>
            {busy === 'connect' ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
            Validar y conectar
          </Button>

          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-[11px] leading-relaxed text-muted-foreground">
            <p className="flex items-center gap-1.5 font-medium text-foreground">
              <AlertCircle className="size-3.5 text-amber-400" />
              Sin DATABASE_URL
            </p>
            <p className="mt-1">
              La validación se hace igualmente contra la API real del proveedor, pero la tienda no se persiste. Levanta PostgreSQL para guardarla
              cifrada junto a sus webhooks.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
