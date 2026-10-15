/**
 * src/lib/tenant-prisma.ts — Extensión de Prisma que aplica el aislamiento
 * multi-cliente en TODAS las consultas.
 *
 * Cómo funciona:
 *   • Modelos con columna `userId` (Store, Product, Order, SyncLog, PricingRule,
 *     SupplierAccount, Subscription…): se inyecta `where.userId` en lecturas y
 *     escrituras, y `data.userId` al crear.
 *   • Modelos hijos (ProductVariant, ProductImage, ProductReview, ShippingQuote,
 *     OrderItem): se filtran por su relación con el producto/pedido del cliente.
 *   • `findUnique` no admite filtros extra → se lee y, si la fila no es del
 *     cliente, se devuelve `null` (jamás se expone).
 *
 * Todo esto ocurre sólo si hay contexto de inquilino. Sin contexto, los modelos
 * de cliente lanzan `TenantScopeError` (fail-closed) salvo que se marque el
 * bloque como global con `withSystem()`.
 */
import type { PrismaClient } from '@prisma/client';
import { currentTenant, TenantScopeError } from './tenant-context';

/** Modelos con columna userId propia */
const DIRECT_TENANT_MODELS = new Set([
  'Store',
  'Product',
  'Order',
  'SyncLog',
  'PricingRule',
  'SupplierAccount',
  'Subscription',
  'VerificationToken',
  'AuditLog',
]);

/** Modelos hijos: se filtran a través de su relación padre */
const RELATION_TENANT_MODELS: Record<string, { relation: string; field: string }> = {
  ProductVariant: { relation: 'product', field: 'userId' },
  ProductImage: { relation: 'product', field: 'userId' },
  ProductReview: { relation: 'product', field: 'userId' },
  ShippingQuote: { relation: 'product', field: 'userId' },
  OrderItem: { relation: 'order', field: 'userId' },
};

const READ_OPS = new Set([
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'count',
  'aggregate',
  'groupBy',
  'updateMany',
  'deleteMany',
]);

const UNIQUE_OPS = new Set(['findUnique', 'findUniqueOrThrow', 'update', 'delete', 'upsert']);

function mergeWhere(where: any, extra: any) {
  if (!where) return { ...extra };
  return { AND: [where, extra] };
}

/**
 * Comprueba que un registro (por clave única) pertenece al inquilino actual.
 * Se usa para los modelos hijos que no tienen columna userId propia.
 */
let prismaForChecks: any = null;
export function registerCheckClient(client: any) {
  prismaForChecks = client;
}

async function checkOwnership(model: string, uniqueWhere: any, tenantWhere: any) {
  if (!prismaForChecks) return null;
  const delegateName = model.charAt(0).toLowerCase() + model.slice(1);
  const delegate = prismaForChecks[delegateName];
  if (!delegate?.findFirst) return null;
  return delegate.findFirst({ where: { ...uniqueWhere, ...tenantWhere }, select: { id: true } });
}

export function tenantExtension() {
  return {
    name: 'tenant-isolation',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }: any) {
          const scope = currentTenant();

          // Modelos globales (catálogo de proveedores, eventos de webhook de
          // sistema, jobs…) no se tocan.
          const isDirect = DIRECT_TENANT_MODELS.has(model);
          const relation = RELATION_TENANT_MODELS[model];
          if (!isDirect && !relation) return query(args);

          // ── Sin contexto: fail-closed para datos de cliente ──────────────
          if (!scope) {
            throw new TenantScopeError(model, operation);
          }
          if (scope.kind === 'system') return query(args);

          const userId = scope.userId;
          const tenantWhere = isDirect ? { userId } : { [relation!.relation]: { [relation!.field]: userId } };
          const next = { ...(args ?? {}) };

          // ── Lecturas y escrituras masivas: se añade el filtro ────────────
          if (READ_OPS.has(operation)) {
            next.where = mergeWhere(next.where, tenantWhere);
            return query(next);
          }

          // ── Operaciones por clave única ──────────────────────────────────
          // `where` de findUnique/update/delete exige la clave única en el
          // primer nivel: se añaden los campos del inquilino en el MISMO nivel
          // (Prisma 5 admite filtros extra junto a la clave única).
          if (UNIQUE_OPS.has(operation)) {
            if (isDirect) {
              next.where = { ...(next.where ?? {}), userId };
              if (operation === 'upsert') {
                next.create = { ...(next.create ?? {}), userId };
              }
              return query(next);
            }

            // Modelos hijos (variantes, imágenes, items): no tienen columna
            // userId, así que la propiedad se comprueba con una consulta previa
            // filtrada por la relación con el padre del cliente.
            const uniqueWhere = next.where ?? {};
            const existing = await checkOwnership(model, uniqueWhere, tenantWhere);
            if (!existing) {
              if (operation.startsWith('findUnique')) return null;
              throw new TenantScopeError(model, `${operation} sobre un registro de otro cliente`);
            }
            next.where = uniqueWhere;
            return query(next);
          }

          // ── Creación: se estampa el userId del inquilino ─────────────────
          if (operation === 'create' && isDirect) {
            next.data = { ...(next.data ?? {}) };
            if (!next.data.userId) next.data.userId = userId;
            if (next.data.userId !== userId) {
              throw new TenantScopeError(`${model} (userId ajeno)`, operation);
            }
            return query(next);
          }

          if (operation === 'createMany' && isDirect) {
            const data = Array.isArray(next.data) ? next.data : [next.data];
            next.data = data.map((row: any) => ({ ...row, userId: row?.userId ?? userId }));
            return query(next);
          }

          return query(next);
        },
      },
    },
  };
}

/** Aplica la extensión al cliente Prisma (se llama desde lib/prisma.ts) */
export function withTenantIsolation<T extends PrismaClient>(client: T): T {
  return (client as any).$extends(tenantExtension()) as unknown as T;
}
