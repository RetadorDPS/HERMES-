/**
 * POST /api/webhooks/woocommerce  → tienda WooCommerce por defecto (la más antigua)
 * GET  /api/webhooks/woocommerce  → autodiagnóstico: qué cabeceras y temas se esperan
 */
import { NextResponse } from 'next/server';
import { handleWooWebhook } from '@/lib/woo-webhook';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  return handleWooWebhook(req);
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: 'DropshipPilot WooCommerce webhooks',
    store: 'predeterminada (la primera tienda WooCommerce)',
    topics: ['order.created', 'order.updated', 'order.deleted', 'product.updated'],
    headers: {
      firma: 'X-WC-Webhook-Signature (HMAC-SHA256 base64 sobre el cuerpo crudo)',
      tema: 'X-WC-Webhook-Topic',
      deduplicacion: 'X-WC-Webhook-Delivery-ID',
    },
    secreto:
      'Se captura automáticamente al registrar los webhooks desde la página Tiendas. Si lo creas a mano en WordPress, define WOO_WEBHOOK_SECRET.',
    salud: 'Para una comprobación completa usa /api/health',
  });
}
