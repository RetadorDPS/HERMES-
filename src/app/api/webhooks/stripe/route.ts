/**
 * POST /api/webhooks/stripe — eventos de facturación.
 *
 * Stripe firma cada evento con `Stripe-Signature` (HMAC con STRIPE_WEBHOOK_SECRET).
 * Eventos gestionados: checkout.session.completed, customer.subscription.* e
 * invoice.paid (renovación → se reinician los créditos del mes).
 */
import { NextResponse } from 'next/server';
import { handleStripeEvent } from '@/lib/stripe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const rawBody = await req.text();
  const signature = req.headers.get('stripe-signature');

  const result = await handleStripeEvent(rawBody, signature);
  if (!result.ok) {
    console.warn('[webhook/stripe]', result.error);
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }

  console.log(`[webhook/stripe] ${result.type} → ${result.applied?.join(', ')}`);
  return NextResponse.json({ received: true, ...result });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: 'DropshipPilot Stripe webhooks',
    configured: Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET),
    events: ['checkout.session.completed', 'customer.subscription.created/updated/deleted', 'invoice.paid'],
    url: 'Configura este endpoint en el panel de Stripe → Developers → Webhooks y copia el secreto en STRIPE_WEBHOOK_SECRET',
  });
}
