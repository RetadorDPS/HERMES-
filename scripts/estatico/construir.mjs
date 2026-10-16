/**
 * scripts/estatico/construir.mjs — Genera la versión ESTÁTICA (solo pantallas) para GitHub Pages.
 *
 * Qué hace:
 *   1. Copia el proyecto a una carpeta temporal (.estatico-tmp), sin tocar el original.
 *   2. En la copia quita lo que necesita un servidor (rutas /api y middleware) y
 *      las marcas «force-dynamic», que no caben en una exportación estática.
 *   3. Construye con ESTATICO=1 (output: 'export') y deja el resultado en ./out
 *
 * El original (lo que se publica en Vercel o en un servidor propio) NO se modifica.
 *
 * Uso:  RUTA_BASE=/HERMES- node scripts/estatico/construir.mjs
 */
import { cpSync, mkdirSync, rmSync, existsSync, readdirSync, readFileSync, writeFileSync, statSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const RAIZ = resolve(new URL('../..', import.meta.url).pathname);
const TMP = join(RAIZ, '.estatico-tmp');
const SALIDA = join(RAIZ, 'out');
const RUTA_BASE = process.env.RUTA_BASE ?? '';

const EXCLUIR = new Set(['node_modules', '.git', '.next', 'out', '.estatico-tmp', 'backups', 'capturas', 'logs', 'docs', 'data']);

function paso(msg) {
  console.log(`\n▶ ${msg}`);
}

paso('Preparando copia temporal del proyecto');
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });
for (const nombre of readdirSync(RAIZ)) {
  if (EXCLUIR.has(nombre)) continue;
  cpSync(join(RAIZ, nombre), join(TMP, nombre), { recursive: true });
}
symlinkSync(join(RAIZ, 'node_modules'), join(TMP, 'node_modules'), 'dir');

paso('Quitando lo que necesita servidor (rutas /api y middleware)');
rmSync(join(TMP, 'src/app/api'), { recursive: true, force: true });
rmSync(join(TMP, 'src/middleware.ts'), { force: true });
// Scripts de verificación, trabajadores y servicios: usan el servidor y no forman parte de las pantallas
for (const carpeta of ['scripts', 'workers', 'services', 'prisma/seed.ts']) rmSync(join(TMP, carpeta), { recursive: true, force: true });
// Las dos carpetas siguientes se vuelven a crear vacías para que el tsconfig no se queje

paso('Quitando marcas de página dinámica');
function recorrer(dir) {
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) recorrer(ruta);
    else if (/\.(tsx?|mjs)$/.test(nombre)) {
      const texto = readFileSync(ruta, 'utf8');
      const nuevo = texto.replace(/^export const dynamic = ['"]force-dynamic['"];?\s*$/gm, '');
      if (nuevo !== texto) writeFileSync(ruta, nuevo);
    }
  }
}
recorrer(join(TMP, 'src'));

paso(`Construyendo versión estática (ruta base: "${RUTA_BASE || '/'}")`);
const r = spawnSync('npx', ['next', 'build'], {
  cwd: TMP,
  stdio: 'inherit',
  env: { ...process.env, ESTATICO: '1', RUTA_BASE, NEXT_TELEMETRY_DISABLED: '1' },
});
if (r.status !== 0) {
  console.error('\n✖ La construcción estática falló.');
  process.exit(r.status ?? 1);
}

paso('Copiando resultado a ./out');
rmSync(SALIDA, { recursive: true, force: true });
cpSync(join(TMP, 'out'), SALIDA, { recursive: true });
if (!existsSync(join(SALIDA, 'index.html'))) {
  console.error('✖ No se generó index.html');
  process.exit(1);
}
// GitHub Pages: evita que Jekyll ignore las carpetas que empiezan por «_» (como _next)
writeFileSync(join(SALIDA, '.nojekyll'), '');
console.log('\n✔ Listo: versión estática en ./out');
