/**
 * src/lib/tenant.ts — Utilidades de inquilino para páginas y endpoints.
 *
 *   • `currentUserId()`      → id del usuario de la sesión (o el de demo si la
 *                              autenticación está desactivada).
 *   • `requireUserId()`      → igual, pero lanza `UnauthorizedError` (401) si
 *                              la autenticación está activa y no hay sesión.
 *   • `withCurrentTenant()`  → envuelve el trabajo de una petición en el
 *                              contexto del usuario: todas las consultas
 *                              quedan filtradas por él automáticamente.
 *   • `getCurrentUser()`     → usuario + plan + consumo, para la UI.
 */
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from './auth';
import { hasDatabase, prisma } from './prisma';
import { withTenant, currentTenant, TenantScopeError } from './tenant-context';
import { planFor, PlanLimitError, CreditsExhaustedError, type PlanDefinition } from './plans';

export const DEMO_USER_ID = 'user_demo_1';

export class UnauthorizedError extends Error {
  constructor(message = 'Necesitas iniciar sesión') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

export const authEnabled = () => process.env.AUTH_ENABLED === 'true';

/** ¿Hay base de datos y usuario real? */
async function defaultUserId(): Promise<string> {
  if (!hasDatabase()) return DEMO_USER_ID;
  const user = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } });
  return user?.id ?? DEMO_USER_ID;
}

export async function currentUserId(): Promise<string> {
  if (authEnabled()) {
    const session = await getServerSession(authOptions);
    const id = (session?.user as any)?.id as string | undefined;
    if (!id) throw new UnauthorizedError();
    return id;
  }
  return defaultUserId();
}

export async function requireUserId(): Promise<string> {
  return currentUserId();
}

/**
 * Ejecuta `fn` dentro del contexto del usuario actual. Úsalo en páginas y
 * endpoints: a partir de ahí, Prisma filtra todo por ese usuario.
 */
export async function withCurrentTenant<T>(fn: (userId: string) => Promise<T> | T): Promise<T> {
  const userId = await currentUserId();
  return withTenant(userId, () => fn(userId), 'request');
}

/** Id del inquilino activo (para código ya dentro de un contexto). */
export function tenantUserId(): string {
  const scope = currentTenant();
  if (!scope) throw new Error('[tenant] No hay contexto de usuario activo');
  if (scope.kind === 'system') throw new Error('[tenant] El contexto es global (withSystem) y no tiene userId');
  return scope.userId;
}

export interface CurrentUserView {
  id: string;
  email: string;
  name: string | null;
  plan: PlanDefinition;
  emailVerified: boolean;
  createdAt: Date | null;
  usage: { products: number; stores: number; orders: number; supplierAccounts: number; creditsUsed: number; creditsLimit: number };
}

export async function getCurrentUser(): Promise<CurrentUserView | null> {
  if (!hasDatabase()) {
    const plan = planFor('PRO');
    return {
      id: DEMO_USER_ID,
      email: 'demo@dropshippilot.io',
      name: 'Modo demo',
      plan,
      emailVerified: true,
      createdAt: null,
      usage: { products: 6, stores: 2, orders: 4, supplierAccounts: 0, creditsUsed: 42, creditsLimit: plan.creditsPerMonth },
    };
  }

  const userId = await currentUserId();
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { subscription: true } });
  if (!user) return null;

  // Los contadores son datos de cliente: se ejecutan en SU contexto.
  const [products, stores, orders, supplierAccounts] = await withTenant(userId, () =>
    Promise.all([
      prisma.product.count({ where: { userId } }),
      prisma.store.count({ where: { userId } }),
      prisma.order.count({ where: { userId } }),
      prisma.supplierAccount.count({ where: { userId } }),
    ]),
  );

  const plan = planFor(user.plan);
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    plan,
    emailVerified: Boolean(user.emailVerifiedAt),
    createdAt: user.createdAt,
    usage: {
      products,
      stores,
      orders,
      supplierAccounts,
      creditsUsed: user.subscription?.creditsUsed ?? 0,
      creditsLimit: user.subscription?.creditsLimit ?? plan.creditsPerMonth,
    },
  };
}

/**
 * Envuelve el cuerpo de un handler de API con el contexto del cliente y traduce
 * los errores a la respuesta HTTP que corresponde. Sin esto, un fallo de sesión
 * o de permisos saldría como un 500 opaco.
 */
export async function apiTenant<T extends Response>(fn: (userId: string) => T | Promise<T>): Promise<T | NextResponse> {
  try {
    return await withCurrentTenant(fn);
  } catch (err) {
    const message = (err as Error)?.message ?? 'Error interno';

    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ ok: false, error: message, code: 'UNAUTHORIZED' }, { status: 401 });
    }
    if (err instanceof PlanLimitError) {
      return NextResponse.json({ ok: false, error: message, code: 'PLAN_LIMIT' }, { status: 402 });
    }
    if (err instanceof CreditsExhaustedError) {
      return NextResponse.json({ ok: false, error: message, code: 'CREDITS_EXHAUSTED' }, { status: 402 });
    }
    if (err instanceof TenantScopeError) {
      // Fallo de aislamiento = error de programación, nunca fuga de datos
      console.error('[api] aislamiento:', message);
      return NextResponse.json({ ok: false, error: message, code: 'TENANT_SCOPE' }, { status: 500 });
    }

    console.error('[api] error no controlado:', err);
    return NextResponse.json({ ok: false, error: message, code: 'INTERNAL' }, { status: 500 });
  }
}
