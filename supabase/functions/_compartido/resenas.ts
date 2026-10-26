/**
 * Opiniones del PROVEEDOR (CJ o AliExpress) de un producto, para mandarlas a Retador. Archivo SIN dependencias (se prueba en Node y corre en Deno).
 *
 * Reglas: solo datos reales de la ficha; nunca se inventa ni se retoca una opinión; no se escogen solo las buenas (se manda la media y el
 * total reales y una muestra de las más recientes tal cual vienen). Siempre se dice de dónde vienen: NO son compradores de Retador.
 * AliExpress solo informa la media y el total (no los textos), y así se manda, sin textos.
 */
export interface OpinionProveedor {
  puntuacion: number;
  texto: string;
  pais: string | null;
  fecha: string | null;
  autor: string | null;
}

export interface OpinionesProveedor {
  fuente: 'cj' | 'aliexpress';
  /** Media real que informa el proveedor (1 a 5), o null si no la informa. */
  media: number | null;
  /** Número real de opiniones que informa el proveedor, o null si no lo informa. */
  total: number | null;
  /** Muestra de las opiniones más recientes con texto, tal cual (en su idioma original). Vacía si el proveedor no da textos. */
  muestra: OpinionProveedor[];
}

const MAX_MUESTRA = 20;
const MAX_TEXTO = 500;
const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};
const texto = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

/** Opiniones del proveedor listas para Retador, o null si la ficha no trae ninguna cifra ni texto real. */
export function resenasParaRetador(ficha: any, proveedor: 'cj' | 'aliexpress'): OpinionesProveedor | null {
  const r = ficha?.resenas;
  if (!r || typeof r !== 'object') return null;
  const media = num(r.media);
  const total = num(r.total);
  const lista: any[] = Array.isArray(r.lista) ? r.lista : [];
  const muestra: OpinionProveedor[] = [];
  for (const o of lista) {
    const t = texto(o?.texto, MAX_TEXTO);
    const p = num(o?.puntuacion);
    if (!t || t.length < 3 || p === null || p < 1 || p > 5) continue;
    const fecha = texto(o?.fecha, 40);
    muestra.push({
      puntuacion: Math.round(p),
      texto: t,
      pais: texto(o?.pais, 2)?.toUpperCase() ?? null,
      fecha: fecha && !Number.isNaN(Date.parse(fecha)) ? new Date(fecha).toISOString() : null,
      autor: texto(o?.usuario, 30),
    });
  }
  // Las más recientes primero, sin filtrar por puntuación
  muestra.sort((a, b) => (b.fecha ?? '').localeCompare(a.fecha ?? ''));
  const validaMedia = media !== null && media >= 1 && media <= 5 ? Math.round(media * 10) / 10 : null;
  const validoTotal = total !== null && total >= 0 ? Math.round(total) : null;
  if (validaMedia === null && !(validoTotal && validoTotal > 0) && !muestra.length) return null;
  return { fuente: proveedor, media: validaMedia, total: validoTotal, muestra: muestra.slice(0, MAX_MUESTRA) };
}
