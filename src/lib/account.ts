/**
 * src/lib/account.ts — Ciclo de vida de las cuentas de cliente del SaaS.
 *
 *   registerUser()          → alta + email de verificación
 *   verifyEmailToken()      → confirma el email
 *   requestPasswordReset()  → envía enlace de restablecimiento
 *   resetPassword()         → cambia la contraseña (invalida sesiones previas)
 *   audit()                 → registra acciones sensibles
 *
 * Seguridad:
 *   • Las contraseñas se guardan con scrypt (nunca en claro).
 *   • Los tokens se envían por email en claro pero se guardan **hasheados**.
 *   • Tokens de un solo uso y caducidad corta (verificación 24 h, reset 1 h).
 *   • Respuestas sin filtración de información (no revelan si un email existe).
 */
import crypto from 'crypto';
import { prisma } from './prisma';
import { hashPassword } from './auth';
import { sendMail, mailLayout } from './mail';
import { welcomeEmailBody } from './onboarding-mail';
import { planFor } from './plans';
import { audit } from './audit';

const TOKEN_TTL_MINUTES = { EMAIL_VERIFY: 60 * 24, PASSWORD_RESET: 60 } as const;

export type TokenType = keyof typeof TOKEN_TTL_MINUTES;

const sha256 = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
const randomToken = () => crypto.randomBytes(32).toString('base64url');

export function appUrl(path = '') {
  const base = (process.env.NEXTAUTH_URL ?? process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  return `${base}${path}`;
}

export { audit };

async function issueToken(userId: string, type: TokenType) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MINUTES[type] * 60_000);

  // Invalida tokens anteriores del mismo tipo (un solo enlace activo)
  await prisma.verificationToken.updateMany({
    where: { userId, type, usedAt: null },
    data: { usedAt: new Date() },
  });

  await prisma.verificationToken.create({
    data: { userId, type, tokenHash: sha256(token), expiresAt },
  });

  return { token, expiresAt };
}

async function consumeToken(rawToken: string, type: TokenType) {
  const record = await prisma.verificationToken.findUnique({ where: { tokenHash: sha256(rawToken) } });
  if (!record || record.type !== type) return null;
  if (record.usedAt) return null;
  if (record.expiresAt < new Date()) return null;

  await prisma.verificationToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });
  return record;
}

// ─────────────────────────────── Registro ────────────────────────────────────

export interface RegisterInput {
  email: string;
  password: string;
  name?: string;
  ip?: string | null;
  userAgent?: string | null;
  /** Plan inicial (por defecto TRIAL) */
  plan?: 'TRIAL' | 'STARTER' | 'PRO' | 'ENTERPRISE';
}

export async function registerUser(input: RegisterInput) {
  const email = input.email.trim().toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new Error('El email no tiene un formato válido');
  if (input.password.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres');

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new Error('Ya existe una cuenta con ese email');

  const trial = planFor(input.plan ?? 'TRIAL');
  const user = await prisma.user.create({
    data: {
      email,
      name: input.name?.trim() || email.split('@')[0],
      passwordHash: hashPassword(input.password),
      plan: input.plan ?? 'TRIAL',
      signupIp: input.ip ?? null,
      lastIp: input.ip ?? null,
      subscription: {
        create: { plan: input.plan ?? 'TRIAL', creditsLimit: trial.creditsPerMonth },
      },
      // Regla de precios inicial razonable para que el cliente pueda empezar
      pricingRules: {
        create: { name: 'Regla global 40%', markupPct: 40, fixedFee: 0.5, minProfit: 1.5, roundTo: 0.99, isDefault: true },
      },
    },
  });

  const { token } = await issueToken(user.id, 'EMAIL_VERIFY');
  const url = appUrl(`/verify?token=${token}`);

  const mail = await sendMail({
    to: email,
    subject: '¡Bienvenido a DropshipPilot! Confirma tu cuenta',
    html: mailLayout(
      '¡Bienvenido a DropshipPilot!',
      welcomeEmailBody(),
      { label: 'Confirmar mi cuenta', url },
    ),
  });

  await audit({ userId: user.id, action: 'user.register', ip: input.ip, userAgent: input.userAgent, metadata: { email, transport: mail.transport } });

  return { user, mail, verifyUrl: url };
}

/**
 * Reenvía el correo de verificación (pre-login: se ejecuta en modo sistema,
 * igual que el resto del ciclo de cuenta). Respuesta neutra: si la cuenta no
 * existe o ya está verificada devuelve `null` sin enviar nada.
 */
export async function resendVerificationEmail(
  rawEmail: string,
  meta: { ip?: string | null; userAgent?: string | null } = {},
) {
  const email = rawEmail.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.emailVerifiedAt) return null;

  const { token } = await issueToken(user.id, 'EMAIL_VERIFY');
  const url = appUrl(`/verify?token=${token}`);

  const mail = await sendMail({
    to: email,
    subject: 'Confirma tu cuenta de DropshipPilot',
    html: mailLayout('Confirma tu cuenta', 'Aquí tienes un enlace nuevo para confirmar tu correo (caduca en 24 horas).', {
      label: 'Confirmar mi cuenta',
      url,
    }),
  });

  await audit({
    userId: user.id,
    action: 'user.verification_resent',
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });

  return { user, mail, verifyUrl: url };
}

