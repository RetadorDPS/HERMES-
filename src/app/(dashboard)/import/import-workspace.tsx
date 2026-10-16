'use client';

import { conBase } from '@/lib/ruta';
import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BadgeEuro,
  CheckCircle2,
  Clipboard,
  ExternalLink,
  Image as ImageIcon,
  Info,
  Loader2,
  Percent,
  RefreshCw,
  Ruler,
  Save,
  Search,
  Ship,
  Star,
  Store as StoreIcon,
  Truck,
  Wand2,
} from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { Progress, Switch } from '@/components/ui/primitives';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { computeSellingPrice } from '@/lib/pricing';
import type { ScrapedProduct } from '@/lib/types';
import { SAMPLE_URLS } from '@/lib/suppliers';
import { cn, formatCurrency, formatNumber, truncate } from '@/lib/utils';

interface StoreOption {
  id: string;
  name: string;
  platform: 'SHOPIFY' | 'WOOCOMMERCE';
  status: string;
}

interface RuleOption {
  id: string;
  name: string;
  markupPct: number;
  fixedFee: number;
  minProfit: number;
  roundTo: number;
  minPrice: number | null;
  maxPrice: number | null;
  includeShipping: boolean;
  isDefault: boolean;
}

interface ScrapeResponse {
  ok: boolean;
  product?: ScrapedProduct;
  pricing?: {
    baseCost: number;
    shippingCost: number;
    breakdown: { sellingPrice: number; profit: number; marginPct: number; compareAtPrice: number };
    perRule: { ruleId: string; name: string; sellingPrice: number; profit: number; marginPct: number }[];
    selectedRuleId: string | null;
  };
  meta?: { stores: StoreOption[]; durationMs: number; estimatedProfit: number };
  error?: string;
  hint?: string;
  code?: string;
}

const STEPS = ['Pega la URL', 'Revisa y edita', 'Importa a tu tienda'];

