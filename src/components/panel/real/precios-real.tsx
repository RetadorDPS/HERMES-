'use client';

import { useState } from 'react';
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { borrarRegla, guardarRegla, obtenerReglas, type EntradaRegla, type ReglaPrecio } from '@/lib/real/datos';
import { computeSellingPrice } from '@/lib/pricing';
import { formatCurrency } from '@/lib/utils';
import { PantallaReal, useCarga } from './comun';

const VACIA: EntradaRegla = {
  name: '',
  markupPct: 40,
  fixedFee: 0,
  minProfit: 1.5,
  minPrice: null,
  maxPrice: null,
  roundTo: 0.99,
  includeShipping: true,
  applyToCategory: null,
  isDefault: false,
};

const EJEMPLOS = [3, 8, 15, 35, 60, 120];

function Campo({ id, etiqueta, ayuda, children }: { id: string; etiqueta: string; ayuda?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{etiqueta}</Label>
      {children}
      {ayuda && <p className="text-[11px] text-muted-foreground">{ayuda}</p>}
    </div>
  );
}

const aNumero = (v: string, defecto = 0) => {
  const n = Number(v.replace(',', '.'));
  return Number.isFinite(n) ? n : defecto;
};

export function PreciosReal() {
  const { datos: reglas, error, cargando, recargar } = useCarga(obtenerReglas);
  const [edicion, setEdicion] = useState<EntradaRegla | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);

  const abrirNueva = () => {
    setFallo(null);
    setEdicion({ ...VACIA, isDefault: (reglas ?? []).length === 0 });
  };
  const abrirEditar = (r: ReglaPrecio) => {
    setFallo(null);
    setEdicion({ id: r.id, name: r.name, markupPct: r.markupPct, fixedFee: r.fixedFee, minProfit: r.minProfit, minPrice: r.minPrice, maxPrice: r.maxPrice, roundTo: r.roundTo, includeShipping: r.includeShipping, applyToCategory: r.applyToCategory, isDefault: r.isDefault });
  };

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!edicion) return;
    if (!edicion.name.trim()) {
      setFallo('Ponle un nombre a la regla.');
      return;
    }
    setGuardando(true);
    setFallo(null);
    try {
      await guardarRegla(edicion);
      setEdicion(null);
      await recargar();
    } catch (err) {
      setFallo((err as Error).message);
    } finally {
      setGuardando(false);
    }
  };

  const borrar = async (r: ReglaPrecio) => {
    if (!window.confirm(`¿Borrar la regla «${r.name}»?`)) return;
    try {
      await borrarRegla(r.id);
      await recargar();
    } catch (err) {
      setFallo((err as Error).message);
    }
  };

  return (
    <PantallaReal
      titulo="Precios y márgenes"
      subtitulo="Reglas que fijan el precio de venta de cada producto"
      cargando={cargando}
      error={error}
      alRecargar={recargar}
      tour="screen:pricing"
    >
      <Alert variant="info" title="Cómo se calcula el precio de venta">
        <code className="rounded bg-black/30 px-1">precio = costo × (1 + markup%) + fee fijo (+ envío)</code>, con suelo de beneficio mínimo, límites mínimo y
        máximo y redondeo a <code className="rounded bg-black/30 px-1">x,99</code>. Solo una regla puede ser la predeterminada.
      </Alert>

      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] text-muted-foreground">{(reglas ?? []).length === 0 ? 'Todavía no tienes reglas.' : `${(reglas ?? []).length} regla(s)`}</p>
        <Button size="sm" variant="gradient" onClick={abrirNueva}>
          <Plus className="size-4" />
          Nueva regla
        </Button>
      </div>

      {fallo && !edicion && (
        <Alert variant="danger" title="No se pudo completar la acción" onDismiss={() => setFallo(null)}>
          {fallo}
        </Alert>
      )}

      {edicion && (
        <Card className="border-indigo-500/30">
          <CardHeader>
            <CardTitle>{edicion.id ? 'Editar regla' : 'Nueva regla'}</CardTitle>
            <CardDescription>Los cambios se aplican a los productos nuevos y a los que se vuelvan a calcular.</CardDescription>
          </CardHeader>
          <CardContent>
            {fallo && (
              <Alert variant="danger" title="No se pudo guardar" className="mb-3" onDismiss={() => setFallo(null)}>
                {fallo}
              </Alert>
            )}
            <form onSubmit={guardar} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="sm:col-span-2">
                <Campo id="nombre" etiqueta="Nombre">
                  <Input id="nombre" value={edicion.name} onChange={(e) => setEdicion({ ...edicion, name: e.target.value })} placeholder="Ej.: Regla general 40 %" />
                </Campo>
              </div>
              <Campo id="markup" etiqueta="Markup (%)" ayuda="Sobre el coste">
                <Input id="markup" inputMode="decimal" value={String(edicion.markupPct)} onChange={(e) => setEdicion({ ...edicion, markupPct: aNumero(e.target.value) })} />
              </Campo>
              <Campo id="fee" etiqueta="Fee fijo (€)">
                <Input id="fee" inputMode="decimal" value={String(edicion.fixedFee)} onChange={(e) => setEdicion({ ...edicion, fixedFee: aNumero(e.target.value) })} />
              </Campo>
              <Campo id="minprofit" etiqueta="Beneficio mínimo (€)">
                <Input id="minprofit" inputMode="decimal" value={String(edicion.minProfit)} onChange={(e) => setEdicion({ ...edicion, minProfit: aNumero(e.target.value) })} />
              </Campo>
              <Campo id="minprice" etiqueta="Precio mínimo (€)" ayuda="Vacío = sin mínimo">
                <Input id="minprice" inputMode="decimal" value={edicion.minPrice ?? ''} onChange={(e) => setEdicion({ ...edicion, minPrice: e.target.value === '' ? null : aNumero(e.target.value) })} />
              </Campo>
              <Campo id="maxprice" etiqueta="Precio máximo (€)" ayuda="Vacío = sin tope">
                <Input id="maxprice" inputMode="decimal" value={edicion.maxPrice ?? ''} onChange={(e) => setEdicion({ ...edicion, maxPrice: e.target.value === '' ? null : aNumero(e.target.value) })} />
              </Campo>
              <Campo id="redondeo" etiqueta="Terminar en" ayuda="Ej.: 0,99">
                <Input id="redondeo" inputMode="decimal" value={String(edicion.roundTo)} onChange={(e) => setEdicion({ ...edicion, roundTo: aNumero(e.target.value, 0.99) })} />
              </Campo>
              <Campo id="categoria" etiqueta="Solo para la categoría" ayuda="Vacío = todas">
                <Input id="categoria" value={edicion.applyToCategory ?? ''} onChange={(e) => setEdicion({ ...edicion, applyToCategory: e.target.value || null })} />
              </Campo>
              <label className="flex items-center gap-2 text-[13px] sm:col-span-2">
                <input type="checkbox" className="size-4 accent-indigo-500" checked={edicion.includeShipping} onChange={(e) => setEdicion({ ...edicion, includeShipping: e.target.checked })} />
                Incluir el envío en el cálculo
              </label>
              <label className="flex items-center gap-2 text-[13px] sm:col-span-2">
                <input type="checkbox" className="size-4 accent-indigo-500" checked={edicion.isDefault} onChange={(e) => setEdicion({ ...edicion, isDefault: e.target.checked })} />
                Regla predeterminada
              </label>
              <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
                <Button type="submit" variant="gradient" disabled={guardando}>
                  {guardando && <Loader2 className="size-4 animate-spin" />}
                  Guardar regla
                </Button>
                <Button type="button" variant="ghost" onClick={() => setEdicion(null)}>
                  Cancelar
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {(reglas ?? []).map((r) => (
          <Card key={r.id} className={r.isDefault ? 'border-indigo-500/25' : ''}>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                {r.name}
                {r.isDefault && <Badge variant="default">Predeterminada</Badge>}
              </CardTitle>
              <CardDescription>{r.applyToCategory ? `Categoría «${r.applyToCategory}»` : 'Todos los productos'}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-[12px]">
              <dl className="space-y-1.5">
                {[
                  ['Markup', `+${r.markupPct.toFixed(0)}%`],
                  ['Fee fijo', formatCurrency(r.fixedFee)],
                  ['Beneficio mínimo', formatCurrency(r.minProfit)],
                  ['Límites', `${r.minPrice !== null ? formatCurrency(r.minPrice) : '—'} / ${r.maxPrice !== null ? formatCurrency(r.maxPrice) : 'sin tope'}`],
                  ['Incluye envío', r.includeShipping ? 'Sí' : 'No'],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="font-medium tabular-nums">{v}</dd>
                  </div>
                ))}
              </dl>
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2">
                <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Vista previa (coste → venta)</p>
                <div className="grid grid-cols-3 gap-1 text-center tabular-nums">
                  {EJEMPLOS.map((c) => (
                    <div key={c}>
                      <span className="text-muted-foreground">{formatCurrency(c)}</span>
                      <span className="block font-semibold text-indigo-200">{formatCurrency(computeSellingPrice(c, 2, r as any, r.name).sellingPrice)}</span>
                    </div>
                  ))}
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground">Con 2 € de envío.</p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => abrirEditar(r)}>
                  <Pencil className="size-3.5" />
                  Editar
                </Button>
                <Button size="sm" variant="ghost" className="text-rose-400 hover:bg-rose-500/10" onClick={() => borrar(r)}>
                  <Trash2 className="size-3.5" />
                  Borrar
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </PantallaReal>
  );
}
