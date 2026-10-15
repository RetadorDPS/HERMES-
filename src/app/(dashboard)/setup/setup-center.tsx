'use client';

/**
 * Centro de conexión — interfaz. Muestra en vivo qué está conectado y qué
 * falta, con el nombre exacto de la variable de entorno y el enlace a la
 * pantalla donde se configura cada cosa.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  ExternalLink,
  Loader2,
  RefreshCw,
  Rocket,
  XCircle,
} from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface Check {
  id: string;
  label: string;
  zone: string;
  status: 'ok' | 'warning' | 'missing' | 'error' | 'optional';
  required: boolean;
  detail: string;
  env?: string[];
  howTo?: string;
  link?: string;
}

interface Payload {
  ok: boolean;
  generatedAt: string;
  ready: boolean;
  summary: { total: number; ok: number; blockers: number; pending: number };
  checks: Check[];
}

const ZONES: { id: string; label: string; description: string }[] = [
  { id: 'infra', label: 'Infraestructura', description: 'Base de datos, colas y motor de extracción' },
  { id: 'seguridad', label: 'Seguridad', description: 'Cifrado, sesiones, verificación y webhooks' },
  { id: 'cobros', label: 'Cobros', description: 'Stripe: claves, precios y webhook' },
  { id: 'correo', label: 'Correo', description: 'Envío de verificación y recuperación de contraseña' },
  { id: 'tiendas', label: 'Tus tiendas', description: 'Shopify y WooCommerce conectadas' },
  { id: 'proveedores', label: 'Proveedores', description: 'APIs oficiales (AliExpress, CJ, Amazon)' },
  { id: 'scraping', label: 'Extracción', description: 'Proxies y modo de scraping' },
];

function StatusIcon({ status }: { status: Check['status'] }) {
  if (status === 'ok') return <CheckCircle2 className="size-4 shrink-0 text-emerald-400" />;
  if (status === 'warning' || status === 'optional') return <AlertTriangle className="size-4 shrink-0 text-amber-400" />;
  return <XCircle className="size-4 shrink-0 text-rose-400" />;
}

function StatusBadge({ status, required }: { status: Check['status']; required: boolean }) {
  if (status === 'ok') return <Badge variant="success">Conectado</Badge>;
  if (status === 'optional') return <Badge variant="outline">Opcional ahora</Badge>;
  if (status === 'warning') return <Badge variant="warning">{required ? 'Pendiente' : 'Recomendado'}</Badge>;
  return <Badge variant="danger">{required ? 'Bloqueante' : 'Pendiente'}</Badge>;
}

export function SetupCenter() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/setup/status', { cache: 'no-store' });
      setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const copy = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      /* el usuario puede copiar a mano */
    }
  };

  if (loading && !data) {
    return (
      <div className="flex items-center gap-2 py-10 text-[13px] text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Comprobando en vivo todas las conexiones…
      </div>
    );
  }

  if (!data?.ok) {
    return (
      <Alert variant="danger" title="No se pudo comprobar el estado">
        Recarga la página o revisa el registro del servidor.
      </Alert>
    );
  }

  const blockers = data.checks.filter((c) => c.required && c.status !== 'ok');

  return (
    <div className="space-y-5">
      {/* Resumen */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Rocket className="size-4 text-indigo-300" />
            {data.ready ? 'Todo listo: no falta nada por conectar' : `Faltan ${blockers.length} conexión(es) imprescindible(s)`}
          </CardTitle>
          <CardDescription>
            Comprobado en vivo el {new Date(data.generatedAt).toLocaleString('es-ES')} · {data.summary.ok} de {data.summary.total} piezas conectadas
            {data.summary.pending > 0 && ` · ${data.summary.pending} recomendadas pendientes`}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            Volver a comprobar
          </Button>
          <span className="text-[12px] text-muted-foreground">
            Las claves se pegan en <code className="rounded bg-black/30 px-1.5 py-0.5">.env.local</code> del servidor; lo demás, en las pantallas del panel.
          </span>
        </CardContent>
      </Card>

      {blockers.length > 0 && (
        <Alert variant="warning" title="Esto es lo que impide operar hoy">
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {blockers.map((c) => (
              <li key={c.id}>
                <strong>{c.label}</strong>: {c.detail}
              </li>
            ))}
          </ul>
        </Alert>
      )}

      {/* Por zonas */}
      {ZONES.map((zone) => {
        const checks = data.checks.filter((c) => c.zone === zone.id);
        if (checks.length === 0) return null;
        const zoneOk = checks.filter((c) => c.status === 'ok').length;

        return (
          <Card key={zone.id}>
            <CardHeader>
              <CardTitle className="text-[14px]">
                {zone.label}
                <span className="ml-2 text-[12px] font-normal text-muted-foreground">
                  {zoneOk}/{checks.length} conectado(s) · {zone.description}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {checks.map((check) => (
                <div key={check.id} className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusIcon status={check.status} />
                    <span className="text-[13px] font-medium">{check.label}</span>
                    <StatusBadge status={check.status} required={check.required} />
                    {check.link && (
                      <Link href={check.link} className="ml-auto inline-flex items-center gap-1 text-[12px] text-indigo-300 hover:underline">
                        Ir a la pantalla <ExternalLink className="size-3" />
                      </Link>
                    )}
                  </div>
                  <p className="mt-1.5 text-[12.5px] text-muted-foreground">{check.detail}</p>

                  {check.env && check.status !== 'ok' && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {check.env.map((name) => (
                        <button
                          key={name}
                          type="button"
                          onClick={() => copy(`${name}=`, name)}
                          className="inline-flex items-center gap-1 rounded border border-white/10 bg-black/30 px-1.5 py-0.5 font-mono text-[11px] hover:border-indigo-400/40"
                          title="Copiar el nombre de la variable"
                        >
                          {name}
                          <Copy className="size-2.5 opacity-60" />
                        </button>
                      ))}
                      {copied && check.env.includes(copied.replace('=', '')) && <span className="text-[11px] text-emerald-300">copiado</span>}
                    </div>
                  )}

                  {check.howTo && check.status !== 'ok' && (
                    <p className="mt-2 text-[12px] leading-relaxed text-indigo-200/90">
                      <strong>Cómo se conecta:</strong> {check.howTo}
                    </p>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
