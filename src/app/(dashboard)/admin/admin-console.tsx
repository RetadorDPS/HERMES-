'use client';

/**
 * Panel del operador: métricas de la plataforma + tabla de clientes con las
 * acciones habituales de soporte (plan, créditos, permisos, verificación).
 */
import { useCallback, useEffect, useState } from 'react';
import {
  BadgeEuro,
  CheckCircle2,
  CreditCard,
  Database,
  Loader2,
  Package,
  RefreshCw,
  ShieldCheck,
  Store,
  TrendingUp,
  UserCog,
  Users,
} from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/input';
import { formatRelative } from '@/lib/utils';
import { PlatformCredentialsCard } from './platform-credentials-card';

interface Tenant {
  id: string;
  email: string;
  name: string | null;
  role: string;
  plan: string;
  createdAt: string;
  lastLoginAt: string | null;
  verified: boolean;
  twoFactor: boolean;
  stores: number;
  products: number;
  orders: number;
  supplierAccounts: number;
  status: string;
  provider: 'stripe' | 'lemon' | null;
  creditsUsed: number;
  creditsLimit: number;
  renewsAt: string | null;
}

interface Payload {
  ok: boolean;
  error?: string;
  admin?: { email: string; source?: string; readOnly?: boolean };
  fx?: { source: 'manual' | 'ecb' | 'default'; fetchedAt: string | null; ageHours: number | null; stale: boolean; refreshHours: number; usdEur: number };
  overview?: {
    users: number;
    stores: number;
    products: number;
    orders: number;
    supplierAccounts: number;
    syncLogs24h: number;
    failed24h: number;
    paying: number;
    mrr: number;
    creditsUsed: number;
    creditsLimit: number;
  };
  tenants?: Tenant[];
}

