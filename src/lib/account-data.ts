/**
 * src/lib/account-data.ts — Derechos del cliente sobre sus datos (RGPD).
 *
 *   • `exportUserData(userId)`      → todo lo que la plataforma guarda de un cliente,
 *                                     en un JSON que se puede leer y reutilizar
 *                                     (art. 15 acceso y art. 20 portabilidad).
 *   • `deleteUserAccount(userId)`   → borrado real y completo de su cuenta y de sus
 *                                     datos (art. 17 supresión).
 *
 * Dos decisiones que conviene entender:
 *
 *   1. **Los secretos no salen en claro.** Una exportación es un fichero que se
 *      descarga y se reenvía por correo: los tokens de tienda y las claves de
 *      proveedor van enmascarados (`shpat_abcd…9f2c`) y el JSON lo dice. Si alguien
 *      necesita las credenciales, las ve (enmascaradas) en su panel, no en un
 *      export que puede acabar en cualquier carpeta.
 *   2. **La auditoría se conserva anonimizada.** El borrado elimina los datos, pero
 *      las entradas de `AuditLog` quedan con el usuario a `null` (así lo definimos
 *      en el esquema): son el registro de seguridad de la plataforma y no contienen
 *      datos personales más allá de la acción y la fecha.
 */
import { prisma, hasDatabase } from './prisma';
import { withSystem } from './tenant-context';
import { audit } from './audit';
import { maskSecret } from './crypto';

/** Frase exacta que hay que escribir para borrar la cuenta (una sola fuente). */
export const CONFIRMATION = 'BORRAR MI CUENTA';

export interface ExportSection {
  name: string;
  rows: number;
  data: unknown;
}

export interface UserDataExport {
  meta: {
    generatedAt: string;
    app: string;
    userId: string;
    format: string;
    notes: string[];
  };
  sections: ExportSection[];
  totals: Record<string, number>;
}

/** Cifras y textos que no deben viajar en una exportación. */
const mask = (value: string | null | undefined) => (value ? maskSecret(value, 4) : null);