export function ImportWorkspace({ rules, stores: initialStores, mode }: { rules: RuleOption[]; stores: StoreOption[]; mode: string }) {
  const [url, setUrl] = useState('');
  const [country, setCountry] = useState('ES');
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<ScrapeResponse | null>(null);
  const [importResult, setImportResult] = useState<any>(null);
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null);

  const [stores] = useState<StoreOption[]>(initialStores);
  const [storeId, setStoreId] = useState(initialStores.find((s) => s.status === 'CONNECTED')?.id ?? initialStores[0]?.id ?? '');
  const [ruleId, setRuleId] = useState(rules.find((r) => r.isDefault)?.id ?? rules[0]?.id ?? '');
  const [marginPct, setMarginPct] = useState<number>(rules.find((r) => r.isDefault)?.markupPct ?? 40);
  const [shippingCost, setShippingCost] = useState<number>(0);
  const [status, setStatus] = useState<'DRAFT' | 'ACTIVE'>('ACTIVE');
  const [publish, setPublish] = useState(true);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priceOverride, setPriceOverride] = useState<string>('');
  const [selectedImage, setSelectedImage] = useState(0);
  const [step, setStep] = useState(0);

  const product = result?.product;
  const rule = rules.find((r) => r.id === ruleId) ?? rules[0];

  // ── Progreso simulado durante la extracción (feedback visual honesto)
  useEffect(() => {
    if (!loading) return;
    setProgress(6);
    const t = setInterval(() => setProgress((p) => (p < 88 ? p + Math.random() * 9 : p)), 450);
    return () => clearInterval(t);
  }, [loading]);

  // ── Cálculo de precios en vivo
  const pricing = useMemo(() => {
    if (!product) return null;
    const baseCost = product.variants[0]?.price ?? 0;
    const ship = shippingCost;
    return {
      baseCost,
      ship,
      ...computeSellingPrice(baseCost, ship, {
        markupPct: marginPct,
        fixedFee: rule?.fixedFee ?? 0,
        minProfit: rule?.minProfit ?? 1.5,
        roundTo: rule?.roundTo ?? 0.99,
        minPrice: rule?.minPrice ?? null,
        maxPrice: rule?.maxPrice ?? null,
        includeShipping: true,
      }, rule?.name ?? 'personalizada'),
    };
  }, [product, marginPct, shippingCost, rule]);

  const finalPrice = priceOverride ? Number(priceOverride) : (pricing?.sellingPrice ?? 0);
  const finalProfit = product ? finalPrice - (product.variants[0]?.price ?? 0) - shippingCost : 0;

  // ───────────────────────────── Extracción ──────────────────────────────
  const extract = async (targetUrl?: string) => {
    const effectiveUrl = (targetUrl ?? url).trim();
    if (!effectiveUrl) {
      setError({ message: 'Introduce la URL del producto del proveedor.' });
      return;
    }
    setUrl(effectiveUrl);
    setLoading(true);
    setError(null);
    setResult(null);
    setImportResult(null);
    setStep(1);

    try {
      const res = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: effectiveUrl, country, ruleId }),
      });
      const json: ScrapeResponse = await res.json();
      if (!json.ok || !json.product) {
        setError({ message: json.error ?? 'No se pudo extraer el producto', hint: json.hint });
        setStep(0);
        return;
      }
      setProgress(100);
      setResult(json);
      setTitle(json.product.title);
      setDescription(json.product.description);
      setShippingCost(json.pricing?.shippingCost ?? json.product.shipping.cheapestCost ?? 0);
      setPriceOverride('');
      setSelectedImage(0);
    } catch (err) {
      setError({ message: (err as Error).message });
      setStep(0);
    } finally {
      setLoading(false);
      setTimeout(() => setProgress(0), 600);
    }
  };

  // ───────────────────────────── Importación ─────────────────────────────
  const importProduct = async () => {
    if (!product || !storeId) return;
    setImporting(true);
    setError(null);
    try {
      const res = await fetch('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: product.sourceUrl,
          storeId,
          ruleId,
          marginPct,
          sellingPrice: priceOverride ? Number(priceOverride) : undefined,
          shippingCost,
          title,
          description,
          status,
          country,
          publish,
          scrapedPayload: product,
        }),
      });
      const json = await res.json();
      if (!json.ok) {
        setError({ message: json.error ?? 'Fallo al importar' });
        return;
      }
      setImportResult(json);
      setStep(2);
    } catch (err) {
      setError({ message: (err as Error).message });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_400px]">
      {/* ─────────────────────────── Columna principal ─────────────────────── */}
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wand2 className="size-4 text-indigo-300" />
              Importador por URL
            </CardTitle>
            <CardDescription>
              Pega el enlace de un producto de AliExpress, Amazon, CJ Dropshipping, Alibaba o Temu. El motor extrae variantes, stock, imágenes HD, envíos y reseñas.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row">
              <div data-tour="import:url" className="relative flex-1">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !loading && extract()}
                  placeholder="https://es.aliexpress.com/item/1005006123456789.html"
                  className="pl-9 font-mono text-[13px]"
                  disabled={loading}
                />
              </div>
              <div className="flex gap-2">
                <Select value={country} onChange={(e) => setCountry(e.target.value)} className="w-[112px]" disabled={loading}>
                  {['ES', 'FR', 'DE', 'IT', 'PT', 'NL', 'BE', 'US', 'MX', 'GB'].map((c) => (
                    <option key={c} value={c}>
                      Envío {c}
                    </option>
                  ))}
                </Select>
                <Button variant="gradient" onClick={() => extract()} disabled={loading || !url.trim()}>
                  {loading ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
                  {loading ? 'Extrayendo…' : 'Extraer producto'}
                </Button>
              </div>
            </div>

            {loading && (
              <div className="space-y-1.5">
                <Progress value={progress} />
                <p className="text-[11px] text-muted-foreground">
                  Navegando al proveedor, resolviendo variantes y calculando envíos a {country}… (rotación de proxy activa)
                </p>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Ejemplos:</span>
              {SAMPLE_URLS.map((s) => (
                <button
                  key={s.url}
                  onClick={() => extract(s.url)}
                  disabled={loading}
                  className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.02] px-2 py-1 text-[11px] text-muted-foreground transition hover:bg-white/[0.07] hover:text-foreground"
                >
                  <Clipboard className="size-3" />
                  {s.label}
                </button>
              ))}
            </div>

            {error && (
              <Alert variant="danger" title={error.message} onDismiss={() => setError(null)}>
                {error.hint}
              </Alert>
            )}
          </CardContent>
        </Card>

        {/* Si la extracción cayó al modo demo, hay que decirlo MUY claro: los datos
            son sintéticos y no deben publicarse como si fueran reales. */}
        {product?.extractionMeta?.mode === 'demo' && (
          <Alert variant="warning" title="Datos de demostración — no son del proveedor">
            La extracción no llegó al proveedor (bloqueo, red o URL de prueba) y se han generado datos{' '}
            <span className="font-medium">simulados</span> para que puedas probar el flujo completo. No lo publiques en una tienda real sin revisar
            precio y stock: con el microservicio de scraping activo y las claves de la plataforma, la extracción es real.
          </Alert>
        )}

        {/* ─────────────────────── Previsualización editable ─────────────────── */}
        {product && (
          <>
            <Card className="animate-in-up">
              <CardHeader className="flex-row items-start justify-between space-y-0">
                <div>
                  <CardTitle>Previsualización</CardTitle>
                  <CardDescription>
                    Extraído en {result?.meta?.durationMs ?? 0} ms · modo <span className="font-mono">{product.extractionMeta.mode}</span> ·{' '}
                    {product.extractionMeta.attempts} intento(s)
                  </CardDescription>
                </div>
                <div className="flex flex-wrap justify-end gap-1.5">
                  <StatusBadge status={product.supplier} label={product.supplier.replace('_', ' ')} />
                  {product.extractionMeta.proxyUsed && <Badge variant="outline">proxy {product.extractionMeta.proxyUsed}</Badge>}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {product.warnings.length > 0 && (
                  <Alert variant="warning" title="Avisos de la extracción">
                    <ul className="list-disc space-y-0.5 pl-4">
                      {product.warnings.slice(0, 3).map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  </Alert>
                )}

                <div className="grid gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
                  <div className="space-y-2">
                    <div className="aspect-square overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.03]">
                      {product.images[selectedImage] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={product.images[selectedImage].hdUrl ?? product.images[selectedImage].url}
                          alt={title}
                          className="size-full object-cover"
                        />
                      ) : (
                        <div className="grid size-full place-items-center text-muted-foreground">
                          <ImageIcon className="size-8" />
                        </div>
                      )}
                    </div>
                    <div className="grid grid-cols-4 gap-1.5">
                      {product.images.slice(0, 8).map((img, i) => (
                        <button
                          key={i}
                          onClick={() => setSelectedImage(i)}
                          className={cn(
                            'aspect-square overflow-hidden rounded-md border transition',
                            selectedImage === i ? 'border-indigo-400 ring-1 ring-indigo-400/50' : 'border-white/10 hover:border-white/25',
                          )}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={img.url} alt="" className="size-full object-cover" loading="lazy" />
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>{product.images.length} imágenes HD</span>
                      <span>{product.specs?.Modelo ?? ''}</span>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <Label htmlFor="title">Título del producto (editable)</Label>
                      <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1.5" />
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        SEO sugerido: <span className="text-foreground/80">{product.seoTitle}</span> · se publica en{' '}
                        {product.category ? `“${product.category}”` : 'sin categoría'}
                      </p>
                    </div>

                    <div>
                      <Label htmlFor="description">Descripción (HTML admitido)</Label>
                      <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} className="mt-1.5 h-[104px] font-mono text-[12px]" />
                    </div>

                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {[
                        { label: 'Coste proveedor', value: formatCurrency(product.variants[0]?.price ?? 0, 'USD'), icon: BadgeEuro },
                        { label: 'Stock total', value: formatNumber(product.stockTotal), icon: Ruler },
                        { label: 'Pedidos históricos', value: formatNumber(product.ordersCount), icon: Truck },
                        { label: 'Valoración', value: `${product.ratingAvg.toFixed(1)} ★ (${formatNumber(product.ratingCount)})`, icon: Star },
                      ].map(({ label, value, icon: Icon }) => (
                        <div key={label} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5">
                          <p className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                            <Icon className="size-3" />
                            {label}
                          </p>
                          <p className="mt-1 text-[13px] font-semibold tabular-nums">{value}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Variantes */}
                <div className="rounded-xl border border-white/[0.06]">
                  <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-2">
                    <p className="text-[13px] font-medium">Variantes detectadas ({product.variants.length})</p>
                    <Badge variant="outline">SKU · coste · stock · talla/color</Badge>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>SKU</TableHead>
                        <TableHead>Variante</TableHead>
                        <TableHead className="text-right">Coste</TableHead>
                        <TableHead className="text-right">Stock</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {product.variants.slice(0, 8).map((v) => (
                        <TableRow key={v.supplierVariantId}>
                          <TableCell className="font-mono text-[11px] text-muted-foreground">{v.sku}</TableCell>
                          <TableCell className="text-[13px]">{v.title}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatCurrency(v.price, product.currency)}</TableCell>
                          <TableCell className="text-right">
                            <span className={cn('tabular-nums', v.stock === 0 ? 'text-rose-400' : v.stock < 20 ? 'text-amber-400' : 'text-emerald-400')}>
                              {v.stock}
                            </span>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {product.variants.length > 8 && (
                    <p className="border-t border-white/[0.06] px-3 py-2 text-[11px] text-muted-foreground">
                      +{product.variants.length - 8} variantes más (se importan todas)
                    </p>
                  )}
                </div>

                {/* Envíos */}
                <div className="rounded-xl border border-white/[0.06] p-3">
                  <p className="flex items-center gap-1.5 text-[13px] font-medium">
                    <Ship className="size-3.5 text-sky-300" />
                    Opciones de envío a {country}
                  </p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {product.shipping.options.slice(0, 4).map((o, i) => (
                      <div key={i} className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
                        <div className="min-w-0">
                          <p className="truncate text-[12px] font-medium">{o.method}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {o.carrier ?? '—'} · {o.minDays ?? '?'}-{o.maxDays ?? '?'} días {o.isTracked ? '· con tracking' : '· sin tracking'}
                          </p>
                        </div>
                        <span className="shrink-0 text-[12px] font-semibold tabular-nums">
                          {o.cost === 0 ? 'Gratis' : formatCurrency(o.cost, o.currency)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Reseñas */}
                {product.reviews.length > 0 && (
                  <div className="rounded-xl border border-white/[0.06] p-3">
                    <p className="flex items-center gap-1.5 text-[13px] font-medium">
                      <Star className="size-3.5 text-amber-300" />
                      Reseñas extraídas ({product.reviews.length}) · media {product.ratingAvg.toFixed(1)} ★
                    </p>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      {product.reviews.slice(0, 4).map((r, i) => (
                        <div key={i} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5">
                          <div className="flex items-center justify-between">
                            <span className="text-[12px] font-medium">
                              {'★'.repeat(Math.max(1, Math.min(5, r.rating)))}
                              <span className="text-muted-foreground">{'★'.repeat(5 - Math.max(1, Math.min(5, r.rating)))}</span>
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                              {r.author} {r.authorCountry ? `· ${r.authorCountry}` : ''}
                            </span>
                          </div>
                          <p className="mt-1 line-clamp-3 text-[11px] leading-relaxed text-muted-foreground">{truncate(r.text ?? '', 160)}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* ─────────────────────────── Panel de importación ──────────────────── */}
      <div className="space-y-4 lg:sticky lg:top-[92px] lg:self-start">
        <Card>
          <CardHeader>
            <CardTitle>Configuración de venta</CardTitle>
            <CardDescription>Margen, tienda destino y publicación</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-1 rounded-lg border border-white/[0.06] bg-white/[0.02] p-1 text-[11px]">
              {STEPS.map((s, i) => (
                <div
                  key={s}
                  className={cn(
                    'flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1.5 text-center',
                    step === i ? 'bg-white/[0.08] font-medium text-foreground' : 'text-muted-foreground',
                  )}
                >
                  <span className={cn('grid size-4 place-items-center rounded-full text-[9px]', step > i ? 'bg-emerald-500 text-white' : step === i ? 'bg-indigo-500 text-white' : 'bg-white/10')}>
                    {step > i ? '✓' : i + 1}
                  </span>
                  <span className="hidden sm:inline">{s}</span>
                </div>
              ))}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="store">Tienda destino</Label>
              <Select id="store" value={storeId} onChange={(e) => setStoreId(e.target.value)}>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · {s.platform === 'SHOPIFY' ? 'Shopify' : 'WooCommerce'} {s.status !== 'CONNECTED' ? `(${s.status})` : ''}
                  </option>
                ))}
              </Select>
              {stores.length === 0 && (
                <p className="text-[11px] text-amber-400">No hay tiendas conectadas: ve a “Tiendas” para conectar Shopify o WooCommerce.</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="rule">Regla de margen</Label>
                <Select
                  id="rule"
                  value={ruleId}
                  onChange={(e) => {
                    setRuleId(e.target.value);
                    const r = rules.find((x) => x.id === e.target.value);
                    if (r) setMarginPct(r.markupPct);
                  }}
                >
                  {rules.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} ({r.markupPct}%)
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="margin">Markup %</Label>
                <div className="relative">
                  <Input
                    id="margin"
                    type="number"
                    value={marginPct}
                    min={0}
                    max={2000}
                    onChange={(e) => {
                      setMarginPct(Number(e.target.value));
                      setPriceOverride('');
                    }}
                    className="pr-7"
                  />
                  <Percent className="absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="shipping">Coste de envío</Label>
                <Input
                  id="shipping"
                  type="number"
                  step="0.01"
                  min={0}
                  value={shippingCost}
                  onChange={(e) => {
                    setShippingCost(Number(e.target.value));
                    setPriceOverride('');
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="price">Precio de venta final</Label>
                <Input
                  id="price"
                  type="number"
                  step="0.01"
                  min={0}
                  value={priceOverride || (pricing?.sellingPrice ?? '')}
                  onChange={(e) => setPriceOverride(e.target.value)}
                  placeholder="Automático"
                />
              </div>
            </div>

            {priceOverride && (
              <button onClick={() => setPriceOverride('')} className="text-[11px] text-indigo-300 hover:underline">
                ↺ Volver al precio calculado por la regla ({formatCurrency(pricing?.sellingPrice ?? 0)})
              </button>
            )}

            {/* Desglose en vivo */}
            {pricing && product && (
              <div className="space-y-2 rounded-xl border border-indigo-500/20 bg-indigo-500/[0.05] p-3">
                <p className="text-[12px] font-medium text-indigo-200">Desglose del precio (en vivo)</p>
                {[
                  { label: 'Coste del proveedor', value: formatCurrency(pricing.baseCost, product.currency) },
                  { label: `Envío a ${country}`, value: pricing.ship === 0 ? 'Gratis' : formatCurrency(pricing.ship, product.currency) },
                  { label: `Markup aplicado`, value: `+${marginPct}% ${rule?.fixedFee ? `+ ${formatCurrency(rule.fixedFee)} fijo` : ''}` },
                  { label: 'Redondeo psicológico', value: `x,${String(rule?.roundTo ?? 0.99).split('.')[1]} (${rule?.name})` },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-center justify-between text-[12px]">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="tabular-nums">{value}</span>
                  </div>
                ))}
                <div className="my-1 border-t border-white/10" />
                <div className="flex items-center justify-between text-[13px]">
                  <span className="font-medium">Precio de venta</span>
                  <span className="font-semibold tabular-nums text-foreground">{formatCurrency(finalPrice)}</span>
                </div>
                <div className="flex items-center justify-between text-[13px]">
                  <span className="text-muted-foreground">Comparativa (precio tachado)</span>
                  <span className="tabular-nums text-muted-foreground line-through">{formatCurrency(pricing.compareAtPrice)}</span>
                </div>
                <div className="flex items-center justify-between rounded-lg bg-emerald-500/10 px-2 py-1.5 text-[13px]">
                  <span className="text-emerald-300">Beneficio neto por unidad</span>
                  <span className="font-semibold tabular-nums text-emerald-300">
                    {formatCurrency(finalProfit)} · {finalPrice > 0 ? ((finalProfit / finalPrice) * 100).toFixed(0) : 0}%
                  </span>
                </div>
              </div>
            )}

            <div className="space-y-2.5 rounded-xl border border-white/[0.06] p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[13px] font-medium">Publicar en la tienda</p>
                  <p className="text-[11px] text-muted-foreground">Desactiva para importar sólo al panel</p>
                </div>
                <Switch checked={publish} onCheckedChange={setPublish} />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[13px] font-medium">Estado al publicar</p>
                  <p className="text-[11px] text-muted-foreground">{status === 'ACTIVE' ? 'Visible al público' : 'Oculto (borrador)'}</p>
                </div>
                <Select value={status} onChange={(e) => setStatus(e.target.value as any)} className="w-[126px]">
                  <option value="ACTIVE">Publicado</option>
                  <option value="DRAFT">Borrador</option>
                </Select>
              </div>
            </div>

            <Button variant="gradient" className="w-full" onClick={importProduct} disabled={!product || importing || !storeId}>
              {importing ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              {importing ? 'Importando…' : `Importar a ${stores.find((s) => s.id === storeId)?.name ?? 'la tienda'}`}
            </Button>

            {!product && (
              <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
                <Info className="mt-0.5 size-3 shrink-0" />
                Extrae primero un producto para habilitar la importación. En modo demo ({mode}) la extracción genera datos sintéticos realistas sin tocar los proveedores.
              </p>
            )}
          </CardContent>
        </Card>

        {importResult && (
          <Card className="animate-in-up border-emerald-500/25">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-emerald-300">
                <CheckCircle2 className="size-4" />
                Producto importado
              </CardTitle>
              <CardDescription>
                {importResult.product.variants} variantes · {importResult.product.images} imágenes · {importResult.product.reviews} reseñas
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2.5">
              <div className="space-y-1.5 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-[12px]">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Tienda</span>
                  <span className="flex items-center gap-1.5">
                    <StoreIcon className="size-3" />
                    {importResult.store.name}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Publicación</span>
                  <span className="flex items-center gap-1.5">
                    {importResult.publish.ok ? (
                      <>
                        <StatusBadge status="SUCCESS" label={importResult.publish.simulated ? 'Simulada (demo)' : 'Publicado'} />
                      </>
                    ) : (
                      <StatusBadge status="FAILED" label="Fallo al publicar" />
                    )}
                  </span>
                </div>
                {importResult.publish.storeProductId && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">ID en tienda</span>
                    <span className="truncate font-mono text-[11px]">{importResult.publish.storeProductId}</span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Precio / beneficio</span>
                  <span className="tabular-nums">
                    {formatCurrency(importResult.product.sellingPrice)} · +{formatCurrency(importResult.product.profit)}
                  </span>
                </div>
                {importResult.fx?.line && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Cambio de divisa</span>
                    <span className="font-mono text-[11px]">{importResult.fx.line}</span>
                  </div>
                )}
                {!importResult.publish?.ok && importResult.creditsRefunded && (
                  <div className="flex items-center justify-between text-emerald-300">
                    <span>Créditos devueltos</span>
                    <span className="font-mono text-[11px]">sí (la operación no se completó)</span>
                  </div>
                )}
                {importResult.syncJob && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Primer chequeo del worker</span>
                    <span className="font-mono text-[11px]">en 15 min ({importResult.syncJob.mode})</span>
                  </div>
                )}
              </div>

              {!importResult.publish.ok && importResult.publish.error && (
                <Alert variant="warning" title="El producto se guardó, pero la tienda rechazó la publicación">
                  {importResult.publish.error}
                </Alert>
              )}

              <div className="flex gap-2">
                <Button asChild variant="outline" size="sm" className="flex-1">
                  <a href={conBase(`/products/${importResult.product.id}/`)}>
                    Ver ficha <ArrowRight className="size-3.5" />
                  </a>
                </Button>
                <Button variant="ghost" size="sm" onClick={() => { setResult(null); setImportResult(null); setUrl(''); setStep(0); }}>
                  <RefreshCw className="size-3.5" />
                  Importar otro
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {product && !importResult && (
          <Card>
            <CardHeader>
              <CardTitle className="text-[13px]">Qué se creará en la tienda</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 text-[12px] text-muted-foreground">
              {[
                `${product.variants.length} variantes con SKU, stock y opciones (color/talla)`,
                `${product.images.length} imágenes en alta resolución`,
                'Descripción saneada + bullets + etiquetas SEO',
                `Metafields: supplier_url, supplier_id, cost_price`,
                `${product.reviews.length} reseñas con nota ${product.ratingAvg.toFixed(1)} ★ (importables)`,
                'Monitorización 24/7 de precio y stock activada',
              ].map((line) => (
                <p key={line} className="flex items-start gap-1.5">
                  <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-emerald-400" />
                  {line}
                </p>
              ))}
              <a
                href={product.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-flex items-center gap-1 text-[11px] text-indigo-300 hover:underline"
              >
                Abrir producto original <ExternalLink className="size-3" />
              </a>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
