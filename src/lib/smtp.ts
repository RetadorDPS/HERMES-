/**
 * src/lib/smtp.ts — Cliente SMTP mínimo, sin dependencias externas.
 *
 * ¿Por qué a mano? Para que «conectar el correo» sea pegar cuatro variables
 * (host, puerto, usuario y contraseña de tu propio buzón) sin añadir paquetes ni
 * contratar un servicio. Es el transporte que funciona con Gmail, Zoho, tu
 * hosting, Amazon SES, Brevo… cualquiera que hable SMTP.
 *
 * Soporta lo que hace falta de verdad en 2026:
 *   • STARTTLS (puerto 587) e Implicit TLS (puerto 465)
 *   • AUTH PLAIN y AUTH LOGIN
 *   • Mensajes HTML (multipart/alternative con versión en texto)
 *   • Asuntos y nombres con acentos (RFC 2047, codificación Q/B)
 *   • Punto-inicial y CRLF correctos (si no, los filtros antispam te tratan mal)
 *
 * Variables: SMTP_HOST, SMTP_PORT (587), SMTP_USER, SMTP_PASS, SMTP_SECURE
 * (true = 465), SMTP_TLS (false = sin cifrar, sólo redes internas),
 * SMTP_TLS_INSECURE (true = aceptar certificado no verificado: sólo pruebas).
 */
import net from 'node:net';
import tls from 'node:tls';
import crypto from 'node:crypto';

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
  timeoutMs?: number;
}

export interface SmtpResult {
  ok: boolean;
  error?: string;
  /** Traza de la conversación (sin credenciales) para poder depurar. */
  log?: string[];
}

interface Reply {
  code: number;
  lines: string[];
}

/* ───────────────────────────── Conversación ─────────────────────────────── */

class SmtpConnection {
  private buf = '';
  private current: string[] = [];
  private waiters: { resolve: (r: Reply) => void }[] = [];
  private ready: Reply[] = [];
  private lastCode = 0;

  constructor(private socket: net.Socket | tls.TLSSocket) {
    this.attach(socket);
  }

  private attach(socket: net.Socket | tls.TLSSocket) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => this.onData(chunk));
  }

  private onData(chunk: string) {
    this.buf += chunk;
    for (;;) {
      const m = /\r?\n/.exec(this.buf);
      if (!m) break;
      const line = this.buf.slice(0, m.index);
      this.buf = this.buf.slice(m.index + m[0].length);
      this.current.push(line);
      const mm = /^(\d{3})([ -])/.exec(line);
      if (!mm || mm[2] === ' ') {
        // «250 texto» (o una línea sin código) cierra la respuesta
        const code = mm ? Number(mm[1]) : this.lastCode;
        this.lastCode = code;
        const reply: Reply = { code, lines: this.current.slice() };
        this.current = [];
        const waiter = this.waiters.shift();
        waiter ? waiter.resolve(reply) : this.ready.push(reply);
      }
    }
  }

  read(timeoutMs: number): Promise<Reply> {
    const pending = this.ready.shift();
    if (pending) return Promise.resolve(pending);
    return new Promise<Reply>((resolve, reject) => {
      const timer = setTimeout(() => {
        const i = this.waiters.findIndex((w) => w.resolve === resolve);
        if (i >= 0) this.waiters.splice(i, 1);
        reject(new Error('SMTP: el servidor no ha respondido a tiempo'));
      }, timeoutMs);
      this.waiters.push({
        resolve: (r) => {
          clearTimeout(timer);
          resolve(r);
        },
      });
    });
  }

  async command(line: string, timeoutMs: number, expect: number[] = [250]): Promise<Reply> {
    this.socket.write(`${line}\r\n`);
    const reply = await this.read(timeoutMs);
    if (!expect.includes(reply.code)) {
      throw new Error(`SMTP: ${line.split(' ')[0]} → ${reply.code} ${reply.lines[reply.lines.length - 1] ?? ''}`);
    }
    return reply;
  }

  /** Cambia a TLS sobre la misma conexión (STARTTLS). */
  async upgrade(host: string, insecure: boolean, timeoutMs: number) {
    const socket = this.socket as net.Socket;
    socket.removeAllListeners('data');
    const secure = tls.connect({ socket, servername: /^\d{1,3}(\.\d{1,3}){3}$/.test(host) ? undefined : host, rejectUnauthorized: !insecure });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('SMTP: TLS no ha respondido a tiempo')), timeoutMs);
      secure.once('secureConnect', () => {
        clearTimeout(timer);
        resolve();
      });
      secure.once('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
    this.socket = secure;
    this.buf = '';
    this.current = [];
    this.attach(secure);
  }

  write(data: string) {
    this.socket.write(data);
  }

  close() {
    try {
      this.socket.end();
    } catch {
      /* la conexión ya estaba cerrada */
    }
  }
}

/* ─────────────────────────────── Utilidades ─────────────────────────────── */

/** Codifica cabeceras con acentos según RFC 2047 (B-encoding). */
export function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7E]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

/** Separa «Nombre <correo@dominio>» en sus partes. */
export function parseFrom(from: string): { name: string | null; address: string } {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from);
  if (m) return { name: m[1] || null, address: m[2] };
  return { name: null, address: from.trim() };
}

