'use client';

/**
 * Importar por enlace (datos reales).
 *
 * El usuario pega la dirección de un producto de CJ o AliExpress; la función central `importar-enlace` lo trae al catálogo común
 * con su ficha completa (y el envío al país elegido) usando muy pocas llamadas al proveedor, una a una. Después se ve con
 * el precio de venta y el beneficio de su regla, y se abre la ficha completa para publicarlo.
 */
import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Download, Info, Loader2, Truck } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import type { CatalogRow } from '@/lib/catalog';
import { consultarItemCatalogo } from '@/lib/real/datos';
import { ErrorImportacion, importarPorEnlace, type ResultadoImportacion } from '@/lib/real/importar';
import { analizarEnlace } from '@/lib/importar/enlace';
import { nombrePais, PAISES_FRECUENTES } from '@/lib/paises';
import { CatalogCard } from '@/app/(dashboard)/catalog/catalog-card';
import { imageSrc } from '@/app/(dashboard)/catalog/image';
import { FichaProveedor } from './ficha-proveedor';
import { PantallaReal } from './comun';

const NOMBRE_PROVEEDOR = { CJ_DROPSHIPPING: 'CJ Dropshipping', ALIEXPRESS: 'AliExpress' } as const;

export function ImportarReal() {
  const [enlace, setEnlace] = useState('');
  const [destino, setDestino] = useState('ES');
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoImportacion | null>(null);
  const [tarjeta, setTarjeta] = useState<CatalogRow | null>(null);
  const [abierta, setAbierta] = useState<string | null>(null);

  useEffect(() => {
    try {
      const guardado = window.localStorage.getItem('hermes-destino');
      if (guardado) setDestino(guardado);
    } catch {
      /* sin almacenamiento: se queda España */
    }
  }, []);

  // Lectura instantánea del enlace (sin llamar a nadie): dice qué proveedor es o por qué no vale
  const lectura = useMemo(() => (enlace.trim() ? analizarEnlace(enlace) : null), [enlace]);
  const enlaceCortoOk = lectura && !lectura.ok && lectura.motivo === 'enlace_corto';
  const puedeImportar = Boolean(lectura && (lectura.ok || enlaceCortoOk)) && !trabajando;
  const proveedorLeido = lectura?.ok ? lectura.proveedor : null;

  async function importar() {
    if (!puedeImportar) return;
    setTrabajando(true);
    setError(null);
    setResultado(null);
    setTarjeta(null);
    try {
      const r = await importarPorEnlace(enlace.trim(), destino);
      setResultado(r);
      setTarjeta(await consultarItemCatalogo(r.itemId, destino));
    } catch (e) {
      setError(e instanceof ErrorImportacion || e instanceof Error ? e.message : 'No se pudo importar el producto.');
    } finally {
      setTrabajando(false);
    }
  }

  return (
    <PantallaReal titulo="Importar por enlace" subtitulo="Trae un producto de CJ o AliExpress pegando su dirección" tour="screen:import">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Download className="size-4 text-indigo-300" />
            Pega el enlace del producto
          </CardTitle>
          <CardDescription>
            Sirve la dirección de la página de un producto de CJ Dropshipping o de AliExpress. Verás su ficha completa, el precio de venta con tu regla y el envío al país que elijas.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void importar();
            }}
          >
            <Input
              value={enlace}
              onChange={(e) => setEnlace(e.target.value)}
              placeholder="https://www.aliexpress.com/item/1005…  ·  https://cjdropshipping.com/product/…-p-….html"
              aria-label="Enlace del producto"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              disabled={trabajando}
            />

            {lectura && (
              <p className={`flex items-start gap-1.5 text-[12px] ${lectura.ok || enlaceCortoOk ? 'text-emerald-300' : 'text-amber-300'}`} role="status">
                {lectura.ok || enlaceCortoOk ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" /> : <AlertCircle className="mt-0.5 size-3.5 shrink-0" />}
                <span>
                  {lectura.ok
                    ? `Producto de ${NOMBRE_PROVEEDOR[lectura.proveedor]} reconocido.`
                    : enlaceCortoOk
                      ? 'Enlace corto de AliExpress: lo abriré para encontrar el producto.'
                      : lectura.mensaje}
                </span>
              </p>
            )}

            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <label className="inline-flex items-center gap-2 text-[12px]">
                <Truck className="size-3.5 text-indigo-300" />
                <span className="text-muted-foreground">Enviar a</span>
                <select
                  className="h-8 rounded-md border border-white/10 bg-white/[0.04] px-2 text-[12px]"
                  value={destino}
                  disabled={trabajando}
                  onChange={(e) => {
                    setDestino(e.target.value);
                    try {
                      window.localStorage.setItem('hermes-destino', e.target.value);
                    } catch {
                      /* vale solo para esta visita */
                    }
                  }}
                  aria-label="País de destino del envío"
                >
                  {[...new Set(['ES', 'US', ...PAISES_FRECUENTES])].map((c) => (
                    <option key={c} value={c}>
                      {nombrePais(c)}
                    </option>
                  ))}
                </select>
              </label>
              <Button type="submit" disabled={!puedeImportar}>
                {trabajando ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
                {trabajando ? 'Importando…' : 'Importar'}
              </Button>
            </div>
          </form>

          {trabajando && (
            <Alert variant="info" title={`Leyendo el producto${proveedorLeido ? ` en ${NOMBRE_PROVEEDOR[proveedorLeido]}` : ''}…`}>
              Puede tardar hasta 20 segundos: se piden los datos con pocas llamadas, una a una, para no saturar al proveedor. No cierres esta pantalla.
            </Alert>
          )}
        </CardContent>
      </Card>

      {error && (
        <Alert variant="danger" title="No se pudo importar">
          <p>{error}</p>
        </Alert>
      )}

      {resultado && (
        <div className="space-y-3">
          <Alert variant="success" title={resultado.yaEstaba && resultado.llamadas === 0 ? 'Ya lo teníamos' : resultado.yaEstaba ? 'Ficha actualizada' : 'Producto importado'}>
            <p>
              {resultado.mensaje} {resultado.llamadas > 0 ? `Se usaron ${resultado.llamadas} ${resultado.llamadas === 1 ? 'llamada' : 'llamadas'} a ${NOMBRE_PROVEEDOR[resultado.proveedor]}.` : ''}
            </p>
            {resultado.avisos.length > 0 && (
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {resultado.avisos.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            )}
          </Alert>

          {tarjeta && (
            <div className="grid gap-3 sm:grid-cols-[minmax(0,240px)_1fr]">
              <CatalogCard
                item={{ ...tarjeta, imageUrl: imageSrc(tarjeta.imageUrl), images: (tarjeta.images ?? []).map(imageSrc) }}
                onOpen={(i) => setAbierta(i.id)}
                onImport={(i) => setAbierta(i.id)}
                etiquetaImportar="Publicar"
              />
              <div className="space-y-2 text-[13px] text-muted-foreground">
                <p className="flex items-start gap-1.5">
                  <Info className="mt-0.5 size-3.5 shrink-0 text-indigo-300" />
                  <span>El producto queda en el catálogo común, así que también lo encontrarás allí. El precio de venta y el beneficio salen de tu regla de precios y del tipo de cambio del día.</span>
                </p>
                <Button type="button" onClick={() => setAbierta(resultado.itemId)}>
                  Ver la ficha completa y publicar
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      <FichaProveedor itemId={abierta} onClose={() => setAbierta(null)} />
    </PantallaReal>
  );
}
