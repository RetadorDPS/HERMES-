/**
 * Pedidos pagados de Retador (contrato docs/contrato-pedidos.md). Archivo SIN dependencias: se prueba en Node y corre en Deno.
 * Todo dato dudoso deja el pedido «en revisión»; nunca se inventa una línea, un costo ni una dirección.
 */

export interface LineaPedido {
  ref: string;
  sku: string;
  cantidad: number;
  precioVentaUsd: number;
}

export interface EntregaPedido {
  tipo: 'centro_logistico' | 'directa';
  pais: string;
  nombre: string;
  telefono: string | null;
  direccion1: string;
  direccion2: string | null;
  ciudad: string;
  provincia: string | null;
  codigoPostal: string | null;
  referencia: string | null;
}

export interface PedidoRetador {
  pedidoId: string;
  numero: string;
  pagadoEn: string;
  moneda: string;
  lineas: LineaPedido[];
  entrega: EntregaPedido;
  estadoCompra: 'pendiente' | 'comprado' | 'enviado' | 'entregado' | 'error' | 'cancelado';
  proveedorPedidoId: string | null;
}

const ESTADOS = new Set(['pendiente', 'comprado', 'enviado', 'entregado', 'error', 'cancelado']);
const texto = (v: unknown, max = 300): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

/** `dsp:<tienda>:<producto>` → ids; null si no tiene ese formato. */
export function parsearRef(ref: unknown): { tiendaId: string; productoId: string } | null {
  if (typeof ref !== 'string') return null;
  const m = /^dsp:([0-9a-f-]{36}):([0-9a-f-]{36})$/i.exec(ref.trim());
  return m ? { tiendaId: m[1], productoId: m[2] } : null;
}

export function normalizarPedido(crudo: any): { ok: true; pedido: PedidoRetador } | { ok: false; motivo: string } {
  const pedidoId = texto(crudo?.pedido_id, 80);
  if (!pedidoId) return { ok: false, motivo: 'el pedido no trae identificador' };
  const numero = texto(crudo?.numero, 60) ?? pedidoId.slice(0, 8);
  if (!Array.isArray(crudo?.lineas) || crudo.lineas.length < 1 || crudo.lineas.length > 50) return { ok: false, motivo: 'el pedido no trae líneas válidas' };
  const lineas: LineaPedido[] = [];
  for (const l of crudo.lineas) {
    const sku = texto(l?.sku, 120);
    const cantidad = Number(l?.cantidad);
    const precio = Number(l?.precio_venta_usd);
    if (!sku || !texto(l?.ref) || !Number.isInteger(cantidad) || cantidad < 1 || cantidad > 1000 || !Number.isFinite(precio) || precio <= 0) {
      return { ok: false, motivo: `una línea no es válida (${sku ?? 'sin sku'})` };
    }
    lineas.push({ ref: String(l.ref).trim(), sku, cantidad, precioVentaUsd: Math.round(precio * 100) / 100 });
  }
  const e = crudo?.entrega ?? {};
  const pais = texto(e.pais, 10)?.toUpperCase() ?? null;
  const nombre = texto(e.nombre, 120);
  const direccion1 = texto(e.direccion1, 200);
  const ciudad = texto(e.ciudad, 100);
  if (!pais || !/^[A-Z]{2}$/.test(pais) || !nombre || !direccion1 || !ciudad) return { ok: false, motivo: 'faltan datos de entrega (país, nombre, dirección o ciudad)' };
  const tipo = e.tipo === 'directa' ? 'directa' : e.tipo === 'centro_logistico' ? 'centro_logistico' : null;
  if (!tipo) return { ok: false, motivo: 'el tipo de entrega no es válido' };
  const estadoCompra = ESTADOS.has(crudo?.estado_compra) ? crudo.estado_compra : null;
  if (!estadoCompra) return { ok: false, motivo: 'el estado de compra no es válido' };
  const pagadoEn = texto(crudo?.pagado_en, 40);
  if (!pagadoEn || Number.isNaN(Date.parse(pagadoEn))) return { ok: false, motivo: 'la fecha de pago no es válida' };
  return {
    ok: true,
    pedido: {
      pedidoId,
      numero,
      pagadoEn,
      moneda: texto(crudo?.moneda, 3)?.toUpperCase() ?? 'USD',
      lineas,
      entrega: {
        tipo,
        pais,
        nombre,
        telefono: texto(e.telefono, 40),
        direccion1,
        direccion2: texto(e.direccion2, 200),
        ciudad,
        provincia: texto(e.provincia, 100),
        codigoPostal: texto(e.codigo_postal, 20),
        referencia: texto(e.referencia, 60),
      },
      estadoCompra: estadoCompra as PedidoRetador['estadoCompra'],
      proveedorPedidoId: texto(crudo?.proveedor_pedido_id, 120),
    },
  };
}

/**
 * Qué hacer con un pedido que YA tenemos cuando Retador lo vuelve a enviar.
 * Solo importa la cancelación: antes de comprar se cancela sin más; si ya se compró al proveedor, no se toca nada y se avisa.
 */
export function efectoDeCancelacion(estadoLocal: string): { estado: 'CANCELED' | null; aviso: string | null } {
  if (['PENDING', 'PAID', 'SUPPLIER_ERROR'].includes(estadoLocal)) return { estado: 'CANCELED', aviso: null };
  if (['SUPPLIER_PURCHASED', 'SHIPPED', 'DELIVERED'].includes(estadoLocal)) {
    return { estado: null, aviso: 'Retador canceló este pedido DESPUÉS de comprarlo al proveedor: revisa con el proveedor si se puede cancelar o devolver.' };
  }
  return { estado: null, aviso: null };
}

/** Texto que explica el estado de un pedido en la pantalla. */
export function etiquetaEstadoPedido(estado: string): { texto: string; tono: 'ok' | 'aviso' | 'error' | 'neutro' } {
  switch (estado) {
    case 'PAID':
      return { texto: 'Pagado: falta comprarlo al proveedor', tono: 'aviso' };
    case 'SUPPLIER_PURCHASED':
      return { texto: 'Comprado al proveedor', tono: 'ok' };
    case 'SUPPLIER_ERROR':
      return { texto: 'Error al comprar', tono: 'error' };
    case 'SHIPPED':
      return { texto: 'Enviado', tono: 'ok' };
    case 'DELIVERED':
      return { texto: 'Entregado', tono: 'ok' };
    case 'CANCELED':
      return { texto: 'Cancelado', tono: 'neutro' };
    case 'REFUNDED':
      return { texto: 'Reembolsado', tono: 'neutro' };
    default:
      return { texto: 'Pendiente de pago', tono: 'neutro' };
  }
}
