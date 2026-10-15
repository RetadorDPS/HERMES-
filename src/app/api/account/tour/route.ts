/**
 * Estado del tutorial guiado del usuario que tiene la sesión abierta.
 *
 *   GET  /api/account/tour          → qué toca ofrecer
 *   POST /api/account/tour {action} → aceptar, terminar, descartar o reiniciar
 */
import { NextResponse } from 'next/server';
import { apiTenant } from '@/lib/tenant';
import { currentAdmin } from '@/lib/admin';
import { TOUR_ACTIONS, TOUR_VERSION, saveTourState, tourState, type TourAction, type TourScope } from '@/lib/tour';
import { clientIp, rateLimit, tooManyRequests } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const scopeFrom = (value: string | null): TourScope => (value === 'admin' ? 'admin' : 'user');

export async function GET(req: Request) {
  return apiTenant(async () => {
    const scope = scopeFrom(new URL(req.url).searchParams.get('scope'));
    if (scope === 'admin' && !(await currentAdmin().catch(() => null))) {
      return NextResponse.json({ ok: false, error: 'Sólo el operador de la plataforma tiene tutorial de administración' }, { status: 403 });
    }
    const state = await tourState(scope);
    return NextResponse.json({ ok: true, scope, tourVersion: TOUR_VERSION, ...state }, { headers: { 'Cache-Control': 'no-store' } });
  });
}

export async function POST(req: Request) {
  return apiTenant(async () => {
    const limit = rateLimit(`tour:${clientIp(req)}`, 30, 60_000);
    if (!limit.ok) return tooManyRequests(limit.retryAfterSeconds);

    let body: { action?: string; scope?: string } = {};
    try {
      body = (await req.json()) as { action?: string; scope?: string };
    } catch {
      return NextResponse.json({ ok: false, error: 'Cuerpo inválido' }, { status: 400 });
    }

    const scope = scopeFrom(body.scope ?? null);
    if (scope === 'admin' && !(await currentAdmin().catch(() => null))) {
      return NextResponse.json({ ok: false, error: 'Sólo el operador de la plataforma tiene tutorial de administración' }, { status: 403 });
    }

    const action = body.action as TourAction;
    if (!TOUR_ACTIONS.includes(action)) {
      return NextResponse.json({ ok: false, error: `Acción no válida. Usa: ${TOUR_ACTIONS.join(', ')}` }, { status: 400 });
    }

    const state = await saveTourState(action, { ip: clientIp(req), userAgent: req.headers.get('user-agent') }, scope);
    return NextResponse.json({ ok: true, scope, ...state }, { headers: { 'Cache-Control': 'no-store' } });
  });
}
