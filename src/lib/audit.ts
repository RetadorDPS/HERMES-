/**
 * src/lib/audit.ts — Registro de acciones sensibles (trazabilidad del SaaS).
 *
 * Se guarda en la tabla AuditLog: accesos, registros, cambios de plan,
 * conexiones de tiendas/proveedores, exportaciones, etc. Nunca lanza: un fallo
 * de auditoría no debe romper la operación que se está auditando.
 */
import { prisma } from './prisma';
import { withSystem, withTenant } from './tenant-context';

export interface AuditInput {
  userId?: string | null;
  action: string;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}

export async function audit(input: AuditInput) {
  // El registro pertenece a un usuario, así que se escribe en SU contexto (o en
  // modo sistema cuando es un evento anónimo, p. ej. intento de login fallido).
  const scoped = <T>(fn: () => T): T =>
    input.userId ? withTenant(input.userId, fn, 'audit') : withSystem('auditoría anónima (pre-login)', fn);

  try {
    await scoped(() =>
      prisma.auditLog.create({
        data: {
          userId: input.userId ?? null,
          action: input.action,
          ip: input.ip ?? null,
          userAgent: input.userAgent?.slice(0, 200) ?? null,
          metadata: (input.metadata ?? {}) as any,
        },
      }),
    );
  } catch (err) {
    console.warn('[audit] no se pudo registrar:', (err as Error).message.split('\n')[0]);
  }
}

/** Últimas acciones de un usuario (para la página de seguridad) */
export async function recentAudit(userId: string, limit = 25) {
  try {
    return await prisma.auditLog.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: limit });
  } catch {
    return [];
  }
}
