// Pruebas del envío incluido por país (contrato 1.8 de Retador) y de la sugerencia de categoría con la lista real de Retador (18/11/2026).
// Ejecutar: npx tsx tests/retador/envio-incluido-categorias.test.ts
import assert from 'node:assert/strict';
import { liquidacionEnvioIncluido, paisesEnvioIncluido, precioMinimoEnvioIncluido, precioMinimoSinPerdida } from '../../supabase/functions/_compartido/retador-costes';
import { sugerirCategoria } from '../../src/lib/retador/sugerir-categoria';

const t = { hubUsdPorLibra: 1.99, diasHubCuba: [8, 15] as [number, number], comisionPctGanancia: 8, pasarelaPct: 4.4, pasarelaFijaUsd: 0.3, pasarelaACargo: 'vendedor' as const, comisionBase: 'precio_venta_menos_costo_producto_menos_pasarela' as const, gananciaMinimaRetadorUsd: 1 };

// Fórmula de Retador: (precio − costo − envío real − pasarela) × (1 − comisión), pasarela sobre lo cobrado (solo el precio)
{
  const l = liquidacionEnvioIncluido(49.99, 11.45, 23.76, t);
  // pasarela 49,99 × 4,4 % + 0,30 = 2,50; base 49,99 − 11,45 − 23,76 − 2,50 = 12,28; comisión 8 % = 0,98; neto 11,30
  assert.equal(l.pasarela, 2.5);
  assert.equal(l.comision, 0.98);
  assert.equal(l.neto, 11.3);
  // Con un precio bajo se pierde: el neto queda negativo y visible
  assert.ok(liquidacionEnvioIncluido(20, 11.45, 23.76, t).neto < 0);
  // Mínimo con envío incluido: (11,45 + 23,76 + 0,30) ÷ 0,956 = 37,15 → con ese precio no se pierde y un céntimo menos sí
  const min = precioMinimoEnvioIncluido(11.45, 23.76, t, precioMinimoSinPerdida(35.21, t, 11.45));
  assert.equal(min, 37.15);
  assert.ok(liquidacionEnvioIncluido(min, 11.45, 23.76, t).neto >= 0);
  // El redondeo de la pasarela al céntimo hace el mínimo prudente: un céntimo menos aún queda en 0 y dos céntimos menos ya pierde
  assert.ok(liquidacionEnvioIncluido(min - 0.02, 11.45, 23.76, t).neto < 0);
  // Si la pasarela la asume Retador, no se descuenta
  assert.equal(liquidacionEnvioIncluido(49.99, 11.45, 23.76, { ...t, pasarelaACargo: 'retador' as const }).pasarela, 0);
}
// Países: 2 letras, sin repetir, como mucho 20
assert.deepEqual(paisesEnvioIncluido(['cu', 'CU', 'es']), ['CU', 'ES']);
assert.deepEqual(paisesEnvioIncluido(undefined), []);
assert.equal(paisesEnvioIncluido(['CUB']), null);
assert.equal(paisesEnvioIncluido(Array.from({ length: 21 }, (_, i) => String.fromCharCode(65 + (i % 26)) + 'A')), null);
console.log('envío incluido: ok');

// Lista real de Retador (dropship-config, 18/11/2026), solo lo que usan las pruebas
const retador = [
  { cat: 'hogar', nombre: 'Hogar', subcategorias: ['Muebles', 'Decoración', 'Electrodomésticos', 'Cocina', 'Iluminación', 'Organización', 'Jardín', 'Herramientas hogar', 'Ropa de cama', 'Baño'] },
  { cat: 'electronica', nombre: 'Electrónica', subcategorias: ['Teléfonos', 'Tablets', 'Laptops', 'Audífonos', 'Smartwatches', 'Cargadores', 'Gaming', 'Cámaras', 'TV', 'Accesorios tech', 'Accesorios de móvil', 'Cables y adaptadores', 'Fundas y protectores'] },
  { cat: 'moda', nombre: 'Moda', subcategorias: ['Mujer', 'Hombre', 'Niños', 'Zapatos', 'Bolsos', 'Accesorios', 'Relojes', 'Joyas', 'Perfumes', 'Gorras', 'Deportiva', 'Lencería', 'Abrigos y chaquetas', 'Calzado deportivo', 'Ropa de invierno'] },
  { cat: 'belleza', nombre: 'Belleza', subcategorias: ['Maquillaje', 'Skincare', 'Cabello', 'Uñas', 'Perfumes', 'Barbería', 'Naturales', 'Herramientas', 'Aparatos de belleza', 'Cuidado corporal', 'Depilación y afeitado'] },
  { cat: 'mascotas', nombre: 'Mascotas', subcategorias: ['Alimentos', 'Accesorios', 'Veterinaria', 'Juguetes', 'Paseo', 'Adopción'] },
  { cat: 'otros', nombre: 'Otros / Varios', subcategorias: ['Gadgets', 'Novedades', 'Regalos', 'Varios'] },
];
const s = (titulo: string, cat?: string) => {
  const r = sugerirCategoria(retador, titulo, cat);
  return r ? `${r.cat}/${r.subcat}${r.porDefecto ? '*' : ''}` : null;
};
assert.equal(s('Men Casual Running Sneakers Breathable', "Men's Shoes"), 'moda/Calzado deportivo');
assert.equal(s('Zapatos de vestir de cuero para hombre', 'Calzado'), 'moda/Zapatos');
assert.equal(s('Sudadera con Capucha Estilo Chaleco Táctico para Hombre'), 'moda/Abrigos y chaquetas');
assert.equal(s('Transparent phone case shockproof', 'Cases & Covers'), 'electronica/Fundas y protectores');
assert.equal(s('USB C cable fast', 'Chargers'), 'electronica/Cables y adaptadores');
assert.equal(s('Depiladora eléctrica de doble cabezal para mujer'), 'belleza/Depilación y afeitado');
assert.equal(s('Pet Hair Remover', 'Pet Hair Removers & Combs'), 'mascotas/Accesorios');
assert.equal(s('Objeto raro sin pistas', 'Misc'), 'otros/Varios*');
// Caso real (28/11/2026): CJ guarda una pirámide decorativa en «Home, Garden & Furniture › Home Storage › Home Office Storage»;
// el nivel de arriba («Furniture») no debe mandar sobre lo que dice el título («Decoration»)
assert.equal(s('Pyramid Decoration Natural Crystal Gravel Energy Tower', 'Home, Garden & Furniture > Home Storage > Home Office Storage'), 'hogar/Decoración');
assert.equal(s('Pyramid Decoration Natural Crystal Gravel Energy Tower', 'Home Office Storage'), 'hogar/Decoración');
// Un mueble de verdad sigue siendo mueble
assert.equal(s('Wooden coffee table for living room', 'Home, Garden & Furniture > Furniture > Living Room Furniture'), 'hogar/Muebles');
console.log('categorías: ok');
