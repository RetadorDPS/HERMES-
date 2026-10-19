/**
 * Lectura de enlaces de productos de proveedor (CJ Dropshipping y AliExpress).
 * Archivo SIN dependencias: se importa tal cual desde la app (Next) y desde las funciones del servidor (Deno).
 *
 * Solo se aceptan direcciones de los dominios oficiales de cada proveedor. Nunca se sigue una dirección
 * que no haya pasado antes por `hostPermitido`.
 */

export type ProveedorEnlace = 'CJ_DROPSHIPPING' | 'ALIEXPRESS';

export type ResultadoEnlace =
  | { ok: true; proveedor: ProveedorEnlace; pid: string; enlaceLimpio: string }
  | { ok: false; motivo: 'vacio' | 'no_es_enlace' | 'proveedor_no_admitido' | 'sin_producto' | 'enlace_corto'; mensaje: string; enlaceCorto?: string };

const LONGITUD_MAXIMA = 2000;
const PID_CJ = /^[0-9A-Za-z][0-9A-Za-z-]{6,62}$/;
const PID_ALI = /^\d{8,20}$/;

const HOST_CJ = /(^|\.)cjdropshipping\.com$/i;
const HOST_ALI = /(^|\.)aliexpress\.(com|us)$/i;
/** Dominios que solo sirven para enlaces cortos de AliExpress (el aviso «compartir» de su app). */
const HOST_ALI_CORTO = /^(a|s\.click)\.aliexpress\.com$/i;
const HOSTS_CONOCIDOS_NO_ADMITIDOS = /(^|\.)(alibaba\.com|1688\.com|amazon\.[a-z.]+|temu\.com|shein\.com|ebay\.[a-z.]+|banggood\.com|dhgate\.com|walmart\.com)$/i;

/** ¿Es un dominio oficial de AliExpress? (para validar cada salto al resolver un enlace corto) */
export function hostPermitidoAli(host: string): boolean {
  return HOST_ALI.test(host);
}
export function hostEsEnlaceCortoAli(host: string): boolean {
  return HOST_ALI_CORTO.test(host);
}

/** Saca la primera dirección web de un texto pegado (acepta «mira esto https://… ¡oferta!» y direcciones sin https). */
export function extraerDireccion(texto: string): string | null {
  const t = String(texto ?? '').trim();
  if (!t) return null;
  const conEsquema = t.match(/https?:\/\/[^\s<>"'“”]+/i);
  if (conEsquema) return conEsquema[0].replace(/[.,;:)\]]+$/, '');
  const sinEsquema = t.match(/(?:^|\s)((?:[a-z0-9-]+\.)+[a-z]{2,}\/[^\s<>"'“”]*)/i);
  return sinEsquema ? `https://${sinEsquema[1].replace(/[.,;:)\]]+$/, '')}` : null;
}

function leerUrl(direccion: string): URL | null {
  if (direccion.length > LONGITUD_MAXIMA) return null;
  try {
    const u = new URL(direccion);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (u.username || u.password) return null; // nada de usuario:clave@
    if (u.port && u.port !== '80' && u.port !== '443') return null;
    return u;
  } catch {
    return null;
  }
}

function pidDeCj(u: URL): string | null {
  const base = u.pathname.replace(/\.html?$/i, '');
  const i = base.lastIndexOf('-p-');
  if (i >= 0) {
    const candidato = base.slice(i + 3);
    if (PID_CJ.test(candidato)) return candidato;
  }
  // Enlaces de la app de CJ: …/product-detail.html?id=<pid> (o ?pid=)
  if (/product/i.test(u.pathname)) {
    for (const k of ['pid', 'id', 'productId']) {
      const v = u.searchParams.get(k);
      if (v && PID_CJ.test(v)) return v;
    }
  }
  return null;
}

function pidDeAli(u: URL): string | null {
  const m = u.pathname.match(/\/(?:item|i)\/(?:[^/]+\/)?(\d{8,20})(?:\.html?)?\/?$/i);
  if (m && PID_ALI.test(m[1])) return m[1];
  for (const k of ['productIds', 'productId', 'x_object_id', 'itemId']) {
    const v = u.searchParams.get(k)?.split(',')[0];
    if (v && PID_ALI.test(v)) return v;
  }
  return null;
}

/** Analiza lo que el usuario pegó. Devuelve el proveedor y el identificador del producto, o un motivo claro en español. */
export function analizarEnlace(texto: string): ResultadoEnlace {
  if (!String(texto ?? '').trim()) return { ok: false, motivo: 'vacio', mensaje: 'Pega el enlace de un producto de CJ Dropshipping o de AliExpress.' };
  const direccion = extraerDireccion(texto);
  const u = direccion ? leerUrl(direccion) : null;
  if (!u) return { ok: false, motivo: 'no_es_enlace', mensaje: 'Eso no parece un enlace web. Copia la dirección completa del producto desde la barra del navegador.' };

  const host = u.hostname.toLowerCase();

  if (HOST_ALI_CORTO.test(host)) {
    return { ok: false, motivo: 'enlace_corto', enlaceCorto: u.toString(), mensaje: 'Es un enlace corto de AliExpress.' };
  }
  if (HOST_ALI.test(host)) {
    const pid = pidDeAli(u);
    if (!pid) return { ok: false, motivo: 'sin_producto', mensaje: 'Ese enlace de AliExpress no es de un producto. Abre el producto y copia su dirección (termina en «…/item/1005….html»).' };
    return { ok: true, proveedor: 'ALIEXPRESS', pid, enlaceLimpio: `https://www.aliexpress.com/item/${pid}.html` };
  }
  if (HOST_CJ.test(host)) {
    const pid = pidDeCj(u);
    if (!pid) return { ok: false, motivo: 'sin_producto', mensaje: 'Ese enlace de CJ Dropshipping no es de un producto. Abre el producto y copia su dirección (contiene «-p-» y termina en «.html»).' };
    return { ok: true, proveedor: 'CJ_DROPSHIPPING', pid, enlaceLimpio: `https://cjdropshipping.com/product/-p-${pid}.html` };
  }
  if (HOSTS_CONOCIDOS_NO_ADMITIDOS.test(host)) {
    return { ok: false, motivo: 'proveedor_no_admitido', mensaje: 'Por ahora solo se admiten enlaces de CJ Dropshipping y de AliExpress.' };
  }
  return { ok: false, motivo: 'proveedor_no_admitido', mensaje: 'Ese enlace no es de CJ Dropshipping ni de AliExpress. Por ahora solo se admiten esos dos proveedores.' };
}
