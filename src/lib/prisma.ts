import { PrismaClient } from '@prisma/client';
import { registerCheckClient, withTenantIsolation } from './tenant-prisma';
import { TenantScopeError } from './tenant-context';

/**
 * Singleton de PrismaClient (evita agotar conexiones con el HMR de Next).
 *
 * Además implementa un **circuit breaker**: si una consulta falla (la base de
 * datos se ha caído, credenciales rotadas, red caída), se abre el circuito y la
 * aplicación pasa a servir el dataset en memoria en lugar de romper el
 * dashboard. Se reintenta automáticamente cada 60 s (half-open).
 */
const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  dbCircuit?: { open: boolean; openedAt: number; reason?: string; failures: number };
};

const circuit = (globalForPrisma.dbCircuit ??= { open: false, openedAt: 0, failures: 0 });
const CIRCUIT_RETRY_MS = 60_000;

function buildClient(): PrismaClient | null {
  if (!process.env.DATABASE_URL) return null;
  const client = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

  // Observa los fallos de cualquier consulta para abrir/cerrar el circuito
  client.$use(async (params, next) => {
    try {
      const result = await next(params);
      if (circuit.open) {
        console.log('[prisma] base de datos recuperada: cerrando el circuito');
        circuit.open = false;
        circuit.failures = 0;
      }
      return result;
    } catch (err) {
      // Un bloqueo de aislamiento es un error LÓGICO (falta un contexto), no
      // un fallo de la base de datos: no debe degradar la app a modo demo.
      if (err instanceof TenantScopeError) throw err;

      circuit.failures += 1;
      circuit.openedAt = Date.now();
      circuit.reason = (err as Error).message.split('\n')[0].slice(0, 160);
      if (!circuit.open) {
        circuit.open = true;
        console.warn(`[prisma] circuito abierto tras un fallo de consulta → degradando a modo demo durante 60 s: ${circuit.reason}`);
      }
      throw err;
    }
  });

  // Cliente sin extensión para las comprobaciones de propiedad internas del
  // aislamiento (no puede usar el propio cliente extendido: recursión).
  registerCheckClient(client);

  // Aislamiento multi-cliente: toda consulta sobre datos de cliente queda
  // filtrada por el userId del contexto (ver lib/tenant-context.ts).
  return withTenantIsolation(client);
}

export const prisma = globalForPrisma.prisma ?? (buildClient() as PrismaClient);

if (process.env.NODE_ENV !== 'production' && prisma) globalForPrisma.prisma = prisma;

/** ¿Debemos usar PostgreSQL ahora mismo? false si no hay URL o si el circuito está abierto. */
export function hasDatabase(): boolean {
  if (!process.env.DATABASE_URL) return false;
  if (circuit.open) {
    // half-open: pasado el periodo de enfriamiento, dejamos pasar una consulta
    if (Date.now() - circuit.openedAt > CIRCUIT_RETRY_MS) {
      circuit.open = false;
      return true;
    }
    return false;
  }
  return true;
}

export function dbStatus() {
  return {
    configured: Boolean(process.env.DATABASE_URL),
    circuitOpen: circuit.open,
    failures: circuit.failures,
    lastError: circuit.reason ?? null,
    degraded: !hasDatabase(),
  };
}

/** Ejecuta `withDb` si hay base de datos sana, o `fallback` (modo demo) si no. */
export async function usingDb<T>(withDb: () => Promise<T>, fallback: () => Promise<T> | T): Promise<T> {
  if (!hasDatabase()) return fallback();
  try {
    return await withDb();
  } catch (err) {
    console.warn('[prisma] consulta fallida, usando fallback demo:', (err as Error).message.split('\n')[0]);
    return fallback();
  }
}

export async function disconnectPrisma() {
  if (prisma) await prisma.$disconnect();
}
