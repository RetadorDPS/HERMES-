import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planPublicacion, type Preparacion, type VarianteServidor } from '../../src/lib/retador/plan-publicacion';
import { precioMinimoSinPerdida } from '../../src/lib/retador/precios';
import { DEFAULT_RULE } from '../../src/lib/pricing';
import type { TarifasRetador } from '../../src/lib/retador/precios';

// Tarifas con la forma del contrato v1.3 (pasarela del vendedor, ganancia mínima de Retador)
const tarifas: TarifasRetador = { hubUsdPorLibra: 2.5, diasHubCuba: [5, 10], comisionPctGanancia: 8, pasarelaPct: 4.4, pasarelaFijaUsd: 0.3, pasarelaACargo: 'vendedor', comisionBase: 'precio_venta_menos_costo_producto_menos_pasarela', gananciaMinimaRetadorUsd: 1 };
const coste = (producto: number) => ({ producto, envioHub: 0, hubCuba: 0, total: producto, sinEnvio: true });
const variante = (sku: string, producto: number | null, extra: Partial<VarianteServidor> = {}): VarianteServidor => ({
  sku, nombre: sku, imagen: null, costeUsd: producto, pesoGramos: 500, stock: 10, coste: producto === null ? null : coste(producto), faltan: producto === null ? ['existencias (sin stock ni en almacén ni en fábrica)'] : [], ...extra,
});
const prep = (variantes: VarianteServidor[], extra: Partial<Preparacion> = {}): Preparacion => ({
  tarifas, categorias: [{ cat: 'electronica', nombre: 'Electrónica', subcategorias: ['Audífonos', 'Accesorios tech'] }, { cat: 'otros', nombre: 'Otros / Varios', subcategorias: ['Varios'] }] as any,
  provincias: [], proveedor: 'aliexpress', envioHub: null, contenido: { titulo: 'Auriculares inalámbricos Bluetooth', descripcion: '', imagenes: ['https://ae01.alicdn.com/kf/x.jpg'] },
  variantes, yaPublicado: null, ...extra,
});

test('propone precio con la regla, nunca bajo el mínimo de Retador, y solo variantes publicables', () => {
  const plan = planPublicacion(prep([variante('A', 5), variante('B', null), variante('', 6)]), DEFAULT_RULE, 'Earphones & Headphones');
  assert.equal(plan.listo, true);
  if (!plan.listo) return;
  assert.deepEqual(plan.variantes.map((v) => v.sku), ['A']); // B sin stock, la tercera sin código
  assert.ok(plan.variantes[0].precioVentaUsd >= precioMinimoSinPerdida(5, tarifas, 5));
  assert.ok(plan.variantes[0].neto >= 0);
  assert.equal(plan.sugerencia?.cat, 'electronica');
  assert.equal(plan.contenido.descripcion, 'Auriculares inalámbricos Bluetooth'); // sin descripción del proveedor se parte del título
  assert.equal(plan.descripcionDelTitulo, true);
});

test('no se planea lo que no se puede publicar, y se dice por qué', () => {
  const sinNada = planPublicacion(prep([variante('B', null)]), DEFAULT_RULE, null);
  assert.equal(sinNada.listo, false);
  assert.match(!sinNada.listo ? sinNada.motivo : '', /existencias/);
  const ya = planPublicacion(prep([variante('A', 5)], { yaPublicado: { productId: 'x', estado: 'ACTIVE' } }), DEFAULT_RULE, null);
  assert.equal(ya.listo, false);
  const sinTarifas = planPublicacion(prep([variante('A', 5)], { tarifas: null }), DEFAULT_RULE, null);
  assert.equal(sinTarifas.listo, false);
});

test('respeta el máximo de variantes de Retador', () => {
  const muchas = Array.from({ length: 15 }, (_, i) => variante(`V${i}`, 4 + i));
  const plan = planPublicacion(prep(muchas, { maxVariantes: 12 }), DEFAULT_RULE, null);
  assert.equal(plan.listo && plan.variantes.length, 12);
  assert.equal(plan.listo && plan.sobrantes, 3);
});
