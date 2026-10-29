import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const round2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** Redondeo psicológico: 24.99 en lugar de 25.12 */
export function roundPsychological(n: number, roundTo = 0.99) {
  const base = Math.floor(n);
  const decimals = roundTo - Math.floor(roundTo);
  const candidate = base + roundTo;
  if (candidate < n) return round2(base + 1 + decimals);
  return round2(candidate);
}

export function formatCurrency(value: number | string, currency = 'EUR', locale = 'es-ES') {
  // Los dólares se escriben «USD» (en español «US$» confunde): 3,91 USD
  if (currency === 'USD') return `${new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value))} USD`;
  return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(value));
}

export function formatNumber(value: number | string, locale = 'es-ES') {
  return new Intl.NumberFormat(locale).format(Number(value));
}

export function formatPct(value: number | string, decimals = 1) {
  return `${Number(value).toFixed(decimals)}%`;
}

/**
 * «Ahora» de la aplicación. En el servidor normal es la hora real. En la versión
 * estática se fija a la hora de construcción: así el HTML publicado y el
 * navegador cuentan lo mismo y los datos de ejemplo no envejecen entre visitas.
 */
export function ahoraApp(): number {
  if (process.env.NEXT_PUBLIC_ESTATICO === '1') return Number(process.env.NEXT_PUBLIC_HORA_BASE) || Date.now();
  return Date.now();
}

export function formatRelative(date: Date | string | null | undefined) {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  const diff = ahoraApp() - d.getTime();
  const abs = Math.abs(diff);
  // Fecha futura (p. ej. «próxima sincronización»): «en 5 min» en vez de «hace 5 min»
  const futuro = diff < 0;
  const dicho = (cantidad: string) => (futuro ? `en ${cantidad}` : `hace ${cantidad}`);
  const min = Math.round(abs / 60000);
  if (min < 1) return futuro ? 'en unos segundos' : 'hace unos segundos';
  if (min < 60) return dicho(`${min} min`);
  const hours = Math.round(min / 60);
  if (hours < 24) return dicho(`${hours} h`);
  const days = Math.round(hours / 24);
  if (days < 30) return dicho(`${days} d`);
  return d.toLocaleDateString('es-ES');
}

export function slugify(input: string) {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 70);
}

/** HTML seguro y limpio para descripción de producto */
export function sanitizeHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/ on\w+="[^"]*"/gi, '')
    .replace(/javascript:/gi, '')
    .trim();
}

export function truncate(s: string, n = 120) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/** Hash determinista y barato para detectar cambios del proveedor */
export function stableHash(input: string) {
  let h1 = 0xdeadbeef ^ input.length;
  let h2 = 0x41c6ce57 ^ input.length;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function statusColor(status: string) {
  const map: Record<string, string> = {
    SUCCESS: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
    ACTIVE: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
    CONNECTED: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
    DELIVERED: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
    FULFILLED: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
    RUNNING: 'text-sky-400 bg-sky-500/10 border-sky-500/30',
    QUEUED: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
    PENDING: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
    PAID: 'text-sky-400 bg-sky-500/10 border-sky-500/30',
    DRAFT: 'text-slate-300 bg-slate-500/10 border-slate-500/30',
    PAUSED: 'text-slate-300 bg-slate-500/10 border-slate-500/30',
    SKIPPED: 'text-slate-300 bg-slate-500/10 border-slate-500/30',
    UNFULFILLED: 'text-slate-300 bg-slate-500/10 border-slate-500/30',
    OUT_OF_STOCK: 'text-orange-400 bg-orange-500/10 border-orange-500/30',
    SUPPLIER_PURCHASED: 'text-violet-400 bg-violet-500/10 border-violet-500/30',
    SHIPPED: 'text-sky-400 bg-sky-500/10 border-sky-500/30',
    FAILED: 'text-rose-400 bg-rose-500/10 border-rose-500/30',
    ERROR: 'text-rose-400 bg-rose-500/10 border-rose-500/30',
    SUPPLIER_ERROR: 'text-rose-400 bg-rose-500/10 border-rose-500/30',
    CANCELED: 'text-rose-400 bg-rose-500/10 border-rose-500/30',
    DISCONNECTED: 'text-rose-400 bg-rose-500/10 border-rose-500/30',
    REFUNDED: 'text-rose-400 bg-rose-500/10 border-rose-500/30',
  };
  return map[status] ?? 'text-slate-300 bg-slate-500/10 border-slate-500/30';
}
