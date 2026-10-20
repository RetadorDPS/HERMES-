'use client';

/**
 * Elegir dónde publicar un producto.
 *
 * DropshipPilot no es solo de Retador: el usuario elige el destino cada vez. Hoy solo la publicación en Retador está construida;
 * Shopify y WooCommerce salen en la lista (para que el sitio ya esté preparado) pero marcados como «aún no disponible»,
 * sin simular nada ni dejar pulsarlos.
 */
import { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, Store, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { obtenerTiendaRetador } from '@/lib/real/retador';
import { cn } from '@/lib/utils';

export type DestinoPublicacion = 'RETADOR';

interface OpcionDestino {
  id: 'RETADOR' | 'SHOPIFY' | 'WOOCOMMERCE';
  nombre: string;
  detalle: string;
  disponible: boolean;
}

const OPCIONES: OpcionDestino[] = [
  { id: 'RETADOR', nombre: 'Retador', detalle: 'Publica en tu tienda de Retador. El envío a sus compradores lo cotiza Retador.', disponible: true },
  { id: 'SHOPIFY', nombre: 'Shopify', detalle: 'La publicación en Shopify todavía no está disponible.', disponible: false },
  { id: 'WOOCOMMERCE', nombre: 'WooCommerce', detalle: 'La publicación en WooCommerce todavía no está disponible.', disponible: false },
];

export function ElegirDestino({ titulo, onElegir, onClose }: { titulo: string; onElegir: (destino: DestinoPublicacion) => void; onClose: () => void }) {
  // Estado de la tienda de Retador del usuario (solo informativo: la conexión se pide después, al publicar)
  const [retador, setRetador] = useState<'cargando' | 'conectada' | 'sin_conectar' | 'desconocido'>('cargando');

  useEffect(() => {
    let vivo = true;
    obtenerTiendaRetador()
      .then((t) => vivo && setRetador(t && t.status === 'CONNECTED' ? 'conectada' : 'sin_conectar'))
      .catch(() => vivo && setRetador('desconocido'));
    return () => {
      vivo = false;
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Elegir dónde publicar">
      <div className="flex max-h-[94vh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl border border-white/10 bg-[#0e1220] shadow-2xl sm:rounded-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-white/[0.07] px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">¿Dónde quieres publicarlo?</h2>
            <p className="truncate text-[12px] text-muted-foreground">{titulo}</p>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="rounded-md p-1 text-muted-foreground hover:bg-white/10 hover:text-foreground">
            <X className="size-4" />
          </button>
        </header>

        <ul className="space-y-2 overflow-y-auto px-4 py-3">
          {OPCIONES.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                disabled={!o.disponible}
                onClick={() => o.id === 'RETADOR' && onElegir('RETADOR')}
                className={cn(
                  'flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors',
                  o.disponible ? 'border-white/10 bg-white/[0.03] hover:border-indigo-400/40 hover:bg-white/[0.06]' : 'cursor-not-allowed border-white/[0.05] bg-white/[0.01] opacity-60',
                )}
              >
                <Store className="mt-0.5 size-4 shrink-0 text-indigo-300" />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2 text-[13px] font-medium">
                    {o.nombre}
                    {o.id === 'RETADOR' && retador === 'cargando' && <Loader2 className="size-3 animate-spin text-muted-foreground" />}
                    {o.id === 'RETADOR' && retador === 'conectada' && (
                      <Badge variant="success" className="gap-1">
                        <CheckCircle2 className="size-3" /> Conectada
                      </Badge>
                    )}
                    {o.id === 'RETADOR' && retador === 'sin_conectar' && <Badge variant="outline">Sin conectar todavía</Badge>}
                    {!o.disponible && <Badge variant="outline">Aún no disponible</Badge>}
                  </span>
                  <span className="mt-0.5 block text-[12px] text-muted-foreground">{o.detalle}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>

        <p className="border-t border-white/[0.07] px-4 py-2.5 text-[11px] text-muted-foreground">Elegirás el destino cada vez que publiques. Los demás aparecerán aquí cuando estén listos.</p>
      </div>
    </div>
  );
}
