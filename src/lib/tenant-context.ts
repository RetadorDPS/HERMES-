/**
 * src/lib/tenant-context.ts — Contexto de inquilino (multi-tenant).
 *
 * El aislamiento entre clientes NO se deja en manos de cada consulta: se aplica
 * en la capa de Prisma mediante AsyncLocalStorage. Cualquier consulta que se
 * ejecute dentro de `withTenant(userId, fn)` queda automáticamente filtrada por
 * ese usuario; y si falta el contexto en un modelo de datos de cliente, la
 * consulta **falla** en vez de devolver datos ajenos (fail-closed).
 *
 *   await withTenant(user.id, () => getProducts())          // sólo sus productos
 *   await withSystem(() => prisma.supplier.findMany())      // catálogo global
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export type TenantScope =
  | { kind: 'tenant'; userId: string; source: string }
  | { kind: 'system'; reason: string }
  | null;

const storage = new AsyncLocalStorage<TenantScope>();

export function currentTenant(): TenantScope {
  return storage.getStore() ?? null;
}

/**
 * Ejecuta `fn` manteniendo el contexto activo incluso si `fn` devuelve una
 * promesa perezosa (caso de Prisma: no ejecuta la consulta hasta el `await`).
 * Sin este cuidado, un `withTenant(id, () => prisma.x.create(...))` sin await
 * interno perdería el contexto al resolver la promesa desde fuera.
 */
function runScoped<T>(scope: TenantScope, fn: () => T): T {
  const result = storage.run(scope, fn as () => T);
  if (result && typeof (result as { then?: unknown }).then === 'function') {
    // Se encadena la resolución DENTRO del mismo contexto
    return storage.run(scope, () => (result as unknown as Promise<T>).then((value) => value)) as unknown as T;
  }
  return result;
}

/** Ejecuta `fn` con el aislamiento de un usuario concreto (petición web, job…). */
export function withTenant<T>(userId: string, fn: () => T, source = 'request'): T {
  if (!userId) throw new Error('[tenant] withTenant requiere un userId');

  // Un contexto de inquilino NUNCA se puede reabrir como otro usuario: eso sería
  // suplantación (p. ej. código de A pidiendo datos de B). El modo sistema sí
  // puede abrir un contexto concreto (barridos del worker, login, auditoría).
  const active = storage.getStore();
  if (active?.kind === 'tenant' && active.userId !== userId) {
    throw new TenantScopeError(
      'TenantContext',
      `withTenant(${userId.slice(-6)}) dentro del contexto de ${active.userId.slice(-6)} — suplantación bloqueada`,
    );
  }

  return runScoped({ kind: 'tenant', userId, source }, fn);
}

/**
 * Ejecuta `fn` sin filtro por usuario. Sólo para procesos legítimamente
 * globales: catálogo de proveedores, migraciones, tareas de administración.
 * Cada uso debe llevar un motivo explícito.
 */
export function withSystem<T>(reason: string, fn: () => T): T {
  return runScoped({ kind: 'system', reason }, fn);
}

export class TenantScopeError extends Error {
  constructor(model: string, operation: string) {
    super(
      `[tenant] Consulta bloqueada: «${model}.${operation}» pertenece a datos de cliente pero se ejecutó ` +
        `fuera de un contexto de usuario. Envuélvela en withTenant(userId, …) o, si es realmente global, en withSystem(motivo, …).`,
    );
    this.name = 'TenantScopeError';
  }
}
