import { test } from 'node:test';
import assert from 'node:assert/strict';
import { grupoDeProducto } from '../../src/lib/catalogo/grupos';

// Casos reales del catálogo (categoría del proveedor y título tal como llegan de CJ y AliExpress)
const casos: Array<[string | null, string, string]> = [
  ['Speakers', 'Portable Bluetooth Speaker Outdoor', 'electronica'],
  ['Solar Lamps', 'Solar Garden Light', 'hogar'],
  ['Floodlights', 'LED Flood Light 100W', 'hogar'],
  ['Flashlights & Torches', 'Tactical Flashlight', 'hogar'],
  ['Blazers', "Men's Slim Blazer", 'moda'],
  ['Bikini Sets', 'Bikini Swimsuit', 'moda'],
  ['Trainers', 'Running Shoes Men', 'moda'],
  ['Shoulder Bags', 'Leather Shoulder Bag', 'moda'],
  ['Cooking Tools', 'Silicone Spatula Set', 'hogar'],
  ['Garden Tools', 'Pruning Shears', 'hogar'],
  ['Pet Sweaters', 'Dog Sweater Winter', 'mascotas'],
  ['Baby Outerwear', 'Baby Jacket', 'bebes'],
  ['Leather Cases', 'Leather Case For iPhone 15', 'electronica'],
  ['Smart Wristbands', 'Smart Band Fitness Tracker', 'electronica'],
  ['Batteries', 'AA Rechargeable Batteries', 'electronica'],
  ['Bolígrafos, lápices y utensilios para escribir', 'Bolígrafo de gel', 'educacion'],
  ['Herramientas manuales', 'Juego de destornilladores', 'herramientas'],
  ['Electrónica para coches', 'Cargador de coche', 'vehiculos'],
  ['Bedding Sets', 'Duvet Cover Set', 'hogar'],
  ['Home Office Storage', 'Desk Organizer', 'hogar'],
  // Sin categoría del proveedor: manda la primera palabra reconocida del título
  [null, 'Auriculares inalámbricos con Bluetooth, auriculares con micrófono, para deporte', 'electronica'],
  [null, 'Ventilador de Camping Recargable con Batería de 20000 mAh, con Luz LED', 'hogar'],
  [null, 'Molde de silicona para cubitos de hielo, refrigerador casero DIY', 'hogar'],
  [null, 'FUCHU Portátil de 14,1 pulgadas Intel Atom Windows 11, ordenador', 'electronica'],
  [null, 'Zapatillas de running para hombre, deportivas', 'moda'],
  [null, 'Ample Cost', 'otros'],
];

test('cada producto real cae en su categoría sencilla', () => {
  for (const [categoria, titulo, esperado] of casos) {
    assert.equal(grupoDeProducto(titulo, categoria), esperado, `${categoria ?? '(sin categoría)'} · ${titulo}`);
  }
});

test('las palabras cortas no chocan dentro de otras (chair, portable, string, casero)', () => {
  assert.equal(grupoDeProducto('Ergonomic Office Chair', null), 'hogar');
  assert.equal(grupoDeProducto('String Lights Fairy', null), 'hogar');
  assert.equal(grupoDeProducto('Portable Blender Juicer Cup', 'Kitchen Appliances'), 'hogar');
});
