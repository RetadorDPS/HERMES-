/**
 * /api/admin/platform-credentials — Claves de proveedor de LA PLATAFORMA.
 *
 * Sólo el administrador (el operador del servicio) puede ver este panel: aquí se
 * guardan UNA vez las claves de AliExpress / CJ / Amazon y desde ese momento
 * TODOS los clientes las usan sin verlas ni configurarlas.
 *
 *   GET    → estado de cada proveedor (valores enmascarados, cuota, última prueba)
 *   POST   → { action: 'save' | 'test' | 'sync' } guardar / probar / descargar catálogo
 *   DELETE → ?provider=CJ_DROPSHIPPING  borrar las claves guardadas
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { currentAdmin, canOperate } from '@/lib/admin';
import {
  clearPlatformCredentials,
  platformCredentialSummary,
  savePlatformCredentials,
  testPlatformConnection,
  PROVIDER_FIELDS,
} from '@/lib/catalog/platform-credentials';
import { syncCatalog } from '@/lib/catalog';
import { hasDatabase, prisma } from '@/lib/prisma';
import { withSystem } from '@/lib/tenant-context';
import type { SupplierType } from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const PROVIDERS: SupplierType[] = ['CJ_DROPSHIPPING', 'ALIEXPRESS', 'AMAZON'];

async function guard(write = false) {
  const admin = await currentAdmin();
  if (!admin) return NextResponse.json({ ok: false, error: 'Sólo el administrador de la plataforma puede gestionar las claves', code: 'FORBIDDEN' }, { status: 403 });
  // En modo evaluación (sin sesión y sin LOCAL_ADMIN_MODE) se puede consultar el
  // estado —siempre enmascarado— pero NO guardar, borrar ni probar claves.
  if (write && !canOperate(admin)) {
    return NextResponse.json(
      { ok: false, error: 'Modo evaluación: para cambiar las claves inicia sesión como administrador o activa LOCAL_ADMIN_MODE=true en el servidor.', code: 'READ_ONLY' },
      { status: 403 },
    );
  }
  return null;
}

async function catalogCounts() {
  if (!hasDatabase()) return [] as { provider: string; source: string; items: number; lastSync: Date | null }[];
  const grouped = await withSystem('catálogo: contar por proveedor', () =>
    prisma.catalogItem.groupBy({ by: ['provider', 'source'], _count: { _all: true }, _max: { lastSyncedAt: true } }),
  ).catch(() => [] as any[]);
  return (grouped as any[]).map((g) => ({
    provider: String(g.provider),
    source: String(g.source),
    items: Number(g._count?._all ?? 0),
    lastSync: (g._max?.lastSyncedAt as Date) ?? null,
  }));
}

export async function GET() {
  const denied = await guard();
  if (denied) return denied;
  const admin = await currentAdmin();

  const [summary, counts] = await Promise.all([platformCredentialSummary(), catalogCounts()]);

  return NextResponse.json({
    ok: true,
    providers: summary.map((p) => ({
      ...p,
      catalogItems: counts.filter((c) => c.provider === p.provider).reduce((acc, c) => acc + c.items, 0),
      catalogReal: counts.filter((c) => c.provider === p.provider && c.source === 'api').reduce((acc, c) => acc + c.items, 0),
      lastSync: counts.find((c) => c.provider === p.provider && c.source === 'api')?.lastSync ?? null,
    })),
    catalog: {
      total: counts.reduce((a, c) => a + c.items, 0),
      real: counts.filter((c) => c.source === 'api').reduce((a, c) => a + c.items, 0),
      sample: counts.filter((c) => c.source === 'sample').reduce((a, c) => a + c.items, 0),
      lastSync: counts.filter((c) => c.source === 'api').reduce<Date | null>((acc, c) => (!c.lastSync ? acc : !acc || c.lastSync > acc ? c.lastSync : acc), null),
    },
    admin: { source: admin?.source, readOnly: Boolean(admin?.readOnly) },
    envFallback: Object.fromEntries(
      PROVIDERS.map((p) => [p, Object.values(PROVIDER_FIELDS[p].envMap).some((name) => Boolean(process.env[name]))]),
    ),
  });
}

const bodySchema = z.object({
  action: z.enum(['save', 'test', 'sync', 'clear']),
  provider: z.enum(['CJ_DROPSHIPPING', 'ALIEXPRESS', 'AMAZON']),
  credentials: z.record(z.string()).optional(),
  monthlyQuota: z.coerce.number().int().min(0).nullable().optional(),
  pages: z.coerce.number().int().min(1).max(10).optional(),
  keyword: z.string().max(80).optional(),
  categories: z.boolean().optional(),
  test: z.boolean().optional(),
});

export async function POST(req: Request) {
  const denied = await guard(true);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON inválido' }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.issues.map((i) => i.message).join(', ') }, { status: 422 });
  }
  const { action, provider } = parsed.data;

  try {
    if (action === 'clear') {
      await clearPlatformCredentials(provider);
      return NextResponse.json({ ok: true, message: `Claves de ${provider} borradas`, providers: await platformCredentialSummary() });
    }

    if (action === 'test') {
      const result = await testPlatformConnection(provider);
      return NextResponse.json({ ok: result.ok, message: result.message, latencyMs: (result as any).latencyMs, missing: (result as any).missing ?? [], providers: await platformCredentialSummary() });
    }

    if (action === 'sync') {
      const result = await syncCatalog({
        provider,
        pages: parsed.data.pages ?? 1,
        keyword: parsed.data.keyword,
        categories: parsed.data.categories ?? true,
      });
      const entry = result.report[0];
      return NextResponse.json({
        ok: Boolean(entry?.ok),
        message: entry ? `${PROVIDER_FIELDS[provider].name}: ${entry.message}` : 'Sin cambios',
        report: result.report,
        catalog: await catalogCounts(),
      });
    }

    // action === 'save'
    const credentials = parsed.data.credentials ?? {};
    const missing = PROVIDER_FIELDS[provider].fields
      .filter((f) => f.secret || f.key === 'appKey' || f.key === 'email' || f.key === 'accessKey')
      .filter((f) => !String(credentials[f.key] ?? '').trim())
      .map((f) => f.label);
    if (missing.length) {
      return NextResponse.json({ ok: false, error: `Faltan datos: ${missing.join(', ')}` }, { status: 422 });
    }

    await savePlatformCredentials({
      provider,
      credentials,
      monthlyQuota: parsed.data.monthlyQuota ?? null,
    });

    let test: { ok: boolean; message: string } | null = null;
    if (parsed.data.test !== false) test = await testPlatformConnection(provider);

    return NextResponse.json({
      ok: true,
      message: test ? test.message : 'Claves guardadas (cifradas)',
      test,
      providers: await platformCredentialSummary(),
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const denied = await guard();
  if (denied) return denied;
  const provider = new URL(req.url).searchParams.get('provider') as SupplierType | null;
  if (!provider || !PROVIDERS.includes(provider)) {
    return NextResponse.json({ ok: false, error: 'Proveedor no válido' }, { status: 422 });
  }
  await clearPlatformCredentials(provider);
  return NextResponse.json({ ok: true, providers: await platformCredentialSummary() });
}
