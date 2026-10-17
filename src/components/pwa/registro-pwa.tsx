'use client';

/**
 * Registra el service worker de la PWA (solo en producción). La versión viaja en la dirección
 * (sw.js?v=NN) para que cada publicación nueva instale un worker nuevo y limpie las cachés viejas.
 */
import { useEffect } from 'react';
import { conBase } from '@/lib/ruta';
import { APP_VERSION } from '@/lib/version';

export function RegistroPwa() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    const registrar = () => {
      navigator.serviceWorker
        .register(conBase(`/sw.js?v=${APP_VERSION}`), { scope: conBase('/') })
        .catch(() => {
          /* sin service worker la app funciona igual, solo que no se puede instalar */
        });
    };
    if (document.readyState === 'complete') registrar();
    else window.addEventListener('load', registrar, { once: true });
  }, []);
  return null;
}
