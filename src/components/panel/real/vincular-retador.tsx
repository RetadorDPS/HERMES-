'use client';

/**
 * «Vincular con Retador»: para quien usa las dos apps, Retador y DropshipPilot son UNA sola plataforma. No hay claves que pegar:
 * se pulsa el botón, se confirma, se aprueba en Retador y se vuelve ya vinculado. Este bloque lo usan la tarjeta de Retador (Tiendas)
 * y la pantalla de publicar cuando todavía no hay cuenta vinculada.
 */
import { useCallback, useEffect, useState } from 'react';
import { Loader2, PlugZap } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { sinBase } from '@/lib/ruta';
import {
  cancelarVinculo,
  confirmarVinculo,
  iniciarVinculo,
  recordarVolver,
  vinculoInfo,
  type VinculoPendiente,
} from '@/lib/real/retador';

export function BloqueVincular({ alVincular }: { alVincular?: () => void | Promise<void> }) {
  const [info, setInfo] = useState<{ disponible: boolean; pendiente: VinculoPendiente | null } | null>(null);
  const [preguntando, setPreguntando] = useState(false);
  const [ocupado, setOcupado] = useState<'ir' | 'confirmar' | 'cancelar' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      setInfo(await vinculoInfo());
    } catch (e) {
      // Si el servidor todavía no conoce la vinculación, no es un fallo de la persona: se dice «muy pronto»
      if ((e as { codigo?: string }).codigo !== 'accion_desconocida') setError((e as Error).message);
      setInfo({ disponible: false, pendiente: null });
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function ir() {
    setOcupado('ir');
    setError(null);
    try {
      const { url } = await iniciarVinculo();
      recordarVolver(`${sinBase(window.location.pathname)}${window.location.search}`);
      window.location.assign(url);
    } catch (e) {
      setError((e as Error).message);
      setOcupado(null);
    }
  }

  async function confirmar(id: string) {
    setOcupado('confirmar');
    setError(null);
    try {
      await confirmarVinculo(id);
      await alVincular?.();
    } catch (e) {
      setError((e as Error).message);
      await cargar();
    } finally {
      setOcupado(null);
    }
  }

  async function cancelar(id: string) {
    setOcupado('cancelar');
    setError(null);
    try {
      await cancelarVinculo(id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      await cargar();
      setOcupado(null);
    }
  }

  if (!info) {
    return (
      <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> Comprobando…
      </p>
    );
  }

  const p = info.pendiente;
  return (
    <div className="space-y-3">
      {error && <Alert variant="danger">{error}</Alert>}

      {p ? (
        <div className="space-y-2 rounded-lg border border-indigo-400/25 bg-indigo-400/[0.06] p-3">
          <p className="text-[13px] font-medium">
            Vincular con la cuenta de Retador de {p.emailRetador ?? 'tu cuenta'}
          </p>
          {!p.emailCoincide && p.emailRetador && (
            <Alert variant="warning" title="El correo no es el mismo">
              Tu cuenta de Retador usa otro correo ({p.emailRetador}) distinto del de esta cuenta. Si es tuya, confírmalo; si no, cancela.
            </Alert>
          )}
          <p className="text-[12px] text-muted-foreground">
            Podrás publicar y mantener al día tus productos desde aquí y ver tus pedidos. Puedes desvincular cuando quieras.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="gradient" disabled={!!ocupado} onClick={() => void confirmar(p.id)}>
              {ocupado === 'confirmar' ? <Loader2 className="animate-spin" /> : <PlugZap />} Confirmar
            </Button>
            <Button size="sm" variant="outline" disabled={!!ocupado} onClick={() => void cancelar(p.id)}>
              {ocupado === 'cancelar' && <Loader2 className="animate-spin" />} Cancelar
            </Button>
          </div>
        </div>
      ) : !info.disponible ? (
        <div className="space-y-2">
          <Button size="sm" variant="gradient" disabled>
            <PlugZap /> Vincular con Retador
          </Button>
          <p className="text-[12px] text-muted-foreground">Vincular con Retador estará disponible muy pronto.</p>
        </div>
      ) : preguntando ? (
        <div className="space-y-2 rounded-lg border border-white/10 bg-white/[0.03] p-3">
          <p className="text-[13px] font-medium">¿Vincular tu cuenta de DropshipPilot con Retador?</p>
          <p className="text-[12px] text-muted-foreground">
            Irás a Retador, entrarás con tu cuenta y aprobarás. Después volverás aquí ya vinculado, sin copiar ninguna clave.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="gradient" disabled={!!ocupado} onClick={() => void ir()}>
              {ocupado === 'ir' ? <Loader2 className="animate-spin" /> : <PlugZap />} Sí, vincular
            </Button>
            <Button size="sm" variant="outline" disabled={!!ocupado} onClick={() => setPreguntando(false)}>
              No
            </Button>
          </div>
        </div>
      ) : (
        <Button size="sm" variant="gradient" onClick={() => setPreguntando(true)}>
          <PlugZap /> Vincular con Retador
        </Button>
      )}
    </div>
  );
}
