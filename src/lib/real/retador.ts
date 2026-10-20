/**
 * src/lib/real/retador.ts — Conexión con la tienda de Retador desde el navegador.
 *
 * Todo pasa por la función `retador-tienda` (con la sesión del usuario): el token de Retador nunca llega al
 * navegador después de pegarlo, y el coste del proveedor nunca se envía a Retador. Contrato: docs/contrato-retador.md.
 */
import { supabase } from '../supabase/cliente';
import type { TarifasRetador } from '../retador/precios';

export class ErrorTiendaRetador extends Error {
  constructor(mensaje: string, public codigo: string, public extra: Record<string, any> = {}) {
    super(mensaje);
  }
}

/** Llama a la función de tienda y devuelve su respuesta; si falla lanza el error real, en español. */
export async function llamarTienda<T = any>(cuerpo: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase().functions.invoke('retador-tienda', { body: cuerpo });
  if (error) {
    let mensaje = 'No se pudo contactar con el servidor. Revisa tu conexión e inténtalo de nuevo.';
    try {
      const cuerpoError = await (error as any).context?.json?.();
      if (cuerpoError?.error) mensaje = cuerpoError.error;
    } catch {
      /* sin JSON legible: se queda el mensaje general */
    }
    throw new ErrorTiendaRetador(mensaje, 'red');
  }
  if (!data?.ok) {
    const { ok: _ok, codigo, error: mensaje, ...extra } = data ?? {};
    throw new ErrorTiendaRetador(mensaje ?? 'Ocurrió un error inesperado.', codigo ?? 'desconocido', extra);
  }
  return data as T;
}

export interface CategoriaRetador {
  cat: string;
  nombre: string;
  subcategorias: string[];
}

export interface TiendaRetador {
  id: string;
  name: string;
  domain: string;
  status: 'PENDING' | 'CONNECTED' | 'ERROR' | 'DISCONNECTED';
  lastPingAt: Date | null;
  lastError: string | null;
  simulada: boolean;
  plan: string | null;
  productosUsados: number | null;
  topeProductos: number | null;
  tarifas: TarifasRetador | null;
  categorias: CategoriaRetador[];
  provincias: string[];
  token: { prefijo: string; caducaEn: Date | null } | null;
  publicados: number;
}

/** Convierte las tarifas que guarda la tienda (formato del contrato) al formato de las cuentas. */
export function tarifasDeAjustes(t: any): TarifasRetador | null {
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  if (!t || n(t.hub_usd_por_libra) === null || n(t.comision_pct_ganancia) === null || n(t.pasarela_pct) === null || n(t.pasarela_fija_usd) === null) return null;
  return {
    hubUsdPorLibra: t.hub_usd_por_libra,
    diasHubCuba: Array.isArray(t.dias_hub_cuba) && t.dias_hub_cuba.length === 2 ? [Number(t.dias_hub_cuba[0]), Number(t.dias_hub_cuba[1])] : [0, 0],
    comisionPctGanancia: t.comision_pct_ganancia,
    pasarelaPct: t.pasarela_pct,
    pasarelaFijaUsd: t.pasarela_fija_usd,
    pasarelaACargo: t.pasarela_a_cargo === 'comprador' ? 'comprador' : t.pasarela_a_cargo === 'retador' ? 'retador' : 'vendedor',
    comisionBase:
      t.comision_base === 'precio_venta_menos_costo_cuba'
        ? 'precio_venta_menos_costo_cuba'
        : t.comision_base === 'precio_venta_menos_costo_producto_menos_pasarela'
          ? 'precio_venta_menos_costo_producto_menos_pasarela'
          : 'precio_venta_menos_costo_producto',
    ...(n(t.ganancia_minima_retador_usd) !== null ? { gananciaMinimaRetadorUsd: t.ganancia_minima_retador_usd as number } : {}),
  };
}

