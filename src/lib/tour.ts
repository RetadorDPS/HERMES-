/**
 * Estado del tutorial guiado, guardado en la cuenta del usuario (no en el
 * navegador): así no le vuelve a salir si entra desde el móvil.
 *
 *   tourVersion  → versión del tutorial aceptada o descartada. Si la app saca
 *                  una versión nueva (más pasos), vuelve a ofrecerse.
 *   tourSeenAt   → cuándo se aceptó, se completó o se descartó.
 */
import { hasDatabase, prisma } from './prisma';
import { withCurrentTenant } from './tenant';
import { withTenant } from './tenant-context';
import { TOUR_PENDING, TOUR_STARTED, TOUR_VERSION } from './tour-steps';

export { TOUR_VERSION, TOUR_STARTED, TOUR_STEPS, TOUR_INTRO, TOUR_SIDE_STEPS, ADMIN_TOUR_STEPS, ADMIN_TOUR_INTRO } from './tour-steps';
export type { TourStep } from './tour-steps';

/** Ámbito del tutorial: el del cliente (12 pasos) o el del operador (5 pasos) */
export type TourScope = 'user' | 'admin';

export type TourDecision = 'none' | 'accepted' | 'completed' | 'dismissed';

export interface TourState {
  /** true = hay que ofrecer la tarjeta de bienvenida (nunca lo ha decidido) */
  shouldOffer: boolean;
  /** true = lo aceptó y va por la mitad: se reanuda sin preguntar */
  inProgress: boolean;
  decision: TourDecision;
  /** El usuario ya decidió sobre esta versión (lo terminó o lo saltó) */
  completed: boolean;
  version: number;
  seenAt: string | null;
}

export const TOUR_ACTIONS = ['accept', 'complete', 'dismiss', 'restart'] as const;
export type TourAction = (typeof TOUR_ACTIONS)[number];

const EMPTY: TourState = { shouldOffer: false, inProgress: false, decision: 'none', completed: false, version: 0, seenAt: null };

/** Estado del tutorial del usuario que tiene la sesión abierta */
export async function tourState(scope: TourScope = 'user', userIdExplicito?: string): Promise<TourState> {
  if (!hasDatabase()) return EMPTY;
  const leer = async (userId: string): Promise<TourState> => {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { tourVersion: true, tourSeenAt: true, adminTourVersion: true, adminTourSeenAt: true },
    });
    if (!user) return EMPTY;
    const version = (scope === 'admin' ? user.adminTourVersion : user.tourVersion) ?? 0;
    const seenAt = scope === 'admin' ? user.adminTourSeenAt : user.tourSeenAt;
    const completed = version >= TOUR_VERSION;
    return {
      shouldOffer: version <= TOUR_PENDING,
      inProgress: version === TOUR_STARTED,
      decision: completed ? ('completed' as const) : version === TOUR_STARTED ? ('accepted' as const) : ('none' as const),
      completed,
      version,
      seenAt: seenAt?.toISOString() ?? null,
    };
  };
  if (userIdExplicito) return withTenant(userIdExplicito, () => leer(userIdExplicito), 'tour');
  return withCurrentTenant(leer).catch(() => EMPTY);
}

/**
 * Guarda lo que ha decidido el usuario. `restart` borra la marca para que la
 * tarjeta vuelva a ofrecerse (es lo que hace el botón «Ver el tutorial otra vez»).
 */
export async function saveTourState(
  action: TourAction,
  meta: { ip?: string; userAgent?: string | null } = {},
  scope: TourScope = 'user',
  userIdExplicito?: string,
): Promise<TourState> {
  if (!hasDatabase()) return EMPTY;

  const version = action === 'restart' ? TOUR_PENDING : action === 'accept' ? TOUR_STARTED : TOUR_VERSION;
  const seenAt = action === 'restart' ? null : new Date();
  const patch =
    scope === 'admin'
      ? { adminTourVersion: version, adminTourSeenAt: seenAt }
      : { tourVersion: version, tourSeenAt: seenAt };

  const guardar = async (userId: string): Promise<TourState> => {
    await prisma.user.update({ where: { id: userId }, data: patch });
    if (action !== 'accept') {
      await prisma.auditLog.create({
        data: {
          userId,
          action: `tour.${scope === 'admin' ? 'admin.' : ''}${action}`,
          ip: meta.ip ?? null,
          metadata: { version: TOUR_VERSION, scope, userAgent: meta.userAgent ?? null },
        },
      });
    }
    return {
      shouldOffer: version <= TOUR_PENDING,
      inProgress: version === TOUR_STARTED,
      decision: version >= TOUR_VERSION ? ('completed' as const) : version === TOUR_STARTED ? ('accepted' as const) : ('none' as const),
      completed: version >= TOUR_VERSION,
      version,
      seenAt: seenAt?.toISOString() ?? null,
    } satisfies TourState;
  };
  if (userIdExplicito) return withTenant(userIdExplicito, () => guardar(userIdExplicito), 'tour');
  return withCurrentTenant(guardar).catch(() => EMPTY);
}
