'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Topbar } from '@/components/layout/topbar';

/** Carga de datos reales con estado de «cargando» y de error, y opción de recargar. */
export function useCarga<T>(cargar: () => Promise<T>) {
  const [datos, setDatos] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const ref = useRef(cargar);
  ref.current = cargar;

  const recargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      setDatos(await ref.current());
    } catch (e) {
      setError((e as Error).message || 'No se pudieron cargar los datos');
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void recargar();
  }, [recargar]);

  return { datos, error, cargando, recargar };
}

/** Marco de una pantalla real: barra superior + contenido con estados de carga y error. */
export function PantallaReal({
  titulo,
  subtitulo,
  cargando,
  error,
  alRecargar,
  children,
  tour,
}: {
  titulo: string;
  subtitulo?: string;
  cargando?: boolean;
  error?: string | null;
  alRecargar?: () => void;
  children?: ReactNode;
  tour?: string;
}) {
  return (
    <>
      <Topbar title={titulo} subtitle={subtitulo} mode="postgres" />
      <div data-tour={tour} className="space-y-3 py-3">
        {error && (
          <Alert variant="danger" title="No se pudieron cargar los datos">
            <p>{error}</p>
            {alRecargar && (
              <Button size="sm" variant="outline" className="mt-2" onClick={alRecargar}>
                <RefreshCw className="size-3.5" />
                Reintentar
              </Button>
            )}
          </Alert>
        )}
        {cargando && !error ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Cargando tus datos…
          </div>
        ) : (
          !error && children
        )}
      </div>
    </>
  );
}
