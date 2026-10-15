import { Compass, LifeBuoy, ListChecks } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { RestartTourButton } from '@/components/tour/guided-tour';
import { RestoreChecklistButton } from './restore-checklist-button';
import { TOUR_STEPS } from '@/lib/tour-steps';

/**
 * Bloque de ayuda de Configuración: volver a ver el tutorial y, de paso, saber
 * qué toca en cada pestaña. Es lo que enlaza el paso final del recorrido.
 */
export function HelpTourCard({
  completed,
  seenAt,
  checklistHidden = false,
}: {
  completed: boolean;
  seenAt: string | null;
  checklistHidden?: boolean;
}) {
  const fecha = seenAt ? new Date(seenAt).toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' }) : null;

  return (
    <Card data-tour="tour-help">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LifeBuoy className="size-4 text-sky-300" /> Ayuda y tutorial guiado
        </CardTitle>
        <CardDescription>
          {completed
            ? `Ya has visto el recorrido por la plataforma${fecha ? ` (${fecha})` : ''}. Aquí lo tienes cuando quieras: son ${TOUR_STEPS.length} pasos y no se vuelve a abrir solo.`
            : `El recorrido por la plataforma tiene ${TOUR_STEPS.length} pasos: te lleva pestaña por pestaña y te señala dónde tocar. Cuando lo cierres, no vuelve a aparecer solo.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <RestartTourButton scope="user" />
          {checklistHidden && <RestoreChecklistButton />}
        </div>
        <details className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2">
          <summary className="cursor-pointer text-[12.5px] text-muted-foreground">Ver los pasos del recorrido</summary>
          <ol className="mt-2 space-y-1.5">
            {TOUR_STEPS.map((step, i) => (
              <li key={step.id} className="flex gap-2 text-[12.5px] text-muted-foreground">
                <span className="w-4 shrink-0 text-right text-foreground/70">{i + 1}</span>
                <span>
                  <span className="text-foreground">{step.tab}</span> · {step.title}
                </span>
              </li>
            ))}
          </ol>
        </details>
        <p className="flex items-start gap-2 text-[11.5px] text-muted-foreground">
          <ListChecks className="mt-0.5 size-3.5 shrink-0" />
          La lista de <span className="text-foreground">«Tus primeros pasos»</span> de la portada se marca sola y desaparece cuando termines las cinco tareas
          {checklistHidden ? '. Ahora mismo está oculta: puedes recuperarla con el botón de arriba.' : '.'}
        </p>
        <p className="flex items-start gap-2 text-[11.5px] text-muted-foreground">
          <Compass className="mt-0.5 size-3.5 shrink-0" />
          El recorrido no cambia nada de tu cuenta: sólo te enseña. Puedes salir en cualquier momento con la tecla Escape o con «Saltar el tutorial».
        </p>
      </CardContent>
    </Card>
  );
}
