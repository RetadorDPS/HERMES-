'use client';

/**
 * Claves de proveedor de la PLATAFORMA (sólo administrador).
 *
 * Aquí se pegan UNA vez las claves de AliExpress / CJ y desde ese momento todos
 * los clientes navegan e importan con ellas sin verlas ni configurarlas. El
 * formulario guarda cifrado (AES-256-GCM), prueba contra la API real y permite
 * lanzar una descarga del catálogo sin salir de la pantalla.
 */
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, KeyRound, Loader2, PlugZap, RefreshCw, Trash2 } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { formatNumber, formatRelative } from '@/lib/utils';

interface Field {
  key: string;
  label: string;
  hint?: string;
  secret?: boolean;
}

interface ProviderState {
  provider: string;
  name: string;
  fields: Field[];
  configured: boolean;
  source: 'database' | 'env' | null;
  enabled: boolean;
  status: string | null;
  lastTestAt: string | null;
  lastError: string | null;
  masked: { key: string; label: string; value: string; secret: boolean }[];
  quota: { monthly: number | null; used: number; resetAt: string | null } | null;
  catalogItems: number;
  catalogReal: number;
  lastSync: string | null;
}

interface Payload {
  ok: boolean;
  error?: string;
  admin?: { source?: string; readOnly?: boolean };
  providers?: ProviderState[];
  catalog?: { total: number; real: number; sample: number; lastSync: string | null };
  envFallback?: Record<string, boolean>;
}

