/** Pruebas de la comparación de variantes del monitor. Ejecutar: npx tsx tests/importar/cambios.test.ts */
import { compararVariantes, describirCambio, esCambioDeRiesgo, esCambioRelevante, stockTotal, type VarianteVigilada } from '../../supabase/functions/_compartido/cambios';

let fallos = 0, total = 0;
function igual(nombre: string, real: unknown, esperado: unknown) {
  total += 1;
  const a = JSON.stringify(real), b = JSON.stringify(esperado);
  if (a !== b) { fallos += 1; console.error(`✗ ${nombre}\n   real:     ${a}\n   esperado: ${b}`); } else console.log(`✓ ${nombre}`);
}
const v = (vid: string, precio: number | null, stock: number | null, nombre = `V${vid}`): VarianteVigilada => ({ vid, nombre, sku: `SKU-${vid}`, precio, stock });
const tipos = (a: VarianteVigilada[], b: VarianteVigilada[]) => compararVariantes(a, b).map((c) => `${c.tipo}:${c.vid}`);

igual('Sin cambios', tipos([v('1', 3.91, 100)], [v('1', 3.91, 100)]), []);
igual('El stock cambia pero sigue habiendo: no es noticia', tipos([v('1', 3.91, 100)], [v('1', 3.91, 80)]), []);
igual('Sube el coste', tipos([v('1', 3.91, 100)], [v('1', 4.5, 100)]), ['PRECIO_SUBE:1']);
igual('Baja el coste', tipos([v('1', 3.91, 100)], [v('1', 3.5, 100)]), ['PRECIO_BAJA:1']);
igual('Una diferencia de menos de medio céntimo no cuenta', tipos([v('1', 3.91, 100)], [v('1', 3.9149, 100)]), []);
igual('Porcentaje del cambio de precio', compararVariantes([v('1', 4, 10)], [v('1', 5, 10)])[0].pct, 25);
igual('Se agota', tipos([v('1', 3, 10)], [v('1', 3, 0)]), ['AGOTADO:1']);
igual('Vuelve a haber', tipos([v('1', 3, 0)], [v('1', 3, 40)]), ['DISPONIBLE:1']);
igual('Stock bajo al cruzar el umbral', tipos([v('1', 3, 50)], [v('1', 3, 4)]), ['STOCK_BAJO:1']);
igual('Stock bajo no se repite si ya estaba bajo', tipos([v('1', 3, 4)], [v('1', 3, 3)]), []);
igual('Sin dato de stock no se inventa nada (null → 0)', tipos([v('1', 3, null)], [v('1', 3, 0)]), []);
igual('Sin dato de stock no se inventa nada (10 → null)', tipos([v('1', 3, 10)], [v('1', 3, null)]), []);
igual('Variante nueva', tipos([v('1', 3, 5)], [v('1', 3, 5), v('2', 4, 9)]), ['VARIANTE_NUEVA:2']);
igual('Variante retirada', tipos([v('1', 3, 5), v('2', 4, 9)], [v('1', 3, 5)]), ['VARIANTE_RETIRADA:2']);
igual('Precio y agotado a la vez', tipos([v('1', 3, 10)], [v('1', 3.5, 0)]), ['PRECIO_SUBE:1', 'AGOTADO:1']);
igual('Variantes sin vid se emparejan por SKU', tipos([{ vid: null, nombre: 'A', sku: 'S1', precio: 2, stock: 5 }], [{ vid: null, nombre: 'A', sku: 'S1', precio: 2.5, stock: 5 }]), ['PRECIO_SUBE:null']);
igual('Precio desconocido no genera cambio', tipos([v('1', null, 5)], [v('1', 9, 5)]), []);
igual('stockTotal suma', stockTotal([{ total: 5 }, { total: 7 }]), 12);
igual('stockTotal sin datos es null, no 0', stockTotal([{ total: null }]), null);
igual('stockTotal de lista vacía es null', stockTotal([]), null);
igual('stockTotal con ceros es 0', stockTotal([{ total: 0 }]), 0);
igual('Frase de subida', describirCambio(compararVariantes([v('1', 3.91, 5, 'Pink')], [v('1', 4.5, 5, 'Pink')])[0]), 'El coste de «Pink» subió de 3,91 US$ a 4,50 US$ (+15,1 %). Revisa tu precio de venta.');
igual('Subida de coste es de riesgo, bajada no', [esCambioDeRiesgo(compararVariantes([v('1', 1, 5)], [v('1', 2, 5)])[0]), esCambioDeRiesgo(compararVariantes([v('1', 2, 5)], [v('1', 1, 5)])[0])], [true, false]);

const rel = (antes: number, despues: number) => esCambioRelevante(compararVariantes([v('1', antes, 5)], [v('1', despues, 5)])[0]);
igual('Deriva de 0,01 US$ (0,2 %) no es noticia', rel(4.71, 4.72), false);
igual('Medio por ciento en un producto caro no es noticia', rel(100, 100.5), false);
igual('Un 2 % y 0,20 US$ sí es noticia', rel(10, 10.2), true);
igual('Una bajada fuerte también cuenta', rel(10, 7), true);
igual('Los cambios de existencias siempre cuentan', esCambioRelevante(compararVariantes([v('1', 3, 10)], [v('1', 3, 0)])[0]), true);

console.log(`\n${total - fallos}/${total} comprobaciones correctas`);
process.exit(fallos ? 1 : 0);
