/** Pruebas de «qué necesita atención» del monitor. Ejecutar: npx tsx tests/monitor/atencion.test.ts */
import { atencionDeProducto, type VarianteActual, type VarianteGuardada } from '../../src/lib/monitor/atencion';

let fallos = 0, total = 0;
function igual(nombre: string, real: unknown, esperado: unknown) {
  total += 1;
  const a = JSON.stringify(real), b = JSON.stringify(esperado);
  if (a !== b) { fallos += 1; console.error(`✗ ${nombre}\n   real:     ${a}\n   esperado: ${b}`); } else console.log(`✓ ${nombre}`);
}
const g = (vid: string, coste: number, venta = 9.99, envio = 2): VarianteGuardada => ({ id: `pv-${vid}`, supplierVariantId: vid, sku: `S${vid}`, title: `Var ${vid}`, costPrice: coste, sellingPrice: venta, shippingCost: envio });
const a = (vid: string, precio: number | null, stock: number | null = 10): VarianteActual => ({ vid, sku: `S${vid}`, precio, stock: stock === null ? [] : [{ total: stock }] });
const motivos = (gs: VarianteGuardada[], as: VarianteActual[]) => atencionDeProducto(gs, as).map((x) => `${x.motivo}:${x.variante}`);

igual('Todo igual: nada que decir', motivos([g('1', 3)], [a('1', 3)]), []);
igual('Subida de céntimos (deriva) no cuenta', motivos([g('1', 4.71)], [a('1', 4.72)]), []);
igual('Subida real', motivos([g('1', 3)], [a('1', 3.6)]), ['COSTE_SUBIO:Var 1']);
igual('La suma de pequeñas subidas sí se detecta frente al coste de publicación', motivos([g('1', 10)], [a('1', 10.4)]), ['COSTE_SUBIO:Var 1']);
igual('Bajada de coste: no requiere acción', motivos([g('1', 3)], [a('1', 2.5)]), []);
igual('Agotado en el proveedor', motivos([g('1', 3)], [a('1', 3, 0)]), ['AGOTADO:Var 1']);
igual('Stock desconocido no es agotado', motivos([g('1', 3)], [a('1', 3, null)]), []);
igual('Sin ficha actual', motivos([g('1', 3)], []), ['SIN_FICHA:']);
igual('Variante que ya no está en la ficha se ignora', motivos([g('1', 3), g('2', 3)], [a('1', 3)]), []);
const x = atencionDeProducto([g('1', 3, 4.5, 1.2)], [a('1', 3.5)])[0];
igual('Ganancia antes y ahora', [x.gananciaAntes, x.gananciaAhora, x.vendeAPerdida, x.pct], [0.3, -0.2, true, 16.67]);
const y = atencionDeProducto([g('1', 3, 9.99, 2)], [a('1', 3.6)])[0];
igual('Sigue ganando aunque suba', [y.gananciaAntes, y.gananciaAhora, y.vendeAPerdida], [4.99, 4.39, false]);
igual('Se empareja por SKU si falta el identificador', atencionDeProducto([{ ...g('1', 3), supplierVariantId: null }], [{ vid: null, sku: 'S1', precio: 4, stock: [{ total: 5 }] }]).length, 1);

console.log(`\n${total - fallos}/${total} comprobaciones correctas`);
process.exit(fallos ? 1 : 0);
