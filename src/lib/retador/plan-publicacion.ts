/**
 * Preparación común para publicar en Retador: qué variantes se pueden elegir, el precio propuesto de cada una y la
 * descripción de partida. La usan la pantalla de publicar un producto y la de publicar varios a la vez, así que las dos
 * hacen exactamente las mismas cuentas (y el servidor vuelve a comprobarlo todo al publicar).
 */
import type { PricingRuleLike } from '@/lib/types';
import type { CategoriaRetador } from '@/lib/real/retador';
import { liquidacion, motivoPesoDudoso, precioMinimoSinPerdida, precioPropuesto, type CostePuestoEnCuba, type TarifasRetador } from './precios';
import { sugerirCategoria, type SugerenciaCategoria } from './sugerir-categoria';

export interface VarianteServidor {
  sku: string;
  nombre: string;
  imagen: string | null;
  costeUsd: number | null;
  pesoGramos: number | null;
  stock: number | null;
  stockAlmacen?: number | null;
  stockFabrica?: number | null;
  coste: CostePuestoEnCuba | null;
  faltan: string[];
  /** Envío estimado por país (USD) con las cotizaciones reales del proveedor (Cuba incluida si se pudo calcular). */
  enviosPais?: Record<string, number>;
}

export interface Preparacion {
  tarifas: TarifasRetador | null;
  categorias: CategoriaRetador[];
  provincias: string[];
  proveedor: 'cj' | 'aliexpress';
  envioHub: { precio: number; origen: string; dias: [number, number] | null } | null;
  contenido: { titulo: string; descripcion: string; imagenes: string[] };
  variantes: VarianteServidor[];
  yaPublicado: { productId: string; estado: string } | null;
  costeReferencia?: { pais: string | null; proveedor: 'cj' | 'aliexpress' };
  /** Máximo de variantes por producto que admite Retador (lo informa su configuración; si no lo dice, 12). */
  maxVariantes?: number;
  /** Lo que Retador anuncia que admite (envío incluido, finanzas…). */
  capacidades?: Record<string, boolean>;
}

/** Límite de variantes por producto mientras Retador no informe otro. */
export const MAX_VARIANTES_POR_DEFECTO = 12;

