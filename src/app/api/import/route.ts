/**
 * POST /api/import — Importa (o re-importa) un producto a la tienda seleccionada.
 *
 * Pasos:
 *   1. Extrae el producto del proveedor (o reutiliza el payload de la preview).
 *   2. Aplica la regla de margen → precio final por variante.
 *   3. Persiste en PostgreSQL (Product + Variants + Images + Reviews).
 *   4. Publica en Shopify/WooCommerce (DRAFT o ACTIVE).
 *   5. Registra SyncLog y programa el primer chequeo del worker.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { scrapeProduct } from '@/lib/scraper';
import { computeSellingPrice } from '@/lib/pricing';
import { createProductFromScraped, getPricingRules, getStores, getDefaultUserId, getProduct } from '@/lib/data';
import { hasDatabase, prisma } from '@/lib/prisma';
import { consumeCredits, refundCredits } from '@/lib/credits';
import { planFor, assertWithinLimit, CreditsExhaustedError, PlanLimitError } from '@/lib/plans';
import { enqueueSyncJob } from '@/lib/queue';
import { publishToStore, writeSyncLog } from '@worker/lib';
import { round2, slugify } from '@/lib/utils';
import { convertCosts, fxLine } from '@/lib/fx';
import { rateLimit, clientIp, tooManyRequests } from '@/lib/rate-limit';
import type { ScrapedProduct } from '@/lib/types';

import { apiTenant, requireUserId, withCurrentTenant } from '@/lib/tenant';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const bodySchema = z.object({
  url: z.string().min(4),
  storeId: z.string().min(1, 'Selecciona una tienda destino'),
  ruleId: z.string().optional(),
  marginPct: z.coerce.number().min(0).max(2000).optional(),
  sellingPrice: z.coerce.number().min(0.01, 'El precio debe ser mayor que 0').optional(),
  shippingCost: z.coerce.number().min(0).optional(),
  title: z.string().min(3).max(255).optional(),
  description: z.string().optional(),
  status: z.enum(['ACTIVE', 'DRAFT']).default('DRAFT'),
  country: z.string().length(2).default('ES'),
  publish: z.boolean().default(true),
  /** Payload ya extraído en la preview: evita un segundo scraping */
  scrapedPayload: z.any().optional(),
  /** Si venía del catálogo, se anota para las estadísticas del operador */
  catalogItemId: z.string().optional(),
});