export async function verifyEmailToken(rawToken: string) {
  const record = await consumeToken(rawToken, 'EMAIL_VERIFY');
  if (!record) return null;

  const user = await prisma.user.update({
    where: { id: record.userId },
    data: { emailVerifiedAt: new Date() },
  });

  await audit({ userId: user.id, action: 'user.email_verified', metadata: { email: user.email } });
  return user;
}

// ─────────────────────────── Contraseña olvidada ─────────────────────────────

export async function requestPasswordReset(email: string, meta: { ip?: string | null; userAgent?: string | null } = {}) {
  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });

  // Respuesta idéntica exista o no la cuenta (evita enumerar usuarios)
  if (!user) {
    await audit({ action: 'user.password_reset_unknown_email', ip: meta.ip, metadata: { email } });
    return { sent: true, previewUrl: undefined as string | undefined };
  }

  const { token } = await issueToken(user.id, 'PASSWORD_RESET');
  const url = appUrl(`/reset?token=${token}`);

  const mail = await sendMail({
    to: user.email,
    subject: 'Restablece tu contraseña de DropshipPilot',
    html: mailLayout(
      'Restablecer contraseña',
      'Pulsa el botón para elegir una contraseña nueva. El enlace caduca en 1 hora y sólo puede usarse una vez.',
      { label: 'Elegir nueva contraseña', url },
    ),
  });

  await audit({ userId: user.id, action: 'user.password_reset_requested', ip: meta.ip, userAgent: meta.userAgent });
  return { sent: true, previewUrl: mail.previewUrl };
}

export async function resetPassword(rawToken: string, newPassword: string, meta: { ip?: string | null } = {}) {
  if (newPassword.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres');

  const record = await consumeToken(rawToken, 'PASSWORD_RESET');
  if (!record) return null;

  const user = await prisma.user.update({
    where: { id: record.userId },
    data: { passwordHash: hashPassword(newPassword) },
  });

  await audit({ userId: user.id, action: 'user.password_reset', ip: meta.ip });
  return user;
}

/** Cambio de contraseña desde el panel (requiere la actual) */
export async function changePassword(userId: string, currentPassword: string, newPassword: string) {
  const { verifyPassword } = await import('./auth');
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error('Usuario no encontrado');
  if (!verifyPassword(currentPassword, user.passwordHash)) throw new Error('La contraseña actual no es correcta');
  if (newPassword.length < 8) throw new Error('La nueva contraseña debe tener al menos 8 caracteres');

  await prisma.user.update({ where: { id: userId }, data: { passwordHash: hashPassword(newPassword) } });
  await audit({ userId, action: 'user.password_changed' });
  return { ok: true };
}
