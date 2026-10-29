/**
 * Decisión de comprar un pedido pagado al proveedor. Archivo SIN dependencias (se prueba en Node y corre en Deno).
 *
 * Principios: no se compra nada con datos dudosos, ni por encima de los topes, ni dos veces, ni con el pedido sin pagar.
 * Cada «no» lleva un código y un motivo que se enseña tal cual en la pantalla. Cualquier duda = no se compra.
 */

export type ModoCompras = 'APAGADO' | 'SIMULACION' | 'MANUAL' | 'AUTOMATICO';
export type Proveedor = 'CJ_DROPSHIPPING' | 'ALIEXPRESS';

export interface ConfigCompras {
  modo: ModoCompras;
  limitePedidoUsd: number;
  limiteDiaUsd: number;
  /** Subida máxima (%) del costo del proveedor respecto al costo guardado al publicar */
  subidaMaxPct: number;
}

export const CONFIG_POR_DEFECTO: ConfigCompras = { modo: 'SIMULACION', limitePedidoUsd: 50, limiteDiaUsd: 200, subidaMaxPct: 10 };

export interface ItemCompra {
  sku: string;
  titulo: string;
  cantidad: number;
  supplierVariantId: string | null;
  proveedor: Proveedor | null;
  /** Costo por unidad guardado al publicar (USD) */
  costeUnitUsd: number;
  /** Costo por unidad que cobra HOY el proveedor, si ya se ha consultado (USD) */
  costeActualUsd?: number | null;
}

export interface OrdenCompra {
  id: string;
  estado: string;
  aviso: string | null;
  entrega: { nombre: string | null; direccion1: string | null; ciudad: string | null; pais: string | null };
  items: ItemCompra[];
  /** Proveedores a los que este pedido ya se les compró (compra en curso o hecha) */
  yaComprado: Proveedor[];
}

export interface GrupoCompra {
  proveedor: Proveedor;
  items: ItemCompra[];
  costeUsd: number;
}

export type DecisionCompra =
  | { ok: true; grupos: GrupoCompra[]; costeTotalUsd: number }
  | { ok: false; codigo: string; motivo: string };

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const no = (codigo: string, motivo: string): DecisionCompra => ({ ok: false, codigo, motivo });

export function evaluarCompra(orden: OrdenCompra, config: ConfigCompras, gastadoHoyUsd: number): DecisionCompra {
  if (config.modo === 'APAGADO') return no('compras_apagadas', 'Las compras están apagadas.');
  if (orden.estado !== 'PAID') return no('no_pagado', 'El pedido no está pagado (o ya no está pendiente de comprar).');
  if (orden.aviso && orden.aviso.startsWith('Necesita revisión')) return no('necesita_revision', 'El pedido necesita revisión antes de comprarlo.');
  if (!orden.items.length) return no('datos_incompletos', 'El pedido no tiene líneas.');
  for (const i of orden.items) {
    if (!i.supplierVariantId || !i.proveedor) return no('datos_incompletos', `La variante «${i.sku}» no está enlazada con el proveedor.`);
    if (!Number.isFinite(i.costeUnitUsd) || i.costeUnitUsd <= 0) return no('datos_incompletos', `La variante «${i.sku}» no tiene un costo conocido.`);
    if (!Number.isInteger(i.cantidad) || i.cantidad < 1) return no('datos_incompletos', `La cantidad de «${i.sku}» no es válida.`);
    if (i.costeActualUsd !== undefined && i.costeActualUsd !== null && i.costeActualUsd > i.costeUnitUsd * (1 + config.subidaMaxPct / 100)) {
      return no('coste_subio', `El proveedor cobra ahora ${i.costeActualUsd.toFixed(2)} US$ por «${i.sku}» (antes ${i.costeUnitUsd.toFixed(2)}): sube más del ${config.subidaMaxPct} % permitido.`);
    }
  }
  const e = orden.entrega;
  if (!e.nombre || !e.direccion1 || !e.ciudad || !e.pais) return no('entrega_incompleta', 'Faltan datos de entrega (nombre, dirección, ciudad o país).');

  const mapa = new Map<Proveedor, ItemCompra[]>();
  for (const i of orden.items) mapa.set(i.proveedor as Proveedor, [...(mapa.get(i.proveedor as Proveedor) ?? []), i]);
  const grupos: GrupoCompra[] = [...mapa.entries()]
    .filter(([p]) => !orden.yaComprado.includes(p))
    .map(([proveedor, items]) => ({ proveedor, items, costeUsd: r2(items.reduce((s, i) => s + i.costeUnitUsd * i.cantidad, 0)) }));
  if (!grupos.length) return no('ya_comprado', 'Este pedido ya se compró al proveedor.');

  const total = r2(grupos.reduce((s, g) => s + g.costeUsd, 0));
  if (total > config.limitePedidoUsd) return no('supera_limite_pedido', `La compra (${total.toFixed(2)} US$) supera el tope por pedido (${config.limitePedidoUsd.toFixed(2)} US$).`);
  if (gastadoHoyUsd + total > config.limiteDiaUsd) return no('supera_limite_dia', `Con esta compra se superaría el tope del día (${config.limiteDiaUsd.toFixed(2)} US$; ya llevas ${gastadoHoyUsd.toFixed(2)} US$).`);
  return { ok: true, grupos, costeTotalUsd: total };
}

