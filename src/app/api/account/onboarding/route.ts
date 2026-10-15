/**
 * Visibilidad de la tarjeta «Tus primeros pasos».
 *
 *   GET  /api/account/onboarding           → estado de la lista (tareas hechas y pendientes)
 *   POST /api/account/onboarding {action}  → `hide` la oculta, `show` la recupera
 */
import { NextResponse } from 'next/server';
import { apiTenant } from '@/lib/tenant';
import { checklistState, setChecklistVisibility } from '@/lib/onboarding';
import { clientIp, rateLimit, tooManyRequests } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export async function GET() {
  return apiTenant(async () => {
    const state = await checklistState();
    return NextResponse.json({ ok: true, ...state }, { headers: NO_STORE });
  });
}

export async function POST(req: Request) {
  return apiTenant(async () => {
    const limit = rateLimit(`onboarding:${clientIp(req)}`, 30, 60_000);
    if (!limit.ok) return tooManyRequests(limit.retryAfterSeconds);

    let body: { action?: string } = {};
    try {
      body = (await req.json()) as { action?: string };
    } catch {
      return NextResponse.json({ ok: false, error: 'Cuerpo inválido' }, { status: 400 });
    }

    if (body.action !== 'hide' && body.action !== 'show') {
      return NextResponse.json({ ok: false, error: 'Acción no válida. Usa: hide, show' }, { status: 400 });
    }

    const state = await setChecklistVisibility(body.action === 'hide');
    return NextResponse.json({ ok: true, ...state }, { headers: NO_STORE });
  });
}
