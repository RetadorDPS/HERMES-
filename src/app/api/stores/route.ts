/**
 * GET  /api/stores → tiendas conectadas + proveedores + modo de datos
 * POST /api/stores → conectar tienda nueva (Shopify o WooCommerce) y registrar webhooks
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getStores, getSuppliers, getDefaultUserId, dataMode } from '@/lib/data';
import { connectStore } from '@/lib/shopify';
import { connectStore as wooConnect } from '@/lib/woocommerce';
import { encryptSecret } from '@/lib/crypto';
import { hasDatabase, prisma } from '@/lib/prisma';
import { planFor, assertWithinLimit, PlanLimitError } from '@/lib/plans';

import { apiTenant, requireUserId, withCurrentTenant } from '@/lib/tenant';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
    return apiTenant(async (userId) => {
      const [stores, suppliers] = await Promise.all([getStores(), getSuppliers()]);
      return NextResponse.json({ ok: true, stores, suppliers, mode: dataMode() });

    });
  }

const connectSchema = z.discriminatedUnion('platform', [
  z.object({
    platform: z.literal('SHOPIFY'),
    shopUrl: z.string().min(4, 'Introduce el dominio de la tienda'),
    accessToken: z.string().min(10, 'El token Admin API es obligatorio (shpat_...)'),
    name: z.string().optional(),
    registerWebhooks: z.boolean().default(true),
  }),
  z.object({
    platform: z.literal('WOOCOMMERCE'),
    shopUrl: z.string().min(4),
    consumerKey: z.string().min(6, 'Consumer key obligatoria (ck_...)'),
    consumerSecret: z.string().min(6, 'Consumer secret obligatorio (cs_...)'),
    name: z.string().optional(),
    registerWebhooks: z.boolean().default(true),
  }),
]);

export async function POST(req: Request) {
    return apiTenant(async (userId) => {
      const parsed = connectSchema.safeParse(await req.json().catch(() => ({})));
      if (!parsed.success) {
        return NextResponse.json({ ok: false, error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' · ') }, { status: 422 });
      }
      const body = parsed.data;
      const baseUrl = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';

      try {
        if (body.platform === 'SHOPIFY') {
          const check = await connectStore(body.shopUrl, body.accessToken);
          if (!check.ok) return NextResponse.json({ ok: false, error: check.error }, { status: 400 });

          if (!hasDatabase()) {
            return NextResponse.json({
              ok: true,
              mode: 'demo',
              store: { id: `store_demo_${Date.now().toString(36)}`, platform: 'SHOPIFY', domain: check.domain, name: check.shop?.name ?? body.name ?? 'Mi tienda Shopify', status: 'CONNECTED', storeProductCount: 0, ordersCount: 0 },
              shop: check.shop,
              scopes: check.scopes,
              missingScopes: check.missingScopes,
              message: 'Tienda validada contra Shopify. Para persistirla necesitas DATABASE_URL (PostgreSQL).',
            });
          }

          // userId resuelto por el contexto de inquilino
          const store = await prisma.store.upsert({
            where: { userId_domain: { userId, domain: check.domain } },
            update: { accessTokenEnc: encryptSecret(body.accessToken), status: 'CONNECTED', lastPingAt: new Date(), lastError: null, scopes: check.scopes, name: body.name ?? check.shop?.name ?? 'Shopify' },
            create: {
              userId,
              platform: 'SHOPIFY',
              name: body.name ?? check.shop?.name ?? 'Shopify',
              domain: check.domain,
              accessTokenEnc: encryptSecret(body.accessToken),
              apiVersion: process.env.SHOPIFY_API_VERSION ?? '2025-01',
              scopes: check.scopes,
              status: 'CONNECTED',
              lastPingAt: new Date(),
              webhookSecret: process.env.SHOPIFY_WEBHOOK_SECRET,
              settings: { currency: check.shop?.currencyCode ?? 'EUR', autoImport: true, translate: true },
            },
          });

          let webhooks: any = null;
          if (body.registerWebhooks) {
            const { listenOrderWebhook } = await import('@/lib/shopify');
            webhooks = await listenOrderWebhook(store, baseUrl);
          }

          return NextResponse.json({ ok: true, store: { id: store.id, name: store.name, domain: store.domain, platform: store.platform, status: store.status }, shop: check.shop, scopes: check.scopes, missingScopes: check.missingScopes, webhooks });
        }

        // ── WooCommerce
        const check = await wooConnect(body.shopUrl, body.consumerKey, body.consumerSecret);
        if (!check.ok) return NextResponse.json({ ok: false, error: check.error }, { status: 400 });

        if (!hasDatabase()) {
          return NextResponse.json({
            ok: true,
            mode: 'demo',
            store: { id: `store_demo_woo_${Date.now().toString(36)}`, platform: 'WOOCOMMERCE', domain: check.domain, name: body.name ?? 'WooCommerce', status: 'CONNECTED' },
            shop: check.shop,
            message: 'Credenciales de WooCommerce válidas. Configura DATABASE_URL para guardarlas cifradas.',
          });
        }

        // userId resuelto por el contexto de inquilino
        const store = await prisma.store.upsert({
          where: { userId_domain: { userId, domain: check.domain } },
          update: { accessTokenEnc: encryptSecret(body.consumerKey), consumerSecretEnc: encryptSecret(body.consumerSecret), status: 'CONNECTED', lastPingAt: new Date(), lastError: null },
          create: {
            userId,
            platform: 'WOOCOMMERCE',
            name: body.name ?? 'WooCommerce',
            domain: check.domain,
            accessTokenEnc: encryptSecret(body.consumerKey),
            consumerSecretEnc: encryptSecret(body.consumerSecret),
            status: 'CONNECTED',
            lastPingAt: new Date(),
            settings: { currency: 'EUR', autoImport: false },
          },
        });

        let webhooks: any = null;
        if (body.registerWebhooks) {
          const { listenOrderWebhook } = await import('@/lib/woocommerce');
          webhooks = await listenOrderWebhook(store as any, baseUrl);
          // WordPress devuelve el secreto de firma una sola vez: lo guardamos cifrado
          const secret = webhooks?.data?.secrets?.[0];
          if (secret) {
            await prisma.store.update({ where: { id: store.id }, data: { webhookSecret: encryptSecret(secret) } });
          }
        }

        return NextResponse.json({ ok: true, store: { id: store.id, name: store.name, domain: store.domain, platform: store.platform, status: store.status }, shop: check.shop, webhooks });
      } catch (err) {
        console.error('[api/stores]', err);
        return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
      }

    });
  }