export function PlatformCredentialsCard() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [forms, setForms] = useState<Record<string, Record<string, string>>>({});
  const [quota, setQuota] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<string | null>(null);
  const readOnly = Boolean(data?.admin?.readOnly);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/platform-credentials', { cache: 'no-store' });
      const json = (await res.json()) as Payload;
      setData(json);
    } catch {
      setData({ ok: false, error: 'No he podido cargar el estado de las claves' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (provider: string, action: 'save' | 'test' | 'sync' | 'clear', extra: Record<string, unknown> = {}) => {
    setBusy(`${provider}:${action}`);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/platform-credentials', {
        method: action === 'clear' ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: action === 'clear' ? undefined : JSON.stringify({ action, provider, ...extra }),
      });
      const json = await res.json();
      setMessage({ ok: Boolean(json.ok), text: json.message ?? json.error ?? 'Hecho' });
      if (json.providers) setData((d) => ({ ...(d ?? {}), ok: true, providers: json.providers }));
      await load();
      if (action === 'save') setForms((f) => ({ ...f, [provider]: {} }));
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const catalog = data?.catalog ?? { total: 0, real: 0, sample: 0, lastSync: null };

  return (
    <Card data-tour="admin:credentials">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="size-4 text-indigo-300" /> Claves de proveedor de la plataforma
          <Badge variant="info">sólo operador</Badge>
        </CardTitle>
        <CardDescription>
          Se configuran una sola vez y las usan todos los clientes: nadie más tiene que solicitar una app a AliExpress ni pegar claves. Se guardan
          cifradas (AES-256-GCM) y nunca se muestran completas. Cascada de resolución: <span className="text-foreground">claves de plataforma → variables
          de entorno → cuenta propia del usuario</span> (opcional).
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-4">
          {[
            { label: 'Artículos indexados', value: formatNumber(catalog.total) },
            { label: 'Reales (de proveedor)', value: formatNumber(catalog.real) },
            { label: 'De muestra', value: formatNumber(catalog.sample) },
            { label: 'Última descarga', value: catalog.lastSync ? formatRelative(catalog.lastSync) : '—' },
          ].map((k) => (
            <div key={k.label} className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{k.label}</div>
              <div className="text-sm font-semibold tabular-nums">{k.value}</div>
            </div>
          ))}
        </div>

        {message && (
          <Alert variant={message.ok ? 'success' : 'danger'} onDismiss={() => setMessage(null)}>
            {message.text}
          </Alert>
        )}

        {loading && (
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Consultando el estado de las claves…
          </div>
        )}

        {(data?.providers ?? []).map((p) => {
          const isOpen = open === p.provider;
          const form = forms[p.provider] ?? {};
          return (
            <div key={p.provider} className="rounded-xl border border-white/[0.07] bg-white/[0.02]">
              <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-[180px] flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{p.name}</span>
                    {p.configured ? (
                      <Badge variant={p.status === 'CONNECTED' ? 'success' : p.status === 'ERROR' ? 'danger' : 'warning'}>
                        {p.status === 'CONNECTED' ? 'conectado' : p.status === 'ERROR' ? 'con error' : 'sin probar'}
                      </Badge>
                    ) : (
                      <Badge variant="outline">sin claves</Badge>
                    )}
                    {p.source === 'env' && <Badge variant="info">desde variables de entorno</Badge>}
                    {p.catalogReal > 0 && <Badge variant="secondary">{formatNumber(p.catalogReal)} productos reales</Badge>}
                  </div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    {p.configured
                      ? `${p.masked.map((m) => `${m.label}: ${m.value}`).join(' · ')}${p.lastTestAt ? ` · probado ${formatRelative(p.lastTestAt)}` : ''}`
                      : data?.envFallback?.[p.provider]
                        ? 'Hay variables de entorno definidas para este proveedor'
                        : 'Sin configurar: los usuarios verán el catálogo de muestra'}
                  </div>
                  {p.lastError && (
                    <div className="mt-1 flex items-center gap-1.5 text-[11px] text-rose-300">
                      <AlertTriangle className="size-3" /> {p.lastError}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant={isOpen ? 'secondary' : 'outline'}
                    onClick={() => setOpen(isOpen ? null : p.provider)}
                  >
                    <KeyRound className="size-3.5" /> {p.configured ? 'Cambiar claves' : 'Añadir claves'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!p.configured || busy === `${p.provider}:test` || readOnly}
                    onClick={() => void act(p.provider, 'test')}
                  >
                    {busy === `${p.provider}:test` ? <Loader2 className="size-3.5 animate-spin" /> : <PlugZap className="size-3.5" />} Probar
                  </Button>
                  <Button
                    size="sm"
                    variant="gradient"
                    disabled={!p.configured || busy === `${p.provider}:sync` || readOnly}
                    onClick={() => void act(p.provider, 'sync', { pages: 2, categories: true })}
                  >
                    {busy === `${p.provider}:sync` ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />} Descargar catálogo
                  </Button>
                  {p.configured && p.source === 'database' && (
                    <Button size="sm" variant="ghost" disabled={busy === `${p.provider}:clear` || readOnly} onClick={() => void act(p.provider, 'clear')}>
                      <Trash2 className="size-3.5" />
                    </Button>
                  )}
                </div>
              </div>

              {isOpen && (
                <div className="border-t border-white/[0.07] px-4 py-4">
                  <form
                    className="grid gap-3 sm:grid-cols-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void act(p.provider, 'save', {
                        credentials: form,
                        monthlyQuota: quota[p.provider] ? Number(quota[p.provider]) : null,
                        test: true,
                      });
                    }}
                  >
                    {p.fields.map((f) => (
                      <div key={f.key} className="space-y-1.5">
                        <Label htmlFor={`${p.provider}-${f.key}`}>{f.label}</Label>
                        <Input
                          id={`${p.provider}-${f.key}`}
                          type={f.secret ? 'password' : 'text'}
                          autoComplete="off"
                          placeholder={p.masked.find((m) => m.key === f.key)?.value || f.hint || ''}
                          value={form[f.key] ?? ''}
                          onChange={(e) => setForms((prev) => ({ ...prev, [p.provider]: { ...(prev[p.provider] ?? {}), [f.key]: e.target.value } }))}
                        />
                        {f.hint && <p className="text-[10px] text-muted-foreground">{f.hint}</p>}
                      </div>
                    ))}

                    <div className="space-y-1.5">
                      <Label htmlFor={`${p.provider}-quota`}>Límite mensual de llamadas (opcional)</Label>
                      <Input
                        id={`${p.provider}-quota`}
                        type="number"
                        min={0}
                        placeholder={p.quota?.monthly ? String(p.quota.monthly) : 'p. ej. 10000'}
                        value={quota[p.provider] ?? ''}
                        onChange={(e) => setQuota((q) => ({ ...q, [p.provider]: e.target.value }))}
                      />
                      <p className="text-[10px] text-muted-foreground">
                        Si lo rellenas, la plataforma deja de pedir al proveedor cuando se agota (te avisa antes de bloquearse). Uso este mes:{' '}
                        {p.quota ? formatNumber(p.quota.used) : 0}
                        {p.quota?.monthly ? ` / ${formatNumber(p.quota.monthly)}` : ''}.
                      </p>
                    </div>

                    <div className="sm:col-span-2 flex flex-wrap items-center gap-2">
                      <Button type="submit" variant="gradient" disabled={busy === `${p.provider}:save` || readOnly}>
                        {busy === `${p.provider}:save` ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                        Guardar y probar
                      </Button>
                      <Button type="button" variant="outline" onClick={() => void load()}>
                        <RefreshCw className="size-4" /> Recargar estado
                      </Button>
                      <span className="text-[11px] text-muted-foreground">
                        Al guardar se prueba contra la API real y se marca el estado (conectado / con error).
                      </span>
                    </div>
                  </form>
                </div>
              )}
            </div>
          );
        })}

        <p className="text-[11px] text-muted-foreground">
          Alternativa por despliegue: define <code>ALIEXPRESS_APP_KEY</code>, <code>ALIEXPRESS_APP_SECRET</code>, <code>ALIEXPRESS_ACCESS_TOKEN</code>,{' '}
          <code>CJ_EMAIL</code> y <code>CJ_API_KEY</code> en el <code>.env</code> del servidor. Lo guardado aquí tiene prioridad.
        </p>
      </CardContent>
    </Card>
  );
}

export default PlatformCredentialsCard;
