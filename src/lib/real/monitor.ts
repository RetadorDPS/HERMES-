/**
 * Monitor de precio y existencias (datos reales).
 *
 * Qué ve cada usuario: sus productos publicados, cuáles necesitan atención (el coste del proveedor ya no es el de cuando publicó,
 * o se agotó) y el registro de avisos que va dejando el barrido programado del servidor (`monitor-proveedor`).
 * El monitor SOLO avisa: nunca cambia un precio ni el estado de un producto.
 */
import { supabase } from '../supabase/cliente';
import { atencionDeProducto, type Atencion, type VarianteActual, type VarianteGuardada } from '../monitor/atencion';

export interface ProductoVigilado {
  id: string;
  titulo: string;
  estado: string;
  proveedor: string;
  /** Última vez que el servidor miró el proveedor para este producto */
  ultimaRevision: Date | null;
  /** Próxima revisión prevista (6 horas después de la anterior) */
  proximaRevision: Date | null;
  atencion: Atencion[];
}

export interface AvisoMonitor {
  id: string;
  productoId: string | null;
  productoTitulo: string | null;
  nivel: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';
  tipo: string;
  mensaje: string;
  fecha: Date;
}

export interface DatosMonitor {
  vigilados: ProductoVigilado[];
  avisos: AvisoMonitor[];
  ultimoRepaso: Date | null;
}

