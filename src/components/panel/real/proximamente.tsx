'use client';

import type { LucideIcon } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PantallaReal } from './comun';

/** Pantalla que todavía no está conectada a datos reales: dice con claridad qué hará y qué falta. */
export function Proximamente({
  titulo,
  subtitulo,
  icono: Icono,
  queHara,
  queFalta,
}: {
  titulo: string;
  subtitulo: string;
  icono: LucideIcon;
  queHara: string[];
  queFalta: string;
}) {
  return (
    <PantallaReal titulo={titulo} subtitulo={subtitulo}>
      <Alert variant="info" title="Esta sección se conecta en una fase próxima">
        {queFalta}
      </Alert>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Icono className="size-4 text-indigo-300" />
            Qué hará
          </CardTitle>
          <CardDescription>Cuando esté conectada, aquí podrás:</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-[13px] text-muted-foreground">
            {queHara.map((t) => (
              <li key={t} className="flex gap-2">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-indigo-400" />
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </PantallaReal>
  );
}
