/**
 * scripts/verify-credits.ts — Prueba de planes, límites y créditos por cliente.
 *
 *   npx tsx scripts/verify-credits.ts
 */
import '../workers/env';
import { prisma } from '../src/lib/prisma';
import { withSystem, withTenant } from '../src/lib/tenant-context';
import { getCreditState, consumeCredits, resetCredits } from '../src/lib/credits';
import { planFor, assertWithinLimit, PlanLimitError, CreditsExhaustedError } from '../src/lib/plans';

const ok = (c: boolean, msg: string, extra = '') => console.log(`${c ? '✔' : '✘'} ${msg}${extra ? ' — ' + extra : ''}`);

async function main() {
  const users = await withSystem('prueba de créditos', () =>
    prisma.user.findMany({ orderBy: { createdAt: 'asc' }, select: { id: true, email: true, plan: true } }),
  );
  const [a, b] = users;
  if (!a || !b) { console.log('✘ hacen falta 2 usuarios'); process.exit(1); }

  const beforeA = await getCreditState(a.id);
  const beforeB = await getCreditState(b.id);

  await consumeCredits(a.id, 5, 'prueba automática');
  const afterA = await getCreditState(a.id);
  ok(afterA.used === beforeA.used + 5, 'Consumir créditos incrementa el contador del cliente', `${beforeA.used} → ${afterA.used}`);

  const afterB = await getCreditState(b.id);
  ok(afterB.used === beforeB.used, 'El consumo de un cliente NO afecta al otro', `B sigue en ${afterB.used}`);

  let exhausted = false;
  try { await consumeCredits(a.id, afterA.limit + 1, 'prueba de agotamiento'); }
  catch (err) { exhausted = err instanceof CreditsExhaustedError; }
  ok(exhausted, 'Agotar el saldo lanza CreditsExhaustedError (la operación no llega a ejecutarse)');

  let limited = false;
  try { assertWithinLimit('products', { products: 9999, stores: 0, supplierAccounts: 0, creditsUsed: 0 }, planFor('TRIAL')); }
  catch (err) { limited = err instanceof PlanLimitError; }
  ok(limited, 'El plan TRIAL corta al superar el número de productos', `límite: ${planFor('TRIAL').maxProducts}`);

  await resetCredits(a.id);
  const reset = await getCreditState(a.id);
  ok(reset.used === 0, 'La renovación del periodo reinicia los créditos', `queda en ${reset.used}`);

  const demo = await withTenant(a.id, () => prisma.product.count({ where: { userId: a.id } }));
  ok(typeof demo === 'number', 'Las consultas bajo contexto siguen respondiendo', `productos de A: ${demo}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
