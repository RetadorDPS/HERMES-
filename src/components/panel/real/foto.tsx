'use client';

import { useEffect, useState } from 'react';
import { ImageOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { direccionOriginal, fotoPorNuestroServidor } from '@/lib/real/foto';

/**
 * Foto de un producto de proveedor. Primero se pide a nuestro servidor; si falla, se intenta directa; si también falla,
 * se enseña un hueco con un icono (nunca el texto suelto ni la imagen rota).
 */
export function Foto({ src, alt = '', className, ancho, perezosa = false }: { src: string | null | undefined; alt?: string; className?: string; ancho?: 240 | 480 | 640; perezosa?: boolean }) {
  const original = direccionOriginal(src);
  const [paso, setPaso] = useState(0); // 0 = por nuestro servidor, 1 = directa, 2 = sin foto
  useEffect(() => setPaso(0), [original]);

  if (!original || paso >= 2) {
    return (
      <span role="img" aria-label="Foto no disponible" className={cn(className, 'grid min-h-12 place-items-center bg-white/[0.04] text-muted-foreground')}>
        <ImageOff className="size-5 opacity-60" aria-hidden />
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={paso === 0 ? fotoPorNuestroServidor(original, ancho) : original}
      alt={alt}
      className={className}
      loading={perezosa ? 'lazy' : undefined}
      referrerPolicy="no-referrer"
      onError={() => setPaso((p) => p + 1)}
    />
  );
}
