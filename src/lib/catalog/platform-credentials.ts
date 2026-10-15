/**
 * src/lib/catalog/platform-credentials.ts — Claves de la PLATAFORMA.
 *
 * Idea de negocio: **el cliente nunca pega claves de proveedor**. El operador
 * (tú) las configura UNA vez —en el panel de administración o por variables de
 * entorno— y todos los usuarios buscan e importan con ellas, sin verlas.
 *
 * Precedencia al resolver un proveedor para un usuario:
 *   1. Claves de la plataforma guardadas en la base de datos (cifradas).
 *   2. Variables de entorno (cómodo para el despliegue con Docker).
 *   3. Cuenta propia del usuario (opcional: quien quiera usar su cuenta de CJ,
 *      por ejemplo para facturar diferente, sigue pudiendo conectarla).
 *
 * Además: cuota mensual por proveedor para la plataforma (si la API tiene un
 * límite, se registra aquí para no agotarlo sin darnos cuenta).
 */
import { prisma } from '../prisma';
import { withSystem } from '../tenant-context';
import { decryptSecret, encryptSecret, maskSecret } from '../crypto';
import { buildClient, clientFromAccount } from '../supplier-apis';
import type { SupplierApiClient, SupplierCredentials } from '../supplier-apis/types';
import type { SupplierType, SupplierAccountStatus } from '@prisma/client';

export interface CredentialField {
  key: string;
  label: string;
  hint?: string;
  secret?: boolean;
}

/** Campos de credenciales y de dónde se leen si vienen del entorno. */
export const PROVIDER_FIELDS: Record<string, { name: string; fields: CredentialField[]; envMap: Record<string, string> }> = {
  ALIEXPRESS: {
    name: 'AliExpress',
    fields: [
      { key: 'appKey', label: 'App Key' },
      { key: 'appSecret', label: 'App Secret', secret: true },
      { key: 'accessToken', label: 'Access Token (OAuth)', hint: 'Necesario para precios reales y pedidos', secret: true },
      { key: 'apiRegion', label: 'Región del gateway', hint: 'sg (por defecto) o eu' },
    ],
    envMap: {
      appKey: 'ALIEXPRESS_APP_KEY',
      appSecret: 'ALIEXPRESS_APP_SECRET',
      accessToken: 'ALIEXPRESS_ACCESS_TOKEN',
      apiRegion: 'ALIEXPRESS_API_REGION',
    },
  },
  CJ_DROPSHIPPING: {
    name: 'CJ Dropshipping',
    fields: [
      { key: 'email', label: 'Email de la cuenta CJ' },
      { key: 'apiKey', label: 'API Key', hint: 'CJ → Autorización → API Key', secret: true },
    ],
    envMap: { email: 'CJ_EMAIL', apiKey: 'CJ_API_KEY' },
  },
  AMAZON: {
    name: 'Amazon',
    fields: [
      { key: 'accessKey', label: 'Access Key' },
      { key: 'secretKey', label: 'Secret Key', secret: true },
      { key: 'partnerTag', label: 'Partner Tag' },
      { key: 'marketplace', label: 'Marketplace', hint: 'es, de, fr, it, uk, us' },
    ],
    envMap: {
      accessKey: 'AMAZON_ACCESS_KEY',
      secretKey: 'AMAZON_SECRET_KEY',
      partnerTag: 'AMAZON_PARTNER_TAG',
      marketplace: 'AMAZON_MARKETPLACE',
    },
  },
};

export const PLATFORM_PROVIDERS: SupplierType[] = ['ALIEXPRESS', 'CJ_DROPSHIPPING', 'AMAZON'];

/** Credenciales del entorno (si están definidas). */
export function credentialsFromEnv(provider: SupplierType): SupplierCredentials | null {
  const spec = PROVIDER_FIELDS[provider];
  if (!spec) return null;
  const creds: SupplierCredentials = {};
  for (const [key, envName] of Object.entries(spec.envMap)) {
    const value = process.env[envName];
    if (value) creds[key] = value;
  }
  // La clave más importante: sin ella no hay cliente utilizable
  const requiredKey = provider === 'CJ_DROPSHIPPING' ? 'apiKey' : provider === 'AMAZON' ? 'accessKey' : 'appKey';
  return creds[requiredKey] ? creds : null;
}

