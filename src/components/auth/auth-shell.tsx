'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * Estructura visual compartida por las pantallas de cuenta
 * (registro, verificación, recuperación de contraseña).
 */
export function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-5 py-12">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -left-32 -top-32 size-[520px] rounded-full bg-indigo-600/20 blur-[120px]" />
        <div className="absolute -bottom-40 -right-24 size-[520px] rounded-full bg-cyan-500/10 blur-[120px]" />
      </div>

      <div className="grid w-full max-w-5xl items-center gap-12 lg:grid-cols-[minmax(0,1fr)_440px]">
        <section className="hidden lg:block">
          <Link href="/" className="mb-8 flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-xl text-white shadow-lg shadow-indigo-500/25">
              ⚡
            </span>
            <span>
              <strong className="block text-lg tracking-tight">DropshipPilot</strong>
              <span className="text-xs text-muted-foreground">Automatización de dropshipping 24/7</span>
            </span>
          </Link>
          <h2 className="text-3xl font-semibold leading-tight tracking-tight">
            Tu negocio de dropshipping,
            <br />
            <span className="bg-gradient-to-r from-indigo-300 to-cyan-300 bg-clip-text text-transparent">en piloto automático</span>
          </h2>
          <ul className="mt-7 space-y-3 text-sm">
            {[
              'Importa productos con APIs oficiales o scraping con proxies',
              'Sincroniza precios y stock cada hora con Shopify y WooCommerce',
              'Compra los pedidos al proveedor automáticamente',
              'Panel único con KPIs, pedidos, envíos y logs de sincronización',
            ].map((item) => (
              <li key={item} className="flex items-start gap-2.5 text-muted-foreground">
                <span className="mt-1 grid size-4 shrink-0 place-items-center rounded-full bg-emerald-500/15 text-[9px] text-emerald-400">✓</span>
                <span className="leading-relaxed">{item}</span>
              </li>
            ))}
          </ul>
          <div className="mt-8 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
            <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1">Cifrado AES-256</span>
            <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1">Aislamiento por cliente</span>
            <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1">Cancela cuando quieras</span>
          </div>
        </section>

        <div className="w-full">
          <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-6 shadow-2xl backdrop-blur-xl">
            <h1 className="text-[17px] font-semibold tracking-tight">{title}</h1>
            {subtitle && <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>}
            <div className="mt-5">{children}</div>
          </div>
          {footer && <div className="mt-5 text-center text-[12px] text-muted-foreground">{footer}</div>}
        </div>
      </div>
    </main>
  );
}
