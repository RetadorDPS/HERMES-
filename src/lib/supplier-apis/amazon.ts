/**
 * src/lib/supplier-apis/amazon.ts — Amazon Product Advertising API 5.0 (PA-API).
 *
 * Permite leer fichas de producto (título, imágenes HD, precio, disponibilidad)
 * de forma legítima. Requiere una cuenta de afiliado Amazon con ventas (Amazon
 * exige 3 ventas en 180 días para mantener el acceso).
 *
 * Firma: AWS Signature Version 4 (servicio `ProductAdvertisingAPI`,
 * región `eu-west-1` para Amazon.es). Implementada a mano con `crypto`.
 *
 * Notas de producción:
 *   • PA-API está pensada para leer catálogo; NO permite crear pedidos. Para
 *     comprar en Amazon se usa Amazon Business / SP-API (otra credencial).
 *   • Límite de velocidad: 1 petición/segundo para cuentas nuevas.
 *
 * Documentación: https://webservices.amazon.com/paapi5/documentation/
 */
import crypto from 'crypto';
import type { ConnectionTestResult, CreateOrderResult, SupplierApiClient, SupplierApiContext, SupplierProduct } from './types';
import { SupplierApiError, apiFetch } from './types';

const MARKETPLACES: Record<string, { host: string; region: string }> = {
  es: { host: 'webservices.amazon.es', region: 'eu-west-1' },
  de: { host: 'webservices.amazon.de', region: 'eu-west-1' },
  fr: { host: 'webservices.amazon.fr', region: 'eu-west-1' },
  it: { host: 'webservices.amazon.it', region: 'eu-west-1' },
  us: { host: 'webservices.amazon.com', region: 'us-east-1' },
  uk: { host: 'webservices.amazon.co.uk', region: 'eu-west-1' },
};

const SERVICE = 'ProductAdvertisingAPI';
const TARGET = 'com.amazon.paapi5.v1.ProductAdvertisingAPIv1';

const sha256Hex = (v: string) => crypto.createHash('sha256').update(v, 'utf8').digest('hex');
const hmac = (key: crypto.BinaryLike | crypto.KeyObject, data: string) => crypto.createHmac('sha256', key).update(data, 'utf8').digest();

export class AmazonClient implements SupplierApiClient {
  readonly provider = 'AMAZON' as const;
  readonly docsUrl = 'https://webservices.amazon.com/paapi5/documentation/';
  readonly credentialFields = [
    { key: 'accessKey', label: 'Access Key', hint: 'Amazon Associates → herramientas → PA-API' },
    { key: 'secretKey', label: 'Secret Key', secret: true },
    { key: 'partnerTag', label: 'Partner Tag', hint: 'Tu identificador de afiliado, ej. mitienda-21' },
    { key: 'marketplace', label: 'Marketplace', hint: 'es | de | fr | it | uk | us (por defecto es)' },
  ];

  constructor(private readonly ctx: SupplierApiContext) {}

  private get credentials() {
    return this.ctx.credentials ?? {};
  }

  private marketplace() {
    const key = (this.credentials.marketplace ?? this.ctx.country ?? 'es').toLowerCase().slice(0, 2);
    return MARKETPLACES[key] ?? MARKETPLACES.es;
  }

  private missingFields() {
    const missing: string[] = [];
    if (!this.credentials.accessKey) missing.push('accessKey');
    if (!this.credentials.secretKey) missing.push('secretKey');
    if (!this.credentials.partnerTag) missing.push('partnerTag');
    return missing;
  }

  /** AWS SigV4 con el payload como cuerpo JSON. */
  private async call(operation: string, payload: Record<string, unknown>) {
    const missing = this.missingFields();
    if (missing.length) throw new SupplierApiError(`Faltan credenciales de Amazon: ${missing.join(', ')}`, this.provider, 'MISSING_CREDENTIALS', { missing });

    const { host, region } = this.marketplace();
    const path = `/paapi5/${operation.toLowerCase()}`;
    const body = JSON.stringify({ ...payload, PartnerTag: this.credentials.partnerTag, PartnerType: 'Associates', Marketplace: `www.${host}` });
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ''); // 20261015T120000Z
    const dateStamp = amzDate.slice(0, 8);

    const canonicalHeaders = `content-encoding:amz-1.0\ncontent-type:application/json; charset=utf-8\nhost:${host}\nx-amz-date:${amzDate}\nx-amz-target:${TARGET}.${operation}\n`;
    const signedHeaders = 'content-encoding;content-type;host;x-amz-date;x-amz-target';
    const canonicalRequest = ['POST', path, '', canonicalHeaders, signedHeaders, sha256Hex(body)].join('\n');

    const scope = `${dateStamp}/${region}/${SERVICE}/aws4_request`;
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');

    const kDate = hmac(`AWS4${this.credentials.secretKey}`, dateStamp);
    const kRegion = hmac(kDate, region);
    const kService = hmac(kRegion, SERVICE);
    const kSigning = hmac(kService, 'aws4_request');
    const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

