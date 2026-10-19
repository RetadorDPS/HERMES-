/** Pruebas del lector de enlaces de proveedor. Ejecutar: npx tsx tests/importar/enlace.test.ts */
import { analizarEnlace, extraerDireccion, hostPermitidoAli, hostEsEnlaceCortoAli } from '../../supabase/functions/_compartido/enlaces';

let fallos = 0;
let total = 0;
function igual(nombre: string, real: unknown, esperado: unknown) {
  total += 1;
  const a = JSON.stringify(real);
  const b = JSON.stringify(esperado);
  if (a !== b) {
    fallos += 1;
    console.error(`✗ ${nombre}\n   real:     ${a}\n   esperado: ${b}`);
  } else console.log(`✓ ${nombre}`);
}
const ok = (t: string) => {
  const r = analizarEnlace(t);
  return r.ok ? { p: r.proveedor, id: r.pid } : { motivo: r.motivo };
};

// AliExpress
igual('Ali estándar', ok('https://www.aliexpress.com/item/1005005123456789.html'), { p: 'ALIEXPRESS', id: '1005005123456789' });
igual('Ali con parámetros de seguimiento', ok('https://es.aliexpress.com/item/1005005123456789.html?spm=a2g0o.productlist&gatewayAdapt=glo2esp'), { p: 'ALIEXPRESS', id: '1005005123456789' });
igual('Ali móvil', ok('https://m.aliexpress.com/item/1005005123456789.html'), { p: 'ALIEXPRESS', id: '1005005123456789' });
igual('Ali /i/', ok('https://www.aliexpress.com/i/1005005123456789.html'), { p: 'ALIEXPRESS', id: '1005005123456789' });
igual('Ali con nombre en la ruta', ok('https://www.aliexpress.com/item/camiseta-bonita/1005005123456789.html'), { p: 'ALIEXPRESS', id: '1005005123456789' });
igual('Ali aliexpress.us', ok('https://www.aliexpress.us/item/3256805123456789.html'), { p: 'ALIEXPRESS', id: '3256805123456789' });
igual('Ali por productIds', ok('https://www.aliexpress.com/p/trade/confirm.html?productIds=1005005123456789'), { p: 'ALIEXPRESS', id: '1005005123456789' });
igual('Ali sin esquema', ok('www.aliexpress.com/item/1005005123456789.html'), { p: 'ALIEXPRESS', id: '1005005123456789' });
igual('Ali dentro de un texto', ok('Mira esto 👉 https://www.aliexpress.com/item/1005005123456789.html ¡está genial!'), { p: 'ALIEXPRESS', id: '1005005123456789' });
igual('Ali enlace corto', ok('https://a.aliexpress.com/_mAbCdEf'), { motivo: 'enlace_corto' });
igual('Ali portada sin producto', ok('https://www.aliexpress.com/'), { motivo: 'sin_producto' });
igual('Ali id demasiado corto', ok('https://www.aliexpress.com/item/123.html'), { motivo: 'sin_producto' });

// CJ
igual('CJ numérico', ok('https://cjdropshipping.com/product/camiseta-p-2410170123456789000.html'), { p: 'CJ_DROPSHIPPING', id: '2410170123456789000' });
igual('CJ con guiones en el nombre (-p- repetido)', ok('https://cjdropshipping.com/product/Mini-p-Lamp-p-2410170123456789000.html'), { p: 'CJ_DROPSHIPPING', id: '2410170123456789000' });
igual('CJ uuid', ok('https://www.cjdropshipping.com/product/Smart-Watch-p-A1B2C3D4-E5F6-7890-ABCD-EF1234567890.html'), { p: 'CJ_DROPSHIPPING', id: 'A1B2C3D4-E5F6-7890-ABCD-EF1234567890' });
igual('CJ app con ?id=', ok('https://app.cjdropshipping.com/product-detail.html?id=2410170123456789000'), { p: 'CJ_DROPSHIPPING', id: '2410170123456789000' });
igual('CJ sin producto', ok('https://cjdropshipping.com/list/wholesale-women.html'), { motivo: 'sin_producto' });

// Rechazos
igual('Vacío', ok('   '), { motivo: 'vacio' });
igual('Texto sin enlace', ok('quiero este producto'), { motivo: 'no_es_enlace' });
igual('Otro proveedor conocido', ok('https://www.amazon.es/dp/B08XYZ1234'), { motivo: 'proveedor_no_admitido' });
igual('Dominio desconocido', ok('https://tienda-rara.com/item/1005005123456789.html'), { motivo: 'proveedor_no_admitido' });
igual('Dominio que imita a AliExpress', ok('https://aliexpress.com.evil.com/item/1005005123456789.html'), { motivo: 'proveedor_no_admitido' });
igual('Dominio que acaba parecido', ok('https://notaliexpress.com/item/1005005123456789.html'), { motivo: 'proveedor_no_admitido' });
igual('Con usuario:clave', ok('https://user:pass@www.aliexpress.com/item/1005005123456789.html'), { motivo: 'no_es_enlace' });
igual('Puerto raro', ok('https://www.aliexpress.com:8443/item/1005005123456789.html'), { motivo: 'no_es_enlace' });
igual('javascript:', ok('javascript:alert(1)'), { motivo: 'no_es_enlace' });
igual('Demasiado largo', ok('https://www.aliexpress.com/item/1005005123456789.html?x=' + 'a'.repeat(2100)), { motivo: 'no_es_enlace' });

// Auxiliares
igual('extraerDireccion quita el punto final', extraerDireccion('ver https://cjdropshipping.com/product/a-p-1234567890.html.'), 'https://cjdropshipping.com/product/a-p-1234567890.html');
igual('hostPermitidoAli ok', hostPermitidoAli('www.aliexpress.com'), true);
igual('hostPermitidoAli rechaza imitación', hostPermitidoAli('aliexpress.com.evil.com'), false);
igual('hostEsEnlaceCortoAli', [hostEsEnlaceCortoAli('a.aliexpress.com'), hostEsEnlaceCortoAli('s.click.aliexpress.com'), hostEsEnlaceCortoAli('x.aliexpress.com')], [true, true, false]);

console.log(`\n${total - fallos}/${total} comprobaciones correctas`);
process.exit(fallos ? 1 : 0);
