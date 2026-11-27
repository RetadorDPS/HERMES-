'use client';

/**
 * Buscar en proveedores (datos reales).
 *
 * Se busca como en la web del proveedor: escribes «teléfono», «funda iPhone 15» o «auriculares» y salen los productos
 * de CJ o de AliExpress en ese momento. Nada entra en el catálogo hasta que el usuario lo añade (uno o varios), y cada
 * producto añadido llega con su ficha completa por la misma vía de «Importar por enlace».
 * Control: cada búsqueda nueva gasta 1 del cupo del plan; repetir una búsqueda en 24 horas no gasta; «Ver más» es
 * una búsqueda más y se pide a mano (nunca se gastan búsquedas solas al desplazarse).
 */
import { useEffect, useMemo, useState } from 'react';
import { Check, CheckCircle2, Loader2, Plus, Search, Sparkles, Star, X } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { cn, formatNumber } from '@/lib/utils';
import { buscarEnProveedor, cupoBusqueda, type CupoBusqueda, type ProveedorBusqueda, type ResultadoBusqueda } from '@/lib/real/buscar';
import { importarPorEnlace } from '@/lib/real/importar';
import { Foto } from './foto';
import { FichaProveedor } from './ficha-proveedor';

const PROVEEDORES: { id: ProveedorBusqueda; nombre: string }[] = [
  { id: 'ALIEXPRESS', nombre: 'AliExpress' },
  { id: 'CJ_DROPSHIPPING', nombre: 'CJ Dropshipping' },
];

/** Búsquedas rápidas: lo que más se busca para vender. Se escriben como las escribiría una persona. */
const RAPIDAS = [
  'Teléfonos',
  'Fundas de móvil',
  'Auriculares inalámbricos',
  'Reloj inteligente',
  'Cargador rápido',
  'Altavoz bluetooth',
  'Maquillaje',
  'Cocina',
  'Juguetes',
  'Mascotas',
  'Zapatillas',
  'Herramientas',
];

/** Máximo de productos que se añaden de una vez (cada uno trae su ficha completa del proveedor, en serie). */
const MAX_POR_TANDA = 10;

type EstadoAnadir = { estado: 'esperando' | 'trabajando' | 'ok' | 'error'; mensaje?: string; itemId?: string };

