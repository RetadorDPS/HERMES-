/**
 * GET /api/catalog — Escaparate de productos listos para importar.
 *
 * Responde SIEMPRE desde nuestro índice (nunca del proveedor en directo), así la
 * navegación es instantánea y no consume cuota de las APIs.
 *
 * Parámetros: q, provider, category, min, max, shipFrom, freeShipping, trending,
 * minRating, sort, page, pageSize.
 */
import { NextResponse } from 'next/server';
import { queryCatalog, type CatalogSort } from '@/lib/catalog';
import { apiTenant } from '@/lib/tenant';
import { getPricingRules } from '@/lib/data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SORTS: CatalogSort[] = ['relevance', 'price-asc', 'price-desc', 'newest', 'trending', 'rating', 'orders'];

export async function GET(req: Request) {
  return apiTenant(async () => {
    const url = new URL(req.url);
    const p = url.searchParams;
    const num = (key: string) => {
      const raw = p.get(key);
      if (raw === null || raw === '') return undefined;
      const n = Number(raw);
      return Number.isFinite(n) ? n : undefined;
    };
    const sortParam = p.get('sort') as CatalogSort | null;

    // Regla de margen del usuario: las tarjetas muestran ya su precio final
    const rules = await getPricingRules().catch(() => []);
    const rule = rules.find((r: any) => r.isDefault) ?? rules[0] ?? null;

    const result = await queryCatalog({
      search: p.get('q') ?? undefined,
      provider: (p.get('provider') as any) ?? 'ALL',
      category: p.get('category') ?? undefined,
      minPrice: num('min'),
      maxPrice: num('max'),
      shipFrom: p.get('shipFrom') ?? undefined,
      freeShipping: p.get('freeShipping') === '1' || p.get('freeShipping') === 'true',
      trending: p.get('trending') === '1' || p.get('trending') === 'true',
      minRating: num('minRating'),
      sort: sortParam && SORTS.includes(sortParam) ? sortParam : 'relevance',
      page: num('page') ?? 1,
      pageSize: num('pageSize') ?? 24,
      pricingRule: rule as any,
    });

    return NextResponse.json({ ok: true, ...result });
  });
}
