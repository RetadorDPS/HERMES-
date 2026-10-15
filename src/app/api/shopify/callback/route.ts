/**
 * GET /api/shopify/callback — segundo paso del flujo OAuth de Shopify.
 *
 * Shopify devuelve aquí (con `code`, `shop`, `state` y `hmac`) tras autorizar la
 * app. Se verifica la firma y el `state`, se canjea el código por un token
 * permanente, se valida contra la API y se guarda la tienda cifrada, igual que
 * si se hubiera pegado el token a mano. Al terminar redirige a /stores.
 */
import { NextResponse } from 'next/server';
import { currentUserId } from '@/lib/tenant';
import { withTenant } from '@/lib/tenant-context';
import { hasDatabase, prisma } from '@/lib/prisma';
import { appUrl, audit } from '@/lib/account';
import { connectStore, listenOrderWebhook } from '@/lib/shopify';
import { encryptSecret } from '@/lib/crypto';
import { planFor, assertWithinLimit, PlanLimitError } from '@/lib/plans';
import { exchangeCodeForToken, normalizeOAuthShop, readState, verifyCallbackHmac } from '@/lib/shopify-oauth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const fail = (mensaje: string) => NextResponse.redirect(appUrl(`/stores?shopify=error&motivo=${encodeURIComponent(mensaje)}`));

export async function GET(req: Request) {
  const url = new URL(req.url);
  const params = url.searchParams;
  const shop = normalizeOAuthShop(params.get('shop') ?? '');
  const code = params.get('code') ?? '';

  if (!shop || !code) return fail('Faltan parámetros del flujo de autorización');
  if (!verifyCallbackHmac(params)) return fail('La firma del callback no es válida (¿secreto de la app incorrecto?)');

  const state = readState(params.get('state'));
  if (!state) return fail('La sesión de instalación caducó o fue manipulada: vuelve a intentarlo');

  // Si hay sesión web, debe coincidir con quien inició la instalación.
  try {
    const sessionUser = await currentUserId();
    if (sessionUser && sessionUser !== state.userId) return fail('Esta instalación la inició otro usuario: entra con tu cuenta y repite el proceso');
  } catch {
    /* sin sesión (AUTH_ENABLED=false): el state firmado basta */
  }

  const token = await exchangeCodeForToken(shop, code);
  if (!token.ok) return fail(token.error);

  // Comprobar el token contra la tienda (nombre real, scopes concedidos)
  const check = await connectStore(shop, token.accessToken);
  if (!check.ok) return fail(check.error ?? 'Shopify rechazó el token');

  if (!hasDatabase()) return fail('Necesitas PostgreSQL para guardar la tienda (DATABASE_URL)');

  const userId = state.userId;

  try {
    await withTenant(
      userId,
      async () => {
        const [user, existing, storeCount] = await Promise.all([
          prisma.user.findUnique({ where: { id: userId }, select: { plan: true } }),
          prisma.store.findUnique({ where: { userId_domain: { userId, domain: check.domain } }, select: { id: true } }),
          prisma.store.count(),
        ]);

        // Límite del plan sólo si es una tienda NUEVA (reconectar no cuenta)
        if (!existing) {
          try {
            assertWithinLimit('stores', { products: 0, stores: storeCount, supplierAccounts: 0, creditsUsed: 0 }, planFor(user?.plan));
          } catch (err) {
            if (err instanceof PlanLimitError) throw err;
            throw err;
          }
        }

        const store = await prisma.store.upsert({
          where: { userId_domain: { userId, domain: check.domain } },
          update: {
            accessTokenEnc: encryptSecret(token.accessToken),
            status: 'CONNECTED',
            lastPingAt: new Date(),
            lastError: null,
            scopes: check.scopes,
            name: check.shop?.name ?? undefined,
            webhookSecret: process.env.SHOPIFY_WEBHOOK_SECRET,
          },
          create: {
            userId,
            platform: 'SHOPIFY',
            name: check.shop?.name ?? check.domain,
            domain: check.domain,
            accessTokenEnc: encryptSecret(token.accessToken),
            apiVersion: process.env.SHOPIFY_API_VERSION ?? '2025-01',
            scopes: check.scopes,
            status: 'CONNECTED',
            lastPingAt: new Date(),
            webhookSecret: process.env.SHOPIFY_WEBHOOK_SECRET,
            settings: { currency: check.shop?.currencyCode ?? 'EUR', autoImport: true, translate: true, installedVia: 'oauth' },
          },
        });

        // Webhook de pedidos (mismo que en la conexión manual)
        try {
          await listenOrderWebhook(store, appUrl());
        } catch (err) {
          console.warn('[shopify/oauth] no se pudo registrar el webhook de pedidos:', (err as Error).message);
        }
      },
      'shopify-oauth',
    );
  } catch (err) {
    if (err instanceof PlanLimitError) return fail(err.message);
    return fail(`No se pudo guardar la tienda: ${(err as Error).message}`);
  }

  await audit({
    userId,
    action: 'store.connected',
    metadata: { platform: 'SHOPIFY', domain: check.domain, via: 'oauth', scopes: check.scopes },
  }).catch(() => undefined);

  return NextResponse.redirect(appUrl(`/stores?shopify=conectada&tienda=${encodeURIComponent(check.domain)}`));
}