/** Códigos de variante que Retador acepta (9/11/2026): con espacios normales, sin comillas, < >, saltos de línea ni caracteres de control, hasta 100 caracteres. */
export const SKU_ADMITIDO_POR_RETADOR = /^[^<>"'\u0000-\u001f\u007f]{1,100}$/;
export const MOTIVO_SKU = 'un código de variante que Retador admita (lleva comillas, signos de mayor o menor, o más de 100 caracteres)';
/** El proveedor no dio ningún código para la variante (ni identificador): Retador exige uno */
export const MOTIVO_SIN_SKU = 'el código de la variante (el proveedor no lo informa)';

/** Bloquea las variantes que Retador va a rechazar (código) o con un peso de relleno del proveedor. */
export function revisarVariantes(variantes: VarianteServidor[]): VarianteServidor[] {
  return variantes.map((v) => {
    if (!v.sku.trim()) return { ...v, coste: null, faltan: [MOTIVO_SIN_SKU] };
    if (!SKU_ADMITIDO_POR_RETADOR.test(v.sku)) return { ...v, coste: null, faltan: [MOTIVO_SKU] };
    // Un peso de relleno del proveedor (p. ej. 100 g para un sofá de 525 USD) haría el envío ridículamente barato: no se publica sin un peso creíble
    const dudoso = motivoPesoDudoso(v.pesoGramos, v.costeUsd);
    return dudoso ? { ...v, coste: null, faltan: [`un peso creíble del proveedor (informa ${dudoso}); sin él el envío saldría mucho más barato de lo real`] } : v;
  });
}

export const maximoVariantes = (p: Pick<Preparacion, 'maxVariantes'>) => (p.maxVariantes && p.maxVariantes >= 1 ? p.maxVariantes : MAX_VARIANTES_POR_DEFECTO);

/**
 * Precio propuesto de cada variante publicable y las que salen marcadas de entrada (hasta el máximo de Retador).
 * El precio es solo el del producto (el comprador paga el envío aparte): la regla de margen se aplica al costo del producto y
 * nunca baja del mínimo de Retador.
 */
export function preciosIniciales(p: Preparacion, regla: PricingRuleLike): { precios: Record<string, string>; elegidas: Record<string, boolean> } {
  const precios: Record<string, string> = {};
  const elegidas: Record<string, boolean> = {};
  let contador = 0;
  const tope = maximoVariantes(p);
  for (const v of p.variantes) {
    if (!v.coste) continue;
    const propuesto = precioPropuesto({ ...v.coste, total: v.coste.producto }, regla);
    const minimoRetador = p.tarifas ? precioMinimoSinPerdida(v.coste.total, p.tarifas, v.coste.producto) : 0;
    precios[v.sku] = Math.max(propuesto, minimoRetador).toFixed(2);
    if (contador < tope && !p.yaPublicado) {
      elegidas[v.sku] = true;
      contador++;
    }
  }
  return { precios, elegidas };
}

/** Retador exige una descripción de texto de 1 a 5000 caracteres: si el proveedor no trae ninguna, se parte del título (dato real). */
export function descripcionInicial(contenido: Preparacion['contenido']): { texto: string; delTitulo: boolean } {
  const textoProveedor = (contenido.descripcion ?? '').trim();
  return { texto: (textoProveedor || contenido.titulo).slice(0, 5000), delTitulo: !textoProveedor };
}

/** Plan para publicar un producto sin pasar por su pantalla: todo propuesto con las mismas reglas, o el motivo por el que no se puede. */
export type PlanPublicacion =
  | {
      listo: true;
      variantes: Array<{ sku: string; precioVentaUsd: number; neto: number }>;
      sugerencia: SugerenciaCategoria | null;
      contenido: { titulo: string; descripcion: string; imagenes: string[] };
      descripcionDelTitulo: boolean;
      /** Variantes que se podrían publicar pero no caben (máximo de Retador). */
      sobrantes: number;
    }
  | { listo: false; motivo: string };

export function planPublicacion(p: Preparacion, regla: PricingRuleLike, categoriaProveedor: string | null): PlanPublicacion {
  if (p.yaPublicado) return { listo: false, motivo: p.yaPublicado.estado === 'PAUSED' ? 'Ya está en tu tienda (pausado).' : 'Ya está publicado en tu tienda.' };
  if (!p.tarifas) return { listo: false, motivo: 'Retador no ha enviado sus tarifas, así que no se puede calcular lo que ganas. Inténtalo más tarde.' };
  const revisadas = revisarVariantes(p.variantes);
  const prep = { ...p, variantes: revisadas };
  const { precios, elegidas } = preciosIniciales(prep, regla);
  const variantes = revisadas
    .filter((v) => elegidas[v.sku] && v.coste)
    .map((v) => {
      const precio = Number(precios[v.sku]);
      return { sku: v.sku, precioVentaUsd: precio, neto: liquidacion(precio, v.coste!.total, p.tarifas!, v.coste!.producto).neto };
    })
    .filter((v) => Number.isFinite(v.precioVentaUsd) && v.precioVentaUsd > 0 && v.neto >= 0);
  if (!variantes.length) {
    const motivo = revisadas.find((v) => v.faltan.length)?.faltan[0];
    return { listo: false, motivo: motivo ? `Ninguna variante se puede publicar: falta ${motivo}.` : 'Ninguna variante se puede publicar.' };
  }
  const descripcion = descripcionInicial(p.contenido);
  if (!p.contenido.imagenes.length) return { listo: false, motivo: 'No tiene ninguna foto que Retador acepte.' };
  if (!p.contenido.titulo.trim()) return { listo: false, motivo: 'No tiene título.' };
  const publicables = revisadas.filter((v) => v.coste).length;
  return {
    listo: true,
    variantes,
    sugerencia: sugerirCategoria(p.categorias, p.contenido.titulo, categoriaProveedor),
    contenido: { titulo: p.contenido.titulo.slice(0, 150), descripcion: descripcion.texto, imagenes: p.contenido.imagenes.slice(0, 9) },
    descripcionDelTitulo: descripcion.delTitulo,
    sobrantes: Math.max(0, publicables - variantes.length),
  };
}
