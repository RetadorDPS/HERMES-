/**
 * src/lib/stripe.ts — Facturación del SaaS con Stripe.
 *
 * Flujo:
 *   1. El cliente pulsa «Cambiar a Pro» → `createCheckoutSession()` devuelve la
 *      URL de Stripe Checkout (pago y suscripción los gestiona Stripe).
 *   2. Stripe envía webhooks a `/api/webhooks/stripe` con la firma
 *      `Stripe-Signature`: aquí se sincroniza el plan, el estado y los créditos
 *      del cliente (`handleStripeEvent`).
 *   3. El portal de cliente permite cambiar método de pago o cancelar.
 *
 * Si STRIPE_SECRET_KEY no está configurada, el módulo responde `configured:false`
 * y la aplicación sigue funcionando (planes gestionados a mano por el operador).
 */
import type Stripe from 'stripe';
import { prisma } from './prisma';
import { withSystem, withTenant } from './tenant-context';
import { PLANS, planFor } from './plans';
import type { PlanTier } from '@prisma/client';

let cached: Stripe | null = null;

export function stripeConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET);
}

async function client(): Promise<Stripe | null> {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  if (cached) return cached;
  const { default: StripeSdk } = await import('stripe');
  cached = new StripeSdk(process.env.STRIPE_SECRET_KEY, { apiVersion: '2025-01-27.acacia' as any, typescript: true });
  return cached;
}

/** Precio de Stripe asociado a un plan y ciclo (se configuran por entorno) */
export function priceIdFor(tier: PlanTier, interval: 'monthly' | 'yearly') {
  const env = PLANS[tier]?.stripePriceEnv;
  if (!env) return null;
  return process.env[interval === 'monthly' ? env.monthly : env.yearly] ?? null;
}

/** Devuelve (creando si hace falta) el customer de Stripe del usuario */
export async function ensureCustomer(userId: string): Promise<{ id: string } | null> {
  const stripe = await client();
  if (!stripe) return null;

  const user = await prisma.user.findUnique({ where: { id: userId }, include: { subscription: true } });
  if (!user) return null;
  if (user.subscription?.stripeCustomerId) return { id: user.subscription.stripeCustomerId };

  const customer = await stripe.customers.create({
    email: user.email,
    name: user.name ?? undefined,
    metadata: { userId: user.id },
  });

  await prisma.subscription.upsert({
    where: { userId: user.id },
    update: { stripeCustomerId: customer.id },
    create: { userId: user.id, stripeCustomerId: customer.id, plan: user.plan, creditsLimit: planFor(user.plan).creditsPerMonth },
  });

  return { id: customer.id };
}

export interface CheckoutResult {
  ok: boolean;
  url?: string;
  error?: string;
  configured: boolean;
}

/** Crea la sesión de pago (suscripción) para un plan. */
export async function createCheckoutSession(input: {
  userId: string;
  tier: PlanTier;
  interval: 'monthly' | 'yearly';
  successUrl: string;
  cancelUrl: string;
}): Promise<CheckoutResult> {
  const stripe = await client();
  if (!stripe) {
    return {
      ok: false,
      configured: false,
      error:
        'Stripe no está configurado en esta instalación (faltan STRIPE_SECRET_KEY y STRIPE_WEBHOOK_SECRET). El plan se puede asignar a mano desde el panel de administración.',
    };
  }

  const priceId = priceIdFor(input.tier, input.interval);
  if (!priceId) {
    return { ok: false, configured: true, error: `Falta el precio de Stripe para el plan ${input.tier} (${input.interval}). Define STRIPE_PRICE_${input.tier}_${input.interval.toUpperCase()} en el entorno.` };
  }

  const customer = await ensureCustomer(input.userId);
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customer?.id,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    allow_promotion_codes: true,
    subscription_data: { metadata: { userId: input.userId, tier: input.tier } },
    metadata: { userId: input.userId, tier: input.tier },
  });

  return { ok: true, configured: true, url: session.url ?? undefined };
}

/** Portal de cliente de Stripe (cambiar tarjeta, facturas, cancelar) */
export async function createPortalSession(input: { userId: string; returnUrl: string }): Promise<CheckoutResult> {
  const stripe = await client();
  if (!stripe) return { ok: false, configured: false, error: 'Stripe no está configurado en esta instalación.' };

  const customer = await ensureCustomer(input.userId);
  if (!customer) return { ok: false, configured: true, error: 'No se pudo identificar al cliente en Stripe.' };

  const session = await stripe.billingPortal.sessions.create({ customer: customer.id, return_url: input.returnUrl });
  return { ok: true, configured: true, url: session.url };
}

