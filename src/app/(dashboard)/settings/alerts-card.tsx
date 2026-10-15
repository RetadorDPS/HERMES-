'use client';

/**
 * Tarjeta «Avisos por correo» de Configuración: activa/desactiva cada tipo de
 * aviso y envía un correo de prueba para comprobar el transporte.
 */
import { useEffect, useState } from 'react';
import { BellRing, Loader2, MailCheck, Send } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type Kind = 'sync' | 'stock' | 'webhooks' | 'billing' | 'onboarding';

interface Payload {
  ok: boolean;
  email: string | null;
  prefs: Record<Kind, boolean>;
  transport: 'resend' | 'webhook' | 'console';
  deliverable: boolean;
}

const ITEMS: { kind: Kind; title: string; desc: string }[] = [
  { kind: 'sync', title: 'Fallos de sincronización', desc: 'Un producto no se pudo re-escanear o actualizar en la tienda tras varios intentos' },
  { kind: 'stock', title: 'Cambios de stock', desc: 'Un producto se quedó agotado en el proveedor (se despublica) o recuperó existencias' },
  { kind: 'webhooks', title: 'Webhooks con firma inválida', desc: 'Una tienda envió un aviso sin firma correcta: posible ataque o mala configuración' },
  { kind: 'billing', title: 'Problemas de pago', desc: 'Un cobro de tu suscripción ha fallado y hay que actualizar el método de pago' },
  {
    kind: 'onboarding',
    title: 'Primeros pasos y acompañamiento',
    desc: 'El correo de bienvenida y un único recordatorio si te quedan pasos por dar (nunca más de uno)',
  },
];

export function AlertsCard() {
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ variant: 'success' | 'danger' | 'info'; text: string } | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await fetch('/api/alerts', { cache: 'no-store' });
      setData(await res.json());
    })();
  }, []);

  const toggle = async (kind: Kind) => {
    if (!data) return;
    const next = { ...data.prefs, [kind]: !data.prefs[kind] };
    setData({ ...data, prefs: next });
    setBusy(kind);
    try {
      const res = await fetch('/api/alerts', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [kind]: next[kind] }) });
      const json = await res.json();
      if (json.prefs) setData((d) => (d ? { ...d, prefs: json.prefs } : d));
    } finally {
      setBusy(null);
    }
  };

  const sendTest = async () => {
    setBusy('test');
    setMsg(null);
    try {
      const res = await fetch('/api/alerts', { method: 'POST' });
      const json = await res.json();
      if (json.ok) {
        setMsg({
          variant: json.console ? 'info' : 'success',
          text: json.console
            ? 'No hay servicio de correo configurado: el aviso se escribió en el registro del servidor (mira la consola de la app). Configura RESEND_API_KEY para que llegue de verdad.'
            : `Correo de prueba enviado a ${data?.email ?? 'tu cuenta'}.`,
        });
      } else {
        setMsg({ variant: 'danger', text: json.error ?? 'No se pudo enviar la prueba' });
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BellRing className="size-4 text-indigo-300" />
          Avisos por correo
          {data && (
            <Badge variant={data.deliverable ? 'success' : 'warning'}>
              {data.transport === 'resend' ? 'Resend' : data.transport === 'webhook' ? 'Webhook' : 'sin servicio de correo'}
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          Te avisamos cuando algo requiere tu atención: {data?.email ?? 'correo de tu cuenta'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {msg && (
          <Alert variant={msg.variant} title={msg.variant === 'success' ? 'Prueba enviada' : msg.variant === 'info' ? 'Registrado en el servidor' : 'No se pudo enviar'}>
            {msg.text}
          </Alert>
        )}

        {!data ? (
          <p className="flex items-center gap-2 py-2 text-[12px] text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Cargando preferencias…
          </p>
        ) : (
          <>
            <div className="space-y-2">
              {ITEMS.map((item) => (
                <label
                  key={item.kind}
                  className={cn(
                    'flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors',
                    data.prefs[item.kind] ? 'border-emerald-500/25 bg-emerald-500/[0.05]' : 'border-white/[0.06] bg-white/[0.02]',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={data.prefs[item.kind]}
                    onChange={() => toggle(item.kind)}
                    disabled={busy === item.kind}
                    className="mt-0.5 size-4 accent-emerald-500"
                  />
                  <span>
                    <span className="block text-[13px] font-medium">{item.title}</span>
                    <span className="block text-[11.5px] text-muted-foreground">{item.desc}</span>
                  </span>
                </label>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={sendTest} disabled={busy === 'test'}>
                {busy === 'test' ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                Enviar correo de prueba
              </Button>
              <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <MailCheck className="size-3" />
                Anti-spam: como mucho un aviso de cada tipo cada pocas horas
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
