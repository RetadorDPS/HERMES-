'use client';

/**
 * Botones de los derechos del cliente sobre sus datos (RGPD):
 *   • Descargar todo lo que la plataforma guarda de él (JSON).
 *   • Borrar la cuenta y sus datos, con confirmación escrita y contraseña.
 *
 * El borrado es irreversible y por eso está detrás de dos barreras: hay que
 * escribir la frase exacta y, si la cuenta tiene contraseña, teclearla.
 */
import { useState } from 'react';
import { AlertTriangle, Download, Loader2, ShieldCheck, Trash2 } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

const CONFIRMATION = 'BORRAR MI CUENTA';

export function DataRightsCard({ email, hasPassword }: { email: string; hasPassword: boolean }) {
  const [busy, setBusy] = useState<'export' | 'delete' | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; title: string; text: string } | null>(null);
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [password, setPassword] = useState('');

  const exportData = async () => {
    setBusy('export');
    setMessage(null);
    try {
      const res = await fetch('/api/account/export', { cache: 'no-store' });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setMessage({ ok: false, title: 'No se ha podido preparar la descarga', text: json.error ?? `HTTP ${res.status}` });
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `mis-datos-dropshippilot-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setMessage({
        ok: true,
        title: 'Descarga preparada',
        text: 'El fichero incluye cuenta, tiendas, productos, pedidos, precios, proveedores e historial. Las credenciales van enmascaradas a propósito.',
      });
    } finally {
      setBusy(null);
    }
  };

  const deleteAccount = async () => {
    setBusy('delete');
    setMessage(null);
    try {
      const res = await fetch('/api/account', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm, password }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        setMessage({ ok: false, title: 'No se ha borrado nada', text: json.error ?? `HTTP ${res.status}` });
        return;
      }
      setMessage({
        ok: true,
        title: 'Cuenta borrada',
        text: `${json.message ?? ''} ${json.subscriptions?.length ? `Suscripciones: ${json.subscriptions.join(' · ')}.` : ''} ${
          json.warnings?.length ? `Avisos: ${json.warnings.join(' · ')}` : ''
        }`.trim(),
      });
      setOpen(false);
      // La sesión ya no sirve: se recarga para volver al acceso
      setTimeout(() => window.location.assign('/login'), 2500);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-emerald-400" /> Tus datos y tu cuenta
        </CardTitle>
        <CardDescription>
          Puedes llevarte todo lo que guardamos de ti cuando quieras, y borrar la cuenta por tu cuenta sin escribir a nadie. Es lo que exige el RGPD
          (acceso, portabilidad y supresión) y lo que nos gusta poder decir sin letra pequeña.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {message && (
          <Alert variant={message.ok ? 'success' : 'danger'} title={message.title} onDismiss={() => setMessage(null)}>
            {message.text}
          </Alert>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => void exportData()} disabled={busy !== null}>
            {busy === 'export' ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />} Descargar mis datos (JSON)
          </Button>
          {!open && (
            <Button variant="ghost" className="text-red-300 hover:text-red-200" onClick={() => setOpen(true)} disabled={busy !== null}>
              <Trash2 className="size-4" /> Borrar mi cuenta
            </Button>
          )}
        </div>

        {open && (
          <div className="space-y-3 rounded-lg border border-red-500/30 bg-red-500/[0.06] p-3">
            <div className="flex items-start gap-2 text-[12.5px] text-red-200">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <div>
                <p className="font-medium">Esto no se puede deshacer.</p>
                <p className="mt-0.5 text-red-200/80">
                  Se borran la cuenta <span className="font-mono">{email}</span>, sus tiendas conectadas, productos, pedidos, reglas de precio, cuentas de
                  proveedor y la suscripción (si la hubiera, se cancela antes de borrar). Queda un registro anónimo en la auditoría de que pediste el
                  borrado.
                </p>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <label className="text-[12px] text-muted-foreground">
                Escribe <span className="font-mono text-foreground">{CONFIRMATION}</span>
                <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={CONFIRMATION} className="mt-1" />
              </label>
              {hasPassword && (
                <label className="text-[12px] text-muted-foreground">
                  Tu contraseña
                  <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className="mt-1" />
                </label>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="destructive"
                disabled={busy !== null || confirm.trim().toUpperCase() !== CONFIRMATION || (hasPassword && !password)}
                onClick={() => void deleteAccount()}
              >
                {busy === 'delete' ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />} Borrar definitivamente
              </Button>
              <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy !== null}>
                Cancelar
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
