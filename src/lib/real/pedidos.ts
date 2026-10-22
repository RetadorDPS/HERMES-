/** Pedidos reales de las tiendas conectadas (tablas `Order` y `OrderItem`) y sus compras al proveedor. */
import { supabase } from '../supabase/cliente';
import { fechaUtc } from './monitor';

export interface ItemPedido {
  titulo: string;
  sku: string | null;
  cantidad: number;
  precio: number;
  coste: number;
}

export interface CompraVista {
  id: string;
  proveedor: string;
  modo: string;
  estado: string;
  costeUsd: number | null;
  mensaje: string | null;
  fecha: Date | null;
}

export interface PedidoVista {
  id: string;
  numero: string;
  estado: string;
  fecha: Date | null;
  pais: string | null;
  ciudad: string | null;
  nombre: string | null;
  notas: string | null;
  moneda: string;
  total: number;
  costeProveedor: number;
  aviso: string | null;
  seguimiento: { numero: string; empresa: string | null; url: string | null } | null;
  items: ItemPedido[];
  compras: CompraVista[];
}

export async function obtenerPedidosReales(): Promise<PedidoVista[]> {
  const c = supabase();
  const r = await c
    .from('Order')
    .select(
      'id,storeOrderNumber,status,orderedAt,shippingCountry,shippingCity,shippingName,notes,currency,total,supplierCost,errorMessage,trackingNumber,trackingCompany,trackingUrl,items:OrderItem(title,sku,quantity,unitPrice,unitCost)',
    )
    .order('orderedAt', { ascending: false })
    .limit(100);
  if (r.error) throw new Error(r.error.message);
  const ordenes = (r.data ?? []) as any[];
  // Las compras al proveedor pueden no existir todavía (se activan después): sin ellas la pantalla sigue funcionando
  const compras = new Map<string, CompraVista[]>();
  if (ordenes.length) {
    const rc = await c.from('CompraProveedor').select('id,orderId,proveedor,modo,estado,costeUsd,mensaje,creadoEn').in('orderId', ordenes.map((o) => o.id)).order('creadoEn', { ascending: false });
    if (!rc.error) {
      for (const f of (rc.data ?? []) as any[]) {
        const lista = compras.get(f.orderId) ?? [];
        lista.push({ id: f.id, proveedor: f.proveedor, modo: f.modo, estado: f.estado, costeUsd: f.costeUsd === null ? null : Number(f.costeUsd), mensaje: f.mensaje ?? null, fecha: fechaUtc(f.creadoEn) });
        compras.set(f.orderId, lista);
      }
    }
  }
  return ordenes.map((o) => ({
    id: o.id,
    numero: o.storeOrderNumber,
    estado: o.status,
    fecha: fechaUtc(o.orderedAt),
    pais: o.shippingCountry ?? null,
    ciudad: o.shippingCity ?? null,
    nombre: o.shippingName ?? null,
    notas: o.notes ?? null,
    moneda: o.currency ?? 'USD',
    total: Number(o.total ?? 0),
    costeProveedor: Number(o.supplierCost ?? 0),
    aviso: o.errorMessage ?? null,
    seguimiento: o.trackingNumber ? { numero: o.trackingNumber, empresa: o.trackingCompany ?? null, url: o.trackingUrl ?? null } : null,
    items: ((o.items ?? []) as any[]).map((i) => ({ titulo: i.title, sku: i.sku ?? null, cantidad: Number(i.quantity ?? 1), precio: Number(i.unitPrice ?? 0), coste: Number(i.unitCost ?? 0) })),
    compras: compras.get(o.id) ?? [],
  }));
}