export function AdminConsole() {
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/tenants', { cache: 'no-store' });
    setData(await res.json());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (tenant: Tenant, body: Record<string, unknown>, label: string) => {
    setBusy(tenant.id);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/tenants/${tenant.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      setMsg(json.ok ? { ok: true, text: `${tenant.email}: ${json.applied?.join(' · ') || label}` } : { ok: false, text: json.error ?? 'No se pudo aplicar el cambio' });
      await load();
    } finally {
      setBusy(null);
    }
  };

  if (!data) {
    return (
      <p className="flex items-center gap-2 py-10 text-[13px] text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Cargando métricas de la plataforma…
      </p>
    );
  }

  if (!data.ok) {
    return (
      <Alert variant="danger" title="No se pudo cargar el panel">
        {data.error}
      </Alert>
    );
  }

  const o = data.overview!;
  const tenants = data.tenants ?? [];
  // Modo evaluación: la sección se puede ver, pero los botones de acción no
  // cambian nada (el servidor también los rechaza: la interfaz no es seguridad).
  const readOnly = Boolean(data.admin?.readOnly);

  const KPIS = [
    { icon: Users, label: 'Clientes', value: o.users, hint: `${o.paying} de pago` },
    { icon: TrendingUp, label: 'MRR estimado', value: `${o.mrr} €`, hint: 'según planes activos' },
    { icon: Store, label: 'Tiendas', value: o.stores, hint: `${o.supplierAccounts} APIs de proveedor` },
    { icon: Package, label: 'Productos', value: o.products, hint: `${o.orders} pedidos` },
    { icon: RefreshCw, label: 'Sync últimas 24 h', value: o.syncLogs24h, hint: `${o.failed24h} con error` },
    { icon: Database, label: 'Créditos consumidos', value: `${o.creditsUsed}`, hint: `de ${o.creditsLimit} asignados` },
  ];

  return (
    <div data-tour="screen:admin" className="space-y-4">
      {data.fx && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[11.5px] text-muted-foreground">
          <BadgeEuro className="size-3.5 text-emerald-300" />
          <span className="text-foreground">Cambio de divisa</span>
          {data.fx.source === 'manual' ? (
            <span>tasas fijadas a mano (FX_RATES) · 1 USD = {data.fx.usdEur} €</span>
          ) : data.fx.source === 'ecb' ? (
            <span>
              tipos del BCE de hace {data.fx.ageHours} h · 1 USD = {data.fx.usdEur} € · se refrescan cada {data.fx.refreshHours} h
              {data.fx.stale ? ' · toca refrescar (npm run fx:refresh)' : ''}
            </span>
          ) : (
            <span>sin descargar todavía: se usan las tasas de reserva y el worker las traerá del BCE</span>
          )}
        </div>
      )}

      {readOnly && (
        <Alert variant="warning" title="Modo evaluación: panel en sólo lectura">
          Estás viendo el panel sin haber iniciado sesión con una cuenta <code>ADMIN</code>. Los datos aparecen con los correos de los clientes ocultos y los botones
          de plan, créditos y permisos están desactivados. Para gestionar de verdad: entra con tu cuenta de operador (<code>AUTH_ENABLED=true</code>) o arranca el
          servidor con <code>LOCAL_ADMIN_MODE=true</code> si es una instalación sólo tuya.
        </Alert>
      )}

      {msg && (
        <Alert variant={msg.ok ? 'success' : 'danger'} title={msg.ok ? 'Cambio aplicado' : 'No se pudo aplicar'} onDismiss={() => setMsg(null)}>
          {msg.text}
        </Alert>
      )}

      <div data-tour="admin:kpis" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {KPIS.map((k) => (
          <Card key={k.label}>
            <CardContent className="p-4">
              <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                <k.icon className="size-3.5" /> {k.label}
              </p>
              <p className="mt-1.5 text-xl font-semibold tabular-nums">{k.value}</p>
              <p className="text-[11px] text-muted-foreground">{k.hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Claves de proveedor de la plataforma: lo que hace que los clientes no
          tengan que configurar nada */}
      <PlatformCredentialsCard />

      <Card data-tour="admin:tenants">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserCog className="size-4 text-indigo-300" /> Clientes ({tenants.length})
          </CardTitle>
          <CardDescription>
            Cambia de plan, ajusta créditos, da permisos de operador o verifica un correo a mano. Todo queda en el registro de auditoría.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {tenants.length === 0 && <p className="text-[12px] text-muted-foreground">Todavía no hay clientes registrados.</p>}

          {tenants.map((t) => (
            <div key={t.id} className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] font-medium">{t.email}</span>
                {t.role === 'ADMIN' && (
                  <Badge variant="info">
                    <ShieldCheck className="size-3" /> operador
                  </Badge>
                )}
                <Badge variant={t.plan === 'TRIAL' ? 'outline' : 'success'}>{t.plan}</Badge>
                <Badge variant="outline">{t.status}</Badge>
                {t.provider && (
                  <Badge variant="outline">
                    <CreditCard className="size-3" /> {t.provider === 'lemon' ? 'Lemon Squeezy' : 'Stripe'}
                  </Badge>
                )}
                {!t.verified && <Badge variant="warning">correo sin verificar</Badge>}
                {t.twoFactor && (
                  <Badge variant="outline">
                    <CheckCircle2 className="size-3" /> 2FA
                  </Badge>
                )}
                <span className="ml-auto text-[11px] text-muted-foreground">
                  alta {new Date(t.createdAt).toLocaleDateString('es-ES')} · último acceso {formatRelative(t.lastLoginAt as any)}
                </span>
              </div>

              <div className="mt-2 grid grid-cols-2 gap-2 text-[11.5px] text-muted-foreground sm:grid-cols-4">
                <span>
                  <Store className="mr-1 inline size-3" />
                  {t.stores} tienda(s) · {t.supplierAccounts} API(s)
                </span>
                <span>
                  <Package className="mr-1 inline size-3" />
                  {t.products} producto(s) · {t.orders} pedido(s)
                </span>
                <span className="flex items-center gap-1">
                  <BadgeEuro className="size-3" />
                  {t.creditsUsed}/{t.creditsLimit} créditos
                </span>
                <span>{t.renewsAt ? `renueva ${formatRelative(t.renewsAt as any)}` : 'sin renovación programada'}</span>
              </div>

              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                <Select
                  value={t.plan}
                  onChange={(e) => act(t, { plan: e.target.value }, 'plan cambiado')}
                  disabled={busy === t.id || readOnly}
                  className="h-8 w-auto text-[12px]"
                >
                  {['TRIAL', 'STARTER', 'PRO', 'ENTERPRISE'].map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </Select>
                <Button variant="outline" size="sm" onClick={() => act(t, { addCredits: 1000 }, '+1000 créditos')} disabled={busy === t.id || readOnly}>
                  +1.000 créditos
                </Button>
                <Button variant="outline" size="sm" onClick={() => act(t, { resetCredits: true }, 'créditos reiniciados')} disabled={busy === t.id || readOnly}>
                  Reiniciar ciclo
                </Button>
                {!t.verified && (
                  <Button variant="outline" size="sm" onClick={() => act(t, { verifyEmail: true }, 'correo verificado')} disabled={busy === t.id || readOnly}>
                    Verificar correo
                  </Button>
                )}
                <Button
                  variant={t.role === 'ADMIN' ? 'destructive' : 'outline'}
                  size="sm"
                  onClick={() => act(t, { role: t.role === 'ADMIN' ? 'OWNER' : 'ADMIN' }, 'rol cambiado')}
                  disabled={busy === t.id || readOnly}
                >
                  {t.role === 'ADMIN' ? 'Quitar operador' : 'Hacer operador'}
                </Button>
                {busy === t.id && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <p className="text-[11px] text-muted-foreground">
        Nota: cambiar el plan aquí no toca Stripe ni Lemon Squeezy (es una concesión manual, útil para pruebas, cortesías o compensaciones). Los cobros reales
        los siguen gestionando sus webhooks.
      </p>
    </div>
  );
}