export function BuscarProveedores({ alAnadir }: { alAnadir?: () => void }) {
  const [proveedor, setProveedor] = useState<ProveedorBusqueda>('ALIEXPRESS');
  const [texto, setTexto] = useState('');
  const [buscado, setBuscado] = useState<{ proveedor: ProveedorBusqueda; palabra: string; enviado: string } | null>(null);
  const [resultados, setResultados] = useState<ResultadoBusqueda[]>([]);
  const [pagina, setPagina] = useState(1);
  const [hayMas, setHayMas] = useState(false);
  const [total, setTotal] = useState<number | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cupo, setCupo] = useState<CupoBusqueda | null>(null);
  const [elegidos, setElegidos] = useState<Set<string>>(new Set());
  const [anadiendo, setAnadiendo] = useState(false);
  const [progreso, setProgreso] = useState<Record<string, EstadoAnadir>>({});
  const [abierta, setAbierta] = useState<string | null>(null);

  useEffect(() => {
    cupoBusqueda().then(setCupo).catch(() => setCupo(null));
  }, []);

  async function buscar(palabra: string, prov: ProveedorBusqueda = proveedor, pag = 1) {
    const limpia = palabra.trim();
    if (limpia.length < 2 || buscando) return;
    setBuscando(true);
    setError(null);
    if (pag === 1) {
      setResultados([]);
      setElegidos(new Set());
      setProgreso({});
    }
    try {
      const r = await buscarEnProveedor(prov, limpia, pag);
      setBuscado({ proveedor: prov, palabra: limpia, enviado: r.buscado });
      setResultados((prev) => {
        const vistos = new Set(prev.map((x) => x.externalId));
        return pag === 1 ? r.resultados : [...prev, ...r.resultados.filter((x) => !vistos.has(x.externalId))];
      });
      setPagina(r.pagina);
      setHayMas(r.hayMas);
      setTotal(r.total);
      if (r.gastado > 0) cupoBusqueda().then(setCupo).catch(() => undefined);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBuscando(false);
    }
  }

  function alternar(r: ResultadoBusqueda) {
    if (r.itemId || progreso[r.externalId]?.itemId) {
      setAbierta(r.itemId ?? progreso[r.externalId]?.itemId ?? null);
      return;
    }
    setElegidos((prev) => {
      const s = new Set(prev);
      if (s.has(r.externalId)) s.delete(r.externalId);
      else if (s.size < MAX_POR_TANDA) s.add(r.externalId);
      return s;
    });
  }

  async function anadirElegidos() {
    const lista = resultados.filter((r) => elegidos.has(r.externalId));
    if (!lista.length || anadiendo) return;
    setAnadiendo(true);
    setProgreso((p) => ({ ...p, ...Object.fromEntries(lista.map((r) => [r.externalId, { estado: 'esperando' as const }])) }));
    let bien = 0;
    // De uno en uno: el proveedor corta si se le llama a la vez
    for (const r of lista) {
      setProgreso((p) => ({ ...p, [r.externalId]: { estado: 'trabajando' } }));
      try {
        const hecho = await importarPorEnlace(r.url, '');
        bien += 1;
        setProgreso((p) => ({ ...p, [r.externalId]: { estado: 'ok', itemId: hecho.itemId } }));
        setResultados((prev) => prev.map((x) => (x.externalId === r.externalId ? { ...x, itemId: hecho.itemId } : x)));
      } catch (e) {
        setProgreso((p) => ({ ...p, [r.externalId]: { estado: 'error', mensaje: (e as Error).message } }));
        // Si es el límite del día, no tiene sentido seguir con los demás
        if (/máximo|límite|mañana/i.test((e as Error).message)) break;
      }
    }
    setElegidos(new Set());
    setAnadiendo(false);
    if (bien > 0) alAnadir?.();
  }

  const errores = useMemo(() => Object.entries(progreso).filter(([, v]) => v.estado === 'error'), [progreso]);
  const anadidos = useMemo(() => Object.values(progreso).filter((v) => v.estado === 'ok').length, [progreso]);
  const nombreProv = (p: ProveedorBusqueda) => PROVEEDORES.find((x) => x.id === p)?.nombre ?? p;
  const etiquetaPopularidad = (p: ProveedorBusqueda, n: number) => (p === 'ALIEXPRESS' ? `${formatNumber(n)} vendidos` : `${formatNumber(n)} tiendas`);

  return (
    <div className="space-y-3">
      <div className="space-y-2.5 rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
        <div className="flex gap-1 rounded-lg bg-white/[0.04] p-1" role="radiogroup" aria-label="Proveedor">
          {PROVEEDORES.map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={proveedor === p.id}
              onClick={() => {
                setProveedor(p.id);
                if (buscado && buscado.proveedor !== p.id) void buscar(buscado.palabra, p.id, 1);
              }}
              className={cn('flex-1 rounded-md px-2 py-1.5 text-[12px] font-medium transition', proveedor === p.id ? 'bg-indigo-500/80 text-white' : 'text-muted-foreground hover:text-foreground')}
            >
              {p.nombre}
            </button>
          ))}
        </div>

        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void buscar(texto);
          }}
        >
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Busca como en el proveedor: teléfono, funda iPhone 15…"
              aria-label="Qué quieres buscar"
              enterKeyHint="search"
              className="h-10 w-full rounded-lg border border-white/10 bg-white/[0.04] pl-8 pr-8 text-[13px] outline-none focus:border-indigo-400/60"
            />
            {texto && (
              <button type="button" aria-label="Borrar" onClick={() => setTexto('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground">
                <X className="size-4" />
              </button>
            )}
          </div>
          <Button type="submit" disabled={buscando || texto.trim().length < 2} className="h-10 shrink-0">
            {buscando ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
            Buscar
          </Button>
        </form>

        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
          {RAPIDAS.map((r) => (
            <button
              key={r}
              type="button"
              disabled={buscando}
              onClick={() => {
                setTexto(r);
                void buscar(r);
              }}
              className="shrink-0 rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] text-muted-foreground hover:border-indigo-400/50 hover:text-foreground"
            >
              {r}
            </button>
          ))}
        </div>

        <p className="text-[11px] leading-snug text-muted-foreground">
          {cupo?.ilimitado
            ? 'Búsquedas sin límite en tu cuenta.'
            : cupo && cupo.restanteMes !== null
              ? `Cada búsqueda nueva gasta 1 de tu plan: te quedan ${cupo.restanteMes} este mes (${cupo.restanteDia ?? 0} hoy). Repetir una búsqueda en 24 horas no gasta.`
              : 'Cada búsqueda nueva gasta 1 de tu plan. Repetir una búsqueda en 24 horas no gasta.'}
        </p>
      </div>

      {error && (
        <Alert variant="danger" title="No se pudo buscar">
          {error}
        </Alert>
      )}

      {buscado && !buscando && (
        <p className="text-[12px] text-muted-foreground">
          {resultados.length ? (
            <>
              {total !== null ? `${formatNumber(total)} resultados` : `${resultados.length} resultados`} en {nombreProv(buscado.proveedor)} para «{buscado.palabra}»
              {buscado.proveedor === 'CJ_DROPSHIPPING' && buscado.enviado.toLowerCase() !== buscado.palabra.toLowerCase() ? ` (CJ busca en inglés: «${buscado.enviado}»)` : ''}. Toca los que quieras y pulsa «Añadir».
            </>
          ) : (
            <>No hay resultados en {nombreProv(buscado.proveedor)} para «{buscado.palabra}». Prueba con otra palabra o con el otro proveedor.</>
          )}
        </p>
      )}

      {resultados.length > 0 && (
        <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 sm:gap-2 lg:grid-cols-5 xl:grid-cols-6">
          {resultados.map((r) => {
            const estado = progreso[r.externalId];
            const enCatalogo = Boolean(r.itemId);
            const elegido = elegidos.has(r.externalId);
            return (
              <button
                key={r.externalId}
                type="button"
                onClick={() => alternar(r)}
                className={cn(
                  'group relative flex min-w-0 flex-col overflow-hidden rounded-lg border bg-white/[0.02] text-left transition',
                  elegido ? 'border-indigo-400 ring-1 ring-indigo-400' : 'border-white/[0.07] hover:border-white/20',
                )}
              >
                <div className="relative aspect-square w-full bg-white/[0.03]">
                  <Foto src={r.imagen} alt={r.titulo} className="size-full object-cover" ancho={240} perezosa />
                  {enCatalogo ? (
                    <span className="absolute left-1 top-1 inline-flex items-center gap-0.5 rounded bg-emerald-500/90 px-1 py-px text-[9px] font-semibold text-white">
                      <Check className="size-2.5" /> En catálogo
                    </span>
                  ) : (
                    <span className={cn('absolute left-1 top-1 grid size-4 place-items-center rounded border text-white', elegido ? 'border-indigo-300 bg-indigo-500' : 'border-white/60 bg-black/30')}>
                      {elegido && <Check className="size-3" />}
                    </span>
                  )}
                  {estado?.estado === 'trabajando' || estado?.estado === 'esperando' ? (
                    <span className="absolute inset-0 grid place-items-center bg-black/50">
                      <Loader2 className={cn('size-5 text-white', estado.estado === 'trabajando' && 'animate-spin')} />
                    </span>
                  ) : null}
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5 p-1.5">
                  <p className="line-clamp-2 text-[10.5px] leading-tight text-foreground/90">{r.titulo}</p>
                  <p className="mt-auto text-[11.5px] font-semibold tabular-nums">{r.precioUsd !== null ? `${r.precioUsd.toFixed(2)} USD` : 'Precio en la ficha'}</p>
                  <p className="flex flex-wrap items-center gap-x-1 text-[9.5px] leading-tight text-muted-foreground">
                    {r.popularidad !== null && r.popularidad > 0 && <span>{etiquetaPopularidad(buscado?.proveedor ?? proveedor, r.popularidad)}</span>}
                    {r.valoracion ? (
                      <span className="inline-flex items-center gap-0.5">
                        <Star className="size-2.5 fill-amber-300 text-amber-300" />
                        {r.valoracion.toLocaleString('es-ES')}
                      </span>
                    ) : null}
                  </p>
                  {estado?.estado === 'error' && <p className="text-[9.5px] leading-tight text-red-300">No se pudo añadir</p>}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {hayMas && resultados.length > 0 && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" disabled={buscando} onClick={() => buscado && void buscar(buscado.palabra, buscado.proveedor, pagina + 1)}>
            {buscando ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Ver más resultados (1 búsqueda)
          </Button>
        </div>
      )}

      {anadidos > 0 && !anadiendo && (
        <Alert variant="success" title={`${anadidos} ${anadidos === 1 ? 'producto añadido' : 'productos añadidos'} a tu catálogo`}>
          Ya los tienes en «Mi catálogo», los primeros de la lista y con su ficha completa. Toca uno con la marca «En catálogo» para ver la ficha y publicarlo.
        </Alert>
      )}
      {errores.length > 0 && !anadiendo && (
        <Alert variant="warning" title={`${errores.length} no se ${errores.length === 1 ? 'pudo' : 'pudieron'} añadir`}>
          {errores[0][1].mensaje}
        </Alert>
      )}

      {(elegidos.size > 0 || anadiendo) && (
        <div className="sticky bottom-3 z-20 flex items-center justify-between gap-2 rounded-xl border border-indigo-400/40 bg-[#14162a]/95 p-2.5 shadow-lg backdrop-blur">
          <p className="min-w-0 text-[12px]">
            {anadiendo ? 'Añadiendo con su ficha completa, uno a uno…' : `${elegidos.size} ${elegidos.size === 1 ? 'elegido' : 'elegidos'}${elegidos.size >= MAX_POR_TANDA ? ` (máximo ${MAX_POR_TANDA} cada vez)` : ''}`}
          </p>
          <div className="flex shrink-0 gap-1.5">
            {!anadiendo && (
              <Button variant="outline" size="sm" onClick={() => setElegidos(new Set())}>
                Quitar
              </Button>
            )}
            <Button size="sm" disabled={anadiendo} onClick={() => void anadirElegidos()}>
              {anadiendo ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
              Añadir al catálogo
            </Button>
          </div>
        </div>
      )}

      {!buscado && !buscando && (
        <div className="flex items-start gap-2 rounded-xl border border-dashed border-white/10 p-3 text-[12px] text-muted-foreground">
          <Sparkles className="mt-0.5 size-4 shrink-0 text-indigo-300" />
          <p>
            Escribe lo que quieres vender o toca una búsqueda rápida. Verás los productos del proveedor al momento; los que añadas pasan a tu catálogo con su ficha completa (variantes, stock, peso y opiniones) y desde allí los publicas.
          </p>
        </div>
      )}

      <FichaProveedor itemId={abierta} onClose={() => setAbierta(null)} />
    </div>
  );
}
