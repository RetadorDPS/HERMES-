/**
 * workers/env.ts — Carga de variables de entorno para los workers.
 *
 * IMPORTANTE: Next.js carga .env.local automáticamente, pero `tsx`/node NO.
 * Este módulo replica el comportamiento de Next (con la misma precedencia:
 * .env.local gana sobre .env) y debe importarse como PRIMERA línea de
 * cualquier entrypoint de worker.
 */
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

const root = path.resolve(__dirname, '..');
const loaded: string[] = [];

// Next.js: .env.local tiene prioridad sobre .env → se carga primero con override=false
for (const file of ['.env.local', '.env']) {
  const filePath = path.join(root, file);
  if (!fs.existsSync(filePath)) continue;
  const result = dotenv.config({ path: filePath, override: false });
  if (!result.error) loaded.push(file);
}

// .env.[NODE_ENV] y .env.[NODE_ENV].local (igual que Next)
const env = process.env.NODE_ENV ?? 'development';
for (const file of [`.env.${env}.local`, `.env.${env}`]) {
  const filePath = path.join(root, file);
  if (!fs.existsSync(filePath)) continue;
  const result = dotenv.config({ path: filePath, override: false });
  if (!result.error) loaded.push(file);
}

export const envFilesLoaded = loaded;

export function reportEnv() {
  const missing: string[] = [];
  if (!process.env.DATABASE_URL) missing.push('DATABASE_URL');
  if (!process.env.REDIS_URL) missing.push('REDIS_URL');
  const files = loaded.length ? loaded.join(', ') : 'ninguno';
  console.log(`[env] archivos cargados: ${files}`);
  if (missing.length) {
    console.warn(`[env] ⚠️  Variables críticas ausentes: ${missing.join(', ')} — revisa .env.local`);
  }
  return missing;
}
