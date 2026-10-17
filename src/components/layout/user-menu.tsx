'use client';

import { useEffect, useRef, useState } from 'react';
import { signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useSesion } from '@/components/auth/sesion';
import Link from 'next/link';
import { ChevronDown, CreditCard, LifeBuoy, LogOut, Settings, UserRound } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Menú de usuario de la cabecera. Muestra las iniciales y, cuando la
 * autenticación está activa, permite cerrar sesión.
 */
export function UserMenu({ authEnabled }: { authEnabled: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const { activo, modo, sesion, email, nombre, salir, salirDemo } = useSesion();
  const real = activo && modo === 'real' && Boolean(sesion);
  const demoEstatica = activo && modo === 'demo';
  const etiqueta = real ? nombre || email || 'Mi cuenta' : 'Modo demo';
  const iniciales = real ? (nombre || email || '?').trim().slice(0, 2).toUpperCase() : 'MD';

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const items = [
    { href: '/settings', label: 'Ajustes de la cuenta', icon: UserRound },
    { href: '/pricing', label: 'Plan y márgenes', icon: CreditCard },
    { href: '/settings', label: 'Ayuda y diagnóstico', icon: LifeBuoy },
  ];

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-full pl-0.5 pr-1.5 py-0.5 transition hover:bg-white/[0.06]"
        title="Cuenta"
      >
        <span className="grid size-8 place-items-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-xs font-semibold text-white">
          {iniciales}
        </span>
        <ChevronDown className={cn('size-3 text-muted-foreground transition', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute right-0 top-11 z-50 w-60 animate-in-up overflow-hidden rounded-xl border border-white/[0.08] bg-popover/95 shadow-2xl backdrop-blur-xl">
          <div className="border-b border-white/[0.06] px-3 py-2.5">
            <p className="truncate text-[12.5px] font-medium">{etiqueta}</p>
            <p className="truncate text-[11px] text-muted-foreground">
              {real ? email : demoEstatica ? 'Demostración · datos de ejemplo' : authEnabled ? 'Sesión iniciada con NextAuth' : 'AUTH_ENABLED=false · sin sesión'}
            </p>
          </div>

          {items.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 px-3 py-2 text-[12.5px] text-muted-foreground transition hover:bg-white/[0.04] hover:text-foreground"
            >
              <item.icon className="size-3.5" />
              {item.label}
            </Link>
          ))}

          <div className="border-t border-white/[0.06]">
            {real ? (
              <button
                onClick={async () => {
                  setOpen(false);
                  await salir();
                  router.replace('/login');
                }}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-[12.5px] text-rose-300 transition hover:bg-rose-500/10"
              >
                <LogOut className="size-3.5" />
                Cerrar sesión
              </button>
            ) : demoEstatica ? (
              <button
                onClick={() => {
                  setOpen(false);
                  salirDemo();
                  router.replace('/login');
                }}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-[12.5px] text-muted-foreground transition hover:bg-white/[0.04] hover:text-foreground"
              >
                <LogOut className="size-3.5" />
                Salir de la demostración
              </button>
            ) : authEnabled ? (
              <button
                onClick={() => signOut({ callbackUrl: '/login' })}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-[12.5px] text-rose-300 transition hover:bg-rose-500/10"
              >
                <LogOut className="size-3.5" />
                Cerrar sesión
              </button>
            ) : (
              <Link
                href="/login"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 px-3 py-2 text-[12.5px] text-muted-foreground transition hover:bg-white/[0.04] hover:text-foreground"
              >
                <Settings className="size-3.5" />
                Ver pantalla de login
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