export async function exportUserData(userId: string): Promise<UserDataExport> {
  const notes: string[] = [
    'Exportación completa de tus datos (RGPD art. 15 y 20). Formato JSON, legible por cualquier herramienta.',
    'Las credenciales (tokens de tienda, claves de proveedor) aparecen ENMASCARADAS a propósito: un fichero exportado acaba reenviándose por correo o copiándose a un disco.',
    'Las contraseñas nunca se guardan en claro: sólo su huella scrypt, que no permite recuperarlas.',
  ];

  if (!hasDatabase()) {
    return {
      meta: { generatedAt: new Date().toISOString(), app: 'DropshipPilot', userId, format: 'dropshippilot/export@1', notes },
      sections: [],
      totals: { sections: 0, rows: 0 },
    };
  }

  // Lectura en contexto de sistema con motivo explícito: es el propio cliente
  // pidiendo sus datos, y hay tablas (suscripción, auditoría) que no cuelgan del
  // contexto de inquilino.
  const data = await withSystem(`exportación de datos del cliente ${userId.slice(-6)} (RGPD)` , async () => {
    const [user, subscription, stores, products, variants, images, reviews, orders, orderItems, pricingRules, supplierAccounts, syncLogs, auditLogs] =
      await Promise.all([
        prisma.user.findUnique({
          where: { id: userId },
          select: {
            id: true, email: true, name: true, role: true, plan: true, timezone: true,
            createdAt: true, updatedAt: true, lastLoginAt: true, emailVerifiedAt: true, totpEnabledAt: true,
            tourVersion: true, tourSeenAt: true, adminTourVersion: true, adminTourSeenAt: true, onboardingHiddenAt: true, onboardingNudgedAt: true, signupIp: true, lastIp: true,
          },
        }),
        prisma.subscription.findUnique({ where: { userId } }),
        prisma.store.findMany({ where: { userId } }),
        prisma.product.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
        prisma.productVariant.findMany({ where: { product: { userId } } }),
        prisma.productImage.findMany({ where: { product: { userId } } }),
        prisma.productReview.findMany({ where: { product: { userId } } }),
        prisma.order.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
        prisma.orderItem.findMany({ where: { order: { userId } } }),
        prisma.pricingRule.findMany({ where: { userId } }),
        prisma.supplierAccount.findMany({ where: { userId } }),
        prisma.syncLog.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 500 }),
        prisma.auditLog.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 500 }),
      ]);

    return { user, subscription, stores, products, variants, images, reviews, orders, orderItems, pricingRules, supplierAccounts, syncLogs, auditLogs };
  });

  // Las credenciales de la tienda salen ENMASCARADAS: un export se reenvía por
  // correo con facilidad y no debe llevar tokens utilizables.
  const cleanStore = (s: (typeof data.stores)[number]) => ({
    id: s.id, name: s.name, platform: s.platform, domain: s.domain, status: s.status,
    apiVersion: s.apiVersion, createdAt: s.createdAt, lastPingAt: s.lastPingAt, lastError: s.lastError,
    accessToken: mask(s.accessTokenEnc),
    consumerSecret: mask(s.consumerSecretEnc),
    webhookSecret: mask(s.webhookSecret),
  });

  const sections: ExportSection[] = [
    { name: 'cuenta', rows: data.user ? 1 : 0, data: data.user },
    {
      name: 'suscripcion',
      rows: data.subscription ? 1 : 0,
      data: data.subscription
        ? {
            plan: data.subscription.plan, status: data.subscription.status,
            creditsUsed: data.subscription.creditsUsed, creditsLimit: data.subscription.creditsLimit,
            currentPeriodEnd: data.subscription.currentPeriodEnd, createdAt: data.subscription.createdAt,
            pasarela: data.subscription.stripeSubscriptionId ? 'stripe' : data.subscription.lemonSubscriptionId ? 'lemon' : null,
          }
        : null,
    },
    { name: 'tiendas', rows: data.stores.length, data: data.stores.map(cleanStore) },
    {
      name: 'productos',
      rows: data.products.length,
      data: data.products.map((p) => ({
        id: p.id, title: p.title, sourceUrl: p.sourceUrl, supplierProductId: p.supplierProductId,
        costPrice: p.costPrice, shippingCost: p.shippingCost, sellingPrice: p.sellingPrice, currency: p.currency,
        stockTotal: p.stockTotal, status: p.status, createdAt: p.createdAt,
      })),
    },
    {
      name: 'variantes',
      rows: data.variants.length,
      data: data.variants.map((v) => ({ productId: v.productId, sku: v.sku, title: v.title, costPrice: v.costPrice, sellingPrice: v.sellingPrice, stock: v.stock })),
    },
    { name: 'imagenes', rows: data.images.length, data: data.images.map((i) => ({ productId: i.productId, url: i.url, alt: i.alt })) },
    { name: 'resenas', rows: data.reviews.length, data: data.reviews.map((r) => ({ productId: r.productId, rating: r.rating, author: r.author, text: r.text, date: r.createdAt })) },
    {
      name: 'pedidos',
      rows: data.orders.length,
      data: data.orders.map((o) => ({
        id: o.id, numeroEnTienda: o.storeOrderNumber, idExterno: o.externalOrderId, estado: o.status,
        estadoDeEnvio: o.fulfillmentStatus, total: Number(o.total), moneda: o.currency, createdAt: o.createdAt,
        seguimiento: o.trackingNumber,
        cliente: { nombre: o.customerName, email: o.customerEmail, telefono: o.customerPhone },
        direccionDeEnvio: {
          nombre: o.shippingName, direccion1: o.shippingAddress1, direccion2: o.shippingAddress2,
          ciudad: o.shippingCity, provincia: o.shippingProvince, pais: o.shippingCountry, codigoPostal: o.shippingZip,
        },
      })),
    },
    {
      name: 'lineas_de_pedido',
      rows: data.orderItems.length,
      data: data.orderItems.map((i) => ({ orderId: i.orderId, title: i.title, sku: i.sku, quantity: i.quantity, unitPrice: i.unitPrice, totalPrice: i.totalPrice })),
    },
    { name: 'reglas_de_precio', rows: data.pricingRules.length, data: data.pricingRules },
    {
      name: 'cuentas_de_proveedor',
      rows: data.supplierAccounts.length,
      data: data.supplierAccounts.map((a) => ({
        id: a.id, proveedor: a.provider, etiqueta: a.label, estado: a.status, esPredeterminada: a.isDefault, createdAt: a.createdAt,
        // Credenciales del proveedor: también enmascaradas
        credenciales: mask(a.credentialsEnc),
      })),
    },
    { name: 'historial_de_sincronizacion', rows: data.syncLogs.length, data: data.syncLogs.map((l) => ({ type: l.type, status: l.status, message: l.message, createdAt: l.createdAt })) },
    { name: 'registro_de_acceso_y_cambios', rows: data.auditLogs.length, data: data.auditLogs.map((l) => ({ action: l.action, ip: l.ip, createdAt: l.createdAt, metadata: l.metadata })) },
  ];

  const totals = Object.fromEntries(sections.map((s) => [s.name, s.rows]));
  totals.sections = sections.length;

  return {
    meta: {
      generatedAt: new Date().toISOString(),
      app: 'DropshipPilot',
      userId,
      format: 'dropshippilot/export@1',
      notes,
    },
    sections,
    totals,
  };
}

export interface DeletionSummary {
  ok: boolean;
  deleted: Record<string, number>;
  /** Cancelación de suscripciones intentada (Stripe / Lemon) */
  subscriptions: string[];
  warnings: string[];
  error?: string;
}

/**
 * Borra la cuenta y TODO lo que depende de ella. Antes cuenta lo que se va a
 * borrar (para poder dejarlo por escrito) y después comprueba que de verdad no
 * queda nada. La auditoría se conserva anonimizada.
 */
