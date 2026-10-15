import { Boxes, Cloud, CreditCard, Cpu, Database, KeyRound, Rocket, Server, Terminal, Zap } from 'lucide-react';
import { Topbar } from '@/components/layout/topbar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/alert';
import { dataMode, getSuppliers, getStores } from '@/lib/data';
import { TwoFactorCard } from './two-factor-card';
import { AlertsCard } from './alerts-card';
import { DataRightsCard } from './data-rights-card';
import { HelpTourCard } from './help-tour-card';
import { getCurrentUser } from '@/lib/tenant';
import { tourState } from '@/lib/tour';
import { checklistState } from '@/lib/onboarding';

import { withCurrentTenant } from '@/lib/tenant';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Configuración' };

const ENV_VARS: { key: string; desc: string; required: boolean }[] = [
  { key: 'DATABASE_URL', desc: 'PostgreSQL: sin ella la app funciona en modo demo con datos en memoria', required: true },
  { key: 'REDIS_URL', desc: 'Cola BullMQ de los workers 24/7 (sync + pedidos)', required: true },
  { key: 'SCRAPER_SERVICE_URL', desc: 'Microservicio FastAPI + Playwright (http://localhost:8000)', required: false },
  { key: 'SCRAPER_MODE', desc: 'auto | service | local | demo — estrategia de extracción', required: false },
  { key: 'PROXY_LIST', desc: 'Proxies para anti-bot, separados por comas (http://user:pass@host:port)', required: false },
  { key: 'SHOPIFY_API_VERSION', desc: 'Versión de la GraphQL Admin API (por defecto 2025-01)', required: false },
  { key: 'SHOPIFY_WEBHOOK_SECRET', desc: 'Secreto para verificar la firma HMAC de los webhooks de Shopify', required: false },
  { key: 'WOO_WEBHOOK_SECRET', desc: 'Alternativa manual al secreto de webhook de Woo (se captura solo al registrarlos)', required: false },
  { key: 'AUTH_ENABLED / AUTH_EMAIL / AUTH_PASSWORD', desc: 'Protege el panel con NextAuth y redirige a /login', required: false },
  { key: 'ENCRYPTION_KEY', desc: 'Clave AES-256-GCM con la que se cifran los tokens de las tiendas', required: false },
  { key: 'NEXTAUTH_SECRET', desc: 'Secreto de sesión de NextAuth', required: false },
  { key: 'STRIPE_SECRET_KEY', desc: 'Suscripciones SaaS (Starter / Pro / Enterprise)', required: false },
  { key: 'SYNC_INTERVAL_MINUTES', desc: 'Frecuencia del barrido automático (por defecto 60)', required: false },
  { key: 'SYNC_CONCURRENCY', desc: 'Jobs de sincronización en paralelo por worker (8)', required: false },
  { key: 'ALIEXPRESS_API_KEY / CJ_API_KEY', desc: 'APIs oficiales de proveedor para compra automática de pedidos', required: false },
];

const STACK = [
  { icon: Zap, title: 'Next.js 14 App Router', desc: 'Server Components + API Routes + TypeScript estricto' },
  { icon: Database, title: 'PostgreSQL + Prisma', desc: 'User, Store, Product, ProductVariant, ProductReview, Order, Supplier, SyncLog' },
  { icon: Cpu, title: 'FastAPI + Playwright', desc: 'Scraping anti-bot con rotación de proxies y extracción por payloads embebidos' },
  { icon: Cloud, title: 'BullMQ + Redis', desc: 'Cola de sincronización 24/7 y envío automático de pedidos' },
  { icon: CreditCard, title: 'Stripe + NextAuth', desc: 'Suscripciones SaaS y autenticación de clientes' },
  { icon: Boxes, title: 'Tailwind + shadcn/ui + Lucide', desc: 'Dashboard en modo oscuro, componentes accesibles' },
];

