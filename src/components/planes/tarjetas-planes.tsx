'use client';

/**
 * Tarjetas de planes (DropshipPilot solo y conjuntos con Retador). Las usan «Elige tu plan» y Facturación.
 * Los datos salen de `src/lib/planes-catalogo.ts` (una sola fuente). Nada se promete que el servidor no aplique.
 */
import { useState } from 'react';
import { Check, ExternalLink, Layers, Loader2, Rocket, Sparkles, Store, Wrench } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { PLANES_CONJUNTOS, PLANES_SOLO, precioDelCiclo, type CicloPlan, type PlanTarjeta } from '@/lib/planes-catalogo';

type Vista = 'conjunto' | 'solo';

const fmt = (n: number) => n.toLocaleString('es-ES', { maximumFractionDigits: 0 });

interface Props {
  /** «elegir»: paso obligatorio tras registrarse. «facturacion»: pantalla del plan. */
  modo: 'elegir' | 'facturacion';
  /** Nombre del plan de herramientas actual (Prueba, Starter, Pro, A medida) para marcar «Tu plan». */
  planActual?: string;
  alEmpezarGratis?: () => void;
  ocupado?: boolean;
}

export function TarjetasPlanes({ modo, planActual, alEmpezarGratis, ocupado }: Props) {
  const [vista, setVista] = useState<Vista>('conjunto');
  const [ciclo, setCiclo] = useState<CicloPlan>('mensual');
  const planes = vista === 'conjunto' ? PLANES_CONJUNTOS : PLANES_SOLO;

  return (
    <div className="space-y-5">
      {/* Selectores */}
      <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-between">
        <div role="tablist" aria-label="Tipo de plan" className="inline-flex rounded-xl border border-white/10 bg-white/[0.03] p-1 text-[13px]">
          <button
            role="tab"
            aria-selected={vista === 'conjunto'}
            onClick={() => setVista('conjunto')}
            className={cn('flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium transition-colors', vista === 'conjunto' ? 'bg-indigo-500/25 text-indigo-100' : 'text-muted-foreground hover:text-foreground')}
          >
            <Layers className="size-3.5" /> Conjunto con Retador
          </button>
          <button
            role="tab"
            aria-selected={vista === 'solo'}
            onClick={() => setVista('solo')}
            className={cn('flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium transition-colors', vista === 'solo' ? 'bg-indigo-500/25 text-indigo-100' : 'text-muted-foreground hover:text-foreground')}
          >
            <Wrench className="size-3.5" /> Solo DropshipPilot
          </button>
        </div>
        <div role="group" aria-label="Ciclo de pago" className="inline-flex items-center gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1 text-[13px]">
          {(['mensual', 'anual'] as const).map((c) => (
            <button
              key={c}
              onClick={() => setCiclo(c)}
              aria-pressed={ciclo === c}
              className={cn('rounded-lg px-3 py-1.5 font-medium transition-colors', ciclo === c ? 'bg-white/10 text-foreground' : 'text-muted-foreground hover:text-foreground')}
            >
              <span className="capitalize">{c}</span>
              {c === 'anual' && <span className="ml-1.5 rounded-full bg-emerald-400/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">2 meses gratis</span>}
            </button>
          ))}
        </div>
      </div>

      <p className="text-center text-[13px] text-muted-foreground sm:text-left">
        {vista === 'conjunto'
          ? 'Un solo plan, una sola cuenta y un solo pago para tu tienda de Retador y tus herramientas de DropshipPilot. Más barato que contratarlos por separado.'
          : 'Si ya tienes tu tienda y solo quieres las herramientas de DropshipPilot, contrata solo este plan: cada app cobra lo suyo.'}
      </p>

      {/* Tarjetas */}
      <div className={cn('grid gap-4', planes.length === 4 ? 'sm:grid-cols-2 xl:grid-cols-4' : 'md:grid-cols-3')}>
        {planes.map((p) => (
          <TarjetaPlan key={`${vista}-${p.id}`} plan={p} vista={vista} ciclo={ciclo} modo={modo} esActual={Boolean(planActual) && p.herramientas.plan === planActual && (p.precioMensual === 0 || modo === 'facturacion')} alEmpezarGratis={alEmpezarGratis} ocupado={ocupado} />
        ))}
      </div>

      <p className="text-center text-[11.5px] text-muted-foreground">
        Precios en USD, sin permanencia. El plan anual equivale a 10 mensualidades. Los límites de fichas y cotizaciones se cuentan en el servidor y se renuevan cada mes
        {vista === 'conjunto' ? '; el número de productos lo fija y lo aplica Retador' : ''}.
      </p>
    </div>
  );
}

