/**
 * src/lib/backup.ts — Copias de seguridad de la base de datos.
 *
 * Una copia que nunca se ha restaurado no es una copia: es una esperanza. Por eso
 * aquí no sólo se vuelca la base de datos, también se **comprueba** que el fichero
 * es un volcado sano (gzip íntegro, tablas clave presentes y filas) y, si se pide,
 * se **restaura en una base temporal** para comparar recuentos.
 *
 * Lo usa:
 *   • `scripts/backup.ts`     → a mano: `npm run backup [--verify]`
 *   • `workers/backupWorker.ts` → solo, todos los días a la hora configurada
 *
 * Ajustes por entorno:
 *   BACKUP_DIR="backups"          carpeta de destino
 *   BACKUP_KEEP_DAYS=14           se borran las copias más antiguas
 *   BACKUP_MIN_KEEP=3             …pero nunca menos de estas (red de seguridad)
 *   BACKUP_HOUR=4                 hora del día (0-23) en que las hace el worker
 *   BACKUP_VERIFY=true            restaurar la copia en una base temporal tras crearla
 *   BACKUP_ENABLED=false          desactivar las copias automáticas
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

export interface BackupOptions {
  /** Motivo que queda en el registro (p. ej. 'diaria', 'manual') */
  reason?: string;
  /** Restaurar en una base temporal y comparar recuentos (más lento) */
  verify?: boolean;
}

export interface BackupResult {
  ok: boolean;
  file?: string;
  bytes?: number;
  durationMs: number;
  /** Copias que se han borrado por antigüedad */
  pruned: string[];
  /** Resultado de la comprobación de restauración, si se pidió */
  verification?: { ok: boolean; detail: string };
  /** Avisos (por ejemplo: no hay pg_dump en esta máquina) */
  warnings: string[];
  error?: string;
}

const dir = () => path.resolve(process.cwd(), process.env.BACKUP_DIR ?? 'backups');
const keepDays = () => Number(process.env.BACKUP_KEEP_DAYS ?? 14);
const minKeep = () => Number(process.env.BACKUP_MIN_KEEP ?? 3);

/** Tablas que siempre deben aparecer en un volcado sano. */
const KEY_TABLES = ['User', 'Store', 'Product', 'ProductVariant', 'Order', 'SyncLog', 'AuditLog'];

function run(
  cmd: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  opts: { stdoutTo?: NodeJS.WritableStream; capture?: boolean; timeoutMs?: number } = {},
): Promise<{ code: number; stderr: string; stdout: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { env, stdio: ['ignore', opts.stdoutTo || opts.capture ? 'pipe' : 'ignore', 'pipe'] });
    let stderr = '';
    let stdout = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      resolve({ code: 124, stderr: `${cmd}: ha tardado demasiado (tiempo agotado)`, stdout });
    }, opts.timeoutMs ?? 10 * 60_000);

    if (opts.stdoutTo && child.stdout) child.stdout.pipe(opts.stdoutTo);
    else child.stdout?.on('data', (chunk) => (stdout += chunk.toString()));
    child.stderr?.on('data', (chunk) => (stderr += chunk.toString()));
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: 127, stderr: `${cmd}: ${err.message}`, stdout });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: code ?? 1, stderr: stderr.trim(), stdout: stdout.trim() });
    });
  });
}