export default async function SettingsPage() {
    return withCurrentTenant(async (userId) => {
      const [stores, suppliers, me, tour, checklist] = await Promise.all([getStores(), getSuppliers(), getCurrentUser(), tourState(), checklistState()]);
      const mode = dataMode();

      return (
        <>
          <Topbar title="Configuración y despliegue" subtitle="Variables de entorno, arquitectura y puesta en marcha" mode={mode} />

          <div data-tour="screen:settings" className="space-y-4 py-5">
            {mode === 'demo' && (
              <Alert variant="warning" title="Estás en modo demo">
                La plataforma funciona con datos sintéticos en memoria: importador, dashboard, monitor de sync y simulación de workers. Para activar el motor
                real necesitas PostgreSQL + Redis + el microservicio de scraping. Sigue los 4 pasos de abajo.
              </Alert>
            )}

            <TwoFactorCard />

            <AlertsCard />

            {/* Ayuda: volver a ver el tutorial guiado y repasar qué hay en cada pestaña */}
            <HelpTourCard completed={tour.completed} seenAt={tour.seenAt} checklistHidden={checklist.hidden} />

            {/* Derechos sobre los propios datos (RGPD art. 15, 17 y 20) */}
            <DataRightsCard email={me?.email ?? 'tu cuenta'} hasPassword={mode !== 'demo'} />

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Rocket className="size-4 text-indigo-300" />
                  Puesta en marcha en 4 pasos
                </CardTitle>
                <CardDescription>De cero a plataforma operativa en menos de 5 minutos</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {[
                  { step: '1', title: 'Infraestructura', cmd: 'docker compose up -d', detail: 'PostgreSQL 16, Redis 7 y scraper service (Playwright + Chromium)' },
                  { step: '2', title: 'Esquema y datos', cmd: 'npm run prisma:push && npm run prisma:seed', detail: 'Crea las tablas y siembra usuario demo, tiendas, productos y pedidos' },
                  { step: '3', title: 'Motor 24/7', cmd: 'npm run worker', detail: 'Workers BullMQ: barrido de precio/stock cada hora + pedidos automáticos' },
                  { step: '4', title: 'Dashboard', cmd: 'npm run dev', detail: 'Panel en http://localhost:3000 — importa tu primer producto por URL' },
                ].map((s) => (
                  <div key={s.step} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5">
                    <div className="flex items-center gap-2">
                      <span className="grid size-6 place-items-center rounded-full bg-indigo-500/15 text-[11px] font-semibold text-indigo-300">{s.step}</span>
                      <p className="text-[13px] font-medium">{s.title}</p>
                    </div>
                    <code className="mt-2 block overflow-x-auto rounded-md bg-black/40 px-2 py-1.5 font-mono text-[11px] text-indigo-300">{s.cmd}</code>
                    <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">{s.detail}</p>
                  </div>
                ))}
              </CardContent>
            </Card>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <KeyRound className="size-4 text-indigo-300" />
                    Variables de entorno
                  </CardTitle>
                  <CardDescription>Copia .env.example a .env y rellena lo que necesites</CardDescription>
                </CardHeader>
                <CardContent className="space-y-1.5">
                  {ENV_VARS.map((v) => (
                    <div key={v.key} className="flex items-start justify-between gap-3 rounded-lg border border-white/[0.05] bg-white/[0.02] px-3 py-2">
                      <div className="min-w-0">
                        <code className="text-[11px] text-indigo-300">{v.key}</code>
                        <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{v.desc}</p>
                      </div>
                      {v.required && <Badge variant="warning">clave</Badge>}
                    </div>
                  ))}
                </CardContent>
              </Card>

              <div className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Server className="size-4 text-indigo-300" />
                      Estado actual
                    </CardTitle>
                    <CardDescription>Recursos detectados en esta instalación</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2 text-[12px]">
                    {[
                      ['Modo de datos', mode === 'postgres' ? 'PostgreSQL (Prisma)' : 'Demo en memoria'],
                      ['Tiendas registradas', String(stores.length)],
                      ['Proveedores activos', String(suppliers.filter((s) => s.isEnabled).length)],
                      ['Cola de tareas', process.env.REDIS_URL ? 'Redis + BullMQ' : 'En memoria (demo)'],
                      ['Microservicio de scraping', process.env.SCRAPER_SERVICE_URL ? process.env.SCRAPER_SERVICE_URL : 'No configurado → extracción local/demo'],
                      ['Facturación', process.env.STRIPE_SECRET_KEY ? 'Stripe conectado' : 'Stripe sin configurar'],
                    ].map(([k, v]) => (
                      <div key={k} className="flex items-center justify-between gap-3 border-b border-white/[0.05] pb-2 last:border-0">
                        <span className="text-muted-foreground">{k}</span>
                        <span className="truncate font-medium">{v}</span>
                      </div>
                    ))}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Terminal className="size-4 text-indigo-300" />
                      Stack técnico
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {STACK.map(({ icon: Icon, title, desc }) => (
                      <div key={title} className="flex items-start gap-2.5 rounded-lg border border-white/[0.05] bg-white/[0.02] p-2.5">
                        <Icon className="mt-0.5 size-4 shrink-0 text-indigo-300" />
                        <div>
                          <p className="text-[12px] font-medium">{title}</p>
                          <p className="text-[11px] leading-relaxed text-muted-foreground">{desc}</p>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </div>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-[13px]">Buenas prácticas legales y operativas</CardTitle>
                <CardDescription>Antes de usar en producción con proveedores reales</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-2 text-[12px] text-muted-foreground md:grid-cols-2">
                <p>• Usa las APIs oficiales de los proveedores (AliExpress Open Platform, CJ API) cuando sea posible; el scraping es el fallback.</p>
                <p>• Respeta los términos de servicio y el robots.txt de cada proveedor, y limita la tasa de peticiones (rate limiting + proxies).</p>
                <p>• Cifra siempre las credenciales de las tiendas (la plataforma ya lo hace con AES-256-GCM).</p>
                <p>• Verifica la firma HMAC de los webhooks entrantes para evitar pedidos falsos.</p>
                <p>• Revisa los márgenes después de las subidas de coste del proveedor: el worker recalcula, pero tu regla define la rentabilidad.</p>
                <p>• Monitoriza la cola de sync: los fallos repetidos suelen indicar proxies quemados o cambios de DOM en el proveedor.</p>
              </CardContent>
            </Card>
          </div>
        </>
      );

    });
  }
