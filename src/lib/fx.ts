/**
 * src/lib/fx.ts — Cambio de divisa para el motor de precios.
 *
 * El problema que resuelve: AliExpress responde en EUR, pero CJ y muchas tiendas
 * devuelven el precio en USD (o GBP, o CNY). Si se calcula el precio de venta
 * sumando euros y dólares sin convertir, el margen que se muestra es falso:
 *   · tratando 69 $ como 69 €, el precio de venta sale más alto de lo necesario
 *     (peor contra la competencia) y el beneficio mostrado no cuadra con la caja.
 *
 * Aquí NO se adivina: las tasas se leen de `FX_RATES` (JSON en el entorno) y,
 * si no está definida, se usan unas por defecto conservadoras. La conversión se
 * hace SIEMPRE en el momento de calcular precios (importación, catálogo y ficha)
 * y el tipo aplicado se muestra al usuario y se guarda en el historial.
 *
 *   FX_RATES='{"USD":0.92,"GBP":1.17,"CNY":0.128,"MXN":0.048}'
 *
 * Ajusta esas tasas cuando quieras (o pon `FX_ENABLED=false` para desactivar la
 * conversión y trabajar con la divisa tal cual, como antes).
 */
import fs from 'node:fs';
import path from 'node:path';

export const BASE_CURRENCY = 'EUR';

/** Divisa del BCE + las que suele cobrar un proveedor de dropshipping. */
export const SUPPORTED_CURRENCIES = ['USD', 'GBP', 'CNY', 'HKD', 'MXN', 'BRL', 'PLN', 'TRY', 'INR', 'JPY', 'KRW', 'CAD', 'AUD', 'CHF', 'SEK'] as const;

/** Dónde se guarda la última descarga del BCE (sobrevive a reinicios). */
const CACHE_FILE = path.join(process.cwd(), 'data', 'fx-rates.json');

/** Fuente gratuita y sin clave: tipos de referencia del Banco Central Europeo. */
const FEED_URL = () =>
  process.env.FX_FEED_URL ?? `https://api.frankfurter.app/latest?from=${BASE_CURRENCY}&to=${SUPPORTED_CURRENCIES.join(',')}`;

const refreshHours = () => Number(process.env.FX_REFRESH_HOURS ?? 12);
const autoEnabled = () => process.env.FX_AUTO !== 'false';

/** Tasas por defecto: cuántos euros vale 1 unidad de la divisa. Edítalas con tu banco. */
const DEFAULT_RATES: Record<string, number> = {
  EUR: 1,
  USD: 0.92,
  GBP: 1.17,
  CNY: 0.128,
  HKD: 0.118,
  MXN: 0.048,
  BRL: 0.17,
  PLN: 0.23,
  TRY: 0.027,
  INR: 0.011,
};

export interface FxCache {
  base: string;
  /** Cuándo se descargaron (ISO). */
  fetchedAt: string;
  source: 'ecb' | 'manual';
  /** euros por 1 unidad de cada divisa */
  rates: Record<string, number>;
}

let cache: FxCache | null = null;
let cacheLoaded = false;

/** Lee la última descarga del disco (una sola vez; luego se usa la memoria). */
function loadCache(): FxCache | null {
  if (cacheLoaded) return cache;
  cacheLoaded = true;
  try {
    const raw = fs.readFileSync(CACHE_FILE, 'utf8');
    const parsed = JSON.parse(raw) as FxCache;
    if (parsed?.rates && typeof parsed.rates === 'object') cache = parsed;
  } catch {
    cache = null; // aún no se ha descargado nunca: normal en la primera ejecución
  }
  return cache;
}

/**
 * Tasas efectivas, por orden de prioridad:
 *   1. `FX_RATES` del entorno — configuración explícita del operador: manda siempre.
 *   2. La última descarga automática del BCE (`data/fx-rates.json`).
 *   3. Tasas por defecto del código (conservadoras, para que nada reviente).
 */
function rates(): Record<string, number> {
  const raw = process.env.FX_RATES;
  if (raw) {
    try {
      return { ...DEFAULT_RATES, ...JSON.parse(raw) };
    } catch {
      console.warn('[fx] FX_RATES no es JSON válido: se usan las tasas automáticas o las por defecto');
    }
  }
  const cached = loadCache();
  if (cached) return { ...DEFAULT_RATES, ...cached.rates };
  return DEFAULT_RATES;
}

/** De dónde salen las tasas que se están usando ahora mismo. */
export type FxSource = 'manual' | 'ecb' | 'default';

export interface FxStatus {
  source: FxSource;
  fetchedAt: string | null;
  /** horas desde la última descarga (null si nunca se descargó) */
  ageHours: number | null;
  stale: boolean;
  auto: boolean;
  refreshHours: number;
  rates: Record<string, number>;
  feed: string;
}

