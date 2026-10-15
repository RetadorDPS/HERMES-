/**
 * GET  /api/proxies → estado del pool de proxies del scraper service
 * POST /api/proxies → valida una lista de proxies con navegador real
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiTenant } from '@/lib/tenant';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;

const SERVICE_URL = () => process.env.SCRAPER_SERVICE_URL?.replace(/\/$/, '');

// Endpoint operativo: exige sesión (protege el pool de proxies y evita abuso
// del validador).
export async function GET() {
  return apiTenant(async () => {
  const url = SERVICE_URL();
  if (!url) {
    return NextResponse.json({
      ok: false,
      serviceUp: false,
      hint: 'Define SCRAPER_SERVICE_URL en .env.local (por defecto http://localhost:8000) y arranca el microservicio con `npm run scraper:dev`.',
    });
  }
  try {
    const res = await fetch(`${url}/proxies`, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    return NextResponse.json({ ok: true, serviceUp: true, ...data });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      serviceUp: false,
      hint: `El microservicio de scraping no responde en ${url} (${(err as Error).message}). Arrástralo con \`npm run scraper:dev\`.`,
    });
  }
  });
}

const testSchema = z.object({
  proxies: z.array(z.string().min(3)).min(1, 'Añade al menos un proxy').max(25, 'Máximo 25 proxies por lote'),
  targetUrl: z.string().nullable().optional(),
  timeoutMs: z.coerce.number().min(3000).max(60000).optional(),
});

export async function POST(req: Request) {
  return apiTenant(async () => {
  const url = SERVICE_URL();
  if (!url) return NextResponse.json({ ok: false, error: 'SCRAPER_SERVICE_URL no configurada' }, { status: 400 });

  const parsed = testSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.issues.map((i) => i.message).join(', ') }, { status: 422 });
  }

  const { proxies, targetUrl, timeoutMs } = parsed.data;

  try {
    const res = await fetch(`${url}/proxies/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        proxies,
        target_url: targetUrl === undefined ? 'https://es.aliexpress.com/item/1005006123456789.html' : targetUrl,
        timeout_ms: timeoutMs ?? 25_000,
      }),
      signal: AbortSignal.timeout(170_000),
    });
    const json = await res.json();
    if (!res.ok) return NextResponse.json({ ok: false, error: json.detail ?? `HTTP ${res.status}` }, { status: 502 });
    return NextResponse.json(json);
  } catch (err) {
    return NextResponse.json({ ok: false, error: `Fallo contactando el validador: ${(err as Error).message}` }, { status: 502 });
  }
  });
}
