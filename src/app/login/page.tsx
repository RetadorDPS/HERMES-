import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions, DEFAULT_DEMO_EMAIL } from '@/lib/auth';
import { LoginForm } from './login-form';
import { LoginSupabase } from './login-supabase';
import { ESTATICO, parametrosDeServidor } from '@/lib/ruta';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Iniciar sesión · DropshipPilot' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: { callbackUrl?: string; error?: string };
}) {
  // Versión estática (GitHub Pages): acceso con Supabase (correo, Google) y modo demostración
  if (ESTATICO) {
    return (
      <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
        <div className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute -left-32 -top-32 size-[520px] rounded-full bg-indigo-600/20 blur-[120px]" />
          <div className="absolute -bottom-40 -right-24 size-[520px] rounded-full bg-cyan-500/10 blur-[120px]" />
        </div>
        <LoginSupabase />
      </main>
    );
  }

  const authEnabled = process.env.AUTH_ENABLED === 'true';
  const callbackUrl = parametrosDeServidor(searchParams).callbackUrl ?? '/dashboard';

  // Si ya hay sesión, no tiene sentido volver a pedir credenciales
  if (authEnabled) {
    const session = await getServerSession(authOptions);
    if (session) redirect(callbackUrl);
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-5 py-12">
      {/* Fondo: mismo lenguaje visual que el dashboard */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -left-32 -top-32 size-[520px] rounded-full bg-indigo-600/20 blur-[120px]" />
        <div className="absolute -bottom-40 -right-24 size-[520px] rounded-full bg-cyan-500/10 blur-[120px]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(99,102,241,0.10),transparent_60%)]" />
      </div>

      <div className="grid w-full max-w-5xl items-center gap-12 lg:grid-cols-[minmax(0,1fr)_420px]">
        <section className="hidden lg:block">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight">
            Tu negocio de dropshipping,
            <br />
            <span className="bg-gradient-to-r from-indigo-300 to-cyan-300 bg-clip-text text-transparent">en piloto automático</span>
          </h2>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-muted-foreground">
            Importa productos de AliExpress, Amazon o CJ, sincroniza precios y stock cada hora con tu Shopify o WooCommerce, y gestiona los pedidos
            y el fulfillment desde un único panel.
          </p>
          <ul className="mt-7 space-y-3 text-sm">
            {[
              'Importador por URL con variantes, fotos HD, reseñas y envíos',
              'Workers 24/7: re-escaneo, recálculo de margen y “Agotado” automático',
              'Conexión directa con Shopify Admin API y WooCommerce REST',
              'Monitor de pedidos con compra automática al proveedor y tracking',
            ].map((item) => (
              <li key={item} className="flex items-start gap-2.5 text-muted-foreground">
                <span className="mt-1 grid size-4 shrink-0 place-items-center rounded-full bg-emerald-500/15 text-[9px] text-emerald-400">✓</span>
                <span className="leading-relaxed">{item}</span>
              </li>
            ))}
          </ul>
          <div className="mt-8 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
            <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1">Next.js 14 · App Router</span>
            <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1">PostgreSQL · Prisma</span>
            <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1">BullMQ · Redis</span>
            <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1">FastAPI · Playwright</span>
          </div>
        </section>

        <LoginForm
          callbackUrl={callbackUrl}
          authEnabled={authEnabled}
          demoEmail={DEFAULT_DEMO_EMAIL}
          showDemoHint={!process.env.AUTH_EMAIL}
        />
      </div>
    </main>
  );
}
