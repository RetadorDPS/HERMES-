// Ejecutar: npx tsx tests/retador/resenas.test.ts
import assert from 'node:assert/strict';
import { resenasParaRetador } from '../../supabase/functions/_compartido/resenas';

// AliExpress: solo media y total, sin textos
const ali = resenasParaRetador({ resenas: { lista: [], media: 4.3, total: 256 } }, 'aliexpress');
assert.deepEqual(ali, { fuente: 'aliexpress', media: 4.3, total: 256, muestra: [] });

// CJ: textos reales, las más recientes primero, sin filtrar por puntuación y sin inventar nada
const cj = resenasParaRetador({
  resenas: { media: 3.9, total: 3, lista: [
    { pais: 'FR', fecha: '2021-10-18T13:52:45+08:00', texto: 'Bon article', usuario: 'F***r', puntuacion: 4, fotos: ['https://x'] },
    { pais: 'BR', fecha: '2021-10-19T08:21:45+08:00', texto: 'Empty, had no liquid inside', usuario: 'A***s', puntuacion: 1 },
    { pais: 'RU', fecha: 'no es fecha', texto: '   ', usuario: 'I***a', puntuacion: 3 },
    { pais: 'RU', fecha: '2021-10-15T10:58:45+08:00', texto: 'ok', usuario: 'I***a', puntuacion: 3 },
    { pais: 'US', fecha: '2021-10-10T10:58:45+08:00', texto: 'Muy bien', usuario: 'Z', puntuacion: 9 },
  ] },
}, 'cj')!;
assert.equal(cj.muestra.length, 2); // se descartan: sin texto, texto de 2 letras y puntuación imposible
assert.equal(cj.muestra[0].puntuacion, 1); // la más reciente, aunque sea mala
assert.equal(cj.muestra[1].pais, 'FR');
assert.equal((cj.muestra[0] as any).fotos, undefined);
assert.equal(cj.media, 3.9);

// Sin datos reales = nada que mandar
assert.equal(resenasParaRetador({}, 'cj'), null);
assert.equal(resenasParaRetador({ resenas: { lista: [], media: null, total: 0 } }, 'cj'), null);
assert.equal(resenasParaRetador({ resenas: { lista: [], media: 7, total: 0 } }, 'cj'), null); // media imposible
// Máximo 20
const muchas = Array.from({ length: 50 }, (_, i) => ({ texto: 'Opinión ' + i, puntuacion: 5, fecha: new Date(2021, 0, 1 + i).toISOString() }));
assert.equal(resenasParaRetador({ resenas: { lista: muchas, media: 5, total: 50 } }, 'cj')!.muestra.length, 20);
console.log('✔ opiniones del proveedor correctas');