    const authorization =
      `AWS4-HMAC-SHA256 Credential=${this.credentials.accessKey}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const res = await apiFetch(`https://${host}${path}`, {
      method: 'POST',
      headers: {
        'Content-Encoding': 'amz-1.0',
        'Content-Type': 'application/json; charset=utf-8',
        'X-Amz-Date': amzDate,
        'X-Amz-Target': `${TARGET}.${operation}`,
        Authorization: authorization,
      },
      body,
      timeoutMs: this.ctx.timeoutMs ?? 20_000,
    });

    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = json?.Errors?.[0];
      const traducciones: Record<string, string> = {
        TooManyRequests: 'Has superado el límite de llamadas de PA-API (1/segundo)',
        UnrecognizedClient: 'Access Key o Secret Key incorrectos',
        InvalidSignature: 'Firma inválida: revisa la Secret Key o la hora del servidor',
        InvalidParameterValue: 'Algún parámetro no es válido (revisa el Partner Tag y el marketplace)',
        AccessDenied: 'La cuenta no tiene acceso a PA-API (necesita 3 ventas en 180 días)',
      };
      const code = String(err?.Code ?? res.status);
      throw new SupplierApiError(`${err?.Message ?? `Error de Amazon (${res.status})`}${traducciones[code] ? ` — ${traducciones[code]}` : ''}`, this.provider, code, err);
    }
    return json;
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const started = Date.now();
    const missing = this.missingFields();
    if (missing.length) return { ok: false, message: `Faltan credenciales: ${missing.join(', ')}`, missing, docs: this.docsUrl };

    try {
      const res = await this.call('SearchItems', { Keywords: 'wireless earbuds', ItemCount: 1, Resources: ['ItemInfo.Title'] });
      const item = res?.SearchResult?.Items?.[0];
      return {
        ok: true,
        message: 'Credenciales válidas: PA-API responde. Puedes importar fichas de Amazon (lectura de catálogo).',
        latencyMs: Date.now() - started,
        account: { name: this.credentials.partnerTag, currency: 'EUR' },
        docs: this.docsUrl,
        ...(item ? {} : { message: 'Credenciales válidas, pero la búsqueda no devolvió resultados (normal en algunas categorías).' }),
      };
    } catch (err) {
      const e = err as SupplierApiError;
      return { ok: false, message: e.message, latencyMs: Date.now() - started, docs: this.docsUrl };
    }
  }

  async fetchProduct({ productId, url }: { productId?: string; url?: string }): Promise<SupplierProduct> {
    const asin = productId ?? url?.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/)?.[1];
    if (!asin) throw new SupplierApiError('No he podido extraer el ASIN de la URL de Amazon', this.provider, 'BAD_INPUT');

    const res = await this.call('GetItems', {
      ItemIds: [asin],
      Resources: ['ItemInfo.Title', 'ItemInfo.Features', 'ItemInfo.ByLineInfo', 'Images.Primary.Large', 'Images.Variants.Large', 'Offers.Listings.Price', 'Offers.Listings.Availability.Message'],
    });

    const item = res?.ItemsResult?.Items?.[0];
    if (!item) throw new SupplierApiError('Amazon no devolvió datos para ese ASIN', this.provider, 'EMPTY_RESULT', res);

    const listing = item.Offers?.Listings?.[0];
    const images: string[] = [item.Images?.Primary?.Large?.URL, ...(item.Images?.Variants ?? []).map((v: any) => v?.Large?.URL)].filter(Boolean) as string[];

    return {
      provider: this.provider,
      supplierProductId: asin,
      sourceUrl: url ?? `https://www.amazon.es/dp/${asin}`,
      title: String(item.ItemInfo?.Title?.DisplayValue ?? `Amazon ${asin}`),
      description: (item.ItemInfo?.Features?.DisplayValues ?? []).map((f: string) => `<li>${f}</li>`).join(''),
      category: item.ItemInfo?.ByLineInfo?.Brand?.DisplayValue ? `Marca: ${item.ItemInfo.ByLineInfo.Brand.DisplayValue}` : undefined,
      currency: listing?.Price?.Currency ?? 'EUR',
      costPrice: Number(listing?.Price?.Amount ?? 0),
      stock: listing?.Availability?.Message ? 50 : 0,
      images,
      variants: [
        {
          supplierVariantId: asin,
          sku: asin,
          title: String(item.ItemInfo?.Title?.DisplayValue ?? asin),
          costPrice: Number(listing?.Price?.Amount ?? 0),
          stock: listing?.Availability?.Message ? 50 : 0,
        },
      ],
      shipping: { cost: 0, minDays: 2, maxDays: 6, country: this.ctx.country ?? 'ES' },
      source: 'api',
    };
  }

  async createOrder(): Promise<CreateOrderResult> {
    return {
      ok: false,
      error:
        'Amazon PA-API es sólo de lectura: no permite crear pedidos. Para compra automatizada necesitas Amazon Business / SP-API (otra credencial). DropshipPilot puede leer la ficha y enlazar el pedido para compra manual.',
    };
  }
}

export function simulateAmazonProduct(asin: string): SupplierProduct {
  return {
    provider: 'AMAZON',
    supplierProductId: asin,
    sourceUrl: `https://www.amazon.es/dp/${asin}`,
    title: 'Producto de ejemplo (Amazon PA-API · modo demo)',
    description: '<li>Datos de ejemplo: añade tus credenciales de Amazon PA-API para leer fichas reales.</li>',
    currency: 'EUR',
    costPrice: 14.99,
    stock: 40,
    images: [],
    variants: [{ supplierVariantId: asin, sku: asin, title: 'Ejemplo', costPrice: 14.99, stock: 40 }],
    shipping: { cost: 0, minDays: 2, maxDays: 6, country: 'ES' },
    source: 'simulated',
  };
}
