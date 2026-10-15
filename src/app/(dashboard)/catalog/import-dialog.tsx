'use client';

/**
 * Ficha + importación de un artículo del catálogo.
 *
 * La importación reutiliza el MISMO endpoint que la importación por URL
 * (`POST /api/import`) enviándole el producto ya normalizado que el catálogo
 * tenía guardado: misma regla de margen, mismos créditos (2), mismo enlace con
 * la tienda y mismo primer chequeo del worker. No hay dos caminos distintos.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Info,
  Loader2,
  Package,
  Star,
  Truck,
  X,
} from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { Progress } from '@/components/ui/primitives';
import { formatCurrency, formatNumber, cn } from '@/lib/utils';
// El MISMO motor de precios que usa el backend y el worker: la vista previa del
// margen no puede calcular distinto que la importación real.
import { computeSellingPrice } from '@/lib/pricing';
import { ProviderBadge } from './catalog-card';
import { imageSrc } from './image';

/** Quita el HTML de la descripción del proveedor para mostrarla como texto. */
const stripHtml = (html: string) => String(html ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

interface Detail {
  ok: boolean;
  error?: string;
  item: {
    id: string;
    provider: string;
    title: string;
    description?: string | null;
    images: string[];
    imageUrl: string | null;
    categoryName: string | null;
    currency: string;
    costPrice: number;
    stock: number;
    rating: number | null;
    ordersCount: number | null;
    shippingCost: number | null;
    freeShipping: boolean;
    shipFrom: string | null;
    shippingMinDays: number | null;
    shippingMaxDays: number | null;
    source: string;
    sourceUrl?: string;
  };
  description: string;
  tags: string[];
  scrapedPayload: any;
  pricing: {
    ruleId: string | null;
    ruleName: string;
    rule?: {
      id?: string;
      name?: string;
      markupPct: number;
      fixedFee: number;
      minProfit: number;
      roundTo: number;
      minPrice: number | null;
      maxPrice: number | null;
      includeShipping: boolean;
    };
    markupPct: number;
    costPrice: number;
    costPriceEur?: number;
    shipping: number;
    fx?: { currency: string; rate: number; converted: boolean; unknown?: boolean };
    sellingPrice: number;
    compareAtPrice: number | null;
    profit: number;
    marginPct: number;
  };
  stores: { id: string; name: string; platform: string; status: string }[];
  variants: number;
  credits: number;
}

interface Props {
  itemId: string | null;
  onClose: () => void;
  onImported?: (info: { title: string; store: string }) => void;
}

export function CatalogImportDrawer({ itemId, onClose, onImported }: Props) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [image, setImage] = useState(0);

  const [storeId, setStoreId] = useState('');
  const [status, setStatus] = useState<'DRAFT' | 'ACTIVE'>('DRAFT');
  const [marginPct, setMarginPct] = useState<string>('');
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string; productId?: string; publish?: string } | null>(null);

  const load = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/catalog/${id}`, { cache: 'no-store' });
      const json = (await res.json()) as Detail & { error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error ?? `Error ${res.status}`);
      setDetail(json);
      setStoreId((prev) => prev || json.stores[0]?.id || '');
      setMarginPct(String(json.pricing.markupPct));
      setImage(0);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (itemId) void load(itemId);
  }, [itemId, load]);

  // Vista previa del precio con el margen elegido, con el motor REAL de precios
  const [preview, setPreview] = useState<{ sellingPrice: number; profit: number; marginPct: number } | null>(null);
  useEffect(() => {
    if (!detail || marginPct === '' || Number(marginPct) === detail.pricing.markupPct) {
      setPreview(null);
      return;
    }
    const cost = detail.pricing.costPriceEur ?? detail.pricing.costPrice;
    const shipping = detail.pricing.shipping;
    const rule = { ...(detail.pricing.rule ?? {}), id: detail.pricing.ruleId ?? undefined, name: detail.pricing.ruleName, markupPct: Number(marginPct) };
    const b = computeSellingPrice(cost, shipping, rule as any, rule.name);
    const landed = Math.round((cost + shipping + Number.EPSILON) * 100) / 100;
    setPreview({
      sellingPrice: b.sellingPrice,
      profit: Math.round((b.sellingPrice - landed + Number.EPSILON) * 100) / 100,
      marginPct: Math.round(((b.sellingPrice - landed) / Math.max(b.sellingPrice, 0.01)) * 1000) / 10,
    });
  }, [marginPct, detail]);

  const doImport = async () => {
    if (!detail) return;
    setImporting(true);
    setResult(null);
    try {
      const res = await fetch('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: detail.scrapedPayload.sourceUrl,
          storeId,
          status,
          country: 'ES',
          publish: true,
          marginPct: marginPct === '' ? undefined : Number(marginPct),
          scrapedPayload: detail.scrapedPayload,
          catalogItemId: detail.item.id,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setResult({ ok: false, message: json.error ?? `Error ${res.status}` });
        return;
      }
      const store = detail.stores.find((s) => s.id === storeId);
      setResult({
        ok: true,
        message: `${json.product.title} · venta ${formatCurrency(json.product.sellingPrice)} · beneficio ${formatCurrency(json.product.profit)}`,
        productId: json.product.id,
        publish: json.publish?.ok ? `Publicado en ${store?.platform ?? 'la tienda'}` : json.publish?.error ? `Guardado, pero la publicación falló: ${json.publish.error}` : 'Guardado sin publicar',
      });
      onImported?.({ title: json.product.title, store: store?.name ?? '' });
    } catch (err) {
      setResult({ ok: false, message: (err as Error).message });
    } finally {
      setImporting(false);
    }
  };

  if (!itemId) return null;

  const item = detail?.item;
  const images = item?.images?.length ? item.images : item?.imageUrl ? [item.imageUrl] : [];
  const finalPrice = preview?.sellingPrice ?? detail?.pricing.sellingPrice ?? 0;
  const finalProfit = preview?.profit ?? detail?.pricing.profit ?? 0;
  const finalMarginPct = preview?.marginPct ?? detail?.pricing.marginPct ?? 0;
  const shipping = detail?.pricing.shipping ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm">
      <button type="button" aria-label="Cerrar" className="flex-1 cursor-default" onClick={onClose} />
      <aside className="flex h-full w-full max-w-[720px] flex-col border-l border-white/10 bg-[#0b0d12] shadow-2xl">
        <header className="flex items-center justify-between gap-3 border-b border-white/[0.07] px-5 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Package className="size-4 text-indigo-300" />
            Ficha del producto
            {item && <ProviderBadge provider={item.provider} />}
            {item?.source === 'sample' && <Badge variant="outline">muestra</Badge>}
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading && (
            <div className="space-y-3">
              <Progress value={70} />
              <p className="text-[12px] text-muted-foreground">Cargando la ficha y tu regla de precios…</p>
            </div>
          )}

          {error && (
            <Alert variant="danger" title="No he podido cargar el artículo">
              {error}
            </Alert>
          )}

          {detail && item && (
            <div className="space-y-5">
              <div className="grid gap-4 md:grid-cols-[240px,1fr]">
                <div className="space-y-2">
                  <div className="overflow-hidden rounded-xl border border-white/[0.07] bg-black/30">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={imageSrc(images[image] ?? item.imageUrl)} alt={item.title} className="aspect-square w-full object-cover" />
                  </div>
                  {images.length > 1 && (
                    <div className="flex gap-2">
                      {images.slice(0, 5).map((img, i) => (
                        <button
                          key={`${img}-${i}`}
                          type="button"
                          onClick={() => setImage(i)}
                          className={cn('size-12 overflow-hidden rounded-md border', i === image ? 'border-indigo-400' : 'border-white/10 opacity-70 hover:opacity-100')}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={imageSrc(img)} alt="" className="size-full object-cover" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-3">
                  <h2 className="text-base font-semibold leading-snug">{item.title}</h2>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px] text-muted-foreground">
                    {item.categoryName && <Badge variant="outline">{item.categoryName}</Badge>}
                    {item.rating !== null && (
                      <span className="inline-flex items-center gap-1 text-amber-300">
                        <Star className="size-3 fill-current" /> {Number(item.rating).toFixed(1)}
                      </span>
                    )}
                    {item.ordersCount ? <span>{formatNumber(item.ordersCount)} pedidos</span> : null}
                    <span className={item.stock > 0 ? '' : 'text-amber-400'}>{formatNumber(item.stock)} uds disponibles</span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
                    <Truck className="size-3.5" />
                    {item.freeShipping ? 'Envío gratis' : `Envío ${formatCurrency(shipping)}`}
                    {item.shippingMinDays ? ` · ${item.shippingMinDays}-${item.shippingMaxDays ?? item.shippingMinDays + 7} días` : ''}
                    {item.shipFrom ? ` · almacén ${item.shipFrom}` : ''}
                  </div>

                  {item.source === 'sample' && (
                    <Alert variant="info" title="Artículo del catálogo de muestra">
                      Sirve para probar el flujo completo (ficha, margen, importación y publicación). Cuando el operador configure las claves de
                      la plataforma en <span className="font-medium">Administración → Claves de proveedor</span>, este catálogo se llenará solo
                      con productos reales de CJ y AliExpress.
                    </Alert>
                  )}

                  <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
                    <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-wide text-muted-foreground">
                      <span>Tu precio con «{detail.pricing.ruleName}»</span>
                      <span>{detail.variants} variantes · {detail.scrapedPayload.images?.length ?? 0} imágenes</span>
                    </div>
                    <div className="grid grid-cols-3 gap-3 text-center">
                      <div className="rounded-lg bg-black/20 py-2">
                        <div className="text-[10px] uppercase text-muted-foreground">Coste</div>
                        <div className="text-sm font-semibold tabular-nums">{formatCurrency((detail.pricing.costPriceEur ?? item.costPrice) + shipping)}</div>
                        {detail.pricing.fx?.converted && (
                          <div className="text-[9px] text-muted-foreground">
                            {formatCurrency(item.costPrice, item.currency)} al cambio {detail.pricing.fx.rate}
                          </div>
                        )}
                      </div>
                      <div className="rounded-lg bg-indigo-500/10 py-2">
                        <div className="text-[10px] uppercase text-indigo-300/80">Precio venta</div>
                        <div className="text-base font-semibold tabular-nums text-indigo-200">{formatCurrency(finalPrice)}</div>
                      </div>
                      <div className="rounded-lg bg-emerald-500/10 py-2">
                        <div className="text-[10px] uppercase text-emerald-300/80">Beneficio</div>
                        <div className="text-base font-semibold tabular-nums text-emerald-300">
                          +{formatCurrency(finalProfit)}
                          <span className="ml-1 text-[10px] font-normal">({Math.round(finalMarginPct)}%)</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="store">Tienda destino</Label>
                      <Select id="store" value={storeId} onChange={(e) => setStoreId(e.target.value)}>
                        {detail.stores.length === 0 && <option value="">— Sin tiendas conectadas —</option>}
                        {detail.stores.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name} · {s.platform}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="status">Estado al publicar</Label>
                      <Select id="status" value={status} onChange={(e) => setStatus(e.target.value as 'DRAFT' | 'ACTIVE')}>
                        <option value="DRAFT">Borrador (revisar antes)</option>
                        <option value="ACTIVE">Publicado (activo)</option>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="margin">Margen de esta importación (%)</Label>
                      <Input id="margin" type="number" min={0} max={2000} value={marginPct} onChange={(e) => setMarginPct(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Coste en créditos</Label>
                      <div className="flex h-9 items-center rounded-md border border-white/10 bg-white/[0.02] px-3 text-[12px] text-muted-foreground">
                        {detail.credits} créditos (igual que importar por URL)
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="gradient" disabled={importing || !storeId} onClick={doImport}>
                      {importing ? <Loader2 className="size-4 animate-spin" /> : <Package className="size-4" />}
                      {importing ? 'Importando…' : 'Importar a mi tienda'}
                    </Button>
                    <Button variant="outline" asChild>
                      <Link href={`/products?search=${encodeURIComponent(item.title.slice(0, 40))}`}>Ver mis productos</Link>
                    </Button>
                    {item.source === 'api' && (
                      <a
                        href={detail.scrapedPayload.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground"
                      >
                        Ver en el proveedor <ExternalLink className="size-3.5" />
                      </a>
                    )}
                  </div>

                  {!storeId && (
                    <Alert variant="warning" title="Necesitas una tienda conectada">
                      Conecta Shopify o WooCommerce en <Link className="underline" href="/stores">Tiendas</Link> para poder publicar.
                    </Alert>
                  )}

                  {result && (
                    <Alert variant={result.ok ? 'success' : 'danger'} title={result.ok ? 'Producto importado' : 'No se pudo importar'}>
                      <div className="space-y-1">
                        <p>{result.message}</p>
                        {result.publish && <p className="text-[12px] opacity-90">{result.publish}</p>}
                        {result.ok && (
                          <p className="flex items-center gap-2 text-[12px]">
                            <CheckCircle2 className="size-3.5" />
                            <Link className="underline" href="/products">
                              Ver en Gestión de productos
                            </Link>
                            <span className="opacity-70">El worker lo vigilará en su próxima pasada.</span>
                          </p>
                        )}
                      </div>
                    </Alert>
                  )}

                  {detail.description && stripHtml(detail.description).trim().length > 20 && (
                    <div className="space-y-1.5">
                      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Descripción del proveedor</div>
                      <p className="max-h-40 overflow-y-auto whitespace-pre-line text-[12px] leading-relaxed text-muted-foreground">
                        {stripHtml(detail.description).slice(0, 900)}
                      </p>
                    </div>
                  )}

                  {detail.tags?.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {detail.tags.slice(0, 12).map((tag) => (
                        <Badge key={tag} variant="secondary" className="text-[10px]">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  )}

                  <div className="flex items-start gap-2 rounded-lg border border-white/[0.07] bg-white/[0.02] p-3 text-[11px] text-muted-foreground">
                    <Info className="mt-0.5 size-3.5 shrink-0 text-indigo-300" />
                    <p>
                      La importación usa el producto <span className="text-foreground">ya indexado</span> por la plataforma: no vuelve a consultar al
                      proveedor, así que es instantánea y no consume cuota de las APIs. El precio se recalcula con tu regla cada vez que cambie el
                      coste.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {!loading && !detail && !error && (
            <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
              <AlertCircle className="size-4" /> Selecciona un producto del catálogo.
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

export default CatalogImportDrawer;