/** Lee la fila de credenciales de plataforma (modo sistema: es global). */
export async function platformCredentialRow(provider: SupplierType) {
  return withSystem('catálogo: leer credenciales de plataforma', () =>
    prisma.platformCredential.findUnique({ where: { provider } }),
  );
}

/** Credenciales de plataforma en claro (memoria), con su origen. */
export async function platformCredentials(provider: SupplierType): Promise<{ credentials: SupplierCredentials; source: 'database' | 'env' } | null> {
  const row = await platformCredentialRow(provider).catch(() => null);
  if (row?.isEnabled && row.credentialsEnc) {
    try {
      const credentials = JSON.parse(decryptSecret(row.credentialsEnc) || '{}');
      if (Object.keys(credentials).length) return { credentials, source: 'database' };
    } catch {
      /* credenciales corruptas: se intenta el entorno */
    }
  }
  const fromEnv = credentialsFromEnv(provider);
  if (fromEnv) return { credentials: fromEnv, source: 'env' };
  return null;
}

/** Guarda (o actualiza) las claves de la plataforma para un proveedor. */
export async function savePlatformCredentials(input: {
  provider: SupplierType;
  credentials: SupplierCredentials;
  label?: string;
  monthlyQuota?: number | null;
  settings?: Record<string, unknown>;
}) {
  const clean: SupplierCredentials = {};
  for (const [k, v] of Object.entries(input.credentials)) {
    if (typeof v === 'string' && v.trim()) clean[k] = v.trim();
  }
  const row = await withSystem('catálogo: guardar credenciales de plataforma', () =>
    prisma.platformCredential.upsert({
      where: { provider: input.provider },
      update: {
        credentialsEnc: encryptSecret(JSON.stringify(clean)),
        label: input.label ?? undefined,
        isEnabled: true,
        status: 'PENDING',
        lastError: null,
        ...(input.monthlyQuota !== undefined ? { monthlyQuota: input.monthlyQuota } : {}),
        ...(input.settings ? { settings: input.settings as any } : {}),
      },
      create: {
        provider: input.provider,
        credentialsEnc: encryptSecret(JSON.stringify(clean)),
        label: input.label ?? 'Plataforma',
        status: 'PENDING',
        monthlyQuota: input.monthlyQuota ?? null,
        settings: (input.settings ?? {}) as any,
      },
    }),
  );
  return row;
}

/** Cliente listo para usar con las claves de la plataforma (o null). */
export async function platformClient(provider: SupplierType): Promise<{ client: SupplierApiClient; source: 'database' | 'env' } | null> {
  const found = await platformCredentials(provider);
  if (!found) return null;
  const client = buildClient(provider, found.credentials);
  if (!client) return null;
  return { client, source: found.source };
}

/**
 * Resuelve el cliente para un usuario concreto: plataforma primero; si no hay,
 * su propia cuenta (opcional). Devuelve también de dónde salió, para poder
 * mostrarlo en la interfaz («Gestionado por la plataforma» / «Tu cuenta»).
 */
export async function resolveProviderClient(
  userId: string | null | undefined,
  provider: SupplierType,
): Promise<{ client: SupplierApiClient; source: 'platform' | 'env' | 'user'; label: string } | null> {
  const platform = await platformClient(provider);
  if (platform) {
    return {
      client: platform.client,
      source: platform.source === 'database' ? 'platform' : 'env',
      label: platform.source === 'database' ? 'Gestionado por la plataforma' : 'Claves del servidor',
    };
  }
  if (!userId) return null;

  const account = await withSystem('catálogo: buscar cuenta propia del usuario', () =>
    prisma.supplierAccount.findFirst({
      where: { userId, provider, status: 'CONNECTED' },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    }),
  );
  if (!account) return null;
  const client = clientFromAccount(account);
  if (!client) return null;
  return { client, source: 'user', label: account.label };
}

