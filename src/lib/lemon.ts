/**
 * src/lib/lemon.ts — Cobro alternativo con Lemon Squeezy («merchant of record»).
 *
 * Por qué existe: en España, cobrar con Stripe exige estar dado de alta en
 * Hacienda (036) y gestionar tú el IVA de cada país. Un «merchant of record»
 * (Lemon Squeezy) actúa como VENDEDOR LEGAL: cobra al cliente, emite la factura,
 * liquida el IVA/VAT de cada país y te transfiere el neto. Sirve, además, para
 * empezar a cobrar antes de tener la pasarela propia montada.
 *
 * Flujo (idéntico al de Stripe para que el resto de la app no cambie):
 *   1. `createLemonCheckout()` devuelve la URL del checkout hospedado, con
 *      datos del comprador y metadatos (userId, tier, interval) precargados.
 *   2. Lemon Squeezy envía webhooks a `/api/webhooks/lemon` firmados con
 *      `X-Signature` (HMAC-SHA256 del cuerpo con LEMON_WEBHOOK_SECRET).
 *   3. `handleLemonEvent()` verifica la firma y sincroniza plan, estado y
 *      créditos del cliente dentro de su contexto de inquilino.
 *
 * Variables de entorno:
 *   LEMON_API_KEY                → API key de la tienda (Settings → API)
 *   LEMON_STORE_ID               → id numérico de la tienda
 *   LEMON_WEBHOOK_SECRET         → secreto del webhook (Settings → Webhooks)
 *   LEMON_VARIANT_<PLAN>_<CICLO> → id de variante por plan: STARTER/PRO/ENTERPRISE × MONTHLY/YEARLY
 *
 * Si no hay claves, el módulo responde `configured:false` y la app sigue igual
 * (los planes se pueden asignar a mano desde el panel de administración).
 */
import crypto from 'node:crypto';
import { prisma } from './prisma';
import { withSystem, withTenant } from './tenant-context';
import { PLANS, planFor } from './plans';
import type { PlanTier } from '@prisma/client';

const API = 'https://api.lemonsqueezy.com/v1';

/** ¿Hay al menos webhooks configurados? (sin esto no se puede sincronizar nada) */
export function lemonConfigured() {
  return Boolean(process.env.LEMON_WEBHOOK_SECRET);
}

/** ¿Se puede iniciar el pago? (requiere API key, tienda y variante) */
export function lemonCheckoutReady() {
  return Boolean(process.env.LEMON_API_KEY && process.env.LEMON_STORE_ID);
}

export function lemonVariantIdFor(tier: PlanTier, interval: 'monthly' | 'yearly'): string | null {
  if (tier === 'TRIAL') return null;
  return process.env[`LEMON_VARIANT_${tier}_${interval.toUpperCase()}`] ?? null;
}

/** Traduce un id de variante de Lemon Squeezy al plan y ciclo de esta app. */
export function planFromVariant(variantId: string | number | null | undefined): { tier: PlanTier; interval: 'monthly' | 'yearly' } | null {
  if (!variantId) return null;
  const id = String(variantId);
  for (const tier of ['STARTER', 'PRO', 'ENTERPRISE'] as PlanTier[]) {
    for (const interval of ['monthly', 'yearly'] as const) {
      if (lemonVariantIdFor(tier, interval) === id) return { tier, interval };
    }
  }
  return null;
}

interface LemonRequestOptions extends RequestInit {
  body?: string;
}

async function api(path: string, init: LemonRequestOptions = {}) {
  const key = process.env.LEMON_API_KEY;
  if (!key) throw new Error('LEMON_API_KEY no configurada');
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.api+json',
      'Content-Type': 'application/vnd.api+json',
      Authorization: `Bearer ${key}`,
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* respuesta no JSON */
  }
  if (!res.ok) {
    const detail = json?.errors?.[0]?.detail ?? json?.error ?? text.slice(0, 200);
    throw new Error(`Lemon Squeezy HTTP ${res.status}: ${detail}`);
  }
  return json;
}

export interface LemonCheckoutResult {
  ok: boolean;
  url?: string;
  configured: boolean;
  error?: string;
}

