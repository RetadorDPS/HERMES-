import Link from 'next/link';
import {
  Boxes,
  Compass,
  Download,
  Layers,
  LineChart,
  Link2,
  RefreshCw,
  Truck,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PortadaAcciones } from '@/components/portada-acciones';

export const metadata = { title: 'Dropshipping en piloto automático' };

const PASOS = [
  { n: 1, titulo: 'Elige o importa', texto: 'Del catálogo listo o pegando el enlace de un producto.' },
  { n: 2, titulo: 'Fija tu margen', texto: 'Una regla de precio y el sistema calcula el precio final.' },
  { n: 3, titulo: 'Publica en tu tienda', texto: 'Shopify o WooCommerce, con variantes y fotos.' },
  { n: 4, titulo: 'Déjalo funcionando', texto: 'Vigila precios y stock y gestiona los pedidos.' },
];

const FUNCIONES = [
  { icon: Compass, titulo: 'Catálogo listo para importar', texto: 'Escaparate con categorías, búsqueda y filtros. Cada tarjeta muestra tu precio final y tu beneficio.' },
  { icon: Download, titulo: 'Importador por enlace', texto: 'Pega la dirección de un producto y se traen variantes, fotos, envíos y reseñas.' },
  { icon: Layers, titulo: 'Reglas de margen', texto: 'Porcentaje, tarifa fija, beneficio mínimo y redondeo, por categoría si quieres.' },
  { icon: RefreshCw, titulo: 'Vigilancia de precio y stock', texto: 'Si el proveedor cambia el coste o se agota, el precio o la publicación se ajustan.' },
  { icon: Truck, titulo: 'Pedidos y seguimiento', texto: 'Del pedido de tu tienda al proveedor, con el número de seguimiento de vuelta al cliente.' },
  { icon: Link2, titulo: 'Varias tiendas', texto: 'Conecta Shopify y WooCommerce y gestiona todo desde un solo panel.' },
];

export default function Portada() {
  return (
    <div className="relative min-h-screen overflow-hidden">
      {/* Fondo */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -left-40 -top-40 size-[560px] rounded-full bg-indigo-600/20 blur-[130px]" />
        <div className="absolute -right-32 top-40 size-[480px] rounded-full bg-cyan-500/10 blur-[130px]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(99,102,241,0.10),transparent_60%)]" />
      </div>

      {/* Barra superior */}
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-sky-500 shadow-lg shadow-indigo-500/30">
            <Zap className="size-5 text-white" strokeWidth={2.5} />
          </span>
          <span className="text-sm font-semibold tracking-tight">DropshipPilot</span>
        </Link>
        <nav className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <Link href="/catalog">Catálogo</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/login">Iniciar sesión</Link>
          </Button>
        </nav>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        {/* Presentación */}
        <section className="grid items-center gap-8 pb-10 pt-6 sm:pt-12 lg:grid-cols-[minmax(0,1fr)_420px] lg:gap-12">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-amber-400/25 bg-amber-400/[0.08] px-3 py-1 text-[11px] font-medium text-amber-200">
              <span className="size-1.5 rounded-full bg-amber-300" />
              Vista previa · demostración con datos de ejemplo
            </span>
            <h1 className="mt-4 text-3xl font-semibold leading-tight tracking-tight sm:text-5xl">
              Tu negocio de dropshipping,
              <br />
              <span className="bg-gradient-to-r from-indigo-300 to-cyan-300 bg-clip-text text-transparent">en piloto automático</span>
            </h1>
            <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
              Importa productos de CJ y AliExpress, fija tu margen, vigila precios y stock y gestiona los pedidos de tus tiendas desde un único panel,
              en español.
            </p>
            <PortadaAcciones />
          </div>

          {/* Vista previa compacta (con datos de ejemplo) */}
          <div className="glass-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Ejemplo del panel</span>
              <LineChart className="size-4 text-indigo-300" />
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              {[
                { l: 'Ventas (7 días)', v: '5.630 €', c: 'text-foreground' },
                { l: 'Beneficio neto', v: '2.117 €', c: 'text-emerald-300' },
                { l: 'Productos vigilados', v: '14', c: 'text-sky-300' },
                { l: 'Pedidos pendientes', v: '17', c: 'text-amber-300' },
              ].map((k) => (
                <div key={k.l} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
                  <p className="truncate text-[10.5px] uppercase tracking-wide text-muted-foreground">{k.l}</p>
                  <p className={`mt-1 text-xl font-semibold tabular-nums ${k.c}`}>{k.v}</p>
                </div>
              ))}
            </div>
            <div className="mt-2.5 flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-[12px] text-muted-foreground">
              <Boxes className="size-4 shrink-0 text-indigo-300" />
              <span>36 productos de muestra listos para importar</span>
            </div>
          </div>
        </section>

        {/* Cómo funciona */}
        <section className="py-6">
          <h2 className="text-lg font-semibold tracking-tight">Cómo funciona</h2>
          <ol className="mt-3 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            {PASOS.map((p) => (
              <li key={p.n} className="glass-card flex items-start gap-3 p-3.5">
                <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-indigo-500/15 text-[13px] font-semibold text-indigo-300">{p.n}</span>
                <div>
                  <p className="text-[13.5px] font-medium">{p.titulo}</p>
                  <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">{p.texto}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* Qué incluye */}
        <section className="py-6">
          <h2 className="text-lg font-semibold tracking-tight">Qué incluye</h2>
          <div className="mt-3 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {FUNCIONES.map(({ icon: Icono, titulo, texto }) => (
              <div key={titulo} className="glass-card p-4">
                <span className="grid size-8 place-items-center rounded-lg border border-white/10 bg-indigo-500/10 text-indigo-300">
                  <Icono className="size-4" />
                </span>
                <p className="mt-2.5 text-[14px] font-medium">{titulo}</p>
                <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">{texto}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="mx-auto mt-6 flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] px-4 py-5 text-[12px] text-muted-foreground sm:px-6">
        <span>DropshipPilot · versión de demostración</span>
        <span className="flex gap-4">
          <Link href="/privacy" className="hover:text-foreground hover:underline">Privacidad</Link>
          <Link href="/terms" className="hover:text-foreground hover:underline">Términos</Link>
          <Link href="/cookies" className="hover:text-foreground hover:underline">Cookies</Link>
        </span>
      </footer>
    </div>
  );
}
