/**
 * scripts/dev-smtp-server.ts — Buzón de mentira para ver el correo en local.
 *
 *   npx tsx scripts/dev-smtp-server.ts            # escucha en 127.0.0.1:2525
 *   npx tsx scripts/dev-smtp-server.ts 2626       # otro puerto
 *
 * Imprime por pantalla cada correo que recibe y lo guarda en `logs/mail-out/`
 * como un fichero `.eml` (se abre con cualquier cliente de correo). Sirve para
 * comprobar el flujo completo —alta, verificación, avisos— sin configurar un
 * buzón real todavía:
 *
 *   SMTP_HOST=127.0.0.1  SMTP_PORT=2525  SMTP_TLS=false  MAIL_FROM="Pruebas <no-reply@local>"
 *
 * Si lo que quieres es el correo de verdad, pon el SMTP de tu buzón
 * (Gmail, Zoho, tu hosting…) en .env.local y listo.
 */
import fs from 'node:fs';
import path from 'node:path';
import { FakeSmtp } from './lib/fake-smtp';

const port = Number(process.argv[2] ?? process.env.DEV_SMTP_PORT ?? 2525);
const outDir = path.join(process.cwd(), 'logs', 'mail-out');
fs.mkdirSync(outDir, { recursive: true });

const server = new FakeSmtp({ port, offerStartTls: false });

server.listen().then(() => {
  console.log(`\n📬 Buzón de pruebas escuchando en 127.0.0.1:${port} (SMTP_TLS=false)`);
  console.log(`   Los correos se guardan en ${path.relative(process.cwd(), outDir)}/\n`);
});

// FakeSmtp apunta cada conexión; este vigilante va volcando lo que llega
let seen = 0;
setInterval(() => {
  const captures = server.captures;
  for (const cap of captures.slice(seen)) {
    if (!cap.data) continue;
    seen++;
    const subjectLine = /^Subject: (.*)$/m.exec(cap.data)?.[1] ?? '(sin asunto)';
    const file = path.join(outDir, `${Date.now()}-${seen}.eml`);
    fs.writeFileSync(file, cap.data.replace(/\n/g, '\r\n'));
    console.log(`📨 Correo recibido de ${cap.from} para ${cap.recipients.join(', ')}`);
    console.log(`   Asunto: ${subjectLine}`);
    console.log(`   Guardado en ${path.relative(process.cwd(), file)}\n`);
  }
}, 500);
