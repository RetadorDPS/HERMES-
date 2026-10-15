/**
 * Registro de proveedores soportados: detección de URL, metadatos y helpers de
 * normalización (incluidas las reescrituras a imágenes HD).
 */
import type { SupplierKey } from './types';

export interface SupplierMeta {
  key: SupplierKey;
  name: string;
  color: string;
  domains: RegExp[];
  /** Reescribe una URL de imagen a su versión HD cuando el CDN lo permite */
  toHdImage?: (url: string) => string;
  extractProductId: (url: string) => string | undefined;
  docsUrl?: string;
}

const aliexpressHd = (url: string) =>
  url
    .replace(/_\d+x\d+\.(jpg|jpeg|png|webp)/i, '.$1')
    .replace(/_\d+x\d+q\d+\./i, '.')
    .replace(/\/\d+x\d+\//, '/');

const amzHd = (url: string) => url.replace(/(\._[A-Z0-9_,]+_)\.(jpg|jpeg|png|webp)/i, '.$2').replace(/\._[A-Z0-9_,]+_\./, '.');

export const SUPPLIER_META: Record<SupplierKey, SupplierMeta> = {
  ALIEXPRESS: {
    key: 'ALIEXPRESS',
    name: 'AliExpress',
    color: '#FF4747',
    domains: [/(^|\.)aliexpress\.com$/i, /(^|\.)aliexpress\.us$/i, /(^|\.)aliexpress\.ru$/i],
    toHdImage: aliexpressHd,
    extractProductId: (url) => url.match(/\/item\/(\d+)/)?.[1] ?? url.match(/[?&]productId=(\d+)/)?.[1],
    docsUrl: 'https://openservice.aliexpress.com/doc/doc.htm',
  },
  CJ_DROPSHIPPING: {
    key: 'CJ_DROPSHIPPING',
    name: 'CJ Dropshipping',
    color: '#1E90FF',
    domains: [/(^|\.)cjdropshipping\.com$/i, /(^|\.)cjdropshipping\.cn$/i],
    toHdImage: (url) => url,
    extractProductId: (url) => url.match(/[?&]pid=([A-Z0-9-]+)/i)?.[1] ?? url.match(/product\/([A-Z0-9-]+)/i)?.[1],
    docsUrl: 'https://developers.cjdropshipping.com',
  },
  AMAZON: {
    key: 'AMAZON',
    name: 'Amazon',
    color: '#FF9900',
    domains: [/(^|\.)amazon\.[a-z.]+$/i, /(^|\.)amzn\.to$/i],
    toHdImage: amzHd,
    extractProductId: (url) => url.match(/\/dp\/([A-Z0-9]{10})/i)?.[1] ?? url.match(/ASIN=([A-Z0-9]{10})/i)?.[1],
    docsUrl: 'https://webservices.amazon.com/paapi5/documentation/',
  },
  ALIBABA: {
    key: 'ALIBABA',
    name: 'Alibaba',
    color: '#FF6A00',
    domains: [/(^|\.)alibaba\.com$/i, /(^|\.)1688\.com$/i],
    extractProductId: (url) => url.match(/(\d{10,})/)?.[1],
  },
  TEMU: {
    key: 'TEMU',
    name: 'Temu',
    color: '#FB7701',
    domains: [/(^|\.)temu\.com$/i],
    extractProductId: (url) => url.match(/-g-(\d+)/)?.[1],
  },
  /**
   * Cualquier otra tienda: mayoristas locales, Shopify, WooCommerce, PrestaShop…
   * La extracción la hace el extractor GENÉRICO del microservicio, que lee datos
   * estructurados de la página (Shopify JSON, JSON-LD schema.org, OpenGraph) y,
   * si no los hay, aplica heurísticas. Nunca inventa: lo que no encuentra lo dice.
   */
  OTHER: {
    key: 'OTHER',
    name: 'Otra tienda',
    color: '#94A3B8',
    // Se usa como reserva: cualquier dominio que no sea de los proveedores conocidos
    domains: [/./],
    toHdImage: (url) => url,
    extractProductId: (url) => {
      try {
        const parsed = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
        const last = parsed.pathname.split('/').filter(Boolean).pop() ?? '';
        return (last.replace(/\.[a-z]{2,5}$/i, '') || parsed.hostname).slice(0, 60);
      } catch {
        return undefined;
      }
    },
  },
};

/**
 * Detecta el proveedor por el dominio. Si no es ninguno de los conocidos,
 * devuelve `OTHER` (extractor genérico) en vez de rechazar la URL: cualquier
 * tienda del mundo debe poder importarse.
 */
export function detectSupplier(url: string): SupplierMeta | null {
  let host: string;
  try {
    host = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname;
  } catch {
    return null;
  }
  for (const meta of Object.values(SUPPLIER_META)) {
    if (meta.key === 'OTHER') continue; // reserva: se comprueba al final
    if (meta.domains.some((re) => re.test(host))) return meta;
  }
  return SUPPLIER_META.OTHER;
}

export const SUPPLIER_LABEL: Record<SupplierKey, string> = Object.fromEntries(
  Object.values(SUPPLIER_META).map((m) => [m.key, m.name]),
) as Record<SupplierKey, string>;

export const REQUEST_HEADERS: Record<string, string> = {
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
};

/** Ejemplos que la UI usa como placeholders / enlaces rápidos de demo */
export const SAMPLE_URLS = [
  { label: 'AliExpress · Auriculares TWS', url: 'https://es.aliexpress.com/item/1005006123456789.html' },
  { label: 'AliExpress · Smartwatch AMOLED', url: 'https://es.aliexpress.com/item/1005005987654321.html' },
  { label: 'CJ · Organizador cocina', url: 'https://www.cjdropshipping.com/product/kitchen-organizer-p12345.html' },
  { label: 'Amazon · Lámpara LED', url: 'https://www.amazon.es/dp/B0C9XYZ123' },
];