/** Crea el checkout hospedado de Lemon Squeezy para un plan. */
export async function createLemonCheckout(input: {
  userId: string;
  email: string;
  name?: string | null;
  tier: PlanTier;
  interval: 'monthly' | 'yearly';
  redirectUrl: string;
}): Promise<LemonCheckoutResult> {
  if (!lemonCheckoutReady()) {
    return {
      ok: false,
      configured: false,
      error:
        'Lemon Squeezy no está configurado (faltan LEMON_API_KEY y/o LEMON_STORE_ID). Consulta PAGOS.md para crear la cuenta y conectar las variantes.',
    };
  }
  const variantId = lemonVariantIdFor(input.tier, input.interval);
  if (!variantId) {
    return {
      ok: false,
      configured: true,
      error: `Falta la variante de Lemon Squeezy para ${input.tier} ${input.interval}: define LEMON_VARIANT_${input.tier}_${input.interval.toUpperCase()} (id del producto en Lemon Squeezy).`,
    };
  }

  try {
    const json = await api('/checkouts', {
      method: 'POST',
      body: JSON.stringify({
        data: {
          type: 'checkouts',
          attributes: {
            checkout_data: {
              email: input.email,
              name: input.name ?? undefined,
              custom: { user_id: input.userId, tier: input.tier, interval: input.interval },
            },
            product_options: {
              redirect_url: input.redirectUrl,
              enabled_variants: [Number(variantId)],
            },
            checkout_options: { embed: false, media: true, logo: true },
            expires_at: null,
          },
          relationships: {
            store: { data: { type: 'stores', id: String(process.env.LEMON_STORE_ID) } },
            variant: { data: { type: 'variants', id: String(variantId) } },
          },
        },
      }),
    });
    const url = json?.data?.attributes?.url;
    if (!url) return { ok: false, configured: true, error: 'Lemon Squeezy no devolvió la URL del checkout' };
    return { ok: true, configured: true, url };
  } catch (err) {
    return { ok: false, configured: true, error: (err as Error).message };
  }
}

/** Portal de cliente de Lemon Squeezy (cambiar tarjeta, cancelar) */
export async function lemonCustomerPortalUrl(subscriptionId: string | null | undefined): Promise<string | null> {
  if (!process.env.LEMON_API_KEY || !subscriptionId) return null;
  try {
    const json = await api(`/subscriptions/${subscriptionId}`);
    return json?.data?.attributes?.urls?.customer_portal ?? null;
  } catch {
    return null;
  }
}

