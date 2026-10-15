/**
 * POST /api/webhooks/woocommerce/{dominio}
 * URL que se registra automáticamente en WordPress al conectar la tienda
 * (ver listenOrderWebhook en lib/woocommerce.ts).
 */
import { NextResponse } from 'next/server';
import { handleWooWebhook } from '@/lib/woo-webhook';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: { store: string } }) {
  return handleWooWebhook(req, params.store);
}

export async function GET(_req: Request, { params }: { params: { store: string } }) {
  return NextResponse.json({ ok: true, service: 'DropshipPilot WooCommerce webhooks', store: decodeURIComponent(params.store) });
}