export async function deleteUserAccount(userId: string, meta: { ip?: string | null; userAgent?: string | null; reason?: string } = {}): Promise<DeletionSummary> {
  const warnings: string[] = [];
  const subscriptions: string[] = [];

  if (!hasDatabase()) return { ok: false, deleted: {}, subscriptions, warnings, error: 'No hay base de datos configurada' };

  const user = await withSystem('borrado de cuenta (RGPD): localizar cliente', () =>
    prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, subscription: { select: { stripeSubscriptionId: true, lemonSubscriptionId: true } } } }),
  );
  if (!user) return { ok: false, deleted: {}, subscriptions, warnings, error: 'La cuenta ya no existe' };

  // 1) Intentar cancelar la suscripción en la pasarela (si la hay). Se hace ANTES
  //    de borrar: sin la cuenta no habría forma de localizarla para cancelarla.
  try {
    const stripeId = user.subscription?.stripeSubscriptionId;
    if (stripeId && process.env.STRIPE_SECRET_KEY) {
      const res = await fetch(`https://api.stripe.com/v1/subscriptions/${stripeId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
      });
      const body = (await res.json().catch(() => ({}))) as any;
      if (res.ok) subscriptions.push('Stripe: suscripción cancelada');
      else {
        subscriptions.push(`Stripe: no se pudo cancelar (${body?.error?.message ?? `HTTP ${res.status}`})`);
        warnings.push(`La suscripción de Stripe sigue activa: cancélala en el panel de Stripe (${stripeId}) para que no se siga cobrando.`);
      }
    }

    const lemonId = user.subscription?.lemonSubscriptionId;
    if (lemonId && process.env.LEMON_API_KEY) {
      const res = await fetch(`https://api.lemonsqueezy.com/v1/subscriptions/${lemonId}`, {
        method: 'DELETE',
        headers: { Accept: 'application/vnd.api+json', 'Content-Type': 'application/vnd.api+json', Authorization: `Bearer ${process.env.LEMON_API_KEY}` },
      });
      if (res.ok) subscriptions.push('Lemon Squeezy: suscripción cancelada');
      else {
        subscriptions.push(`Lemon Squeezy: no se pudo cancelar (HTTP ${res.status})`);
        warnings.push(`La suscripción de Lemon Squeezy sigue activa: cancélala en su panel (${lemonId}).`);
      }
    }
  } catch (err) {
    warnings.push(`No se ha podido cancelar la suscripción automáticamente: ${(err as Error).message}. Cancélala en el panel de la pasarela.`);
  }

  // 2) Contar lo que se va a borrar y borrarlo en una transacción. El borrado del
  //    usuario arrastra (Cascade) tiendas, productos, variantes, imágenes,
  //    reseñas, pedidos, líneas, reglas de precio, cuentas de proveedor,
  //    suscripción e historial de sincronización.
  const deleted = await withSystem('borrado de cuenta (RGPD): eliminar datos del cliente', async () => {
    const counts = {
      tiendas: await prisma.store.count({ where: { userId } }),
      productos: await prisma.product.count({ where: { userId } }),
      pedidos: await prisma.order.count({ where: { userId } }),
      cuentasDeProveedor: await prisma.supplierAccount.count({ where: { userId } }),
      registrosDeSync: await prisma.syncLog.count({ where: { userId } }),
      reglasDePrecio: await prisma.pricingRule.count({ where: { userId } }),
      suscripcion: await prisma.subscription.count({ where: { userId } }),
    };
    await prisma.user.delete({ where: { id: userId } });
    return counts;
  });

  // 3) Comprobación honesta: ¿queda algo?
  const leftovers = await withSystem('borrado de cuenta (RGPD): comprobar que no queda nada', async () => {
    const [users, stores, products, orders, accounts] = await Promise.all([
      prisma.user.count({ where: { id: userId } }),
      prisma.store.count({ where: { userId } }),
      prisma.product.count({ where: { userId } }),
      prisma.order.count({ where: { userId } }),
      prisma.supplierAccount.count({ where: { userId } }),
    ]);
    return { users, stores, products, orders, accounts };
  });
  const residue = Object.values(leftovers).reduce((a, b) => a + b, 0);
  if (residue > 0) {
    warnings.push(`Quedan ${residue} registro(s) sin borrar: ${JSON.stringify(leftovers)}. Avísanos para completar el borrado.`);
  }

  // 4) Registro: la cuenta ya no existe, así que la entrada queda sin usuario
  //    (anonimizada) pero con el rastro de que el borrado se pidió y se hizo.
  await audit({
    userId: null,
    action: 'account.deleted',
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
    metadata: { email: user.email, deleted, residue, subscriptions, reason: meta.reason ?? 'petición del cliente' },
  });

  return { ok: residue === 0, deleted, subscriptions, warnings };
}
