/**
 * src/lib/admin.ts — Utilidades del operador de la plataforma.
 *
 * «Administrador» aquí significa OPERADOR DEL SaaS (tú), no el dueño de una
 * cuenta de cliente: cada cliente es OWNER de su propio espacio. El panel de
 * administración sólo responde a usuarios con rol ADMIN.
 *
 * Cómo dar de alta un administrador:
 *   npx tsx scripts/make-admin.ts tu@correo.com
 */
import { prisma } from './prisma';
import { currentTenant, withSystem } from './tenant-context';
import { currentUserId, authEnabled } from './tenant';
import { hasDatabase } from './prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from './auth';
import type { UserRole } from '@prisma/client';

/**
 * Modo local de un único dueño (instalación en tu propio servidor o portátil):
 * permite entrar al panel de operador sin sesión. Es un interruptor EXPLÍCITO,
 * apagado por defecto; en un SaaS abierto no debe activarse nunca, porque
 * cualquiera que abra la URL tendría los permisos del propietario.
 */
const localAdminMode = () => process.env.LOCAL_ADMIN_MODE === 'true';

export interface AdminIdentity {
  userId: string;
  email: string;
  role: UserRole;
  /**
   * `true` en modo evaluación (autenticación desactivada y sin modo local):
   * el panel se puede MIRAR —para que veas la sección— pero no cambiar nada.
   * Así un visitante anónimo no puede tocar claves, planes ni permisos.
   */
  readOnly: boolean;
  source: 'session' | 'local' | 'evaluation';
}

/** Id del usuario con sesión iniciada, o null (nunca lanza). */
async function sessionUserId(): Promise<string | null> {
  if (!authEnabled()) return null;
  try {
    const session = await getServerSession(authOptions);
    return ((session?.user as any)?.id as string | undefined) ?? null;
  } catch {
    return null;
  }
}

/**
 * Devuelve la identidad de operador si quien actúa puede serlo.
 *
 * Reglas (de más a menos confianza):
 *   1. Sesión iniciada con rol ADMIN → acceso completo.
 *   2. LOCAL_ADMIN_MODE=true → acceso completo (instalación de un solo dueño).
 *   3. Sin autenticación activada y sin modo local → acceso de SÓLO LECTURA
 *      (modo evaluación). Antes esa misma situación daba permisos completos:
 *      un anónimo podía ver y modificar las claves de plataforma y los planes
 *      de todos los clientes. Ese era el agujero que se cierra aquí.
 *   4. Autenticación activa sin sesión → nadie.
 */
export async function currentAdmin(): Promise<AdminIdentity | null> {
  if (!hasDatabase()) {
    // Versión estática de demostración (GitHub Pages): el panel se puede MIRAR, nunca cambiar.
    // ESTATICO solo existe en esa construcción; en un servidor real no se define y se devuelve null.
    if (process.env.NEXT_PUBLIC_ESTATICO === '1') {
      return { userId: 'user_demo_1', email: 'operador@dropshippilot.io', role: 'ADMIN' as UserRole, readOnly: true, source: 'evaluation' };
    }
    return null;
  }

  const sessionId = await sessionUserId();
  // Dentro de un contexto de inquilino ya resuelto (jobs, scripts, llamadas
  // internas) ese es el usuario que actúa; si no, se resuelve por la sesión.
  const active = currentTenant();
  const tenantId = active?.kind === 'tenant' ? active.userId : null;
  const userId = sessionId ?? tenantId ?? (await currentUserId().catch(() => null));
  if (!userId) return null;

  const source: AdminIdentity['source'] = sessionId ? 'session' : localAdminMode() ? 'local' : authEnabled() ? 'local' : 'evaluation';

  const user = await withSystem('admin: comprobar rol del operador', () =>
    prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, role: true } }),
  );
  if (!user || user.role !== 'ADMIN') return null;
  return { userId: user.id, email: user.email, role: user.role, readOnly: source === 'evaluation', source };
}

/**
 * ¿Se puede ESCRIBIR como operador? (evita repetir `if (admin.readOnly)` en cada
 * ruta). Devuelve un booleano normal, no un predicado de tipo: así el `else` no
 * colapsa la variable a `never` y el código que sólo LEE sigue funcionando.
 */
export function canOperate(admin: AdminIdentity | null): boolean {
  return Boolean(admin && !admin.readOnly);
}

/** Resumen global de la plataforma (para el panel de administración). */
export async function platformOverview() {
  return withSystem('admin: métricas globales de la plataforma', async () => {
    const [users, stores, products, orders, supplierAccounts, syncLogs24h, failed24h, subs] = await Promise.all([
      prisma.user.count(),
      prisma.store.count(),
      prisma.product.count(),
      prisma.order.count(),
      prisma.supplierAccount.count(),
      prisma.syncLog.count({ where: { createdAt: { gte: new Date(Date.now() - 24 * 3600_000) } } }),
      prisma.syncLog.count({ where: { createdAt: { gte: new Date(Date.now() - 24 * 3600_000) }, status: 'FAILED' } }),
      prisma.subscription.findMany({ select: { plan: true, status: true, stripeSubscriptionId: true, lemonSubscriptionId: true, creditsUsed: true, creditsLimit: true } }),
    ]);

    const planPrices: Record<string, number> = { TRIAL: 0, STARTER: 29, PRO: 79, ENTERPRISE: 249 };
    const paying = subs.filter((s) => s.status === 'ACTIVE' || s.status === 'PAST_DUE');
    const mrr = paying.reduce((sum, s) => sum + (planPrices[s.plan] ?? 0), 0);

    return {
      users,
      stores,
      products,
      orders,
      supplierAccounts,
      syncLogs24h,
      failed24h,
      paying: paying.length,
      mrr,
      creditsUsed: subs.reduce((sum, s) => sum + s.creditsUsed, 0),
      creditsLimit: subs.reduce((sum, s) => sum + s.creditsLimit, 0),
    };
  });
}

/** Lista de clientes con sus métricas, ordenada por actividad reciente. */
export async function tenantList() {
  return withSystem('admin: listado de clientes', async () => {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        plan: true,
        createdAt: true,
        lastLoginAt: true,
        emailVerifiedAt: true,
        totpEnabledAt: true,
        subscription: {
          select: { status: true, creditsUsed: true, creditsLimit: true, stripeSubscriptionId: true, lemonSubscriptionId: true, currentPeriodEnd: true },
        },
        _count: { select: { stores: true, products: true, orders: true, supplierAccounts: true } },
      },
    });
    return users;
  });
}
