/** Pruebas de los filtros del buscador con títulos REALES devueltos por AliExpress y CJ (27/11/2026). */
import assert from 'node:assert/strict';
import { esAccesorio, palabrasClave, tieneTodas } from '../../src/lib/real/filtro-busqueda';

// Fundas y piezas que salieron al buscar «Poco F7 Pro» y «Samsung Galaxy S26 Ultra»: todas son accesorio
for (const t of [
  'Funda de silicona líquida a prueba de golpes para Xiaomi Poco X7 X8 Pro',
  'Para POCO F7 Pro Mecha disipación de calor cuatro esquinas cojín de aire',
  'Protector de pantalla de vidrio templado para Samsung S26 Ultra, 2 uds',
  'Batería BP4K 2026 para Xiaomi Poco F1/F2/F3/F5 PRO/F4 GT/F4 5G/F6 PRO',
  'For Xiaomi Pocophone Poco X3 NFC Case Shockproof',
  'Mobile phone holder Xiaomi',
]) assert.equal(esAccesorio(t), true, t);

// Aparatos de verdad: no son accesorio
for (const t of [
  'Teléfono Inteligente Plegable OPPO Find N6 5G con Pantalla OLED de 8.12 Pulgadas',
  'iPhone 16 Pro Max Original de 6.9 Pulgadas, SIM/eSIM Física Original',
  'Auriculares Bluetooth Inalámbricos, Cómodos, con Sonido Mejorado, Diseño Ligero',
  'Teléfono Móvil Original Motorola Razr 60 Pro XT2557 5G, NFC, 12GB+256GB',
]) assert.equal(esAccesorio(t), false, t);

// «Que tenga todas las palabras»
const poco = palabrasClave('Poco F7 PRO teléfono');
assert.deepEqual(poco, ['poco', 'f7', 'pro']);
assert.equal(tieneTodas('Xiaomi POCO F7 Pro 5G Smartphone 12GB', poco), true);
assert.equal(tieneTodas('Teléfono Móvil Original VIVO X300 Pro 5G', poco), false);
assert.equal(tieneTodas('POCOF7pro-funda protectora de diamante', poco), true); // unido también cuenta (luego la quita «accesorios»)
assert.deepEqual(palabrasClave('auriculares inalámbricos'), ['auriculares', 'inalambricos']);
assert.equal(tieneTodas('Auriculares Bluetooth Inalámbricos, Cómodos', palabrasClave('auriculares inalámbricos')), true);
// CJ: se comprueba con lo que se mandó traducido
assert.equal(tieneTodas('Silicone phone case', palabrasClave('case phone')), true);

console.log('filtro del buscador: todo bien');
