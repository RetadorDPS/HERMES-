/**
 * src/lib/auth.ts — Autenticación (NextAuth v4 · Credentials).
 *
 * Modelo soportado:
 *   • SaaS multi-cliente: cada usuario es una fila de `User` con su
 *     `passwordHash` (scrypt) y su suscripción. `signup()` crea la cuenta.
 *   • Autoevaluación / demo: con AUTH_ENABLED=false el panel es navegable sin
 *     login y todo funciona sobre la cuenta por defecto.
 *   • Cuenta de propietario por entorno: AUTH_EMAIL + AUTH_PASSWORD permiten
 *     entrar sin depender de la base de datos (útil en instalaciones propias).
 *
 * Reglas de seguridad:
 *   • Con AUTH_ENABLED=true la app **falla cerrada**: sin AUTH_EMAIL o usuarios
 *     en base de datos, nadie entra.
 *   • `REQUIRE_EMAIL_VERIFICATION=true` bloquea el acceso hasta confirmar el
 *     correo (recomendado cuando el SaaS es público).
 *   • Cada intento (acertado o no) queda registrado en AuditLog.
 */
import crypto from 'crypto';
import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { hasDatabase, prisma } from '@/lib/prisma';
import { audit } from '@/lib/audit';
import { planFor } from '@/lib/plans';
import { rateLimit } from './rate-limit';
import { hashRecoveryCode, verifyTotp } from './totp';
import { decryptSecret } from './crypto';

export const DEFAULT_DEMO_EMAIL = 'demo@dropshippilot.io';
export const DEFAULT_DEMO_PASSWORD = 'dropshippilot';

export const authEnabled = () => process.env.AUTH_ENABLED === 'true';
const requireVerification = () => process.env.REQUIRE_EMAIL_VERIFICATION === 'true';

/** Hash de contraseña con scrypt (sin dependencias externas) */
export function hashPassword(password: string) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string | null | undefined) {
  if (!stored || !stored.startsWith('scrypt:')) return false;
  const [, salt, hash] = stored.split(':');
  const candidate = crypto.scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(candidate, 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export const authOptions: NextAuthOptions = {
  session: { strategy: 'jwt', maxAge: 60 * 60 * 24 * 30 },
  pages: { signIn: '/login', error: '/login' },
  providers: [
    CredentialsProvider({
      name: 'Credenciales',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Contraseña', type: 'password' },
        code: { label: 'Código 2FA (si lo tienes activado)', type: 'text' },
      },
      async authorize(credentials, req) {
        const email = credentials?.email?.trim().toLowerCase() ?? '';
        const password = credentials?.password ?? '';
        if (!email || !password) return null;

        const ip = (req?.headers?.['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? null;
        const userAgent = (req?.headers?.['user-agent'] as string) ?? null;

        const fail = async (reason: string, userId?: string) => {
          await audit({ userId: userId ?? null, action: 'auth.login_failed', ip, userAgent, metadata: { email, reason } });
          return null;
        };

        // ── 0. Freno a la fuerza bruta ───────────────────────────────────
        // 10 intentos por IP+email cada 15 min; al superarlos, bloqueo de 15 min.
        // Se comprueba ANTES de tocar la contraseña.
        const throttle = rateLimit(`login:${ip ?? 'sin-ip'}:${email}`, 10, 15 * 60_000, 15 * 60_000);
        if (!throttle.ok) {
          await fail('bloqueado_por_intentos', undefined);
          return null;
        }

        // ── 1. Cuenta de propietario definida por entorno ────────────────
        const envEmail = (process.env.AUTH_EMAIL ?? '').toLowerCase();
        const envPassword = process.env.AUTH_PASSWORD;
        if (envEmail && envPassword && email === envEmail && password === envPassword) {
          await audit({ action: 'auth.login_owner_env', ip, userAgent, metadata: { email } });

          // Si además existe en la base de datos, entramos con su id real para
          // que el aislamiento multi-cliente funcione con sus datos.
          if (hasDatabase()) {
            const dbUser = await prisma.user.findUnique({ where: { email } });
            if (dbUser) {
              await prisma.user.update({ where: { id: dbUser.id }, data: { lastLoginAt: new Date(), lastIp: ip } });
              return { id: dbUser.id, email: dbUser.email, name: dbUser.name ?? dbUser.email, plan: dbUser.plan } as any;
            }
          }
          return { id: 'env-user', email: envEmail, name: process.env.AUTH_NAME ?? 'Owner', plan: 'ENTERPRISE' } as any;
        }

        // ── 2. Usuario registrado en la base de datos ────────────────────
        if (hasDatabase()) {
          try {
            const user = await prisma.user.findUnique({ where: { email } });
            if (!user) return fail('usuario_inexistente');
            if (!user.passwordHash) return fail('sin_contraseña', user.id);
            if (!verifyPassword(password, user.passwordHash)) return fail('contraseña_incorrecta', user.id);

            // ── Segundo factor (TOTP) ────────────────────────────────────
            // Si la cuenta lo tiene activo, la contraseña sola NO entra.
            if (user.totpEnabledAt) {
              const code = String(credentials?.code ?? '').trim();
              if (!code) return fail('2fa_requerida', user.id);

              const secret = user.totpSecretEnc ? decryptSecret(user.totpSecretEnc) : '';
              const byApp = verifyTotp(secret, code);

              // Código de recuperación (un solo uso) si no es un código de la app
              let byRecovery = false;
              if (!byApp && code.replace(/[\s-]/g, '').length >= 8) {
                const hash = hashRecoveryCode(code);
                if (user.totpRecoveryCodes.includes(hash)) {
                  byRecovery = true;
                  await prisma.user.update({
                    where: { id: user.id },
                    data: { totpRecoveryCodes: user.totpRecoveryCodes.filter((h) => h !== hash) },
                  });
                }
              }

              if (!byApp && !byRecovery) return fail('2fa_incorrecta', user.id);
            }

            if (requireVerification() && !user.emailVerifiedAt) {
              return fail('email_sin_verificar', user.id);
            }

            await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date(), lastIp: ip } });
            await audit({ userId: user.id, action: 'auth.login', ip, userAgent, metadata: { email } });

            return { id: user.id, email: user.email, name: user.name ?? user.email, plan: user.plan } as any;
          } catch (err) {
            console.error('[auth] error consultando la base de datos:', (err as Error).message.split('\n')[0]);
          }
        }

        // ── 3. Credenciales de demostración ──────────────────────────────
        // Sólo con la autenticación desactivada (o pedido explícitamente).
        const demoAllowed = !authEnabled() || process.env.ALLOW_DEMO_LOGIN === 'true';
        if (demoAllowed && email === DEFAULT_DEMO_EMAIL && password === DEFAULT_DEMO_PASSWORD) {
          await audit({ action: 'auth.login_demo', ip, userAgent });
          return { id: 'demo-user', email: DEFAULT_DEMO_EMAIL, name: 'Modo demo', plan: 'PRO' } as any;
        }

        if (authEnabled() && !envEmail && !process.env.ALLOW_DEMO_LOGIN) {
          console.warn('[auth] AUTH_ENABLED=true sin AUTH_EMAIL/AUTH_PASSWORD y sin usuarios: nadie puede entrar (fallo cerrado).');
        }
        return fail('credenciales_inválidas');
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.uid = (user as any).id;
        token.plan = (user as any).plan;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.uid;
        (session.user as any).plan = planFor((token.plan as any) ?? 'TRIAL').name;
      }
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};
