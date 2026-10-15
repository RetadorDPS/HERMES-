/**
 * workers/index.ts — Arranque unificado de workers (sync + pedidos + catálogo + copias + acompañamiento).
 *
 * Uso:
 *   npm run worker                         # ambos workers en un proceso
 *   node --experimental-strip-types ...    # alternativa sin tsx
 *   pm2 start workers/index.ts --interpreter tsx --name autods-workers
 *
 * En producción se recomienda un contenedor por worker:
 *   docker run ... npm run worker:sync
 *   docker run ... npm run worker:orders
 *   docker run ... npm run worker:catalog
 */
import './env'; // ← carga .env.local en el proceso padre y en los hijos
import { spawn } from 'node:child_process';
import path from 'node:path';

const children: ReturnType<typeof spawn>[] = [];

function run(script: string, name: string) {
  const child = spawn(process.execPath, ['--import', 'tsx', path.join(__dirname, script)], {
    stdio: 'inherit',
    env: process.env,
  });
  child.on('exit', (code) => {
    console.error(`[workers] ${name} terminó con código ${code}`);
    if (code !== 0) process.exitCode = code ?? 1;
  });
  children.push(child);
  console.log(`[workers] ${name} arrancado (pid ${child.pid})`);
  return child;
}

console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║  DropshipPilot · Workers 24/7 (BullMQ + Redis)           ║');
console.log('╚══════════════════════════════════════════════════════════╝');
if (!process.env.REDIS_URL) {
  console.warn('⚠️  REDIS_URL no definida: los workers necesitan Redis para funcionar (docker compose up -d redis)');
}
if (!process.env.DATABASE_URL) {
  console.warn('⚠️  DATABASE_URL no definida: los workers escriben en PostgreSQL (docker compose up -d db)');
}
console.log(`[workers] DATABASE_URL=${process.env.DATABASE_URL ? 'configurada' : 'AUSENTE'} · REDIS_URL=${process.env.REDIS_URL ? 'configurada' : 'AUSENTE'}`);

run('syncWorker.ts', 'sync-worker');
run('orderWorker.ts', 'order-worker');
run('catalogWorker.ts', 'catalog-worker');
// Copias de seguridad: un fallo del servidor no puede llevarse los datos por delante
run('backupWorker.ts', 'backup-worker');
run('onboardingWorker.ts', 'onboarding-worker');

const shutdown = (signal: string) => {
  console.log(`[workers] ${signal} recibido: deteniendo hijos...`);
  children.forEach((c) => c.kill('SIGTERM'));
  setTimeout(() => process.exit(0), 3_000);
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
