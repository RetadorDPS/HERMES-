/**
 * src/lib/real/retador.ts — Conexión con la tienda de Retador desde el navegador.
 *
 * Todo pasa por la función `retador-tienda` (con la sesión del usuario): la clave de Retador existe solo entre servidores (nadie la ve ni
 * la pega: la cuenta se une con «Vincular con Retador») y el coste del proveedor nunca se envía a Retador. Contrato: docs/contrato-retador.md.
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
  /** Retador admite recibir las opiniones reales del proveedor (con su origen). */
  resenasProveedor: boolean;
  /** El plan de Retador manda también aquí (plan conjunto): esta app no cobra a esta cuenta. */
  planConjunto: boolean;
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
    resenasProveedor: aj.capacidades?.resenas_proveedor === true,
    planConjunto: aj.planConjunto === true,
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
/** El coste del proveedor subió y el precio publicado ya no vale (mínimo de Retador o pérdida). Lo deja anotado la sincronización automática. */
export interface PrecioEnRiesgo {
  desde: string;
  /** true = el producto se pausó solo en Retador para que no se venda así */
  pausadoSolo: boolean;
  variantes: { sku: string; titulo: string; precioActual: number; minimoUsd: number; costeAntes: number; costeAhora: number; costeProductoAhora: number; pierde: boolean }[];
}

/** Precio automático: el precio sigue la regla de precios del vendedor cuando cambia el coste del proveedor (decisión del vendedor, por producto). */
export interface PrecioAutomatico {
  activo: boolean;
  ultimoCambio: Date | null;
  /** Quién lo apagó, si está apagado: «vendedor» (lo apagó él o puso un precio a mano). */
  apagadoPor: string | null;
}

export interface VistaPrecioAuto {
  regla: { markupPct: number; propia: boolean; nombre: string | null };
  variantes: { sku: string; titulo: string; precioActual: number; precioNuevo: number; minimo: number | null }[];
  cambian: number;
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
  precioEnRiesgo: PrecioEnRiesgo | null;
  precioAuto: PrecioAutomatico | null;
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
      precioAuto: ret.autoPrecio ? { activo: ret.autoPrecio.activo === true, ultimoCambio: ret.autoPrecio.ultimoCambio ? new Date(ret.autoPrecio.ultimoCambio) : null, apagadoPor: ret.autoPrecio.apagadoPor ?? null } : null,
      precioEnRiesgo: ret.precioEnRiesgo && Array.isArray(ret.precioEnRiesgo.variantes) && ret.precioEnRiesgo.variantes.length ? (ret.precioEnRiesgo as PrecioEnRiesgo) : null,
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


/* ───────────────────────────── Vincular con Retador (contrato 1.6) ───────────────────────────── */

export interface VinculoPendiente {
  id: string;
  /** Desde dónde empezó la persona: pulsó el botón en Retador o en esta app. */
  origen: 'retador' | 'dropshippilot';
  emailRetador: string | null;
  /** El correo de la cuenta de Retador es el mismo que el de esta cuenta. */
  emailCoincide: boolean;
}

/** ¿Está disponible «Vincular con Retador»? ¿Hay una vinculación esperando confirmación? */
export const vinculoInfo = () => llamarTienda<{ disponible: boolean; pendiente: VinculoPendiente | null }>({ accion: 'vinculo_info' });
/** Empieza la vinculación desde aquí: devuelve la dirección de Retador a la que hay que ir. */
export const iniciarVinculo = () => llamarTienda<{ url: string }>({ accion: 'vincular_iniciar' });
/** Vuelta de Retador (empezó aquí). */
export const canjearVinculo = (codigo: string, state: string) =>
  llamarTienda<{ vinculada: boolean; emailRetador: string | null; pendiente?: VinculoPendiente }>({ accion: 'vincular_canjear', codigo, state });
/** Entrada desde Retador (empezó allí): deja la vinculación pendiente de confirmar. */
export const entradaVinculo = (codigo: string) => llamarTienda<{ pendiente: VinculoPendiente }>({ accion: 'vincular_entrada', codigo });
export const confirmarVinculo = (id: string) => llamarTienda<{ vinculada: boolean; emailRetador: string | null }>({ accion: 'vincular_confirmar', id });
export const cancelarVinculo = (id: string) => llamarTienda<{ cancelada: boolean }>({ accion: 'vincular_cancelar', id });

const CLAVE_VOLVER = 'hermes-vincular-volver';
/** Recuerda a qué pantalla volver cuando termine la vinculación (solo rutas propias). */
export function recordarVolver(ruta: string) {
  try {
    if (ruta.startsWith('/') && !ruta.startsWith('//')) sessionStorage.setItem(CLAVE_VOLVER, ruta);
  } catch {
    /* sin almacenamiento: se vuelve a Tiendas */
  }
}
export function tomarVolver(): string {
  try {
    const r = sessionStorage.getItem(CLAVE_VOLVER);
    sessionStorage.removeItem(CLAVE_VOLVER);
    if (r && r.startsWith('/') && !r.startsWith('//')) return r;
  } catch {
    /* ignorar */
  }
  return '/stores';
}

/** Desvincula la cuenta: anula la clave en Retador y la olvida aquí (función `retador-desvincular`). Los productos ya publicados siguen en Retador. */
export async function desvincularCuenta(storeId: string): Promise<{ productosEnRetador: number; aviso: string | null }> {
  const { data, error } = await supabase().functions.invoke('retador-desvincular', { body: { storeId } });
  if (error) {
    let mensaje = 'No se pudo contactar con el servidor. Revisa tu conexión e inténtalo de nuevo.';
    try {
      const c = await (error as any).context?.json?.();
      if (c?.error) mensaje = c.error;
    } catch {
      /* mensaje general */
    }
    throw new ErrorTiendaRetador(mensaje, 'red');
  }
  if (!data?.ok) throw new ErrorTiendaRetador(data?.error ?? 'No se pudo desvincular.', data?.codigo ?? 'desconocido');
  return data;
}
