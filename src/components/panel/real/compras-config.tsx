'use client';

/**
 * Configuración de las compras al proveedor: modo y topes. Por defecto «Simulación» (no compra nada).
 * El servidor valida todo otra vez (el modo automático exige 3 compras reales hechas con tu aprobación).
 */
import { useEffect, useState } from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { llamarCompras, type ConfigComprasVista, type ModoCompras } from '@/lib/real/compras';

const MODOS: { id: ModoCompras; nombre: string; detalle: string }[] = [
  { id: 'APAGADO', nombre: 'Apagado', detalle: 'No se hace nada con los pedidos.' },
  { id: 'SIMULACION', nombre: 'Simulación', detalle: 'Se comprueba todo y se anota lo que se compraría, pero NO se llama al proveedor.' },
  { id: 'MANUAL', nombre: 'Manual', detalle: 'Cada compra se hace con tu botón «Aprobar y comprar». El pedido se crea en CJ sin pagar; el pago lo haces tú.' },
  { id: 'AUTOMATICO', nombre: 'Automático', detalle: 'Solo se puede activar después de 3 compras reales hechas con tu aprobación.' },
];

export function ComprasConfig({ alCambiar }: { alCambiar?: (modo: ModoCompras) => void }) {
  const [estado, setEstado] = useState<'cargando' | 'listo' | 'pendiente' | 'error'>('cargando');
  const [config, setConfig] = useState<ConfigComprasVista | null>(null);
  const [hechas, setHechas] = useState(0);
  const [mensaje, setMensaje] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    let vivo = true;
    llamarCompras<{ config: ConfigComprasVista; comprasRealesHechas: number }>({ accion: 'config_obtener' })
      .then((r) => {
        if (!vivo) return;
        setConfig(r.config);
        setHechas(r.comprasRealesHechas);
        setEstado('listo');
        alCambiar?.(r.config.modo);
      })
      .catch((e) => {
        if (!vivo) return;
        setEstado(e?.codigo === 'tablas_pendientes' ? 'pendiente' : 'error');
        setMensaje({ tipo: 'error', texto: (e as Error).message });
      });
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function guardar() {
    if (!config) return;
    setGuardando(true);
    setMensaje(null);
    try {
      const r = await llamarCompras<{ config: ConfigComprasVista; comprasRealesHechas: number }>({ accion: 'config_guardar', config });
      setConfig(r.config);
      setHechas(r.comprasRealesHechas);
      setMensaje({ tipo: 'ok', texto: 'Configuración guardada.' });
      alCambiar?.(r.config.modo);
    } catch (e) {
      setMensaje({ tipo: 'error', texto: (e as Error).message });
      // El servidor rechazó el cambio: se vuelve a enseñar lo que de verdad está guardado
      llamarCompras<{ config: ConfigComprasVista }>({ accion: 'config_obtener' }).then((r) => setConfig(r.config)).catch(() => undefined);
    } finally {
      setGuardando(false);
    }
  }

  const numero = (clave: 'limitePedidoUsd' | 'limiteDiaUsd' | 'subidaMaxPct', etiqueta: string, sufijo: string) => (
    <label className="block text-[12px]">
      <span className="text-muted-foreground">{etiqueta}</span>
      <span className="mt-1 flex items-center gap-1.5">
        <input
          type="number"
          min={0}
          step="any"
          inputMode="decimal"
          value={config?.[clave] ?? 0}
          onChange={(e) => setConfig((c) => (c ? { ...c, [clave]: Number(e.target.value) } : c))}
          className="h-9 w-full min-w-0 rounded-md border border-white/10 bg-white/[0.04] px-2.5 text-[13px] tabular-nums outline-none focus:border-indigo-400/50"
        />
        <span className="shrink-0 text-muted-foreground">{sufijo}</span>
      </span>
    </label>
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-[13px]">
          <ShieldCheck className="size-4 text-indigo-300" /> Compras al proveedor
        </CardTitle>
        <CardDescription>Tú decides si se compra, cuánto como máximo y con qué aprobación. Empieza en Simulación.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {estado === 'cargando' && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        {estado === 'pendiente' && (
          <Alert variant="warning" title="Falta preparar la base de datos">
            Las tablas de compras todavía no están creadas. Hasta entonces los pedidos se pueden ver, pero no simular ni comprar.
          </Alert>
        )}
        {estado === 'error' && mensaje && <Alert variant="danger" title="No se pudo leer la configuración">{mensaje.texto}</Alert>}
        {estado === 'listo' && config && (
          <>
            <div className="grid gap-2 sm:grid-cols-2">
              {MODOS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setConfig({ ...config, modo: m.id })}
                  className={`rounded-xl border p-3 text-left transition-colors ${config.modo === m.id ? 'border-indigo-400/60 bg-indigo-500/10' : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]'}`}
                >
                  <span className="block text-[13px] font-medium">{m.nombre}</span>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">{m.detalle}</span>
                </button>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {numero('limitePedidoUsd', 'Tope por pedido', 'US$')}
              {numero('limiteDiaUsd', 'Tope por día', 'US$')}
              {numero('subidaMaxPct', 'Subida máxima del costo', '%')}
            </div>
            <p className="text-[11px] text-muted-foreground">Compras reales hechas con tu aprobación: {hechas}. Si el costo del proveedor sube más del porcentaje indicado, no se compra.</p>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={guardar} disabled={guardando}>
                {guardando && <Loader2 className="size-4 animate-spin" />} Guardar
              </Button>
              {mensaje && <span className={`text-[12px] ${mensaje.tipo === 'ok' ? 'text-emerald-300' : 'text-red-300'}`}>{mensaje.texto}</span>}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