/** La tienda de Retador del usuario (o null si todavía no la conectó). Solo lee columnas permitidas, nunca el token. */
export async function obtenerTiendaRetador(): Promise<TiendaRetador | null> {
  const r = await supabase()
    .from('Store')
    .select('id,name,domain,status,lastPingAt,lastError,settings,products:Product(count)')
    .eq('platform', 'RETADOR')
    .maybeSingle();
  if (r.error) throw new Error(r.error.message);
  const s: any = r.data;
  if (!s) return null;
  const aj = s.settings ?? {};
  const publicados = await supabase().from('Product').select('id', { count: 'exact', head: true }).eq('storeId', s.id).not('storeProductId', 'is', null);
  return {
    id: s.id,
    name: s.name,
    domain: s.domain,
    status: s.status,
    lastPingAt: s.lastPingAt ? new Date(s.lastPingAt) : null,
    lastError: s.lastError,
    simulada: Boolean(aj.simulada),
    plan: aj.plan ?? null,
    productosUsados: aj.productosUsados ?? null,
    topeProductos: aj.topeProductos ?? null,
    tarifas: tarifasDeAjustes(aj.tarifas),
    categorias: Array.isArray(aj.categorias) ? aj.categorias : [],
    provincias: Array.isArray(aj.provincias) ? aj.provincias : [],
    token: aj.token ? { prefijo: String(aj.token.prefijo ?? ''), caducaEn: aj.token.caduca_en ? new Date(aj.token.caduca_en) : null } : null,
    publicados: publicados.count ?? 0,
  };
}

export interface VarianteRetador {
  sku: string;
  title: string;
  sellingPrice: number;
  costPrice: number;
  shippingCost: number;
  stock: number;
  stockVerificado: boolean | null;
}
export interface ProductoRetador {
  id: string;
  title: string;
  status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'OUT_OF_STOCK' | 'ERROR' | 'ARCHIVED';
  url: string | null;
  foto: string | null;
  stockTotal: number;
  lastSyncedAt: Date | null;
  lastSyncStatus: string | null;
  lastSyncError: string | null;
  moderacion: string | null;
  vendidos: number | null;
  cambiadoEnRetador: boolean;
  variantes: VarianteRetador[];
}

/** Productos publicados por el usuario en su tienda de Retador (con sus variantes). */
export async function obtenerProductosRetador(storeId: string): Promise<ProductoRetador[]> {
  const r = await supabase()
    .from('Product')
    .select(
      'id,title,status,storeHandle,stockTotal,lastSyncedAt,lastSyncStatus,lastSyncError,rawPayload,images:ProductImage(url,position),variants:ProductVariant(sku,title,sellingPrice,costPrice,shippingCost,stock,stockVerificado,position)',
    )
    .eq('storeId', storeId)
    .not('storeProductId', 'is', null)
    .order('createdAt', { ascending: false });
  if (r.error) throw new Error(r.error.message);
  return ((r.data ?? []) as any[]).map((p) => {
    const portada = [...(p.images ?? [])].sort((a: any, b: any) => a.position - b.position)[0];
    const ret = p.rawPayload?.retador ?? {};
    return {
      id: p.id,
      title: p.title,
      status: p.status,
      url: p.storeHandle ?? null,
      foto: portada?.url ?? null,
      stockTotal: Number(p.stockTotal ?? 0),
      lastSyncedAt: p.lastSyncedAt ? new Date(p.lastSyncedAt) : null,
      lastSyncStatus: p.lastSyncStatus ?? null,
      lastSyncError: p.lastSyncError ?? null,
      moderacion: ret.moderacion ?? null,
      vendidos: typeof ret.vendidos === 'number' ? ret.vendidos : null,
      cambiadoEnRetador: ret.origenUltimoCambio === 'vendedor',
      variantes: [...(p.variants ?? [])]
        .sort((a: any, b: any) => a.position - b.position)
        .map((v: any) => ({
          sku: v.sku,
          title: v.title,
          sellingPrice: Number(v.sellingPrice),
          costPrice: Number(v.costPrice),
          shippingCost: Number(v.shippingCost),
          stock: Number(v.stock),
          stockVerificado: v.stockVerificado ?? null,
        })),
    };
  });
}
