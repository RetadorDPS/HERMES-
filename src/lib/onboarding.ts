/**
 * Primeros pasos: la lista que acompaña al cliente nuevo en la portada.
 *
 * No es una lista de deseos: cada casilla se marca **leyendo la base de datos**
 * (¿tiene una tienda conectada?, ¿ya importó algo?, ¿el robot ya ha trabajado?).
 * Cuando están todas hechas la tarjeta desaparece sola, y el cliente puede
 * ocultarla antes si no la quiere (y recuperarla desde Configuración).
 */
import { hasDatabase, prisma } from './prisma';
import { withCurrentTenant } from './tenant';
import { withTenant } from './tenant-context';
import { TOUR_VERSION } from './tour-steps';

export interface ChecklistTask {
  key: string;
  label: string;
  hint: string;
  done: boolean;
  /** A dónde lleva el botón de la tarea */
  href: string;
  action: string;
}

export interface ChecklistState {
  tasks: ChecklistTask[];
  done: number;
  total: number;
  /** El cliente la ha ocultado a mano */
  hidden: boolean;
  /** Todas hechas: la tarjeta ya no se muestra */
  complete: boolean;
  /** Lo que se ve en el panel */
  visible: boolean;
}

const DEMO_TASKS: ChecklistTask[] = [
  { key: 'tour', label: 'Haz el recorrido guiado', hint: '2 minutos y conoces las 12 pantallas', done: false, href: '/dashboard', action: 'tour' },
  { key: 'store', label: 'Conecta tu tienda', hint: 'Shopify en un clic o WooCommerce con sus claves', done: false, href: '/stores', action: 'link' },
  { key: 'product', label: 'Importa tu primer producto', hint: 'Desde el catálogo o pegando una URL', done: false, href: '/catalog', action: 'link' },
  { key: 'sync', label: 'Deja que el robot lo vigile', hint: 'Precios y stock cada hora, solo', done: false, href: '/monitor', action: 'link' },
  { key: 'billing', label: 'Elige cómo cobrar', hint: 'Tu pasarela o un vendedor que liquida el IVA', done: false, href: '/billing', action: 'link' },
];

const EMPTY: ChecklistState = { tasks: DEMO_TASKS, done: 0, total: 5, hidden: false, complete: false, visible: false };

export async function checklistState(userIdExplicito?: string): Promise<ChecklistState> {
  if (!hasDatabase()) return EMPTY;
  if (userIdExplicito) return withTenant(userIdExplicito, () => compute(userIdExplicito), 'checklist');
  return withCurrentTenant((userId) => compute(userId)).catch(() => EMPTY);
}

async function compute(userId: string): Promise<ChecklistState> {
  {
    const resultado = await (async () => {
    const [user, stores, products, syncLogs, subscription] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { tourVersion: true, onboardingHiddenAt: true } }),
      prisma.store.count({ where: { userId, status: 'CONNECTED' } }),
      prisma.product.count({ where: { userId } }),
      prisma.syncLog.count({ where: { userId, status: 'SUCCESS' } }),
      prisma.subscription.findUnique({ where: { userId }, select: { plan: true, stripeCustomerId: true, lemonCustomerId: true } }),
    ]);

    const paying = Boolean(subscription?.stripeCustomerId || subscription?.lemonCustomerId) || (subscription?.plan ?? 'TRIAL') !== 'TRIAL';

    const tasks: ChecklistTask[] = [
      {
        key: 'tour',
        label: 'Haz el recorrido guiado',
        hint: '2 minutos y conoces las 12 pantallas',
        done: (user?.tourVersion ?? 0) >= TOUR_VERSION,
        href: '/dashboard',
        action: 'tour',
      },
      {
        key: 'store',
        label: 'Conecta tu tienda',
        hint: 'Shopify en un clic o WooCommerce con sus claves',
        done: stores > 0,
        href: '/stores',
        action: 'link',
      },
      {
        key: 'product',
        label: 'Importa tu primer producto',
        hint: 'Desde el catálogo o pegando una URL',
        done: products > 0,
        href: '/catalog',
        action: 'link',
      },
      {
        key: 'sync',
        label: 'Deja que el robot lo vigile',
        hint: 'Precios y stock cada hora, solo',
        done: syncLogs > 0,
        href: '/monitor',
        action: 'link',
      },
      {
        key: 'billing',
        label: 'Elige cómo cobrar',
        hint: 'Tu pasarela o un vendedor que liquida el IVA por ti',
        done: paying,
        href: '/billing',
        action: 'link',
      },
    ];

    const done = tasks.filter((t) => t.done).length;
    const hidden = Boolean(user?.onboardingHiddenAt);
    const complete = done === tasks.length;
    return { tasks, done, total: tasks.length, hidden, complete, visible: !hidden && !complete };
    })();
    return resultado;
  }
}

/** Oculta o vuelve a mostrar la tarjeta (lo decide el cliente) */
export async function setChecklistVisibility(hidden: boolean, userIdExplicito?: string) {
  if (!hasDatabase()) return EMPTY;
  const aplicar = async (userId: string) => {
    await prisma.user.update({ where: { id: userId }, data: { onboardingHiddenAt: hidden ? new Date() : null } });
    return { ...(await compute(userId)), hidden };
  };
  if (userIdExplicito) return withTenant(userIdExplicito, () => aplicar(userIdExplicito), 'checklist');
  return withCurrentTenant(aplicar).catch(() => EMPTY);
}