export async function POST(req: Request) {
    return apiTenant(async (userId) => {
      const started = Date.now();

      // Cada importación cuesta dinero (extracción + publicación): se limita por IP
      const limit = rateLimit(`import:${clientIp(req)}`, 30, 5 * 60_000);
      if (!limit.ok) return tooManyRequests(limit.retryAfterSeconds, 'Demasiadas importaciones seguidas. Espera un momento.');
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return NextResponse.json({ ok: false, error: 'JSON inválido' }, { status: 400 });
      }

      const parsed = bodySchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ ok: false, error: parsed.error.issues.map((i) => i.message).join(', ') }, { status: 422 });
      }
      const data = parsed.data;
      // Cuántos créditos se han consumido en ESTA petición: si algo falla antes
      // de crear el producto, se devuelven (nadie paga por un error nuestro).
      let creditsConsumed = 0;
      let productCreated = false;

      try {
        // ── Límites del plan y créditos ────────────────────────────────────
        if (hasDatabase()) {
          const [user, productCount] = await Promise.all([
            prisma.user.findUnique({ where: { id: userId }, select: { plan: true } }),
            prisma.product.count({ where: { userId } }),
          ]);
          try {
            assertWithinLimit('products', { products: productCount, stores: 0, supplierAccounts: 0, creditsUsed: 0 }, planFor(user?.plan));
          } catch (err) {
            if (err instanceof PlanLimitError) {
              return NextResponse.json({ ok: false, error: err.message, code: 'PLAN_LIMIT', limit: err.limit }, { status: 402 });
            }
            throw err;
          }
        }

        try {
          await consumeCredits(userId, 2, 'importación de producto');
          creditsConsumed = 2;
        } catch (err) {
          if (err instanceof CreditsExhaustedError) {
            return NextResponse.json({ ok: false, error: err.message, code: 'CREDITS_EXHAUSTED' }, { status: 402 });
          }
          throw err;
        }

        // userId resuelto por el contexto de inquilino
        const [stores, rules] = await Promise.all([getStores(), getPricingRules()]);
        const store = stores.find((s) => s.id === data.storeId);
        if (!store) return NextResponse.json({ ok: false, error: 'Tienda no encontrada' }, { status: 404 });

        // 1) Producto: payload de la preview o extracción nueva
        const scraped: ScrapedProduct = data.scrapedPayload
          ? (data.scrapedPayload as ScrapedProduct)
          : await scrapeProduct(data.url, { destinationCountry: data.country, userId });

        // ── Cambio de divisa ────────────────────────────────────────────────
        // El motor de precios trabaja en EUR: si el proveedor devuelve USD (CJ,
        // muchas tiendas), se convierte ANTES de calcular el precio de venta y
        // el beneficio, para que los números que se muestran sean reales.
        const supplierCurrency = scraped.currency ?? 'EUR';
        const cost0 = Number(scraped.variants?.[0]?.price ?? 0);
        const ship0 = Number(data.shippingCost ?? scraped.shipping.cheapestCost ?? 0);
        const { cost: costEur, shipping: shipEur, fx } = convertCosts({ cost: cost0, shipping: ship0 }, supplierCurrency);

        const shipCost = shipEur;
        const rule = rules.find((r) => r.id === data.ruleId) ?? rules.find((r) => r.isDefault) ?? rules[0];
        const effectiveRule = data.marginPct !== undefined ? { ...rule, markupPct: data.marginPct } : rule;

        // 2) Precios con margen aplicado
        const priced: ScrapedProduct = {
          ...scraped,
          title: data.title ?? scraped.title,
          description: data.description ?? scraped.description,
          // `variants[].price` sigue siendo el COSTE del proveedor (con su divisa
          // original): antes se sobrescribía con el precio de venta y entonces la
          // ficha guardaba el precio de venta como coste (beneficio 0).
          // El coste convertido viaja aparte, en `costPriceEur`.
          shippingCostEur: shipEur,
          variants: scraped.variants.map((v) => {
            const vCost = convertCosts({ cost: Number(v.price) }, supplierCurrency).cost;
            const b = computeSellingPrice(vCost, shipCost, effectiveRule, effectiveRule?.name ?? 'default');
            return { ...v, costPriceEur: vCost, sellingPriceSugerido: b.sellingPrice, compareAtPrice: b.compareAtPrice } as any;
          }),
        } as any;

        const finalPrice = data.sellingPrice ?? computeSellingPrice(costEur, shipCost, effectiveRule, effectiveRule?.name ?? 'default').sellingPrice;

        // 3) Persistencia
        productCreated = true;
        const created = await createProductFromScraped(priced, {
          userId,
          storeId: store.id,
          sellingPrice: finalPrice,
          marginPct: Number(effectiveRule?.markupPct ?? 40),
          status: data.status,
        });

        // Estadística del catálogo: cuántas veces se ha importado este artículo
        if (data.catalogItemId && hasDatabase()) {
          const { withSystem } = await import('@/lib/tenant-context');
          await withSystem('catálogo: anotar importación', () =>
            prisma.catalogItem.update({ where: { id: data.catalogItemId! }, data: { importedCount: { increment: 1 } } }),
          ).catch(() => undefined);
        }

        // 4) Publicación en la tienda
        let publishResult: { ok: boolean; error?: string; storeProductId?: string | null; storeVariantIds?: string[]; simulated?: boolean } = { ok: false };
        if (data.publish) {
          const storeRecord = hasDatabase()
            ? await prisma.store.findUnique({ where: { id: store.id } })
            : { id: store.id, platform: store.platform, domain: store.domain, accessTokenEnc: 'shpat_demo_encrypted_token', consumerSecretEnc: null, apiVersion: '2025-01' };

          const res = await publishToStore(storeRecord as any, priced, {
            sellingPrice: finalPrice,
            marginPct: Number(effectiveRule?.markupPct ?? 40),
            status: data.status,
          });
          publishResult = {
            ok: res.ok,
            error: res.error,
            storeProductId: (res.data as any)?.id ?? null,
            storeVariantIds: ((res.data as any)?.variants ?? []).map((v: any) => v.id),
            simulated: (res as any).simulated,
          };

          if (hasDatabase()) {
            await prisma.product.update({
              where: { id: (created as any).id },
              data: {
                storeProductId: publishResult.storeProductId,
                storeHandle: slugify(priced.title),
                status: publishResult.ok ? data.status : 'ERROR',
                lastSyncedAt: new Date(),
                lastSyncStatus: publishResult.ok ? 'SUCCESS' : 'FAILED',
                lastSyncError: publishResult.error ?? null,
                providerHash: null,
                nextSyncAt: new Date(Date.now() + 3_600_000),
              },
            });
          }
        }

        // 5) Log de importación
        if (hasDatabase()) {
          await writeSyncLog({
            userId,
            storeId: store.id,
            productId: (created as any).id,
            type: 'IMPORT',
            status: publishResult.ok || !data.publish ? 'SUCCESS' : 'FAILED',
            level: publishResult.ok || !data.publish ? 'INFO' : 'ERROR',
            message: publishResult.ok
              ? `Producto importado a ${store.name} (${store.platform}) con ${priced.variants.length} variantes · precio venta ${finalPrice.toFixed(2)} € · margen ${effectiveRule?.markupPct}%${fxLine(fx, cost0) ? ` · ${fxLine(fx, cost0)}` : ''}`
              : `Producto guardado pero falló la publicación en ${store.platform}: ${publishResult.error}`,
            changes: { field: 'import', from: cost0, to: finalPrice, costEur, storeProductId: publishResult.storeProductId },
            durationMs: Date.now() - started,
          });
        }

        // 6) Primer chequeo del worker (dentro de 15 min)
        let job: { id: string; mode: string } | null = null;
        if (hasDatabase()) {
          job = await enqueueSyncJob(
            { productId: (created as any).id, type: 'FULL_REFRESH', userId, reason: 'post-import' },
            { delay: 15 * 60_000, priority: 3 },
          );
        } else {
          // Modo demo: la cola en memoria también acepta el job para que el monitor lo muestre
          job = await enqueueSyncJob(
            { productId: (created as any).id, type: 'FULL_REFRESH', userId: 'user_demo_1', reason: 'post-import' },
            { delay: 15 * 60_000, priority: 3 },
          );
        }

        return NextResponse.json({
          ok: true,
          product: {
            id: (created as any).id,
            title: created.title,
            sellingPrice: finalPrice,
            costPrice: costEur,
            shippingCost: shipCost,
            marginPct: Number(effectiveRule?.markupPct ?? 40),
            profit: round2(finalPrice - costEur - shipCost),
            variants: priced.variants.length,
            images: priced.images.length,
            reviews: priced.reviews.length,
          },
          publish: publishResult,
          store: { id: store.id, name: store.name, platform: store.platform },
          syncJob: job,
          fx: { ...fx, originalCost: cost0, originalShipping: ship0, costEur, shippingEur: shipEur, line: fxLine(fx, cost0) || null },
          meta: { durationMs: Date.now() - started, mode: scraped.extractionMeta.mode },
        });
      } catch (err) {
        // Producto repetido: el mismo proveedor + URL ya está importado en esa
        // tienda. Es un aviso normal, no un fallo del sistema (P2002).
        if ((err as any)?.code === 'P2002') {
          return NextResponse.json(
            {
              ok: false,
              code: 'ALREADY_IMPORTED',
              error: 'Ese producto ya está en tu tienda: no se ha creado otro ni se han gastado créditos.',
              creditsRefunded: false,
            },
            { status: 409 },
          );
        }
        console.error('[api/import]', err);
        // Devolución: sólo si no se llegó a crear nada. Si el producto ya existe,
        // el trabajo está hecho (aunque la publicación falle, se reintenta) y no
        // se devuelve: así se evita regalar importaciones a base de fallos.
        if (creditsConsumed > 0 && !productCreated) {
          await refundCredits(userId, creditsConsumed, 'importación fallida').catch(() => undefined);
        }
        return NextResponse.json(
          { ok: false, error: (err as Error).message, creditsRefunded: creditsConsumed > 0 && !productCreated },
          { status: 500 },
        );
      }

    });
  }

/** GET /api/import?url=... → comprobación previa (¿ya importado?) */
export async function GET(req: Request) {
    return apiTenant(async (userId) => {
      const url = new URL(req.url).searchParams.get('url');
      if (!url) return NextResponse.json({ ok: false, error: 'Falta el parámetro url' }, { status: 400 });

      if (!hasDatabase()) {
        const { demoProducts } = await import('@/lib/demo-data');
        const existing = demoProducts.find((p) => p.sourceUrl === url);
        return NextResponse.json({ ok: true, alreadyImported: Boolean(existing), productId: existing?.id ?? null });
      }

      const { getProducts } = await import('@/lib/data');
      const { items } = await getProducts({ search: url, limit: 1 });
      return NextResponse.json({ ok: true, alreadyImported: items.length > 0, productId: items[0]?.id ?? null });

    });
  }