export function fxStatus(): FxStatus {
  const cached = loadCache();
  const manual = Boolean(process.env.FX_RATES);
  const ageMs = cached ? Date.now() - new Date(cached.fetchedAt).getTime() : null;
  const ageHours = ageMs === null ? null : Math.round((ageMs / 3_600_000) * 10) / 10;
  return {
    source: manual ? 'manual' : cached ? cached.source === 'ecb' ? 'ecb' : 'manual' : 'default',
    fetchedAt: cached?.fetchedAt ?? null,
    ageHours,
    stale: !manual && (ageHours === null || ageHours > refreshHours()),
    auto: autoEnabled(),
    refreshHours: refreshHours(),
    rates: rates(),
    feed: FEED_URL(),
  };
}

/**
 * Descarga las tasas del BCE y las deja en disco. Es la única llamada de red de
 * este módulo y **nunca lanza**: si no hay internet o el feed cambia, se siguen
 * usando las tasas anteriores (o las por defecto) y se informa en el resultado.
 */
export async function refreshFxRates(options: { force?: boolean } = {}): Promise<{ ok: boolean; skipped?: boolean; reason?: string; status: FxStatus }> {
  if (!autoEnabled() && !options.force) {
    return { ok: false, skipped: true, reason: 'FX_AUTO=false (tasas fijadas a mano)', status: fxStatus() };
  }
  if (process.env.FX_RATES && !options.force) {
    return { ok: false, skipped: true, reason: 'FX_RATES definido: manda la configuración manual', status: fxStatus() };
  }

  const before = fxStatus();
  if (!options.force && before.source === 'ecb' && !before.stale) {
    return { ok: true, skipped: true, reason: `las tasas tienen ${before.ageHours} h (se refrescan cada ${before.refreshHours} h)`, status: before };
  }

  try {
    const res = await fetch(FEED_URL(), { signal: AbortSignal.timeout(8000), headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { base?: string; date?: string; rates?: Record<string, number> };
    const eurPer: Record<string, number> = { EUR: 1 };
    for (const [code, perEur] of Object.entries(body.rates ?? {})) {
      // El BCE publica «cuántas unidades de X vale 1 EUR»; aquí se guarda lo inverso.
      if (typeof perEur === 'number' && perEur > 0) eurPer[code.toUpperCase()] = Math.round((1 / perEur) * 1e6) / 1e6;
    }
    if (Object.keys(eurPer).length <= 1) throw new Error('el feed no ha devuelto tasas');

    const next: FxCache = { base: body.base ?? BASE_CURRENCY, fetchedAt: new Date().toISOString(), source: 'ecb', rates: eurPer };
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(next, null, 2));
    cache = next;
    cacheLoaded = true;
    console.log(`[fx] tasas del BCE actualizadas (${Object.keys(eurPer).length - 1} divisas) · referencia ${body.date ?? 'sin fecha'}`);
    return { ok: true, status: fxStatus() };
  } catch (err) {
    const reason = (err as Error).message;
    console.warn(`[fx] no se han podido descargar las tasas (${reason}): se mantienen ${before.source === 'ecb' ? 'las últimas conocidas' : 'las de reserva'}`);
    return { ok: false, reason, status: fxStatus() };
  }
}

export const fxEnabled = () => process.env.FX_ENABLED !== 'false';

export interface FxInfo {
  currency: string;
  rate: number;
  /** true si se aplicó conversión (divisa distinta de la base y activada) */
  converted: boolean;
  /** true si la divisa no está en la tabla: se usa 1:1 y se avisa */
  unknown?: boolean;
}

export function fxInfo(currency: string | null | undefined): FxInfo {
  const code = String(currency ?? BASE_CURRENCY).toUpperCase();
  if (code === BASE_CURRENCY || !fxEnabled()) return { currency: code, rate: 1, converted: false };
  const rate = rates()[code];
  if (!rate) {
    console.warn(`[fx] Divisa ${code} sin tasa configurada: se usa 1:1 (revisa FX_RATES)`);
    return { currency: code, rate: 1, converted: false, unknown: true };
  }
  return { currency: code, rate, converted: true };
}

const round = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** Convierte un importe a euros con la tasa configurada. */
export function toEur(amount: number, currency: string | null | undefined): number {
  const { rate } = fxInfo(currency);
  return round(Number(amount ?? 0) * rate);
}

/** Convierte varios importes (por ejemplo el coste y el envío de una variante). */
export function convertCosts(
  values: { cost: number; shipping?: number },
  currency: string | null | undefined,
): { cost: number; shipping: number; fx: FxInfo } {
  const info = fxInfo(currency);
  return { cost: toEur(values.cost, currency), shipping: toEur(values.shipping ?? 0, currency), fx: info };
}

/** Línea legible para el historial de sync y para la interfaz. */
export function fxLine(info: FxInfo, original: number): string {
  if (!info.converted) return info.unknown ? `Divisa ${info.currency} sin tasa configurada (1:1)` : '';
  return `${original} ${info.currency} → ${toEur(original, info.currency)} € (tipo ${info.rate})`;
}
