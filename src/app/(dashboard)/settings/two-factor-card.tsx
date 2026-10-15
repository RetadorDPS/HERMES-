'use client';

/**
 * Tarjeta de segundo factor (TOTP) para la página de configuración.
 * Todo se resuelve contra /api/security/totp: el QR se genera en el servidor
 * (SVG), así que no hace falta ninguna petición a Internet.
 */
import { useEffect, useState } from 'react';
import { CheckCircle2, Copy, Loader2, RefreshCw, ShieldCheck, ShieldOff } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';

interface Status {
  enabled: boolean;
  enabledAt: string | null;
  recoveryCodesLeft: number;
}

export function TwoFactorCard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Alta
  const [setup, setSetup] = useState<{ secret: string; uri: string; qrSvg: string } | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);

  const load = async () => {
    const res = await fetch('/api/security/totp');
    const data = await res.json();
    if (data.ok) setStatus({ enabled: data.enabled, enabledAt: data.enabledAt, recoveryCodesLeft: data.recoveryCodesLeft });
  };

  useEffect(() => {
    void load();
  }, []);

  const call = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/security/totp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error ?? 'No se pudo completar la operación');
        return null;
      }
      return data;
    } finally {
      setBusy(false);
    }
  };

  const startSetup = async () => {
    const data = await call({ action: 'setup' });
    if (data) setSetup({ secret: data.secret, uri: data.uri, qrSvg: data.qrSvg });
  };

  const confirmSetup = async () => {
    const data = await call({ action: 'enable', secret: setup?.secret, code });
    if (data) {
      setRecoveryCodes(data.recoveryCodes);
      setSetup(null);
      setCode('');
      setNotice(data.message);
      await load();
    }
  };

  const disable = async () => {
    const data = await call({ action: 'disable', password, code });
    if (data) {
      setNotice(data.message);
      setPassword('');
      setCode('');
      await load();
    }
  };

  const regenerate = async () => {
    const data = await call({ action: 'regenerate', password, code });
    if (data) {
      setRecoveryCodes(data.recoveryCodes);
      setNotice(data.message);
      setPassword('');
      setCode('');
      await load();
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setNotice('Copiado al portapapeles');
    } catch {
      setNotice('Copia manualmente el texto seleccionado');
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {status?.enabled ? <ShieldCheck className="size-4 text-emerald-300" /> : <ShieldOff className="size-4 text-amber-300" />}
          Segundo factor (2FA)
          {status?.enabled ? <Badge variant="success">Activo</Badge> : <Badge variant="warning">Desactivado</Badge>}
        </CardTitle>
        <CardDescription>
          Código de 6 dígitos de Google Authenticator, Authy, 1Password o Bitwarden. Recomendado antes de conectar cuentas de tienda y proveedores.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {error && <Alert variant="danger" title="No se pudo completar" onDismiss={() => setError(null)}>{error}</Alert>}
        {notice && <Alert variant="success" onDismiss={() => setNotice(null)}>{notice}</Alert>}

        {recoveryCodes && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.07] p-3">
            <p className="text-[13px] font-medium text-amber-100">Guarda estos códigos de recuperación</p>
            <p className="mt-1 text-[11.5px] text-muted-foreground">
              Se muestran una sola vez y cada uno sirve para un único acceso si pierdes el móvil. Guárdalos fuera de la aplicación.
            </p>
            <div className="mt-2 grid grid-cols-2 gap-1 font-mono text-[12px] sm:grid-cols-5">
              {recoveryCodes.map((c) => (
                <span key={c} className="rounded bg-black/30 px-2 py-1 text-center">{c}</span>
              ))}
            </div>
            <Button size="sm" variant="ghost" className="mt-2" onClick={() => copy(recoveryCodes.join('\n'))}>
              <Copy className="size-3.5" /> Copiar todos
            </Button>
          </div>
        )}

        {/* ── Activación ─────────────────────────────────────────────── */}
        {!status?.enabled && !setup && (
          <Button variant="gradient" onClick={startSetup} disabled={busy || !status}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
            Activar segundo factor
          </Button>
        )}

        {setup && (
          <div className="grid gap-4 sm:grid-cols-[auto_1fr] sm:items-start">
            <div className="rounded-xl border border-white/10 bg-white p-2" dangerouslySetInnerHTML={{ __html: setup.qrSvg }} />
            <div className="space-y-3">
              <p className="text-[12.5px] text-muted-foreground">
                Escanea el código con tu aplicación y escribe el código de 6 dígitos que genera. ¿No puedes escanear? Añade este secreto a mano:
              </p>
              <button
                type="button"
                onClick={() => copy(setup.secret)}
                className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-left font-mono text-[12px] break-all hover:border-indigo-400/40"
              >
                {setup.secret}
              </button>
              <div className="space-y-1.5">
                <Label htmlFor="totp-enable">Código de 6 dígitos</Label>
                <Input
                  id="totp-enable"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  inputMode="numeric"
                  placeholder="123456"
                  className="max-w-[160px] font-mono tracking-[0.3em]"
                />
              </div>
              <div className="flex gap-2">
                <Button onClick={confirmSetup} disabled={busy || code.replace(/\D/g, '').length !== 6}>
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                  Confirmar y activar
                </Button>
                <Button variant="ghost" onClick={() => { setSetup(null); setCode(''); }} disabled={busy}>
                  Cancelar
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* ── Gestión con 2FA activo ─────────────────────────────────── */}
        {status?.enabled && (
          <div className="space-y-3">
            <p className="text-[12.5px] text-muted-foreground">
              Activado el {status.enabledAt ? new Date(status.enabledAt).toLocaleDateString('es-ES') : '—'} · códigos de recuperación
              disponibles: <strong>{status.recoveryCodesLeft}</strong>
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="totp-password">Contraseña</Label>
                <Input id="totp-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="totp-code">Código del autenticador</Label>
                <Input id="totp-code" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" placeholder="123456" className="font-mono" />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={regenerate} disabled={busy || !password || !code}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                Renovar códigos de recuperación
              </Button>
              <Button variant="ghost" className="text-rose-300 hover:text-rose-200" onClick={disable} disabled={busy || !password || !code}>
                <ShieldOff className="size-4" />
                Desactivar 2FA
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
