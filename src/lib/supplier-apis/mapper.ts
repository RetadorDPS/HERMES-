/**
 * src/lib/supplier-apis/mapper.ts — Convierte la respuesta de una API oficial
 * al formato interno `ScrapedProduct`, para que la importación, el motor de
 * precios y el worker traten igual los datos vengan de API o de scraping.
 */
import type { ScrapedProduct, ScrapedReview, ScrapedShippingOption, ScrapedVariant, SupplierKey } from '@/lib/types';
import { round2, slugify } from '@/lib/utils';
import type { SupplierProduct } from './types';

export function supplierProductToScraped(api: SupplierProduct, opts: { destinationCountry?: string; durationMs?: number } = {}): ScrapedProduct {
  const currency = api.currency || 'EUR';
  const cheapest = api.shipping?.cost ?? 0;

  const shippingOption: ScrapedShippingOption = {
    method: api.shipping?.methods?.[0]?.name ?? 'Envío estándar del proveedor',
    carrier: api.provider,
    cost: round2(cheapest),
    currency,
    minDays: api.shipping?.minDays,
    maxDays: api.shipping?.maxDays,
    isTracked: true,
    destinationCountry: opts.destinationCountry ?? api.shipping?.country ?? 'ES',
  };

  const variants: ScrapedVariant[] = (api.variants ?? []).map((v, i) => ({
    supplierVariantId: v.supplierVariantId,
    sku: v.sku ?? `${api.supplierProductId}-${i + 1}`,
    title: v.title,
    color: v.color,
    size: v.size,
    option1Name: v.color ? 'Color' : undefined,
    option1Value: v.color,
    option2Name: v.size ? 'Talla' : undefined,
    option2Value: v.size,
    price: round2(v.costPrice),
    stock: v.stock,
    imageUrl: v.imageUrl,
    weightGrams: v.weightGrams,
  }));

  const reviews: ScrapedReview[] = (api.reviews ?? []).map((r, i) => ({
    supplierReviewId: `api-${i}`,
    rating: r.rating,
    author: r.author,
    text: r.text,
    date: r.date,
    images: [],
  }));

  return {
    sourceUrl: api.sourceUrl,
    supplier: api.provider as unknown as SupplierKey,
    supplierProductId: api.supplierProductId,
    title: api.title,
    seoTitle: `${api.title} — envío rápido`.slice(0, 70),
    description: api.description || `<p>${api.title}</p>`,
    bullets: [],
    category: api.category,
    categoryPath: api.category ? [api.category] : [],
    tags: [slugify(api.title).split('-').slice(0, 4).join('-')],
    currency,
    images: (api.images ?? []).filter(Boolean).map((url) => ({ url, hdUrl: url })),
    variants:
      variants.length > 0
        ? variants
        : [
            {
              supplierVariantId: api.supplierProductId,
              sku: api.supplierProductId,
              title: api.title,
              price: round2(api.costPrice),
              stock: api.stock,
            },
          ],
    shipping: {
      options: shippingOption.cost >= 0 ? [shippingOption] : [],
      cheapestCost: round2(cheapest),
      fastest: shippingOption,
      shipsTo: [opts.destinationCountry ?? api.shipping?.country ?? 'ES'],
    },
    reviews,
    ratingAvg: api.rating ?? (reviews.length ? round2(reviews.reduce((a, r) => a + r.rating, 0) / reviews.length) : 0),
    ratingCount: api.reviews?.length ?? 0,
    ordersCount: api.orders ?? 0,
    stockTotal: api.variants?.reduce((a, v) => a + v.stock, 0) ?? api.stock,
    specs: {},
    warnings: api.source === 'simulated' ? ['Datos de ejemplo: la cuenta de proveedor está en modo demostración'] : [],
    extractionMeta: {
      mode: 'service', // la API oficial es una fuente de datos de primera clase
      durationMs: opts.durationMs ?? 0,
      extractorVersion: `api:${String(api.provider).toLowerCase()}-v1`,
      extractedAt: new Date().toISOString(),
      attempts: 1,
    },
  };
}