/** Las fechas llegan de Supabase sin zona horaria y siempre en UTC: sin esto el navegador las leería como hora local y saldrían desplazadas. */
export function fechaUtc(v: unknown): Date | null {
  if (!v) return null;
  const t = String(v);
  const d = new Date(/(Z|[+-]\d{2}:?\d{2})$/.test(t) ? t : `${t}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

const NOMBRE_PROVEEDOR: Record<string, string> = { CJ_DROPSHIPPING: 'CJ Dropshipping', ALIEXPRESS: 'AliExpress' };
const num = (v: unknown) => (v === null || v === undefined || v === '' ? 0 : Number(v));

export async function obtenerMonitor(): Promise<DatosMonitor> {
  const c = supabase();
  const [prod, prov, logs] = await Promise.all([
    c
      .from('Product')
      .select('id,title,status,supplierId,supplierProductId,lastSyncedAt,variants:ProductVariant(id,supplierVariantId,sku,title,costPrice,sellingPrice,shippingCost)')
      .eq('isMonitored', true)
      .order('updatedAt', { ascending: false })
      .limit(500),
    c.from('Supplier').select('id,type'),
    c.from('SyncLog').select('id,productId,type,level,message,createdAt').in('type', ['PRICE_UPDATE', 'STOCK_UPDATE', 'FULL_REFRESH']).order('createdAt', { ascending: false }).limit(80),
  ]);
  if (prod.error) throw new Error(prod.error.message);
  if (prov.error) throw new Error(prov.error.message);
  if (logs.error) throw new Error(logs.error.message);

  const tipoDe = new Map<string, string>((prov.data ?? []).map((p: any) => [String(p.id), String(p.type)]));
  const productos = (prod.data ?? []) as any[];

  // Ficha actual del proveedor de cada producto vigilado (precio y existencias por variante)
  const externos = [...new Set(productos.map((p) => String(p.supplierProductId ?? '')).filter(Boolean))];
  const items = externos.length ? await c.from('CatalogItem').select('id,provider,externalId,lastSyncedAt,refreshDueAt').in('externalId', externos) : { data: [], error: null };
  if (items.error) throw new Error(items.error.message);
  const ids = (items.data ?? []).map((i: any) => i.id);
  const fichas = ids.length ? await c.from('CatalogItemDetail').select('itemId,ficha').in('itemId', ids) : { data: [], error: null };
  if (fichas.error) throw new Error(fichas.error.message);
  const fichaDe = new Map<string, any>((fichas.data ?? []).map((f: any) => [f.itemId, f.ficha]));
  const itemDe = new Map<string, any>((items.data ?? []).map((i: any) => [`${i.provider}|${i.externalId}`, i]));

  let ultimoRepaso: Date | null = null;
  const vigilados: ProductoVigilado[] = productos.map((p) => {
    const provider = tipoDe.get(String(p.supplierId)) ?? '';
    const item = itemDe.get(`${provider}|${p.supplierProductId}`);
    const ficha = item ? fichaDe.get(item.id) : null;
    const actuales: VarianteActual[] | null = Array.isArray(ficha?.variantes)
      ? ficha.variantes.map((v: any) => ({ vid: v.vid ?? null, sku: v.sku ?? null, precio: typeof v.precio === 'number' ? v.precio : null, stock: v.stock ?? [] }))
      : null;
    const guardadas: VarianteGuardada[] = (p.variants ?? []).map((v: any) => ({
      id: v.id, supplierVariantId: v.supplierVariantId ?? null, sku: v.sku ?? null, title: v.title ?? '', costPrice: num(v.costPrice), sellingPrice: num(v.sellingPrice), shippingCost: num(v.shippingCost),
    }));
    const revisado = fechaUtc(item?.lastSyncedAt);
    if (revisado && (!ultimoRepaso || revisado > ultimoRepaso)) ultimoRepaso = revisado;
    return {
      id: p.id,
      titulo: p.title,
      estado: p.status,
      proveedor: NOMBRE_PROVEEDOR[provider] ?? provider,
      ultimaRevision: revisado,
      proximaRevision: fechaUtc(item?.refreshDueAt),
      atencion: atencionDeProducto(guardadas, actuales),
    };
  });

  const tituloDe = new Map(productos.map((p) => [p.id, p.title as string]));
  const avisos: AvisoMonitor[] = (logs.data ?? []).map((l: any) => ({
    id: l.id,
    productoId: l.productId ?? null,
    productoTitulo: l.productId ? tituloDe.get(l.productId) ?? null : null,
    nivel: l.level,
    tipo: l.type,
    mensaje: l.message,
    fecha: fechaUtc(l.createdAt) as Date,
  }));

  return { vigilados, avisos, ultimoRepaso };
}

export interface ResultadoRevision {
  mensaje: string;
  revisados: number;
  cambios: number;
  fallos: number;
  llamadas: number;
  ocupado: boolean;
}

/** Solo administrador: lanza ahora una revisión de hasta 3 productos (el servidor respeta el turno y la pausa entre llamadas). */
export async function revisarAhora(): Promise<ResultadoRevision> {
  const { data, error } = await supabase().functions.invoke('monitor-proveedor', { body: { maximo: 3 } });
  if (error) {
    const respuesta = (error as { context?: Response }).context;
    const cuerpo = respuesta && typeof respuesta.json === 'function' ? await respuesta.json().catch(() => null) : null;
    throw new Error(cuerpo?.error ?? 'No se pudo lanzar la revisión. Comprueba tu conexión.');
  }
  if (!data?.ok) throw new Error(String(data?.error ?? 'La revisión no se pudo completar.'));
  return {
    mensaje: String(data.mensaje ?? ''),
    revisados: Number(data.revisados ?? 0),
    cambios: Number(data.cambios ?? 0),
    fallos: Number(data.fallos ?? 0),
    llamadas: Number(data.llamadas ?? 0),
    ocupado: Boolean(data.ocupado),
  };
}

/* ───────────────────────── Proveedores y APIs ───────────────────────── */

export interface EstadoProveedor {
  proveedor: 'CJ_DROPSHIPPING' | 'ALIEXPRESS';
  nombre: string;
  /** CONNECTED = responde · ERROR = falló la última comprobación · otro = sin comprobar */
  estado: string;
  ultimaComprobacion: Date | null;
  /** Solo AliExpress: hace falta una cuenta autorizada para leer fichas y cotizar envío */
  cuentaAutorizada: boolean;
  /** Solo el administrador los recibe */
  ultimoError: string | null;
  llamadasMes: number | null;
}

/** Estado de CJ y AliExpress. Nunca incluye claves ni tokens: la función de la base de datos solo devuelve datos inocuos. */
export async function obtenerEstadoProveedores(): Promise<EstadoProveedor[]> {
  const { data, error } = await supabase().rpc('estado_proveedores');
  if (error) throw new Error(error.message);
  const filas = (data ?? []) as any[];
  return (['CJ_DROPSHIPPING', 'ALIEXPRESS'] as const).map((p) => {
    const f = filas.find((x) => x.provider === p);
    return {
      proveedor: p,
      nombre: NOMBRE_PROVEEDOR[p],
      estado: f?.estado ?? 'SIN_DATOS',
      ultimaComprobacion: fechaUtc(f?.ultima_comprobacion),
      cuentaAutorizada: Boolean(f?.cuenta_autorizada),
      ultimoError: f?.ultimo_error ?? null,
      llamadasMes: f?.llamadas_mes === null || f?.llamadas_mes === undefined ? null : Number(f.llamadas_mes),
    };
  });
}
