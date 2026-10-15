/**
 * src/lib/alerts.ts — Avisos al cliente por correo.
 *
 * Cuatro tipos, cada uno desactivable por el propio usuario en Configuración:
 *   • sync      → un producto no se pudo sincronizar (fallo real, no pasajero)
 *   • stock     → un producto se quedó sin stock / volvió a tener stock
 *   • webhooks  → una tienda envió un webhook con firma inválida (posible ataque o mala configuración)
 *   • billing   → problema de pago de su suscripción
 *
 * Dos reglas de diseño:
 *   1. Un aviso NUNCA tumba la operación que lo provoca (igual que el correo de
 *      verificación): si el envío falla, se registra y se sigue.
 *   2. Anti-spam: por (cliente, tipo) hay un intervalo mínimo entre correos, para
 *      que un barrido con 200 productos fallidos no genere 200 correos.
 *      (El freno es por proceso; con varias réplicas el peor caso es algún correo
 *      repetido, nunca una avalancha.)
 */
import { prisma } from './prisma';
import { currentTenant, withSystem } from './tenant-context';
import { sendMail, mailLayout } from './mail';

export type AlertKind = 'sync' | 'stock' | 'webhooks' | 'billing' | 'onboarding';

const PREFERENCE_FIELD: Record<
  AlertKind,
  'alertSyncFailures' | 'alertStockChanges' | 'alertWebhookErrors' | 'alertBilling' | 'alertOnboarding'
> = {
  sync: 'alertSyncFailures',
  stock: 'alertStockChanges',
  webhooks: 'alertWebhookErrors',
  billing: 'alertBilling',
  onboarding: 'alertOnboarding',
};

const LABEL: Record<AlertKind, string> = {
  sync: 'sincronización',
  stock: 'stock',
  webhooks: 'webhooks',
  billing: 'facturación',
  onboarding: 'primeros pasos',
};

/** Intervalo mínimo entre correos del mismo tipo para el mismo cliente. */
const MIN_INTERVAL_MINUTES: Record<AlertKind, number> = {
  sync: 360,
  stock: 720,
  webhooks: 360,
  billing: 60,
  onboarding: 10080, // el recordatorio de primeros pasos es único (7 días de freno)
};

const lastSent = new Map<string, number>();

export interface AlertContent {
  title: string;
  body: string;
  link?: string;
  cta?: string;
}

export interface AlertResult {
  sent: boolean;
  reason?: 'preference-off' | 'throttled' | 'no-user' | 'mail-failed';
  transport?: string;
  error?: string;
}

/**
 * Envía un aviso al cliente. Devuelve `{ sent:false, reason }` sin lanzar nunca.
 */
export async function alertUser(userId: string, kind: AlertKind, content: AlertContent, opts: { minIntervalMinutes?: number; force?: boolean } = {}): Promise<AlertResult> {
  try {
    const active = currentTenant();
    const inOwnContext = active?.kind === 'tenant' && active.userId === userId;
    const load = () =>
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          email: true,
          name: true,
          alertSyncFailures: true,
          alertStockChanges: true,
          alertWebhookErrors: true,
          alertBilling: true,
          alertOnboarding: true,
        },
      });
    const user = inOwnContext ? await load() : await withSystem('alerts: leer destinatario del aviso', load);

    if (!user?.email) return { sent: false, reason: 'no-user' };
    if (!user[PREFERENCE_FIELD[kind]]) return { sent: false, reason: 'preference-off' };

    if (!opts.force) {
      const minutes = opts.minIntervalMinutes ?? MIN_INTERVAL_MINUTES[kind];
      const key = `${userId}:${kind}`;
      const last = lastSent.get(key) ?? 0;
      if (Date.now() - last < minutes * 60_000) return { sent: false, reason: 'throttled' };
      lastSent.set(key, Date.now());

      // Además del freno en memoria, se comprueba el último SyncLog de aviso
      // persistido en la base: sobrevive a reinicios del worker.
      const recent = await (inOwnContext
        ? prisma.auditLog.findFirst({ where: { userId, action: `alert.${kind}` }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } })
        : withSystem('alerts: comprobar último aviso', () =>
            prisma.auditLog.findFirst({ where: { userId, action: `alert.${kind}` }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
          ));
      if (recent && Date.now() - recent.createdAt.getTime() < minutes * 60_000) return { sent: false, reason: 'throttled' };
    }

    const appUrl = (process.env.NEXTAUTH_URL ?? process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
    const link = content.link ? `${appUrl}${content.link.startsWith('/') ? content.link : `/${content.link}`}` : undefined;

    const result = await sendMail({
      to: user.email,
      subject: `[DropshipPilot] ${content.title}`,
      html: mailLayout(content.title, `${content.body}${content.body.includes('<') ? '' : ''}`, link ? { label: content.cta ?? 'Abrir el panel', url: link } : undefined),
    });

    // Deja rastro del aviso (sirve de freno persistente y de auditoría)
    const writeLog = () =>
      prisma.auditLog.create({
        data: {
          userId,
          action: `alert.${kind}`,
          metadata: { title: content.title, transport: result.transport, ok: result.ok, throttle: opts.minIntervalMinutes ?? MIN_INTERVAL_MINUTES[kind] },
        },
      });
    try {
      if (inOwnContext) await writeLog();
      else await withSystem('alerts: registrar aviso enviado', writeLog);
    } catch {
      /* el registro es secundario */
    }

    if (!result.ok) return { sent: false, reason: 'mail-failed', transport: result.transport, error: result.error };
    return { sent: true, transport: result.transport };
  } catch (err) {
    return { sent: false, reason: 'mail-failed', error: (err as Error).message };
  }
}

/** Preferencias del usuario + transporte de correo activo (para la interfaz). */
export async function alertSettings(userId: string) {
  const user = await withSystem('alerts: leer preferencias', () =>
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        email: true,
        alertSyncFailures: true,
        alertStockChanges: true,
        alertWebhookErrors: true,
        alertBilling: true,
        alertOnboarding: true,
      },
    }),
  );
  const transport = process.env.RESEND_API_KEY ? 'resend' : process.env.MAIL_WEBHOOK_URL ? 'webhook' : 'console';
  return {
    email: user?.email ?? null,
    prefs: {
      sync: user?.alertSyncFailures ?? true,
      stock: user?.alertStockChanges ?? true,
      webhooks: user?.alertWebhookErrors ?? true,
      billing: user?.alertBilling ?? true,
      onboarding: user?.alertOnboarding ?? true,
    },
    transport,
    deliverable: transport !== 'console',
    labels: LABEL,
  };
}

/** Actualiza preferencias (sólo los campos enviados). */
export async function updateAlertSettings(userId: string, patch: Partial<Record<AlertKind, boolean>>) {
  const data: Record<string, boolean> = {};
  for (const kind of Object.keys(patch) as AlertKind[]) {
    if (!(kind in PREFERENCE_FIELD)) continue;
    if (typeof patch[kind] === 'boolean') data[PREFERENCE_FIELD[kind]] = patch[kind] as boolean;
  }
  if (Object.keys(data).length === 0) return alertSettings(userId);
  await withSystem('alerts: guardar preferencias', () => prisma.user.update({ where: { id: userId }, data }));
  return alertSettings(userId);
}
