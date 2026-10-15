'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, RefreshCw, Save, Trash2 } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { Switch } from '@/components/ui/primitives';
import { computeSellingPrice } from '@/lib/pricing';
import { formatCurrency } from '@/lib/utils';

export function ProductEditor({
  product,
}: {
  product: {
    id: string;
    title: string;
    description: string;
    sellingPrice: number;
    compareAtPrice: number;
    marginPct: number;
    costPrice: number;
    shippingCost: number;
    status: string;
    isMonitored: boolean;
    category: string;
    currency: string;
  };
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    title: product.title,
    description: product.description,
    sellingPrice: product.sellingPrice,
    compareAtPrice: product.compareAtPrice,
    marginPct: product.marginPct,
    status: product.status,
    isMonitored: product.isMonitored,
    category: product.category,
  });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ variant: 'success' | 'danger' | 'info'; text: string } | null>(null);

  const projected = computeSellingPrice(product.costPrice, product.shippingCost, { markupPct: form.marginPct });
  const profit = form.sellingPrice - product.costPrice - product.shippingCost;

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/products/${product.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: form.title,
          description: form.description,
          sellingPrice: Number(form.sellingPrice),
          compareAtPrice: Number(form.compareAtPrice),
          marginPct: Number(form.marginPct),
          status: form.status,
          isMonitored: form.isMonitored,
          category: form.category,
        }),
      });
      const json = await res.json();
      setMsg({ variant: json.ok ? 'success' : 'danger', text: json.ok ? 'Cambios guardados. El worker aplicará el precio nuevo en la próxima sincronización.' : json.error });
      if (json.ok) router.refresh();
    } catch (err) {
      setMsg({ variant: 'danger', text: (err as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const syncNow = async () => {
    setSaving(true);
    const res = await fetch(`/api/products/${product.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'sync', priority: 1 }),
    });
    const json = await res.json();
    setMsg({ variant: json.ok ? 'info' : 'danger', text: json.message ?? (json.ok ? 'Sincronización encolada' : json.error) });
    setSaving(false);
  };

  const remove = async () => {
    if (!confirm('¿Borrar este producto del panel? No se elimina de la tienda.')) return;
    await fetch(`/api/products/${product.id}`, { method: 'DELETE' });
    router.push('/products');
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Edición rápida</CardTitle>
        <CardDescription>Los cambios se guardan en el panel; el worker los propaga a la tienda en la siguiente sincronización</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3.5">
        {msg && (
          <Alert variant={msg.variant} onDismiss={() => setMsg(null)}>
            {msg.text}
          </Alert>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="p-title">Título</Label>
          <Input id="p-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="p-desc">Descripción</Label>
          <Textarea id="p-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="h-28 font-mono text-[12px]" />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="p-margin">Margen %</Label>
            <Input
              id="p-margin"
              type="number"
              value={form.marginPct}
              onChange={(e) => {
                const marginPct = Number(e.target.value);
                const b = computeSellingPrice(product.costPrice, product.shippingCost, { markupPct: marginPct });
                setForm({ ...form, marginPct, sellingPrice: b.sellingPrice, compareAtPrice: b.compareAtPrice });
              }}
            />
            <p className="text-[11px] text-muted-foreground">
              Regla → <span className="text-foreground">{formatCurrency(projected.sellingPrice)}</span>
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p-price">Precio de venta</Label>
            <Input id="p-price" type="number" step="0.01" value={form.sellingPrice} onChange={(e) => setForm({ ...form, sellingPrice: Number(e.target.value) })} />
            <p className="text-[11px] text-muted-foreground">
              Beneficio <span className={profit > 0 ? 'text-emerald-400' : 'text-rose-400'}>{formatCurrency(profit)}</span>
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="p-compare">Precio tachado</Label>
            <Input id="p-compare" type="number" step="0.01" value={form.compareAtPrice} onChange={(e) => setForm({ ...form, compareAtPrice: Number(e.target.value) })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p-status">Estado</Label>
            <Select id="p-status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              {['ACTIVE', 'DRAFT', 'PAUSED', 'OUT_OF_STOCK', 'ERROR', 'ARCHIVED'].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
          <div>
            <p className="text-[13px] font-medium">Monitorización 24/7</p>
            <p className="text-[11px] text-muted-foreground">Revisa precio y stock cada hora</p>
          </div>
          <Switch checked={form.isMonitored} onCheckedChange={(v) => setForm({ ...form, isMonitored: v })} />
        </div>

        <div className="flex gap-2">
          <Button variant="gradient" className="flex-1" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Guardar cambios
          </Button>
          <Button variant="outline" onClick={syncNow} disabled={saving}>
            <RefreshCw className="size-4" />
            Sync ahora
          </Button>
          <Button variant="ghost" className="text-rose-400 hover:bg-rose-500/10" onClick={remove} disabled={saving}>
            <Trash2 className="size-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