/** Comprueba una firma `X-Signature` de Lemon Squeezy (HMAC-SHA256 en hex). */
export function verifyLemonSignature(rawBody: string, signature: string | null, secret = process.env.LEMON_WEBHOOK_SECRET): boolean {
  if (!signature || !secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature.trim().toLowerCase(), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

const STATUS_MAP: Record<string, 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'UNPAID'> = {
  on_trial: 'TRIALING',
  active: 'ACTIVE',
  paused: 'PAST_DUE',
  past_due: 'PAST_DUE',
  unpaid: 'UNPAID',
  cancelled: 'CANCELED',
  expired: 'CANCELED',
};

export interface LemonApplyResult {
  ok: boolean;
  error?: string;
  applied?: string[];
}

/**
 * Verifica y aplica un webhook de Lemon Squeezy.
 * Mismo patrón de aislamiento que en Stripe: primero se identifica al dueño
 * (`withSystem`) y todo el trabajo se hace dentro de su contexto (`withTenant`).
 */
export async function handleLemonEvent(rawBody: string, signature: string | null): Promise<LemonApplyResult> {
  const secret = process.env.LEMON_WEBHOOK_SECRET;
  if (!secret) return { ok: false, error: 'Lemon Squeezy no configurado (falta LEMON_WEBHOOK_SECRET)' };
  if (!verifyLemonSignature(rawBody, signature)) return { ok: false, error: 'Firma inválida' };

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { ok: false, error: 'Cuerpo no es JSON válido' };
  }

  const eventName: string = payload?.meta?.event_name ?? 'unknown';
  const custom = payload?.meta?.custom_data ?? {};
  const attrs = payload?.data?.attributes ?? {};
  const subscriptionId = payload?.data?.type === 'subscriptions' ? String(payload.data.id) : (attrs.subscription_id ? String(attrs.subscription_id) : null);

  // 1) Identificar al dueño: por metadata del checkout o por el id de suscripción
  const userId: string | null =
    (typeof custom.user_id === 'string' && custom.user_id) ||
    (await withSystem('webhook de Lemon Squeezy: localizar al cliente por id de suscripción', async () => {
      if (!subscriptionId) {
        const byCustomer = attrs.customer_id
          ? await prisma.subscription.findFirst({ where: { lemonCustomerId: String(attrs.customer_id) }, select: { userId: true } })
          : null;
        return byCustomer?.userId ?? null;
      }
      const found = await prisma.subscription.findFirst({ where: { lemonSubscriptionId: subscriptionId }, select: { userId: true } });
      return found?.userId ?? null;
    }));

  if (!userId) return { ok: true, applied: [`${eventName}: sin cliente identificable (ignorado)`] };

  const applied: string[] = [];

  const applyPlan = async (tier: PlanTier, opts: { status: string; renewsAt?: string | null; endsAt?: string | null; resetCredits?: boolean }) => {
    const plan = planFor(tier);
    const status = STATUS_MAP[opts.status] ?? 'ACTIVE';
    await withTenant(userId, async () => {
      if (status === 'CANCELED') {
        await prisma.subscription.update({
          where: { userId },
          data: { status, plan: 'TRIAL', lemonStatus: opts.status, cancelAtPeriodEnd: true },
        });
        await prisma.user.update({ where: { id: userId }, data: { plan: 'TRIAL' } });
        return;
      }
      await prisma.user.update({ where: { id: userId }, data: { plan: tier } });
      await prisma.subscription.upsert({
        where: { userId },
        update: {
          plan: tier,
          status,
          lemonStatus: opts.status,
          lemonCustomerId: attrs.customer_id ? String(attrs.customer_id) : undefined,
          lemonSubscriptionId: subscriptionId ?? undefined,
          lemonVariantId: attrs.variant_id ? String(attrs.variant_id) : undefined,
          creditsLimit: plan.creditsPerMonth,
          ...(opts.resetCredits ? { creditsUsed: 0 } : {}),
          currentPeriodEnd: opts.renewsAt ? new Date(opts.renewsAt) : opts.endsAt ? new Date(opts.endsAt) : undefined,
          cancelAtPeriodEnd: Boolean(attrs.cancelled),
        },
        create: {
          userId,
          plan: tier,
          status,
          lemonStatus: opts.status,
          lemonCustomerId: attrs.customer_id ? String(attrs.customer_id) : null,
          lemonSubscriptionId: subscriptionId ?? null,
          lemonVariantId: attrs.variant_id ? String(attrs.variant_id) : null,
          creditsLimit: plan.creditsPerMonth,
          currentPeriodEnd: opts.renewsAt ? new Date(opts.renewsAt) : null,
        },
      });
    }, 'webhook-lemon');
  };

  const tierFromMeta = (typeof custom.tier === 'string' ? (custom.tier as PlanTier) : null) ?? planFromVariant(attrs.variant_id)?.tier ?? null;

  try {
    switch (eventName) {
      case 'subscription_created':
      case 'subscription_resumed':
      case 'subscription_unpaused': {
        const tier = tierFromMeta ?? 'PRO';
        await applyPlan(tier, { status: attrs.status ?? 'active', renewsAt: attrs.renews_at, resetCredits: true });
        applied.push(`${eventName} → plan=${tier} (reinicio de créditos)`);
        break;
      }
      case 'subscription_updated': {
        const tier = tierFromMeta;
        if (!tier) {
          applied.push(`${eventName}: variante desconocida (${attrs.variant_id}) — configura LEMON_VARIANT_* en el entorno`);
          break;
        }
        await applyPlan(tier, { status: attrs.status ?? 'active', renewsAt: attrs.renews_at });
        applied.push(`${eventName} → estado=${attrs.status}`);
        break;
      }
      case 'subscription_payment_success': {
        const tier = tierFromMeta ?? 'PRO';
        await applyPlan(tier, { status: 'active', renewsAt: attrs.renews_at, resetCredits: true });
        applied.push('pago renovado → créditos reiniciados');
        break;
      }
      case 'subscription_payment_failed': {
        const tier = tierFromMeta ?? 'PRO';
        await applyPlan(tier, { status: 'past_due' });
        applied.push('pago fallido → estado PAST_DUE (aviso enviado al cliente)');
        const { alertUser } = await import('./alerts');
        await alertUser(userId, 'billing', {
          title: 'Tu pago no ha podido procesarse',
          body: 'Lemon Squeezy no ha podido cobrar tu suscripción. Actualiza tu método de pago para no perder el plan.',
          link: '/billing',
        });
        break;
      }
      case 'subscription_cancelled':
      case 'subscription_expired': {
        await applyPlan('TRIAL', { status: 'cancelled' });
        applied.push(`${eventName} → plan de prueba`);
        break;
      }
      case 'order_created': {
        applied.push(`pedido ${payload?.data?.id ?? ''} registrado (sin cambios de plan)`);
        break;
      }
      default:
        applied.push(`${eventName}: evento ignorado`);
    }
  } catch (err) {
    return { ok: false, error: (err as Error).message, applied };
  }

  return { ok: true, applied };
}

/** Texto de ayuda para la pantalla de facturación y el centro de conexión. */
export function lemonStatusSummary() {
  const variants = (['STARTER', 'PRO', 'ENTERPRISE'] as PlanTier[]).flatMap((t) =>
    (['monthly', 'yearly'] as const).map((i) => ({ tier: t, interval: i, present: Boolean(lemonVariantIdFor(t, i)) })),
  );
  return {
    configured: lemonConfigured(),
    checkoutReady: lemonCheckoutReady(),
    variantsPresent: variants.filter((v) => v.present).length,
    variantsTotal: variants.length,
    plans: Object.values(PLANS).filter((p) => p.tier !== 'TRIAL').length,
  };
}
