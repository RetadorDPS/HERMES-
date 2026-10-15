/**
 * src/lib/mail.ts — Envío de correo transaccional.
 *
 * Transportes soportados, en orden de preferencia:
 *   1. SMTP propio (SMTP_HOST + SMTP_USER + SMTP_PASS) — **el más útil**: sirve
 *      cualquier buzón que ya tengas (Gmail, Zoho, tu hosting, Amazon SES…) y no
 *      cuesta nada. Implementado en `src/lib/smtp.ts`, sin dependencias.
 *   2. Resend (RESEND_API_KEY + MAIL_FROM) — alternativa gestionada, si prefieres
 *      no usar tu buzón.
 *   3. Relay por webhook (MAIL_WEBHOOK_URL) — para quien ya tenga un servicio
 *      interno de correo.
 *   4. Consola (desarrollo): el correo se registra en el log y, si
 *      MAIL_EXPOSE_LINKS=true, el enlace se devuelve en la respuesta de la API
 *      para poder probar el flujo sin bandeja de entrada.
 *
 * Nunca lanza excepción hacia la capa superior: un fallo de correo no debe
 * impedir registrarse (se registra el error y se avisa al usuario).
 */
export interface MailResult {
  ok: boolean;
  transport: 'smtp' | 'resend' | 'webhook' | 'console';
  previewUrl?: string;
  error?: string;
  /** Traza de la conversación SMTP (sin credenciales), para depurar entregas. */
  log?: string[];
}

export interface MailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

const FROM = () => process.env.MAIL_FROM ?? 'DropshipPilot <no-reply@dropshippilot.local>';

/** ¿Hay algún transporte configurado que llegue a una bandeja real? */
export function mailTransportConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST || process.env.RESEND_API_KEY || process.env.MAIL_WEBHOOK_URL);
}

/** Nombre del transporte activo, para mostrarlo en la interfaz y comprobaciones. */
export function mailTransportName(): 'smtp' | 'resend' | 'webhook' | 'console' {
  if (process.env.SMTP_HOST) return 'smtp';
  if (process.env.RESEND_API_KEY) return 'resend';
  if (process.env.MAIL_WEBHOOK_URL) return 'webhook';
  return 'console';
}

export async function sendMail({ to, subject, html, text }: MailInput): Promise<MailResult> {
  const smtpHost = process.env.SMTP_HOST;
  const resendKey = process.env.RESEND_API_KEY;
  const webhookUrl = process.env.MAIL_WEBHOOK_URL;

  if (smtpHost) {
    const { smtpSend } = await import('./smtp');
    const port = Number(process.env.SMTP_PORT ?? 587);
    const result = await smtpSend(
      {
        host: smtpHost,
        port,
        // 465 = TLS directo; 587 = STARTTLS. Si el operador lo dice, se respeta.
        secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465,
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
        from: FROM(),
      },
      { from: FROM(), to, subject, html, text },
    );
    if (!result.ok) {
      console.error(`[mail] SMTP ${smtpHost}:${port} falló: ${result.error}`);
      return { ok: false, transport: 'smtp', error: result.error, log: result.log };
    }
    return { ok: true, transport: 'smtp', log: result.log };
  }

  if (resendKey) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: FROM(), to: [to], subject, html, text: text ?? html.replace(/<[^>]+>/g, ' ') }),
      });
      if (!res.ok) return { ok: false, transport: 'resend', error: `Resend ${res.status}: ${(await res.text()).slice(0, 200)}` };
      return { ok: true, transport: 'resend' };
    } catch (err) {
      return { ok: false, transport: 'resend', error: (err as Error).message };
    }
  }

  if (webhookUrl) {
    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: FROM(), to, subject, html }),
      });
      return res.ok ? { ok: true, transport: 'webhook' } : { ok: false, transport: 'webhook', error: `HTTP ${res.status}` };
    } catch (err) {
      return { ok: false, transport: 'webhook', error: (err as Error).message };
    }
  }

  // Desarrollo: a la consola
  const link = html.match(/href="(https?:\/\/[^"]+)"/)?.[1];
  console.log(`\n[mail:console] → ${to}\n  Asunto: ${subject}${link ? `\n  Enlace: ${link}` : ''}\n`);
  return { ok: true, transport: 'console', previewUrl: link };
}

/** Plantilla base con la estética del panel */
export function mailLayout(title: string, body: string, cta?: { label: string; url: string }) {
  return `<!doctype html><html><body style="margin:0;background:#0a0b14;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:24px">
      <div style="width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,#6366f1,#22d3ee)"></div>
      <strong style="color:#fff;font-size:16px">DropshipPilot</strong>
    </div>
    <div style="background:#12131f;border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:24px">
      <h1 style="color:#fff;font-size:19px;margin:0 0 12px">${title}</h1>
      <div style="color:#b6bdd1;font-size:14px;line-height:1.6">${body}</div>
      ${
        cta
          ? `<a href="${cta.url}" style="display:inline-block;margin-top:20px;background:linear-gradient(135deg,#6366f1,#22d3ee);color:#050510;
             text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px;font-size:14px">${cta.label}</a>`
          : ''
      }
    </div>
    <p style="color:#5c657f;font-size:12px;margin-top:18px">Si no esperabas este correo, puedes ignorarlo con tranquilidad.</p>
  </div></body></html>`;
}