function TarjetaPlan({ plan, vista, ciclo, modo, esActual, alEmpezarGratis, ocupado }: { plan: PlanTarjeta; vista: Vista; ciclo: CicloPlan; modo: Props['modo']; esActual: boolean; alEmpezarGratis?: () => void; ocupado?: boolean }) {
  const gratis = plan.precioMensual === 0;
  const conPrecio = typeof plan.precioMensual === 'number' && plan.precioMensual > 0;
  const precio = conPrecio ? precioDelCiclo(plan.precioMensual as number, ciclo) : null;
  const Icono = gratis ? Sparkles : plan.destacado ? Rocket : Store;

  return (
    <div
      className={cn(
        'relative flex flex-col rounded-2xl border p-5 shadow-lg transition-transform hover:-translate-y-0.5',
        plan.destacado ? 'border-indigo-400/50 bg-gradient-to-b from-indigo-500/[0.14] to-white/[0.02] shadow-indigo-500/10' : 'border-white/10 bg-white/[0.03]',
      )}
    >
      {plan.etiqueta && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 px-3 py-1 text-[11px] font-semibold text-white shadow-md">{plan.etiqueta}</span>
      )}
      <div className="flex items-center gap-2">
        <span className={cn('grid size-8 place-items-center rounded-lg', plan.destacado ? 'bg-indigo-400/25 text-indigo-100' : 'bg-white/[0.06] text-indigo-200')}>
          <Icono className="size-4" />
        </span>
        <h3 className="text-base font-semibold">{plan.nombre}</h3>
        {esActual && <Badge variant="success" className="ml-auto">Tu plan</Badge>}
      </div>
      <p className="mt-2 min-h-[2.5rem] text-[12.5px] leading-snug text-muted-foreground">{plan.lema}</p>

      {/* Precio */}
      <div className="mt-3 min-h-[4.25rem]">
        {gratis ? (
          <p className="text-3xl font-bold tracking-tight">0 <span className="text-base font-medium text-muted-foreground">USD</span></p>
        ) : precio ? (
          <>
            <p className="text-3xl font-bold tracking-tight">
              {fmt(precio.importe)} <span className="text-base font-medium text-muted-foreground">USD {precio.periodo}</span>
            </p>
            <p className="mt-0.5 text-[12px] text-emerald-300">{precio.ahorro ? `${precio.ahorro} · equivale a ${fmt((plan.precioMensual as number) * 10 / 12)} USD al mes` : 'Cancela cuando quieras'}</p>
          </>
        ) : (
          <p className="text-lg font-semibold text-amber-200">{plan.sinPrecio ?? 'Precio por confirmar'}</p>
        )}
      </div>

      {/* Qué incluye */}
      <div className="mt-3 space-y-2 border-t border-white/[0.07] pt-3 text-[12.5px]">
        {plan.retador && (
          <div className="rounded-lg bg-white/[0.04] p-2.5">
            <p className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">En Retador · plan {plan.retador.plan}</p>
            <p className="mt-0.5 font-medium">{plan.retador.productos}</p>
          </div>
        )}
        <div className="rounded-lg bg-white/[0.04] p-2.5">
          <p className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">En DropshipPilot{vista === 'conjunto' ? ` · herramientas ${plan.herramientas.plan}` : ''}</p>
          <p className="mt-0.5 font-medium">{plan.herramientas.fichas}</p>
          <p className="font-medium">{plan.herramientas.envios}</p>
        </div>
      </div>
      <ul className="mt-3 flex-1 space-y-1.5 text-[12.5px]">
        {plan.ventajas.map((v) => (
          <li key={v} className="flex items-start gap-2 text-muted-foreground">
            <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-300" />
            <span>{v}</span>
          </li>
        ))}
      </ul>

      {/* Acción */}
      <div className="mt-4">
        {gratis ? (
          modo === 'elegir' ? (
            <Button variant="gradient" className="w-full" disabled={ocupado} onClick={alEmpezarGratis}>
              {ocupado && <Loader2 className="size-4 animate-spin" />} Empezar gratis
            </Button>
          ) : (
            <Button variant="outline" className="w-full" disabled>{esActual ? 'Es tu plan actual' : 'Incluido'}</Button>
          )
        ) : vista === 'conjunto' ? (
          <Button asChild variant={plan.destacado ? 'gradient' : 'outline'} className="w-full">
            <a href="https://retadormarketplace.es/" target="_blank" rel="noopener noreferrer">
              Contratar en Retador <ExternalLink className="size-3.5" />
            </a>
          </Button>
        ) : (
          <Button variant="outline" className="w-full" disabled>Muy pronto</Button>
        )}
        {!gratis && vista === 'conjunto' && <p className="mt-1.5 text-center text-[11px] text-muted-foreground">Después, vincula tu cuenta y el plan llega solo.</p>}
        {!gratis && vista === 'solo' && <p className="mt-1.5 text-center text-[11px] text-muted-foreground">Activaremos los cobros de estos planes muy pronto.</p>}
      </div>
    </div>
  );
}
