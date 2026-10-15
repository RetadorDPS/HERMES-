/**
 * POST /api/scrape — Previsualización de producto antes de importar.
 *
 * Body: { url: string, country?: string, ruleId?: string, marginPct?: number, mode?: 'demo'|'local'|'service' }
 * Resp: { ok, product: ScrapedProduct, pricing: { sugerido, desgloses[], reglas[] } }
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { scrapeProduct, ScraperError } from '@/lib/scraper';
import { computeSellingPrice } from '@/lib/pricing';
import { convertCosts, fxInfo, fxLine, toEur } from '@/lib/fx';
import { getPricingRules, getStores, getSuppliers } from '@/lib/data';
import { round2 } from '@/lib/utils';
import { rateLimit, clientIp, tooManyRequests } from '@/lib/rate-limit';
import { consumeCredits, refundCredits } from '@/lib/credits';
import { CreditsExhaustedError } from '@/lib/plans';

import { apiTenant, requireUserId, withCurrentTenant } from '@/lib/tenant';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const bodySchema = z.object({
  url: z.string().min(4, 'Introduce una URL de producto'),
  country: z.string().length(2).default('ES'),
  ruleId: z.string().optional(),
  marginPct: z.coerce.number().min(0).max(2000).optional(),
  shippingCost: z.coerce.number().min(0).optional(),
  mode: z.enum(['demo', 'local', 'service', 'auto']).optional(),
});

export async function POST(req: Request) {
    return apiTenant(async (userId) => {
      const started = Date.now();

      // Protección: la extracción abre un navegador real, es el endpoint más caro.
      // 20 extracciones/min por IP y bloqueo de 2 min si se abusa.
      const limit = rateLimit(`scrape:${clientIp(req)}`, 20, 60_000, 120_000);
      if (!limit.ok) return tooManyRequests(limit.retryAfterSeconds, 'Has hecho demasiadas extracciones seguidas. Espera un par de minutos.');

      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return NextResponse.json({ ok: false, error: 'JSON inválido' }, { status: 400 });
      }

      const parsed = bodySchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { ok: false, error: parsed.error.issues.map((i) => i.message).join(', ') },
          { status: 422 },
        );
      }

      const { url, country, ruleId, marginPct, shippingCost, mode } = parsed.data;

      // Consumo de créditos del plan (la extracción es la operación que cuesta dinero)
      try {
        await consumeCredits(userId, 1, 'extracción de producto');
      } catch (err) {
        if (err instanceof CreditsExhaustedError) {
          return NextResponse.json({ ok: false, error: err.message, code: 'CREDITS_EXHAUSTED' }, { status: 402 });
        }
        throw err;
      }

      try {
        const [rules, stores, suppliers] = await Promise.all([getPricingRules(), getStores(), getSuppliers()]);

        const product = await scrapeProduct(url, {
          // El userId permite usar la API OFICIAL del proveedor si el cliente
          // la tiene conectada (y si no, se pasa al scraping con proxies).
          userId,
          destinationCountry: country,
          // En preview priorizamos velocidad: sin reseñas completas si el servicio está lento
          skipReviews: false,
          mode: mode === 'auto' || !mode ? undefined : mode,
        });

        // Si la extracción cayó al modo demo, los datos son simulados: se devuelve
        // el crédito. Nadie paga por datos inventados.
        const isDemo = product.extractionMeta.mode === 'demo';
        if (isDemo) await refundCredits(userId, 1, 'extracción en modo demo (datos simulados)').catch(() => undefined);

        // Cambio de divisa: el motor de precios trabaja en EUR. Si el proveedor
        // devuelve USD (CJ, tiendas sueltas), se convierte ANTES de calcular, para
        // que la vista previa que ve el usuario sea la misma cifra que la
        // importación real (antes 69 $ se contaban como 69 €).
        const supplierCurrency = product.currency ?? 'EUR';
        const cost0 = product.variants[0]?.price ?? 0;
        const shipRaw = shippingCost ?? product.shipping.cheapestCost ?? 0;
        const converted = convertCosts({ cost: cost0, shipping: shipRaw }, supplierCurrency);
        const shipCost = converted.shipping;
        const costEur = converted.cost;
        const fx = converted.fx;
        const rule = rules.find((r) => r.id === ruleId) ?? rules.find((r) => r.isDefault) ?? rules[0];

        const effectiveRule = marginPct !== undefined ? { ...rule, markupPct: marginPct } : rule;
        const breakdown = computeSellingPrice(costEur, shipCost, effectiveRule, effectiveRule?.name ?? 'default');

        return NextResponse.json({
          ok: true,
          product,
          demo: isDemo,
          creditsRefunded: isDemo,
          pricing: {
            baseCost: costEur,
            baseCostOriginal: cost0,
            shippingCost: shipCost,
            shippingCostOriginal: shipRaw,
            fx,
            fxLine: fxLine(fx, cost0) || null,
            breakdown,
            perRule: rules.map((r) => ({
              ruleId: r.id,
              name: r.name,
              markupPct: r.markupPct,
              ...computeSellingPrice(costEur, shipCost, r, r.name),
            })),
            selectedRuleId: effectiveRule?.id ?? null,
          },
          meta: {
            stores: stores.map((s) => ({ id: s.id, name: s.name, platform: s.platform, status: s.status })),
            suppliers,
            durationMs: Date.now() - started,
            estimatedProfit: round2(breakdown.profit),
          },
        });
      } catch (err) {
        if (err instanceof ScraperError) {
          const status = err.code === 'INVALID_URL' || err.code === 'UNSUPPORTED_SUPPLIER' ? 422 : err.code === 'NOT_FOUND' ? 404 : 502;
          return NextResponse.json(
            {
              ok: false,
              error: err.message,
              code: err.code,
              hint:
                err.code === 'UNSUPPORTED_SUPPLIER'
                  ? 'Proveedores soportados: AliExpress, Amazon, CJ Dropshipping, Alibaba y Temu.'
                  : err.code === 'BLOCKED'
                    ? 'El proveedor ha bloqueado la petición: configura PROXY_LIST con proxies residenciales o activa SCRAPER_MODE=demo.'
                    : undefined,
            },
            { status },
          );
        }
        console.error('[api/scrape]', err);
        return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
      }

    });
  }
