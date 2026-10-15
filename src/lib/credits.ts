/**
 * src/lib/credits.ts — Consumo y control de créditos por cliente.
 *
 * Cada plan incluye un número de créditos mensuales (extracciones, importaciones,
 * sincronizaciones y compras de pedidos). El consumo se registra en la tabla
 * Subscription para poder facturar por uso y evitar abusos.
 */
import { prisma, hasDatabase } from './prisma';
import { withTenant } from './tenant-context';
import { planFor, CreditsExhaustedError, type PlanDefinition } from './plans';

export interface CreditState {
  used: number;
  limit: number;
  remaining: number;
  plan: PlanDefinition;
}

export async function getCreditState(rawUserId: string): Promise<CreditState> {
  const userId = rawUserId;
  // Sin base de datos (o con el circuito abierto) se trabaja con el plan por
  // defecto y sin tocar la tabla: el identificador de respaldo del modo demo no
  // es una fila real de `User`, así que un UPSERT aquí reventaba con un error de
  // clave ajena (P2003) y tumbaba la petición entera.
  if (!hasDatabase()) {
    const plan = planFor('PRO');
    return { used: 0, limit: plan.creditsPerMonth, remaining: plan.creditsPerMonth, plan };
  }
  return withTenant(userId, async () => {
  const [user, subscription] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { plan: true } }),
    prisma.subscription.findUnique({ where: { userId }, select: { creditsUsed: true, creditsLimit: true } }),
  ]);

  const plan = planFor(user?.plan);
  const used = subscription?.creditsUsed ?? 0;
  const limit = subscription?.creditsLimit ?? plan.creditsPerMonth;
  return { used, limit, remaining: Math.max(0, limit - used), plan };
  }, 'credits');
}

/**
 * Consume créditos. Lanza `CreditsExhaustedError` si no hay saldo suficiente,
 * de modo que la operación no llega a ejecutarse.
 */
export async function consumeCredits(rawUserId: string, amount: number, reason: string): Promise<CreditState> {
  const userId = rawUserId;
  if (!hasDatabase()) {
    console.log(`[credits] modo degradado (sin base de datos): no se descuentan ${amount} crédito(s) · ${reason}`);
    return getCreditState(userId);
  }
  return withTenant(userId, async () => {
    const state = await getCreditState(userId);
    if (state.remaining < amount) throw new CreditsExhaustedError(state.plan);

    await prisma.subscription.upsert({
      where: { userId },
      update: { creditsUsed: { increment: amount } },
      create: { userId, plan: state.plan.tier, creditsUsed: amount, creditsLimit: state.plan.creditsPerMonth },
    });

    console.log(`[credits] ${amount} crédito(s) · ${reason} · usuario ${userId.slice(-6)} (${state.used + amount}/${state.limit})`);
    return { ...state, used: state.used + amount, remaining: state.remaining - amount };
  }, 'credits');
}

/**
 * Devuelve créditos consumidos. Se usa cuando una operación FALLA antes de
 * dejar producto: es de caja, no de cortesía — el cliente no paga por algo que
 * no ocurrió.
 */
export async function refundCredits(rawUserId: string, amount: number, reason: string): Promise<CreditState> {
  const userId = rawUserId;
  if (!hasDatabase()) return getCreditState(userId);
  return withTenant(userId, async () => {
    const state = await getCreditState(userId);
    const nextUsed = Math.max(0, state.used - amount);
    await prisma.subscription.update({ where: { userId }, data: { creditsUsed: nextUsed } }).catch(() => undefined);
    console.log(`[credits] devolución de ${amount} crédito(s) · ${reason} · usuario ${userId.slice(-6)} (${nextUsed}/${state.limit})`);
    return { ...state, used: nextUsed, remaining: Math.max(0, state.limit - nextUsed) };
  }, 'credits');
}

/** Se ejecuta al renovar el periodo (webhook de Stripe o cron mensual). */
export async function resetCredits(rawUserId: string) {
  const userId = rawUserId;
  if (!hasDatabase()) return;
  await withTenant(userId, () => prisma.subscription.update({ where: { userId }, data: { creditsUsed: 0 } }).catch(() => undefined), 'credits');
}