/** Datos de conexión, a partir de DATABASE_URL (o de las variables PG* si existen). */
export function pgConfig() {
  const url = process.env.DATABASE_URL;
  if (url && /^postgres/.test(url)) {
    const u = new URL(url);
    return {
      host: process.env.PGHOST ?? u.hostname,
      port: process.env.PGPORT ?? u.port ?? '5432',
      user: process.env.PGUSER ?? decodeURIComponent(u.username),
      password: process.env.PGPASSWORD ?? decodeURIComponent(u.password),
      database: process.env.PGDATABASE ?? u.pathname.replace(/^\//, ''),
    };
  }
  return {
    host: process.env.PGHOST ?? 'localhost',
    port: process.env.PGPORT ?? '5432',
    user: process.env.PGUSER ?? 'postgres',
    password: process.env.PGPASSWORD ?? '',
    database: process.env.PGDATABASE ?? 'autods',
  };
}

const pgEnv = () => {
  const c = pgConfig();
  return { ...process.env, PGHOST: c.host, PGPORT: c.port, PGUSER: c.user, PGPASSWORD: c.password, PGDATABASE: c.database };
};

/** ¿Hay `pg_dump` disponible? En contenedores mínimos puede no estarlo. */
export async function pgToolsAvailable(): Promise<boolean> {
  const res = await run('pg_dump', ['--version'], process.env, { timeoutMs: 10_000 });
  return res.code === 0;
}

function stamp(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Copias existentes, de la más nueva a la más antigua. */
export function listBackups(): { file: string; sizeBytes: number; createdAt: Date }[] {
  const base = dir();
  if (!fs.existsSync(base)) return [];
  return fs
    .readdirSync(base)
    .filter((f) => /^autods-.*\.sql\.gz$/.test(f))
    .map((f) => {
      const full = path.join(base, f);
      const stat = fs.statSync(full);
      return { file: full, sizeBytes: stat.size, createdAt: stat.mtime };
    })
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/**
 * Borra las copias más antiguas que la retención configurada, respetando siempre
 * las `BACKUP_MIN_KEEP` últimas (nunca se queda sin copias por un reloj raro).
 */
export function pruneBackups(): string[] {
  const all = listBackups();
  const cutoff = Date.now() - keepDays() * 24 * 3600_000;
  const removable = all.filter((b) => b.createdAt.getTime() < cutoff);
  const deletable = removable.slice(0, Math.max(0, all.length - minKeep()));
  for (const b of deletable) {
    try {
      fs.unlinkSync(b.file);
    } catch {
      /* si no se puede borrar, se queda: no es un motivo para fallar la copia */
    }
  }
  return deletable.map((b) => path.basename(b.file));
}

/** Comprobación barata: el gzip tiene que abrirse y contener las tablas clave. */
export function inspectDump(file: string): { ok: boolean; detail: string } {
  try {
    const gz = fs.readFileSync(file);
    const sql = zlib.gunzipSync(gz).toString('utf8');
    const missing = KEY_TABLES.filter((t) => !sql.includes(`"${t}"`));
    if (sql.length < 1000) return { ok: false, detail: 'el volcado es sospechosamente pequeño' };
    if (missing.length) return { ok: false, detail: `faltan tablas: ${missing.join(', ')}` };
    return { ok: true, detail: `${Math.round(sql.length / 1024)} KB de SQL · ${KEY_TABLES.length} tablas clave presentes` };
  } catch (err) {
    return { ok: false, detail: `el fichero no se puede descomprimir: ${(err as Error).message}` };
  }
}

/** Cuenta filas de las tablas clave, para comparar original y restauración. */
async function tableCounts(env: NodeJS.ProcessEnv, database: string): Promise<Record<string, number>> {
  const sql = `select ${KEY_TABLES.map((t) => `(select count(*) from "${t}") as "${t}"`).join(', ')};`;
  const res = await run('psql', ['-d', database, '-t', '-A', '-F', '|', '-c', sql], { ...env, PGDATABASE: database }, { capture: true, timeoutMs: 60_000 });
  if (res.code !== 0) throw new Error(res.stderr || 'psql falló');
  const values = res.stdout.split('|').map((v) => Number(v.trim()));
  return Object.fromEntries(KEY_TABLES.map((t, i) => [t, values[i] ?? -1]));
}

/** Restaura la copia en una base temporal y compara los recuentos con la real. */
async function verifyRestore(file: string, env: NodeJS.ProcessEnv): Promise<{ ok: boolean; detail: string }> {
  const cfg = pgConfig();
  const scratch = `${cfg.database}_verificacion`;
  const admin = { ...env, PGDATABASE: 'postgres' };

  await run('psql', ['-d', 'postgres', '-c', `drop database if exists "${scratch}";`], admin, { timeoutMs: 60_000 });
  const created = await run('psql', ['-d', 'postgres', '-c', `create database "${scratch}";`], admin, { timeoutMs: 60_000 });
  if (created.code !== 0) return { ok: false, detail: `no se ha podido crear la base temporal: ${created.stderr.slice(0, 120)}` };

  try {
    // gunzip → psql (sin ficheros intermedios)
    const sql = zlib.gunzipSync(fs.readFileSync(file));
    const restored = await new Promise<{ code: number; stderr: string }>((resolve) => {
      const child = spawn('psql', ['-d', scratch, '-q', '--set', 'ON_ERROR_STOP=0'], { env: { ...env, PGDATABASE: scratch }, stdio: ['pipe', 'ignore', 'pipe'] });
      let stderr = '';
      child.stderr.on('data', (c) => (stderr += c.toString()));
      child.on('error', (err) => resolve({ code: 127, stderr: err.message }));
      child.on('close', (code) => resolve({ code: code ?? 1, stderr: stderr.trim() }));
      child.stdin.end(sql);
    });
    if (restored.code !== 0) return { ok: false, detail: `la restauración terminó con código ${restored.code}: ${restored.stderr.slice(0, 160)}` };

    const [original, copy] = await Promise.all([tableCounts(env, cfg.database), tableCounts(env, scratch)]);
    const diffs = KEY_TABLES.filter((t) => original[t] !== copy[t]);
    if (diffs.length) {
      return { ok: false, detail: diffs.map((t) => `${t}: ${original[t]} → ${copy[t]}`).join(' · ') };
    }
    return { ok: true, detail: `restaurada y comparada: ${KEY_TABLES.map((t) => `${t} ${copy[t]}`).join(' · ')}` };
  } finally {
    await run('psql', ['-d', 'postgres', '-c', `drop database if exists "${scratch}";`], admin, { timeoutMs: 60_000 });
  }
}

/**
 * Hace la copia completa. Nunca lanza: devuelve `{ ok: false, error }` para que el
 * worker pueda registrarlo y seguir vivo.
 */
export async function runBackup(options: BackupOptions = {}): Promise<BackupResult> {
  const started = Date.now();
  const warnings: string[] = [];
  const base = dir();
  fs.mkdirSync(base, { recursive: true });

  if (!(await pgToolsAvailable())) {
    return {
      ok: false,
      durationMs: Date.now() - started,
      pruned: [],
      warnings,
      error: 'No hay `pg_dump` en esta máquina: instala el cliente de PostgreSQL (`apt-get install postgresql-client`) o usa el servicio `backup` del docker-compose.',
    };
  }

  const file = path.join(base, `autods-${stamp()}.sql.gz`);
  const out = fs.createWriteStream(file);
  // El volcado se comprime al vuelo (pg_dump → gzip → fichero): sin ficheros
  // temporales, y una base de datos de 100 MB ocupa unos pocos MB en disco.
  const gzip = zlib.createGzip({ level: 6 });
  gzip.pipe(out);
  const env = pgEnv();
  const dump = await run('pg_dump', ['--no-owner', '--no-privileges', '--clean', '--if-exists', pgConfig().database], env, { stdoutTo: gzip });
  await new Promise<void>((resolve) => gzip.end(() => out.end(resolve)));

  if (dump.code !== 0) {
    fs.rmSync(file, { force: true });
    return { ok: false, durationMs: Date.now() - started, pruned: [], warnings, error: `pg_dump falló: ${dump.stderr.slice(0, 200)}` };
  }

  const bytes = fs.statSync(file).size;
  const inspection = inspectDump(file);
  if (!inspection.ok) {
    // Un volcado ilegible se conserva por si acaso, pero se avisa claro.
    warnings.push(`La copia no pasa la comprobación: ${inspection.detail}`);
  }

  const verification = options.verify ? await verifyRestore(file, env) : undefined;
  const pruned = pruneBackups();

  return {
    ok: inspection.ok && (verification?.ok ?? true),
    file,
    bytes,
    durationMs: Date.now() - started,
    pruned,
    verification,
    warnings,
  };
}

/** Resumen para la interfaz y las comprobaciones. */
export function backupStatus() {
  const all = listBackups();
  const newest = all[0];
  return {
    dir: dir(),
    keepDays: keepDays(),
    minKeep: minKeep(),
    count: all.length,
    totalBytes: all.reduce((a, b) => a + b.sizeBytes, 0),
    newest: newest ? { file: path.basename(newest.file), sizeBytes: newest.sizeBytes, createdAt: newest.createdAt, inspect: inspectDump(newest.file) } : null,
    oldest: all.length ? { file: path.basename(all[all.length - 1].file), createdAt: all[all.length - 1].createdAt } : null,
    schedule: { hour: Number(process.env.BACKUP_HOUR ?? 4), enabled: process.env.BACKUP_ENABLED !== 'false', verify: process.env.BACKUP_VERIFY === 'true' },
  };
}
