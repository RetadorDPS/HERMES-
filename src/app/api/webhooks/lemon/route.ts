/**
 * POST /api/webhooks/lemon — eventos de facturación de Lemon Squeezy.
 *
 * Lemon Squeezy firma cada evento con la cabecera `X-Signature`
 * (HMAC-SHA256 en hexadecimal del cuerpo en bruto, con LEMON_WEBHOOK_SECRET).
 * Eventos gestionados: subscription_created/updated/cancelled/expired/resumed,
 * subscription_payment_success/payment_failed y order_created.
 *
 * Configuración: Lemon Squeezy → Settings → Webhooks → URL
 *   https://tu-dominio/api/webhooks/lemon
 * y copia el «signing secret» en LEMON_WEBHOOK_SECRET.
 */
import { NextResponse } from 'next/server';
import { handleLemonEvent, lemonConfigured } from '@/lib/lemon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const rawBody = await req.text();
  const signature = req.headers.get('x-signature');

  const result = await handleLemonEvent(rawBody, signature);
  if (!result.ok) {
    console.warn('[webhook/lemon]', result.error);
    const status = result.error === 'Firma inválida' ? 401 : 400;
    return NextResponse.json({ ok: false, error: result.error }, { status });
  }

  console.log(`[webhook/lemon] ${result.applied?.join(' · ') || 'sin cambios'}`);
  return NextResponse.json({ received: true, ok: true, applied: result.applied });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: 'DropshipPilot Lemon Squeezy webhooks',
    configured: lemonConfigured(),
    events: ['subscription_created', 'subscription_updated', 'subscription_cancelled', 'subscription_expired', 'subscription_payment_success', 'subscription_payment_failed', 'order_created'],
    url: 'Configura este endpoint en Lemon Squeezy → Settings → Webhooks y copia el signing secret en LEMON_WEBHOOK_SECRET',
    docs: 'PAGOS.md',
  });
}
