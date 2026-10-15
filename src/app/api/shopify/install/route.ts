/**
 * GET /api/shopify/install?shop=mitienda.myshopify.com
 *
 * Primer paso del flujo OAuth de Shopify: redirige al comerciante a la pantalla
 * de autorización de SU tienda con los permisos que necesita la app. Si OAuth
 * no está configurado, devuelve un mensaje claro en JSON con la alternativa
 * manual (pegar el token Admin API en la página Tiendas).
 */
import { NextResponse } from 'next/server';
import { apiTenant } from '@/lib/tenant';
import { appUrl } from '@/lib/account';
import { buildInstallUrl, isValidShopDomain, normalizeOAuthShop, shopifyOAuthConfigured } from '@/lib/shopify-oauth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const rawShop = url.searchParams.get('shop') ?? '';

  return apiTenant(async (userId) => {
    if (!shopifyOAuthConfigured()) {
      return NextResponse.json(
        {
          ok: false,
          configured: false,
          error:
            'OAuth de Shopify sin configurar. Crea una app gratis en partners.shopify.com y define SHOPIFY_API_KEY / SHOPIFY_API_SECRET (URL de redirección: ' +
            appUrl('/api/shopify/callback') +
            '). Mientras tanto puedes conectar la tienda pegando un token Admin API.',
          manual: true,
        },
        { status: 501 },
      );
    }

    const shop = normalizeOAuthShop(rawShop);
    if (!isValidShopDomain(shop)) {
      return NextResponse.json(
        { ok: false, error: 'Escribe el dominio interno de la tienda, con el formato mitienda.myshopify.com (está en Shopify → Configuración → Dominios).' },
        { status: 422 },
      );
    }

    return NextResponse.redirect(buildInstallUrl({ shop, userId, appUrl: appUrl() }));
  });
}
