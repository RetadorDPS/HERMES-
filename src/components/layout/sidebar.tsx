'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Boxes,
  Compass,
  Download,
  Gauge,
  Link2,
  Package,
  RefreshCw,
  CreditCard,
  Factory,
  Settings,
  Shield,
  Truck,
  Zap,
  Rocket,
  ShieldCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: Gauge, hint: 'KPIs y estado general' },
  { href: '/catalog', label: 'Catálogo', icon: Compass, hint: 'Escaparate listo para importar', badge: 'NUEVO' },
  { href: '/import', label: 'Importar por URL', icon: Download, hint: 'AliExpress · Amazon · CJ', highlight: true },
  { href: '/products', label: 'Productos', icon: Package, hint: 'Gestión y sincronización' },
  { href: '/orders', label: 'Pedidos', icon: Truck, hint: 'Fulfillment y tracking' },
  { href: '/monitor', label: 'Monitor de sync', icon: RefreshCw, hint: 'Cola 24/7 y logs' },
  { href: '/proxies', label: 'Proxies y anti-bot', icon: Shield, hint: 'Extracción sin bloqueos' },
  { href: '/suppliers', label: 'Proveedores y APIs', icon: Factory, hint: 'AliExpress · CJ · Amazon' },
  { href: '/billing', label: 'Facturación', icon: CreditCard, hint: 'Plan y créditos' },
  { href: '/stores', label: 'Tiendas', icon: Link2, hint: 'Shopify y WooCommerce' },
  { href: '/pricing', label: 'Precios y márgenes', icon: Boxes, hint: 'Reglas de beneficio' },
  { href: '/setup', label: 'Puesta en marcha', icon: Rocket },
  { href: '/settings', label: 'Configuración', icon: Settings, hint: 'Proveedores, workers, API' },
  { href: '/admin', label: 'Administración', icon: ShieldCheck, hint: 'Sólo operadores', adminOnly: true },
];

export function Sidebar({ mode, isAdmin = false }: { mode: 'demo' | 'postgres'; isAdmin?: boolean }) {
  const items = NAV.filter((item) => !('adminOnly' in item && item.adminOnly) || isAdmin);
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 hidden h-screen w-[264px] shrink-0 flex-col border-r border-white/[0.06] bg-black/20 px-3 py-4 backdrop-blur-xl lg:flex">
      <Link href="/dashboard" className="mb-6 flex items-center gap-2.5 px-2">
        <span className="relative grid size-9 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-sky-500 shadow-lg shadow-indigo-500/30">
          <Zap className="size-5 text-white" strokeWidth={2.5} />
        </span>
        <span className="leading-tight">
          <span className="block text-sm font-semibold tracking-tight">DropshipPilot</span>
          <span className="block text-[11px] text-muted-foreground">Automatización 24/7</span>
        </span>
      </Link>

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto">
        {items.map(({ href, label, icon: Icon, hint, highlight, badge }: any) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-all',
                active ? 'bg-white/[0.07] text-foreground' : 'text-muted-foreground hover:bg-white/[0.04] hover:text-foreground',
              )}
            >
              {active && <span className="absolute left-0 top-1/2 h-6 w-0.5 -translate-y-1/2 rounded-r bg-gradient-to-b from-indigo-400 to-sky-400" />}
              <Icon className={cn('size-4 shrink-0', active ? 'text-indigo-300' : 'text-muted-foreground group-hover:text-foreground')} />
              <span className="flex-1 font-medium">{label}</span>
              {highlight && (
                <span className="rounded bg-indigo-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-300">URL</span>
              )}
              {badge && <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">{badge}</span>}
              <span className="pointer-events-none absolute left-full z-50 ml-2 hidden whitespace-nowrap rounded-md border border-white/10 bg-popover px-2 py-1 text-[11px] text-muted-foreground shadow-xl group-hover:block xl:hidden">
                {hint}
              </span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-4 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-muted-foreground">Fuente de datos</span>
          <span className={cn('rounded px-1.5 py-0.5 font-semibold', mode === 'postgres' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-amber-500/15 text-amber-400')}>
            {mode === 'postgres' ? 'PostgreSQL' : 'MODO DEMO'}
          </span>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          {mode === 'postgres'
            ? 'Datos reales desde Prisma. Workers BullMQ activos.'
            : 'Añade DATABASE_URL + REDIS_URL en .env para operar con datos reales.'}
        </p>
      </div>
    </aside>
  );
}