/** Comprueba las claves contra la API real y guarda el resultado. */
export async function testPlatformConnection(provider: SupplierType) {
  const found = await platformClient(provider);
  if (!found) {
    return { ok: false, source: null as null | string, message: `No hay claves configuradas para ${PROVIDER_FIELDS[provider]?.name ?? provider}` };
  }
  const result = await found.client.testConnection();
  if (found.source === 'database') {
    await withSystem('catálogo: registrar prueba de credenciales', () =>
      prisma.platformCredential.update({
        where: { provider },
        data: { status: result.ok ? 'CONNECTED' : 'ERROR', lastTestAt: new Date(), lastError: result.ok ? null : result.message },
      }),
    ).catch(() => undefined);
  }
  return { ...result, source: found.source };
}

/** Estado de cada proveedor para el panel de administración. */
export async function platformCredentialSummary() {
  const rows = await withSystem('catálogo: resumen de credenciales', () => prisma.platformCredential.findMany()).catch(() => []);

  return PLATFORM_PROVIDERS.map((provider) => {
    const spec = PROVIDER_FIELDS[provider];
    const row = rows.find((r) => r.provider === provider) ?? null;
    const envCreds = credentialsFromEnv(provider);
    let masked: { key: string; label: string; value: string; secret: boolean }[] = [];

    if (row?.credentialsEnc) {
      try {
        const creds = JSON.parse(decryptSecret(row.credentialsEnc) || '{}');
        masked = spec.fields.map((f) => ({ key: f.key, label: f.label, value: maskSecret(creds[f.key] ?? '', 4), secret: Boolean(f.secret) }));
      } catch {
        masked = [];
      }
    } else if (envCreds) {
      masked = spec.fields.map((f) => ({ key: f.key, label: f.label, value: maskSecret(envCreds[f.key] ?? '', 4), secret: Boolean(f.secret) }));
    }

    return {
      provider,
      name: spec.name,
      fields: spec.fields,
      configured: Boolean(row?.credentialsEnc) || Boolean(envCreds),
      source: row?.credentialsEnc ? ('database' as const) : envCreds ? ('env' as const) : null,
      enabled: row?.isEnabled ?? Boolean(envCreds),
      status: (row?.status ?? (envCreds ? 'CONNECTED' : null)) as SupplierAccountStatus | null,
      lastTestAt: row?.lastTestAt ?? null,
      lastError: row?.lastError ?? null,
      masked,
      quota: row ? { monthly: row.monthlyQuota, used: row.usedThisMonth, resetAt: row.quotaResetAt } : null,
      catalogItems: 0,
    };
  });
}

/**
 * Consume cuota de plataforma. La cuota se reinicia cada mes natural.
 * Si la cuota está agotada, devuelve `{ ok:false }` para que quien llama pueda
 * avisar («estamos al límite del proveedor, inténtalo mañana»).
 */
export async function consumePlatformQuota(provider: SupplierType, units = 1): Promise<{ ok: boolean; used: number; limit: number | null }> {
  const row = await platformCredentialRow(provider).catch(() => null);
  if (!row) return { ok: true, used: 0, limit: null };

  const now = new Date();
  const needsReset = !row.quotaResetAt || row.quotaResetAt.getMonth() !== now.getMonth() || row.quotaResetAt.getFullYear() !== now.getFullYear();
  const used = needsReset ? 0 : row.usedThisMonth;
  const limit = row.monthlyQuota;

  if (limit !== null && used + units > limit) {
    return { ok: false, used, limit };
  }

  await withSystem('catálogo: consumir cuota de plataforma', () =>
    prisma.platformCredential.update({
      where: { provider },
      data: { usedThisMonth: used + units, quotaResetAt: needsReset ? now : row.quotaResetAt ?? now },
    }),
  ).catch(() => undefined);

  return { ok: true, used: used + units, limit };
}

/** Borra las claves guardadas (deja de servirse catálogo con ellas). */
export async function clearPlatformCredentials(provider: SupplierType) {
  await withSystem('catálogo: borrar credenciales de plataforma', () =>
    prisma.platformCredential.upsert({
      where: { provider },
      update: { credentialsEnc: '', isEnabled: false, status: 'DISABLED', lastError: null },
      create: { provider, credentialsEnc: '', isEnabled: false, status: 'DISABLED' },
    }),
  );
}