/** Bloque de datos del mensaje, con las cabeceras y el escapado que exige el protocolo. */
export function buildMessage(opts: { from: string; to: string; subject: string; html: string; text?: string }): string {
  const from = parseFrom(opts.from);
  const fromHeader = from.name ? `${encodeHeader(from.name)} <${from.address}>` : from.address;
  const messageId = `<${crypto.randomUUID()}@${from.address.split('@')[1] ?? 'dropshippilot'}>`;
  const plain = opts.text ?? opts.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const boundary = `dp-${crypto.randomBytes(8).toString('hex')}`;

  const headers = [
    `From: ${fromHeader}`,
    `To: ${opts.to}`,
    `Subject: ${encodeHeader(opts.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${messageId}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];

  const body = [
    'This is a message in MIME format.',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    plain,
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    opts.html,
    `--${boundary}--`,
    '',
  ].join('\r\n');

  // Punto inicial → doble punto (si no, el servidor corta el mensaje ahí)
  const stuffed = body.replace(/^\./gm, '..');
  return `${headers.join('\r\n')}\r\n\r\n${stuffed}`;
}

/* ──────────────────────────────── Envío ─────────────────────────────────── */

export async function smtpSend(
  config: SmtpConfig,
  message: { from: string; to: string; subject: string; html: string; text?: string },
): Promise<SmtpResult> {
  const timeout = config.timeoutMs ?? 15_000;
  const log: string[] = [];
  const insecure = process.env.SMTP_TLS_INSECURE === 'true';
  // `servername` sólo admite nombres (RFC 6066), no direcciones IP
  const serverName = /^\d{1,3}(\.\d{1,3}){3}$/.test(config.host) ? undefined : config.host;
  const tlsAllowed = process.env.SMTP_TLS !== 'false';
  let conn: SmtpConnection | null = null;

  try {
    const socket = config.secure
      ? tls.connect({ host: config.host, port: config.port, servername: serverName, rejectUnauthorized: !insecure })
      : net.connect({ host: config.host, port: config.port });
    socket.setTimeout(timeout);
    await new Promise<void>((resolve, reject) => {
      const onReady = () => {
        socket.removeListener('error', onError);
        resolve();
      };
      const onError = (err: Error) => {
        socket.removeListener('connect', onReady);
        reject(err);
      };
      config.secure ? socket.once('secureConnect', onReady) : socket.once('connect', onReady);
      socket.once('error', onError);
    });

    conn = new SmtpConnection(socket as net.Socket);

    const greeting = await conn.read(timeout);
    log.push(`S: ${greeting.lines.join(' / ')}`);
    if (greeting.code !== 220) throw new Error(`SMTP: saludo inesperado ${greeting.code}`);

    const ehloHost = parseFrom(config.from).address.split('@')[1] ?? 'localhost';
    let ehlo = await conn.command(`EHLO ${ehloHost}`, timeout);
    log.push(`C: EHLO ${ehloHost} → ${ehlo.code}`);
    let extensions = ehlo.lines.join('\n');

    // STARTTLS: se activa si el servidor lo ofrece y no estamos ya cifrados
    if (!config.secure && tlsAllowed && /STARTTLS/i.test(extensions)) {
      await conn.command('STARTTLS', timeout, [220]);
      await conn.upgrade(config.host, insecure, timeout);
      log.push('→ STARTTLS negociado');
      ehlo = await conn.command(`EHLO ${ehloHost}`, timeout);
      extensions = ehlo.lines.join('\n');
    } else if (!config.secure && !tlsAllowed) {
      log.push('→ sin TLS (SMTP_TLS=false)');
    }

    // Autenticación
    if (config.user) {
      const authLine = ehlo.lines.find((l) => /AUTH/i.test(l)) ?? '';
      const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
      if (/PLAIN/i.test(authLine) || !/LOGIN/i.test(authLine)) {
        await conn.command(`AUTH PLAIN ${b64(`\u0000${config.user}\u0000${config.pass ?? ''}`)}`, timeout, [235]);
        log.push('C: AUTH PLAIN → 235');
      } else {
        await conn.command('AUTH LOGIN', timeout, [334]);
        await conn.command(b64(config.user), timeout, [334]);
        await conn.command(b64(config.pass ?? ''), timeout, [235]);
        log.push('C: AUTH LOGIN → 235');
      }
    }

    const from = parseFrom(config.from).address;
    await conn.command(`MAIL FROM:<${from}>`, timeout);
    await conn.command(`RCPT TO:<${message.to.trim()}>`, timeout, [250, 251]);
    await conn.command('DATA', timeout, [354]);
    conn.write(`${buildMessage({ ...message, from: config.from }).replace(/\r?\n/g, '\r\n')}\r\n.\r\n`);
    const stored = await conn.read(timeout);
    if (stored.code !== 250) throw new Error(`SMTP: el servidor rechazó el mensaje (${stored.code})`);
    log.push('S: mensaje aceptado (250)');

    try {
      await conn.command('QUIT', 3000, [221, 250]);
    } catch {
      /* algunos servidores cierran sin responder al QUIT: da igual */
    }

    return { ok: true, log };
  } catch (err) {
    return { ok: false, error: (err as Error).message, log };
  } finally {
    conn?.close();
  }
}