/** Validación de lo que el usuario guarda como configuración de compras. */
export function validarConfig(c: any, comprasRealesHechas: number): { ok: true; config: ConfigCompras } | { ok: false; motivo: string } {
  const modos: ModoCompras[] = ['APAGADO', 'SIMULACION', 'MANUAL', 'AUTOMATICO'];
  if (!modos.includes(c?.modo)) return { ok: false, motivo: 'El modo no es válido.' };
  const num = (v: unknown, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? r2(v) : null);
  const limitePedidoUsd = num(c?.limitePedidoUsd, 0, 10_000);
  const limiteDiaUsd = num(c?.limiteDiaUsd, 0, 100_000);
  const subidaMaxPct = num(c?.subidaMaxPct, 0, 100);
  if (limitePedidoUsd === null || limiteDiaUsd === null || subidaMaxPct === null) return { ok: false, motivo: 'Los topes no son válidos.' };
  if (limiteDiaUsd < limitePedidoUsd) return { ok: false, motivo: 'El tope del día no puede ser menor que el tope por pedido.' };
  if (c.modo === 'AUTOMATICO' && comprasRealesHechas < 3) {
    return { ok: false, motivo: 'El modo automático solo se puede activar después de 3 compras reales hechas con tu aprobación (llevas ' + comprasRealesHechas + ').' };
  }
  return { ok: true, config: { modo: c.modo, limitePedidoUsd, limiteDiaUsd, subidaMaxPct } };
}

/**
 * Método de envío para comprar en CJ: la opción más barata hacia el país de entrega, solo desde los almacenes que tienen las existencias
 * de TODAS las líneas del grupo. Sin cotización guardada = no se compra (nunca se supone un método).
 */
export function elegirEnvioCompra(fichas: any[], origenesConStock: Set<string>[], destino: string): { origen: string; logistica: string; precioUsd: number } | { error: string } {
  if (!fichas.length || fichas.length !== origenesConStock.length) return { error: 'No hay ficha de envío para todas las líneas.' };
  let comunes: Set<string> | null = null;
  for (const o of origenesConStock) {
    const previo: Set<string> | null = comunes;
    comunes = previo ? new Set([...previo].filter((x: string) => o.has(x))) : new Set(o);
  }
  if (!comunes || !comunes.size) return { error: 'Ningún almacén de CJ tiene existencias de todas las líneas a la vez.' };
  let mejor: { origen: string; logistica: string; precioUsd: number } | null = null;
  for (const origen of comunes) {
    // Un método solo vale si está cotizado para todas las fichas con el mismo nombre; se toma el mayor precio entre ellas (conservador)
    const porNombre = new Map<string, number[]>();
    for (const f of fichas) {
      const opciones = f?.envio?.porOrigen?.[origen]?.[destino]?.opciones;
      if (!Array.isArray(opciones)) { porNombre.clear(); break; }
      for (const o of opciones) {
        const precio = typeof o?.precio === 'number' && Number.isFinite(o.precio) ? o.precio : o?.gratis === true ? 0 : null;
        if (typeof o?.nombre !== 'string' || precio === null) continue;
        porNombre.set(o.nombre, [...(porNombre.get(o.nombre) ?? []), precio]);
      }
    }
    for (const [nombre, precios] of porNombre) {
      if (precios.length < fichas.length) continue;
      const precio = Math.max(...precios);
      if (!mejor || precio < mejor.precioUsd) mejor = { origen, logistica: nombre, precioUsd: precio };
    }
  }
  return mejor ?? { error: `CJ no tiene un método de envío cotizado hacia ${destino} desde el almacén con existencias.` };
}
