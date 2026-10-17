'use client';

/**
 * Aviso para instalar la app (PWA).
 *  - Se muestra cada vez que se entra MIENTRAS la app no esté instalada.
 *  - «Ahora no» solo lo oculta durante la visita actual; la próxima vez vuelve a salir.
 *  - Una vez instalada (o abierta como app instalada) ya no vuelve a salir.
 *  - Android/ordenador (Chrome, Edge…): botón «Instalar» con el aviso oficial del navegador.
 *  - iPhone/iPad: Apple no permite el botón; se explican los pasos («Compartir» → «Añadir a pantalla de inicio»).
 */
import { useEffect, useState } from 'react';
import { Download, Share, SquarePlus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { conBase } from '@/lib/ruta';

interface EventoInstalacion extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const CLAVE_INSTALADA = 'dsp-pwa-instalada';
const CLAVE_OCULTO = 'dsp-pwa-aviso-oculto';

const leer = (almacen: 'localStorage' | 'sessionStorage', clave: string): string | null => {
  try {
    return window[almacen].getItem(clave);
  } catch {
    return null;
  }
};
const guardar = (almacen: 'localStorage' | 'sessionStorage', clave: string, valor: string) => {
  try {
    window[almacen].setItem(clave, valor);
  } catch {
    /* sin almacenamiento: el aviso simplemente volverá a salir */
  }
};

const abiertaComoApp = (): boolean =>
  window.matchMedia('(display-mode: standalone)').matches ||
  window.matchMedia('(display-mode: fullscreen)').matches ||
  window.matchMedia('(display-mode: minimal-ui)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

const esApple = (): boolean =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function AvisoInstalar() {
  const [evento, setEvento] = useState<EventoInstalacion | null>(null);
  const [apple, setApple] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (abiertaComoApp()) {
      guardar('localStorage', CLAVE_INSTALADA, '1'); // quien la abre como app ya la tiene instalada
      return;
    }
    if (leer('sessionStorage', CLAVE_OCULTO) === '1') return;

    const alInstalar = () => {
      guardar('localStorage', CLAVE_INSTALADA, '1');
      setVisible(false);
      setEvento(null);
    };
    const alOfrecer = (e: Event) => {
      e.preventDefault();
      // Si el navegador vuelve a ofrecerla, es que ya no está instalada: se retira la marca antigua.
      try {
        window.localStorage.removeItem(CLAVE_INSTALADA);
      } catch {
        /* nada */
      }
      setEvento(e as EventoInstalacion);
      setVisible(true);
    };
    window.addEventListener('beforeinstallprompt', alOfrecer);
    window.addEventListener('appinstalled', alInstalar);

    let temporizador: ReturnType<typeof setTimeout> | undefined;
    if (esApple() && leer('localStorage', CLAVE_INSTALADA) !== '1') {
      setApple(true);
      temporizador = setTimeout(() => setVisible(true), 2500);
    }
    return () => {
      window.removeEventListener('beforeinstallprompt', alOfrecer);
      window.removeEventListener('appinstalled', alInstalar);
      if (temporizador) clearTimeout(temporizador);
    };
  }, []);

  const ocultar = () => {
    guardar('sessionStorage', CLAVE_OCULTO, '1');
    setVisible(false);
  };

  const instalar = async () => {
    if (!evento) return;
    await evento.prompt();
    const eleccion = await evento.userChoice;
    setEvento(null);
    if (eleccion.outcome === 'accepted') {
      guardar('localStorage', CLAVE_INSTALADA, '1');
      setVisible(false);
    } else {
      ocultar();
    }
  };

  if (!visible || (!evento && !apple)) return null;

  return (
    <div
      role="dialog"
      aria-label="Instalar DropshipPilot"
      data-aviso-instalar
      className="fixed inset-x-3 bottom-3 z-40 mx-auto max-w-md rounded-2xl border border-white/10 bg-[#11142099] p-4 shadow-2xl shadow-black/50 backdrop-blur-xl pb-[max(1rem,env(safe-area-inset-bottom))] sm:left-auto sm:right-4 sm:bottom-4 sm:mx-0"
      style={{ backgroundColor: 'rgba(17, 20, 32, 0.96)' }}
    >
      <div className="flex items-start gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={conBase('/iconos/icono-192.png')} alt="" width={44} height={44} className="size-11 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Instala DropshipPilot en tu dispositivo</p>
          {evento ? (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Ábrela como una app, a pantalla completa y con su propio icono. No ocupa casi espacio.
            </p>
          ) : (
            <ol className="mt-1 space-y-1 text-xs text-muted-foreground">
              <li>
                1. Pulsa <Share className="mx-0.5 inline size-3.5 align-text-bottom" aria-hidden /> <b>Compartir</b> en la barra de Safari.
              </li>
              <li>
                2. Elige <SquarePlus className="mx-0.5 inline size-3.5 align-text-bottom" aria-hidden /> <b>Añadir a pantalla de inicio</b>.
              </li>
            </ol>
          )}
        </div>
        <button
          type="button"
          onClick={ocultar}
          aria-label="Cerrar aviso"
          className="-mr-1 -mt-1 rounded-md p-1 text-muted-foreground hover:bg-white/10 hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        {evento ? (
          <>
            <Button variant="ghost" size="sm" onClick={ocultar}>
              Ahora no
            </Button>
            <Button variant="gradient" size="sm" onClick={instalar}>
              <Download /> Instalar
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" size="sm" onClick={ocultar}>
              Ahora no
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                guardar('localStorage', CLAVE_INSTALADA, '1');
                setVisible(false);
              }}
            >
              Ya la instalé
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