/** Verifica y procesa un webhook de Stripe. Devuelve el resumen de lo aplicado. */
export async function handleStripeEvent(rawBody: string, signature: string | null) {
  const stripe = await client();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) return { ok: false, error: 'Stripe no configurado' };
  if (!signature) return { ok: false, error: 'Falta la cabecera Stripe-Signature' };

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, secret);
  } catch (err) {
    return { ok: false, error: `Firma inválida: ${(err as Error).message}` };
  }

  const applied: string[] = [];

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = (session.metadata?.userId as string) || null;
      const tier = (session.metadata?.tier as PlanTier) ?? 'PRO';
      if (userId) {
        const plan = planFor(tier);
        // El evento identifica al cliente en su metadata: el cambio de plan y de
        // suscripción se hace DENTRO de su contexto (aislamiento multi-cliente).
        await withTenant(userId, async () => {
        await prisma.user.update({ where: { id: userId }, data: { plan: tier } });
        await prisma.subscription.upsert({
          where: { userId },
          update: {
            plan: tier,
            status: 'ACTIVE',
            stripeCustomerId: String(session.customer ?? ''),
            stripeSubscriptionId: String(session.subscription ?? ''),
            creditsLimit: plan.creditsPerMonth,
            creditsUsed: 0,
          },
          create: {
            userId,
            plan: tier,
            status: 'ACTIVE',
            stripeCustomerId: String(session.customer ?? ''),
            stripeSubscriptionId: String(session.subscription ?? ''),
            creditsLimit: plan.creditsPerMonth,
          },
        });
        }, 'webhook-stripe');
        applied.push(`plan=${tier} para el usuario ${userId.slice(-6)}`);
      }
      break;
    }

    case 'customer.subscription.updated':
    case 'customer.subscription.created': {
      const sub = event.data.object as Stripe.Subscription;
      const userId = sub.metadata?.userId ?? null;
      // Sin userId en la metadata hay que localizar al cliente por el id de
      // suscripción de Stripe: eso cruza clientes, así que se hace en modo
      // sistema y el trabajo posterior va en el contexto del dueño encontrado.
      const record = userId
        ? { userId }
        : await withSystem('webhook de Stripe: localizar al cliente por id de suscripción', () =>
            prisma.subscription.findFirst({ where: { stripeSubscriptionId: sub.id }, select: { userId: true } }),
          );
      if (record) {
        const tier = (sub.metadata?.tier as PlanTier) ?? undefined;
        await withTenant(record.userId, async () => {
        await prisma.subscription.update({
          where: { userId: record.userId },
          data: {
            status: sub.status === 'active' ? 'ACTIVE' : sub.status === 'trialing' ? 'TRIALING' : sub.status === 'canceled' ? 'CANCELED' : 'PAST_DUE',
            currentPeriodEnd: new Date((sub as any).current_period_end * 1000),
            cancelAtPeriodEnd: sub.cancel_at_period_end,
            ...(tier ? { plan: tier } : {}),
            ...(tier ? { creditsLimit: planFor(tier).creditsPerMonth } : {}),
          },
        });
        if (tier) await prisma.user.update({ where: { id: record.userId }, data: { plan: tier } });
        }, 'webhook-stripe');
        applied.push(`subscription=${sub.status}`);
      }
      break;
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription;
      const record = await withSystem('webhook de Stripe: localizar al cliente por id de suscripción', () =>
        prisma.subscription.findFirst({ where: { stripeSubscriptionId: sub.id }, select: { userId: true } }),
      );
      if (record) {
        await withTenant(record.userId, async () => {
          await prisma.subscription.update({ where: { userId: record.userId }, data: { status: 'CANCELED', plan: 'TRIAL' } });
          await prisma.user.update({ where: { id: record.userId }, data: { plan: 'TRIAL' } });
        }, 'webhook-stripe');
        applied.push('suscripción cancelada → plan de prueba');
      }
      break;
    }

    case 'invoice.paid': {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = String(invoice.customer ?? '');
      const record = await withSystem('webhook de Stripe: localizar al cliente por id de cliente', () =>
        prisma.subscription.findFirst({ where: { stripeCustomerId: customerId }, select: { userId: true } }),
      );
      if (record) {
        // Renovación del ciclo → se reinician los créditos del mes
        await withTenant(record.userId, () =>
          prisma.subscription.update({
            where: { userId: record.userId },
            data: { creditsUsed: 0, status: 'ACTIVE' },
          }),
          'webhook-stripe',
        );
        applied.push('créditos reiniciados por renovación');
      }
      break;
    }

    default:
      applied.push(`evento ignorado: ${event.type}`);
  }

  return { ok: true, type: event.type, applied };
}
