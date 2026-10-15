/**
 * POST /api/stores/[id]/test  → prueba de conexión (ping) y refresco de estado
 * DELETE /api/stores/[id]     → desconectar tienda (conserva productos, desvincula)
 */
import { NextResponse } from 'next/server';
import { hasDatabase, prisma } from '@/lib/prisma';
import { connectStore, getPrimaryLocationId } from '@/lib/shopify';
import { getStores } from '@/lib/data';
import { decryptSecret } from '@/lib/crypto';

import { apiTenant, requireUserId, withCurrentTenant } from '@/lib/tenant';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
    return apiTenant(async (userId) => {
      if (!hasDatabase()) {
        const stores = await getStores();
        const store = stores.find((s) => s.id === params.id);
        if (!store) return NextResponse.json({ ok: false, error: 'Tienda no encontrada' }, { status: 404 });
        return NextResponse.json({
          ok: store.status === 'CONNECTED',
          mode: 'demo',
          store: { id: store.id, name: store.name, platform: store.platform, status: store.status },
          latencyMs: 42,
          message: store.status === 'CONNECTED' ? 'Conexión correcta (simulada en modo demo)' : store.lastError ?? 'La tienda reporta error: revisa las credenciales.',
        });
      }

      const store = await prisma.store.findUnique({ where: { id: params.id } });
      if (!store) return NextResponse.json({ ok: false, error: 'Tienda no encontrada' }, { status: 404 });

      const started = Date.now();
      try {
        if (store.platform === 'SHOPIFY') {
          const res = await connectStore(store.domain, decryptSecret(store.accessTokenEnc));
          const locationId = res.ok ? await getPrimaryLocationId(store as any) : null;
          await prisma.store.update({
            where: { id: store.id },
            data: {
              status: res.ok ? 'CONNECTED' : 'ERROR',
              lastPingAt: new Date(),
              lastError: res.ok ? null : res.error ?? 'Error desconocido',
              scopes: res.ok ? res.scopes : store.scopes,
            },
          });
          return NextResponse.json({
            ok: res.ok,
            latencyMs: Date.now() - started,
            shop: res.ok ? res.shop : undefined,
            scopes: res.ok ? res.scopes : undefined,
            missingScopes: res.ok ? res.missingScopes : undefined,
            primaryLocationId: locationId,
            error: res.ok ? undefined : res.error,
          });
        }

        const { connectStore: wooConnect } = await import('@/lib/woocommerce');
        const res = await wooConnect(store.domain, decryptSecret(store.accessTokenEnc), decryptSecret(store.consumerSecretEnc));
        await prisma.store.update({
          where: { id: store.id },
          data: { status: res.ok ? 'CONNECTED' : 'ERROR', lastPingAt: new Date(), lastError: res.ok ? null : res.error },
        });
        return NextResponse.json({ ok: res.ok, latencyMs: Date.now() - started, shop: res.ok ? res.shop : undefined, error: res.ok ? undefined : res.error });
      } catch (err) {
        await prisma.store.update({ where: { id: store.id }, data: { status: 'ERROR', lastError: (err as Error).message } });
        return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
      }

    });
  }

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
    return apiTenant(async (userId) => {
      if (!hasDatabase()) {
        const { demoStores } = await import('@/lib/demo-data');
        const idx = demoStores.findIndex((s) => s.id === params.id);
        if (idx >= 0) demoStores.splice(idx, 1);
        return NextResponse.json({ ok: idx >= 0, mode: 'demo' });
      }
      const store = await prisma.store.findUnique({ where: { id: params.id } });
      if (!store) return NextResponse.json({ ok: false, error: 'Tienda no encontrada' }, { status: 404 });

      // No borramos la tienda: la marcamos desconectada y desvinculamos sus productos
      await prisma.$transaction([
        prisma.product.updateMany({ where: { storeId: store.id }, data: { storeId: null, storeProductId: null, status: 'PAUSED', isMonitored: false } }),
        prisma.store.update({ where: { id: store.id }, data: { status: 'DISCONNECTED', accessTokenEnc: null, consumerSecretEnc: null, lastError: 'Desconectada manualmente desde el panel' } }),
      ]);

      return NextResponse.json({ ok: true, warning: 'Los productos publicados NO se han borrado de la tienda; quedan pausados y sin monitorizar.' });

    });
  }
