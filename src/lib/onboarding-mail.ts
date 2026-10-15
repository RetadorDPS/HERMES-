/**
 * Correos de acompañamiento del cliente nuevo.
 *
 *  1. El de bienvenida (lo manda el alta) incluye la lista de primeros pasos.
 *  2. Y, si al día siguiente sigue con tareas pendientes, recibe **un solo**
 *     recordatorio con lo que le falta. Nunca más de uno: la marca
 *     `User.onboardingNudgedAt` lo impide, y el cliente puede apagarlos en
 *     Configuración (aviso `onboarding`).
 */
import { prisma } from './prisma';
import { hasDatabase } from './prisma';
import { withSystem } from './tenant-context';
import { checklistState, type ChecklistTask } from './onboarding';
import { sendMail, mailLayout } from './mail';
import { appUrl } from './account';

/** Cuánto tiempo se deja pasar antes de recordar (horas) */
const NUDGE_AFTER_HOURS = Number(process.env.ONBOARDING_NUDGE_HOURS ?? 24);
/** Interruptor general de estos correos */
export const onboardingEmailsEnabled = () => process.env.ONBOARDING_EMAILS !== 'false';

const LINK_POR_TAREA: Record<string, string> = {
  tour: '/dashboard',
  store: '/stores',
  product: '/catalog',
  sync: '/monitor',
  billing: '/billing',
};

/** Bloque HTML con la lista de primeros pasos, para meterlo en un correo */
export function stepsHtml(tasks: ChecklistTask[], base = appUrl('')): string {
  const filas = tasks
    .map((t) => {
      const url = `${base}${LINK_POR_TAREA[t.key] ?? t.href}`;
      const marca = t.done ? '✅' : '⬜️';
      const nombre = t.done ? `<s style="opacity:.55">${t.label}</s>` : `<b>${t.label}</b>`;
      return `<tr><td style="padding:8px 0;font-size:14px;color:#c9d6e6;">${marca} <a href="${url}" style="color:#a78bfa;text-decoration:none;">${nombre}</a> — <span style="color:#8ea0b5;">${t.hint}</span></td></tr>`;
    })
    .join('');
  const hechas = tasks.filter((t) => t.done).length;
  return `
    <table style="width:100%;border-collapse:collapse;margin:16px 0 4px;border-top:1px solid #23303f;padding-top:10px;">
      <tr><td style="padding:12px 0 4px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#8ea0b5;">
        Tus primeros pasos · ${hechas} de ${tasks.length} hechos
      </td></tr>
      ${filas}
    </table>`;
}

/** Los cinco pasos tal y como salen en un correo de bienvenida (todos pendientes) */
export function welcomeStepsHtml(base = appUrl('')): string {
  const pendientes: ChecklistTask[] = [
    { key: 'tour', label: 'Haz el recorrido guiado', hint: '2 minutos por las 12 pantallas', done: false, href: '/dashboard', action: 'tour' },
    { key: 'store', label: 'Conecta tu tienda', hint: 'Shopify en un clic o WooCommerce con sus claves', done: false, href: '/stores', action: 'link' },
    { key: 'product', label: 'Importa tu primer producto', hint: 'desde el catálogo o pegando una URL', done: false, href: '/catalog', action: 'link' },
    { key: 'sync', label: 'Deja que el robot lo vigile', hint: 'revisa precio y stock cada hora', done: false, href: '/monitor', action: 'link' },
    { key: 'billing', label: 'Elige cómo cobrar', hint: 'tu pasarela o un vendedor que liquida el IVA', done: false, href: '/billing', action: 'link' },
  ];
  return stepsHtml(pendientes, base);
}

