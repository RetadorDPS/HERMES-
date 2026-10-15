/**
 * GET /api/catalog/[id] — Ficha completa de un producto del catálogo.
 *
 * Devuelve, además de los datos visibles, el `scrapedPayload` ya normalizado:
 * es lo que el botón «Importar» envía a `POST /api/import`, de modo que la
 * importación NO vuelve a extraer nada del proveedor (ni gasta tiempo ni cuota).
 */
import { NextResponse } from 'next/server';
import { catalogItemWithPayload } from '@/lib/catalog';
import { apiTenant } from '@/lib/tenant';
import { getPricingRules, getStores } from '@/lib/data';
import { computeSellingPrice } from '@/lib/pricing';
import { fxInfo, toEur } from '@/lib/fx';
import { round2 } from '@/lib/utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: { id: string } }) {
  return apiTenant(async () => {
    const country = new URL(req.url).searchParams.get('country') ?? 'ES';
    const found = await catalogItemWithPayload(params.id, { destinationCountry: country });
    if (!found) return NextResponse.json({ ok: false, error: 'Producto del catálogo no encontrado' }, { status: 404 });

    // Vista previa del precio final con la regla de margen DEL usuario:
    // es lo que hace que el catálogo y su motor de precios sean coherentes.
    const [rules, stores] = await Promise.all([getPricingRules(), getStores()]);
    const rule = rules.find((r) => r.isDefault) ?? rules[0] ?? null;
    // Coste y envío en EUR (el proveedor puede facturar en USD)
    const fx = fxInfo(found.item.currency);
    const costEur = toEur(found.item.costPrice, found.item.currency);
    const shipping = toEur(found.item.freeShipping ? 0 : found.item.shippingCost ?? 0, found.item.currency);
    const breakdown = computeSellingPrice(costEur, shipping, rule as any, rule?.name ?? 'default');

    return NextResponse.json({
      ok: true,
      item: found.item,
      description: found.description,
      tags: found.tags,
      scrapedPayload: found.scraped,
      pricing: {
        ruleId: rule?.id ?? null,
        ruleName: rule?.name ?? 'Sin regla',
        // Regla completa: la vista previa de «+ margen» en la ficha usa exactamente
        // los mismos parámetros que la importación (minProfit, redondeo, envío…).
        rule: rule
          ? {
              id: rule.id,
              name: rule.name,
              markupPct: Number(rule.markupPct),
              fixedFee: Number(rule.fixedFee ?? 0),
              minProfit: Number(rule.minProfit ?? 0),
              roundTo: Number(rule.roundTo ?? 0.99),
              minPrice: rule.minPrice ?? null,
              maxPrice: rule.maxPrice ?? null,
              includeShipping: rule.includeShipping ?? true,
            }
          : { markupPct: 40, fixedFee: 0, minProfit: 1.5, roundTo: 0.99, minPrice: null, maxPrice: null, includeShipping: true, name: 'Sin regla' },
        markupPct: Number(rule?.markupPct ?? 40),
        costPrice: round2(found.item.costPrice),
        costPriceEur: round2(costEur),
        shipping: round2(shipping),
        fx,
        sellingPrice: breakdown.sellingPrice,
        compareAtPrice: breakdown.compareAtPrice ?? null,
        profit: round2(breakdown.sellingPrice - costEur - shipping),
        marginPct: round2(((breakdown.sellingPrice - costEur - shipping) / Math.max(breakdown.sellingPrice, 0.01)) * 100),
      },
      stores: stores.map((s) => ({ id: s.id, name: s.name, platform: s.platform, status: s.status })),
      variants: found.scraped.variants.length,
      credits: 2,
    });
  });
}
