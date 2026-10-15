/**
 * GET  /api/supplier-accounts  → lista de cuentas de proveedor del cliente
 * POST /api/supplier-accounts  → crea/actualiza una conexión (credenciales cifradas)
 *
 * Las credenciales NUNCA se devuelven: sólo una máscara. Se guardan cifradas con
 * AES-256-GCM en `SupplierAccount.credentialsEnc`.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { encryptSecret, decryptSecret, maskSecret } from '@/lib/crypto';
import { apiTenant, withCurrentTenant } from '@/lib/tenant';
import { PROVIDERS, buildClient } from '@/lib/supplier-apis';
import { planFor, assertWithinLimit } from '@/lib/plans';
import { audit } from '@/lib/audit';
import { clientIp, rateLimit, tooManyRequests } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PROVIDER_VALUES = ['ALIEXPRESS', 'CJ_DROPSHIPPING', 'AMAZON', 'ALIBABA', 'TEMU'] as const;

export async function GET() {
  return apiTenant(async (userId) => {
    const accounts = await prisma.supplierAccount.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });

    const [user, usage] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { plan: true } }),
      prisma.supplierAccount.count({ where: { userId } }),
    ]);
    const plan = planFor(user?.plan);

    return NextResponse.json({
      ok: true,
      providers: PROVIDERS,
      plan: { tier: plan.tier, name: plan.name, maxSupplierAccounts: plan.maxSupplierAccounts, used: usage },
      accounts: accounts.map((a) => ({
        id: a.id,
        provider: a.provider,
        label: a.label,
        status: a.status,
        isDefault: a.isDefault,
        lastTestAt: a.lastTestAt,
        lastError: a.lastError,
        // Sólo la máscara: p. ej. «eyJhbG…9f2c»
        credentialsMask: maskSecret(safeFirstValue(a.credentialsEnc), 6),
        settings: a.settings,
        createdAt: a.createdAt,
      })),
    });
  });
}

/** Primer valor legible de las credenciales descifradas (para la máscara) */
function safeFirstValue(enc: string): string {
  try {
    const obj = JSON.parse(decryptSecret(enc) || '{}');
    return String(Object.values(obj)[0] ?? '');
  } catch {
    return '';
  }
}

const schema = z.object({
  provider: z.enum(PROVIDER_VALUES),
  label: z.string().min(2, 'Ponle un nombre a la conexión').max(60),
  credentials: z.record(z.string()),
  isDefault: z.boolean().optional(),
  settings: z.record(z.any()).optional(),
});

export async function POST(req: Request) {
  const limit = rateLimit(`supplier-account:${clientIp(req)}`, 30, 10 * 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfterSeconds);

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.issues.map((i) => i.message).join(', ') }, { status: 422 });
  }

  return apiTenant(async (userId) => {
    const { provider, label, credentials, isDefault, settings } = parsed.data;

    const definition = PROVIDERS.find((p) => p.provider === provider);
    if (!definition?.available) {
      return NextResponse.json({ ok: false, error: `El proveedor ${provider} todavía no tiene API soportada` }, { status: 400 });
    }

    // ── Límite del plan ────────────────────────────────────────────────────
    const [user, existing, count] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { plan: true } }),
      prisma.supplierAccount.findFirst({ where: { userId, provider, label } }),
      prisma.supplierAccount.count({ where: { userId } }),
    ]);
    const plan = planFor(user?.plan);
    try {
      if (!existing) assertWithinLimit('supplierAccounts', { products: 0, stores: 0, supplierAccounts: count, creditsUsed: 0 }, plan);
    } catch (err) {
      return NextResponse.json({ ok: false, error: (err as Error).message, code: 'PLAN_LIMIT' }, { status: 402 });
    }

    // ── Validación de credenciales contra la API real (si se pide) ─────────
    const client = buildClient(provider, credentials);
    let test: Awaited<ReturnType<NonNullable<typeof client>['testConnection']>> | null = null;
    if (client) test = await client.testConnection();

    const data = {
      userId,
      provider,
      label,
      credentialsEnc: encryptSecret(JSON.stringify(credentials)),
      status: test?.ok ? ('CONNECTED' as const) : ('ERROR' as const),
      lastTestAt: new Date(),
      lastError: test?.ok ? null : (test?.message ?? 'Sin verificar'),
      settings: (settings ?? {}) as any,
      isDefault: Boolean(isDefault),
    };

    const account = existing
      ? await prisma.supplierAccount.update({ where: { id: existing.id }, data })
      : await prisma.supplierAccount.create({ data });

    if (isDefault) {
      await prisma.supplierAccount.updateMany({ where: { userId, provider, NOT: { id: account.id } }, data: { isDefault: false } });
    }

    await audit({
      userId,
      action: 'supplier_account.connected',
      ip: clientIp(req),
      metadata: { provider, label, ok: Boolean(test?.ok), message: test?.message },
    });

    return NextResponse.json(
      {
        ok: true,
        account: {
          id: account.id,
          provider: account.provider,
          label: account.label,
          status: account.status,
          isDefault: account.isDefault,
          lastTestAt: account.lastTestAt,
        },
        test,
        message: test?.ok
          ? 'Conexión validada contra la API del proveedor.'
          : `Conexión guardada, pero la verificación falló: ${test?.message ?? 'sin respuesta'}. Revisa las credenciales y vuelve a probar.`,
      },
      { status: existing ? 200 : 201 },
    );
  });
}
