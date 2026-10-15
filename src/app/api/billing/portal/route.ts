/**
 * POST /api/billing/portal — abre el portal de cliente de Stripe
 * (cambiar tarjeta, descargar facturas, cancelar la suscripción).
 */
import { NextResponse } from 'next/server';
import { createPortalSession } from '@/lib/stripe';
import { apiTenant, withCurrentTenant } from '@/lib/tenant';
import { appUrl } from '@/lib/account';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  return apiTenant(async (userId) => {
    const result = await createPortalSession({ userId, returnUrl: appUrl('/billing') });
    return NextResponse.json(result, { status: result.ok ? 200 : result.configured ? 400 : 501 });
  });
}
