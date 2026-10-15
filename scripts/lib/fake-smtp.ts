/**
 * scripts/lib/fake-smtp.ts — Servidor SMTP de mentira para pruebas y desarrollo.
 *
 * Acepta cualquier conexión, apunta lo que recibe (autenticación, sobre y
 * mensaje) y opcionalmente ofrece STARTTLS con un certificado que le pases.
 * Sirve para verificar el envío de correo sin depender de un buzón real.
 */
import net from 'node:net';
import tls from 'node:tls';

/** Servidor SMTP mínimo: acepta todo lo que le pida el cliente y lo apunta. */
export interface Captured {
  authUser?: string;
  authPass?: string;
  from?: string;
  recipients: string[];
  data: string;
  usedTls: boolean;
  ehloCount: number;
}

export class FakeSmtp {
  private server: net.Server;
  private tlsCtx: tls.SecureContext | null = null;
  captures: Captured[] = [];
  /** Si es 'reject-auth', responde 535 a cualquier AUTH. */
  mode: 'accept' | 'reject-auth' = 'accept';

  constructor(
    private opts: { port: number; offerStartTls: boolean; key?: string; cert?: string },
  ) {
    if (opts.key && opts.cert) this.tlsCtx = tls.createSecureContext({ key: opts.key, cert: opts.cert });
    this.server = net.createServer((socket) => this.handle(socket));
  }

  listen(): Promise<void> {
    return new Promise((resolve) => this.server.listen(this.opts.port, '127.0.0.1', () => resolve()));
  }

  close(): Promise<void> {
    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  private handle(socket: net.Socket) {
    const cap: Captured = { recipients: [], data: '', usedTls: false, ehloCount: 0 };
    this.captures.push(cap);
    let inData = false;
    let buffer = '';

    const send = (line: string, target: net.Socket = socket) => target.write(`${line}\r\n`);

    const onLine = (line: string, target: net.Socket) => {
      if (inData) {
        if (line === '.') {
          inData = false;
          send('250 2.0.0 Ok: mensaje aceptado', target);
          return;
        }
        cap.data += `${line}\n`;
        return;
      }
      const [verb, ...rest] = line.split(' ');
      const arg = rest.join(' ');
      switch (verb.toUpperCase()) {
        case 'EHLO':
        case 'HELO':
          cap.ehloCount++;
          send('250-fake.smtp.saluda', target);
          if (this.opts.offerStartTls && !cap.usedTls) send('250-STARTTLS', target);
          send('250-AUTH PLAIN LOGIN', target);
          send('250 8BITMIME', target);
          break;
        case 'STARTTLS': {
          send('220 2.0.0 Listo para TLS', target);
          // El socket crudo debe dejar de entregar datos en claro antes de envolverlo
          socket.removeListener('data', rawHandler);
          const secure = new tls.TLSSocket(socket, { isServer: true, secureContext: this.tlsCtx! });
          cap.usedTls = true;
          secure.on('data', (chunk) => onChunk(chunk as Buffer, secure));
          break;
        }
        case 'AUTH': {
          if (this.mode === 'reject-auth') {
            send('535 5.7.8 Credenciales incorrectas', target);
            break;
          }
          const parts = line.split(/\s+/);
          const mechanism = parts[1] ?? '';
          const token = parts[2] ?? '';
          if (/PLAIN/i.test(mechanism)) {
            const decoded = Buffer.from(token ?? '', 'base64').toString('utf8').split('\u0000');
            cap.authUser = decoded[1];
            cap.authPass = decoded[2];
            send('235 2.7.0 Autenticado', target);
          } else {
            // AUTH LOGIN: usuario y contraseña en dos pasos aparte
            send('334 VXNlcm5hbWU6', target);
            cap.authUser = Buffer.from(arg, 'base64').toString('utf8');
          }
          break;
        }
        case 'MAIL':
          cap.from = /<([^>]*)>/.exec(arg)?.[1] ?? arg;
          send('250 2.1.0 Remitente aceptado', target);
          break;
        case 'RCPT':
          cap.recipients.push(/<([^>]*)>/.exec(arg)?.[1] ?? arg);
          send('250 2.1.5 Destinatario aceptado', target);
          break;
        case 'DATA':
          inData = true;
          send('354 Envía el mensaje, termina con <CRLF>.<CRLF>', target);
          break;
        case 'QUIT':
          send('221 2.0.0 Adiós', target);
          target.end();
          break;
        default:
          send('250 2.0.0 Ok', target);
      }
    };

    const onChunk = (chunk: Buffer | string, target: net.Socket) => {
      buffer += chunk.toString('utf8');
      for (;;) {
        const idx = buffer.indexOf('\r\n') >= 0 ? buffer.indexOf('\r\n') : buffer.indexOf('\n');
        if (idx < 0) break;
        const skip = buffer.startsWith('\r\n', idx) ? 2 : 1;
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + skip);
        onLine(line, target);
      }
    };

    // Sin fijar codificación: el socket crudo tiene que poder pasar a TLS tal cual
    const rawHandler = (chunk: Buffer) => onChunk(chunk, socket);
    socket.on('data', rawHandler);
    send('220 fake.smtp.saluda', socket);
  }
}

