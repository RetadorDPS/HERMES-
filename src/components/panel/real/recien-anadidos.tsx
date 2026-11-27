'use client';

/**
 * «Acabas de añadir»: los productos que el usuario acaba de traer desde el buscador, juntos y arriba de «Mi catálogo»,
 * para que no tenga que adivinar cuáles son. Se recuerdan en esta sesión del navegador hasta que pulse «Ocultar».
 */
import { useEffect, useState } from 'react';
import { Loader2, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { CatalogRow } from '@/lib/catalog';
import { consultarItemsCatalogo } from '@/lib/real/datos';
import { CatalogCardCompact } from '@/app/(dashboard)/catalog/catalog-card';
import { imageSrc } from '@/app/(dashboard)/catalog/image';
import { FichaProveedor } from './ficha-proveedor';

const CLAVE = 'hermes-recien-anadidos';

export function leerRecienAnadidos(): string[] {
  try {
    const v = JSON.parse(window.sessionStorage.getItem(CLAVE) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 100) : [];
  } catch {
    return [];
  }
}

export function guardarRecienAnadidos(ids: string[]) {
  try {
    window.sessionStorage.setItem(CLAVE, JSON.stringify(ids.slice(0, 100)));
  } catch {
    /* sin almacenamiento: solo mientras la pantalla esté abierta */
  }
}

export function RecienAnadidos({ ids, alOcultar }: { ids: string[]; alOcultar: () => void }) {
  const [items, setItems] = useState<CatalogRow[] | null>(null);
  const [abierta, setAbierta] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    setItems(null);
    consultarItemsCatalogo(ids)
      .then((f) => vivo && setItems(f))
      .catch(() => vivo && setItems([]));
    return () => {
      vivo = false;
    };
  }, [ids.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ids.length) return null;
  return (
    <section className="space-y-2 rounded-xl border border-indigo-400/30 bg-indigo-500/[0.06] p-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="flex min-w-0 items-center gap-1.5 text-[12.5px] font-medium">
          <Sparkles className="size-4 shrink-0 text-indigo-300" />
          Acabas de añadir {ids.length} {ids.length === 1 ? 'producto' : 'productos'}
        </p>
        <Button variant="outline" size="sm" className="h-7 shrink-0 px-2 text-[11px]" onClick={alOcultar}>
          <X className="size-3.5" /> Ocultar
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">Toca uno para ver su ficha completa y publicarlo. También están en el catálogo, los primeros.</p>
      {items === null ? (
        <div className="flex items-center gap-2 py-4 text-[12px] text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Cargando…
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-1.5 sm:gap-2 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
          {items.map((item) => (
            <CatalogCardCompact key={item.id} item={{ ...item, imageUrl: imageSrc(item.imageUrl), images: (item.images ?? []).map(imageSrc) }} onOpen={(i) => setAbierta(i.id)} />
          ))}
        </div>
      )}
      <FichaProveedor itemId={abierta} onClose={() => setAbierta(null)} />
    </section>
  );
}