/** Cuerpo del correo de bienvenida (lo usa el alta) */
export function welcomeEmailBody(base = appUrl('')): string {
  return [
    'Confirma tu dirección de correo para activar tu cuenta (el enlace caduca en 24 horas).',
    'Cuando entres no estarás solo delante de un panel vacío: la plataforma te va llevando pantalla por pantalla. Esto es lo que hay que hacer:',
    welcomeStepsHtml(base),
    '<p style="font-size:13px;color:#8ea0b5;margin:14px 0 0;">Tranquilo, no hay prisa. Y si estos correos te sobran, se apagan en <b>Configuración → Avisos por correo</b>.</p>',
  ].join('<br>');
}

export interface NudgeResult {
  candidates: number;
  sent: number;
  skipped: number;
  details: { userId: string; email: string; pending: number; sent: boolean; reason?: string }[];
}

/**
 * Envía el recordatorio a quien lleva más de `NUDGE_AFTER_HOURS` con tareas
 * pendientes. Devuelve el detalle (lo usan el worker y las pruebas).
 */
export async function runOnboardingNudges({ limit = 50, dryRun = false } = {}): Promise<NudgeResult> {
  const resultado: NudgeResult = { candidates: 0, sent: 0, skipped: 0, details: [] };
  if (!hasDatabase() || !onboardingEmailsEnabled()) return resultado;

  const corte = new Date(Date.now() - NUDGE_AFTER_HOURS * 3600_000);

  const candidatos = await withSystem('onboarding-mail: buscar a quién recordar', () =>
    prisma.user.findMany({
      where: {
        createdAt: { lte: corte },
        emailVerifiedAt: { not: null },
        onboardingNudgedAt: null,
        alertOnboarding: true,
        tourVersion: { lt: 99 }, // no filtra por tutorial: eso lo decide la lista
      },
      select: { id: true, email: true, name: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
      take: limit,
    }),
  );

  resultado.candidates = candidatos.length;

  for (const candidato of candidatos) {
    const estado = await checklistState(candidato.id);
    if (estado.complete || estado.hidden) {
      resultado.skipped++;
      resultado.details.push({ userId: candidato.id, email: candidato.email, pending: estado.total - estado.done, sent: false, reason: estado.complete ? 'ya terminado' : 'lista oculta' });
      continue;
    }

    const pendientes = estado.tasks.filter((t) => !t.done);
    if (dryRun) {
      resultado.details.push({ userId: candidato.id, email: candidato.email, pending: pendientes.length, sent: false, reason: 'ensayo' });
      continue;
    }

    const base = appUrl('');
    const mail = await sendMail({
      to: candidato.email,
      subject: `Tu tienda aún no vende sola: te queda${pendientes.length === 1 ? '' : 'n'} ${pendientes.length} paso${pendientes.length === 1 ? '' : 's'}`,
      html: mailLayout(
        `Hola ${candidato.name ?? ''}`.trim() || 'Hola',
        `Te registraste ayer y veo que te queda${pendientes.length === 1 ? '' : 'n'} ${pendientes.length} paso${pendientes.length === 1 ? '' : 's'} por dar. Son un par de minutos y es lo único que separa tu tienda de vender sola:<br>${stepsHtml(estado.tasks, base)}`,
        { label: 'Seguir donde lo dejé', url: `${base}${LINK_POR_TAREA[pendientes[0].key] ?? '/'}` },
      ),
    });

    await withSystem('onboarding-mail: marcar recordatorio enviado', async () => {
      await prisma.user.update({ where: { id: candidato.id }, data: { onboardingNudgedAt: new Date() } });
      await prisma.auditLog.create({
        data: {
          userId: candidato.id,
          action: 'onboarding.nudged',
          metadata: { pending: pendientes.length, tasks: pendientes.map((t) => t.key), transport: mail.transport, ok: mail.ok },
        },
      });
    });

    if (mail.ok) resultado.sent++;
    else resultado.skipped++;
    resultado.details.push({ userId: candidato.id, email: candidato.email, pending: pendientes.length, sent: mail.ok, reason: mail.ok ? undefined : mail.transport });
  }

  return resultado;
}
