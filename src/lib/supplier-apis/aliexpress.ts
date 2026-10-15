/**
 * src/lib/supplier-apis/aliexpress.ts — AliExpress Open Platform (DS API).
 *
 * Esta es la vía LIMPIA para trabajar con AliExpress: datos estructurados,
 * sin captchas ni bloqueos, y con capacidad de crear el pedido en el proveedor
 * (`aliexpress.ds.order.create`). Sustituye al scraping cuando está disponible.
 *
 * Firma: el gateway TOP exige firmar todos los parámetros con HMAC-SHA256
 * (sign_method=sha256) usando el App Secret. Implementada aquí según la
 * documentación oficial.
 *
 * Credenciales necesarias (se guardan cifradas por cliente):
 *   appKey     → App Key de la consola de desarrollador
 *   appSecret  → App Secret
 *   accessToken→ token OAuth (aliexpress.system.oauth.token) para operar en
 *                nombre de la tienda y crear pedidos
 *   apiRegion  → 'sg' (Singapur, por defecto) o 'eu'
 *
 * Documentación: https://openservice.aliexpress.com/doc/doc.htm
 */
import crypto from 'crypto';
import type {
  ConnectionTestResult,
  CreateOrderResult,
  SupplierApiClient,
  SupplierApiContext,
  SupplierOrderAddress,
  SupplierOrderItem,
  SupplierProduct,
} from './types';
import { SupplierApiError, apiFetch } from './types';

const GATEWAYS = {
  sg: 'https://api-sg.aliexpress.com/sync',
  eu: 'https://api-eu.aliexpress.com/sync',
} as const;

function gateway(region?: string) {
  return region === 'eu' ? GATEWAYS.eu : GATEWAYS.sg;
}

/** Firma HMAC-SHA256 del gateway TOP: ordena los parámetros y firma la cadena. */
function sign(params: Record<string, string>, appSecret: string) {
  const base = Object.keys(params)
    .sort()
    .map((key) => `${key}${params[key]}`)
    .join('');
  return crypto.createHmac('sha256', appSecret).update(base, 'utf8').digest('hex').toUpperCase();
}

function timestamp() {
  // Formato exigido por AliExpress: yyyy-MM-dd HH:mm:ss (UTC)
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

export class AliExpressClient implements SupplierApiClient {
  readonly provider = 'ALIEXPRESS' as const;
  readonly docsUrl = 'https://openservice.aliexpress.com/doc/doc.htm';
  readonly credentialFields = [
    { key: 'appKey', label: 'App Key', hint: 'Consola de desarrollador → tu aplicación' },
    { key: 'appSecret', label: 'App Secret', secret: true },
    { key: 'accessToken', label: 'Access Token (OAuth)', hint: 'Necesario para consultar precios reales y crear pedidos', secret: true },
    { key: 'apiRegion', label: 'Región del gateway', hint: 'sg (por defecto) o eu' },
  ];

  constructor(private readonly ctx: SupplierApiContext) {}

  private get credentials() {
    return this.ctx.credentials ?? {};
  }

  private missingFields() {
    const missing: string[] = [];
    if (!this.credentials.appKey) missing.push('appKey');
    if (!this.credentials.appSecret) missing.push('appSecret');
    return missing;
  }

  /** Llama al gateway con firma. Devuelve la respuesta cruda parseada. */
  private async call(method: string, businessParams: Record<string, string | number | undefined> = {}) {
    const missing = this.missingFields();
    if (missing.length) {
      throw new SupplierApiError(`Faltan credenciales de AliExpress: ${missing.join(', ')}`, this.provider, 'MISSING_CREDENTIALS', { missing });
    }

    const params: Record<string, string> = {
      method,
      app_key: this.credentials.appKey,
      timestamp: timestamp(),
      format: 'json',
      v: '2.0',
      sign_method: 'sha256',
      ...Object.fromEntries(Object.entries(businessParams).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)])),
    };
    if (this.credentials.accessToken) params.session = this.credentials.accessToken;
    if (this.credentials.trackingId) params.tracking_id = this.credentials.trackingId;

    params.sign = sign(params, this.credentials.appSecret);

    const res = await apiFetch(gateway(this.credentials.apiRegion), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body: new URLSearchParams(params).toString(),
      timeoutMs: this.ctx.timeoutMs ?? 20_000,
    });

    const text = await res.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      throw new SupplierApiError(`Respuesta no JSON de AliExpress (HTTP ${res.status})`, this.provider, 'BAD_RESPONSE', text.slice(0, 300));
    }

    const error = json?.error_response;
    if (error) {
      const code = error.code ?? 'ERROR';
      const message = error.msg ?? error.sub_msg ?? 'Error de AliExpress';
      const traducciones: Record<string, string> = {
        '15': 'App Key o App Secret incorrectos',
        '16': 'Firma inválida: revisa el App Secret',
        '17': 'El gateway exige HTTPS o la petición expiró (comprueba la hora del servidor)',
        '19': 'Access Token caducado: renueva el OAuth',
        '21': 'Límite de llamadas alcanzado para esta app',
        '1001': 'Parámetro obligatorio ausente',
      };
      throw new SupplierApiError(`${message}${traducciones[String(code)] ? ` — ${traducciones[String(code)]}` : ''}`, this.provider, String(code), error);
    }

    return json;
  }

  /**
   * CATÁLOGO: feed curado de AliExpress (`aliexpress.ds.recommend.feed.get`).
   * Permite navegar por categorías y país, ordenando por ventas, descuento o
   * valoración del vendedor: exactamente lo que necesita un catálogo servido.
   */
  async fetchFeed(params: {
    feedName?: string;
    categoryId?: string;
    page?: number;
    pageSize?: number;
    sort?: 'priceAsc' | 'priceDesc' | 'volumeAsc' | 'volumeDesc' | 'discountAsc' | 'discountDesc' | 'DSRratingAsc' | 'DSRratingDesc';
    country?: string;
  } = {}): Promise<SupplierProduct[]> {
    const res = await this.call('aliexpress.ds.recommend.feed.get', {
      feed_name: params.feedName ?? 'DS bestseller',
      country: params.country ?? this.ctx.country ?? 'ES',
      target_currency: 'EUR',
      target_language: 'ES',
      page_no: params.page ?? 1,
      page_size: Math.min(params.pageSize ?? 50, 50),
      sort: params.sort,
      category_id: params.categoryId,
    });

    const node = res?.aliexpress_ds_recommend_feed_get_response?.result ?? res?.aliexpress_ds_recommend_feed_get_response;
    const list: any[] = node?.products ?? node?.product_list ?? node?.ae_item_list ?? [];
    return (Array.isArray(list) ? list : []).map((item) => this.mapFeedItem(item));
  }

  /** Normaliza un elemento del feed al contrato común. */
  private mapFeedItem(item: any): SupplierProduct {
    const id = String(item.product_id ?? item.productId ?? item.item_id ?? '');
    const image = String(item.product_main_image_url ?? item.productImage ?? '');
    const gallery = String(item.product_small_image_urls ?? item.image_urls ?? '')
      .split(';')
      .map((u) => u.trim())
      .filter(Boolean);
    const cost = Number(item.target_sale_price ?? item.sale_price ?? item.original_price ?? 0);
    const original = Number(item.target_original_price ?? item.original_price ?? 0);
    return {
      provider: this.provider,
      supplierProductId: id,
      sourceUrl: String(item.product_detail_url ?? `https://es.aliexpress.com/item/${id}.html`),
      title: String(item.product_title ?? item.title ?? 'Producto AliExpress'),
      description: String(item.product_detail ?? ''),
      category: item.second_level_category_name ? String(item.second_level_category_name) : item.first_level_category_name ? String(item.first_level_category_name) : undefined,
      currency: 'EUR',
      costPrice: cost,
      stock: Number(item.available_quantity ?? 999),
      images: [image, ...gallery].filter(Boolean),
      variants: [{ supplierVariantId: `${id}-default`, title: 'Único', costPrice: cost, stock: 999, imageUrl: image }],
      shipping: {
        cost: item.shipping_cost ? Number(item.shipping_cost) : 0,
        minDays: Number(item.delivery_time_min ?? 7),
        maxDays: Number(item.delivery_time_max ?? 20),
        country: this.ctx.country ?? 'ES',
      },
      reviews: [],
      rating: item.evaluate_rate ? Number(String(item.evaluate_rate).replace('%', '')) / 20 : undefined,
      orders: item.lastest_volume ? Number(item.lastest_volume) : undefined,
      source: 'api',
    };
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const started = Date.now();
    const missing = this.missingFields();
    if (missing.length) {
      return {
        ok: false,
        message: `Faltan credenciales: ${missing.join(', ')}`,
        missing,
        docs: this.docsUrl,
      };
    }

    try {
      // Consulta ligera que valida appKey/appSecret y, si hay token, la sesión
      const res = await this.call('aliexpress.ds.recommend.feed.get', { feed_name: 'DS bestseller', target_currency: 'EUR', target_language: 'ES', country: 'ES', page_size: 1 });
      const okNode = res?.aliexpress_ds_recommend_feed_get_response;
      return {
        ok: true,
        message: this.credentials.accessToken
          ? 'Credenciales válidas y sesión OAuth activa: puedes consultar productos y crear pedidos.'
          : 'App Key/Secret válidos. Añade el Access Token para consultar precios y crear pedidos.',
        latencyMs: Date.now() - started,
        account: { name: okNode?.resp_result?.resp_code === 200 ? 'AliExpress DS' : undefined, currency: 'EUR' },
        docs: this.docsUrl,
      };
    } catch (err) {
      const e = err as SupplierApiError;
      return { ok: false, message: e.message, latencyMs: Date.now() - started, docs: this.docsUrl };
    }
  }

  async fetchProduct({ productId, url }: { productId?: string; url?: string }): Promise<SupplierProduct> {
    const id = productId ?? url?.match(/item\/(\d+)\.html/)?.[1] ?? url?.match(/[?&]productId=(\d+)/)?.[1];
    if (!id) throw new SupplierApiError('No he podido extraer el id de producto de la URL', this.provider, 'BAD_INPUT');

    const res = await this.call('aliexpress.ds.product.get', {
      product_id: id,
      target_currency: 'EUR',
      target_language: 'ES',
      country: this.ctx.country ?? 'ES',
      ship_to_country: this.ctx.country ?? 'ES',
    });

    const node = res?.aliexpress_ds_product_get_response?.result ?? res?.aliexpress_ds_product_get_response;
    if (!node) throw new SupplierApiError('AliExpress no devolvió datos del producto', this.provider, 'EMPTY_RESULT', res);

    const base = node.ae_item_base_info_dto ?? node;
    const media = node.ae_multimedia_info_dto ?? {};
    const skuInfo = node.ae_item_sku_info_dtos?.ae_item_sku_info_d_t_o ?? node.ae_item_sku_info_dtos ?? [];
    const packages = node.package_info_dto ?? {};
    const images: string[] = String(media.image_urls ?? '').split(';').filter(Boolean);

    const coste = Number(base.original_price ?? skuInfo?.[0]?.sku_price ?? 0);
    const stock = skuInfo.reduce((acc: number, s: any) => acc + Number(s.sku_available_quantity ?? 0), 0) || Number(packages.gross_weight ? 999 : 0);

    return {
      provider: this.provider,
      supplierProductId: String(base.product_id ?? id),
      sourceUrl: url ?? `https://es.aliexpress.com/item/${id}.html`,
      title: String(base.subject ?? 'Producto AliExpress'),
      description: String(node.ae_store_info?.store_name ? `<p>Vendido por ${node.ae_store_info.store_name}</p>` : ''),
      category: base.category_id ? `AliExpress #${base.category_id}` : undefined,
      currency: 'EUR',
      costPrice: coste,
      stock,
      images,
      variants: skuInfo.map((s: any, i: number) => ({
        supplierVariantId: String(s.sku_id ?? `sku-${i}`),
        sku: s.sku_code ? String(s.sku_code) : undefined,
        title: String(s.sku_attr ?? s.sku_props ?? `Variante ${i + 1}`),
        color: s.sku_props?.sku_property_value,
        costPrice: Number(s.sku_price ?? coste),
        stock: Number(s.sku_available_quantity ?? 0),
        imageUrl: images[i],
      })),
      shipping: {
        cost: Number(packages.shipping_fee ?? 0),
        minDays: 7,
        maxDays: 20,
        country: this.ctx.country ?? 'ES',
      },
      rating: node.ae_store_info?.seller_admin_seq ? undefined : undefined,
      source: 'api',
    };
  }

  async quoteShipping({ productId, country, quantity = 1 }: { productId: string; country: string; quantity?: number }) {
    const res = await this.call('aliexpress.ds.freight.query', {
      query_delivery_req: JSON.stringify({ product_id: productId, quantity, ship_to_country: country, city_code: '' }),
    });
    const list =
      res?.aliexpress_ds_freight_query_response?.result?.delivery_options?.delivery_option_d_t_o ??
      res?.aliexpress_ds_freight_query_response?.result?.delivery_options ??
      [];
    const options = (Array.isArray(list) ? list : [list]).filter(Boolean).map((o: any) => ({
      name: String(o.service_name ?? o.company ?? 'Envío'),
      cost: Number(o.freight_amount?.amount ?? o.estimated_freight_amount ?? 0),
      minDays: Number(o.delivery_time_min ?? 10),
      maxDays: Number(o.delivery_time_max ?? 25),
    }));
    const best = options.sort((a, b) => a.cost - b.cost)[0];
    return {
      cost: best?.cost ?? 0,
      minDays: best?.minDays ?? 10,
      maxDays: best?.maxDays ?? 25,
      country,
      methods: options,
    };
  }

  async createOrder({ items, address, reference }: { items: SupplierOrderItem[]; address: SupplierOrderAddress; reference?: string }): Promise<CreateOrderResult> {
    if (!this.credentials.accessToken) {
      return { ok: false, error: 'Para crear pedidos necesitas el Access Token OAuth de AliExpress (aliexpress.ds.order.create)' };
    }

    try {
      const res = await this.call('aliexpress.ds.order.create', {
        param_place_order_request4_open_api_d_t_o: JSON.stringify({
          logistics_address: {
            address: [address.address1, address.address2].filter(Boolean).join(' '),
            city: address.city,
            contact_person: address.name,
            country: address.country,
            full_name: address.name,
            mobile_no: address.phone ?? '000000000',
            phone_country: address.country,
            zip: address.zip ?? '',
            locale: 'es_ES',
            province: address.province ?? '',
          },
          product_items: items.map((i) => ({
            product_id: i.supplierProductId,
            product_count: i.quantity,
            sku_attr: i.supplierVariantId ?? '',
            logistics_service_name: 'CAINIAO_FULFILLMENT_STD',
          })),
        }),
      });

      const result = res?.aliexpress_ds_order_create_response?.result;
      if (!result?.order_list?.number?.[0]) {
        return { ok: false, error: 'AliExpress no confirmó el pedido: ' + JSON.stringify(res).slice(0, 300) };
      }
      return {
        ok: true,
        supplierOrderId: String(result.order_list.number[0]),
        status: 'ACCEPTED',
        cost: Number(result.order_list.total_amount?.amount ?? 0),
        error: result.is_success === false ? 'Marcado como fallido por AliExpress' : undefined,
      };
    } catch (err) {
      return { ok: false, error: (err as SupplierApiError).message };
    }
  }
}

/** Datos de ejemplo etiquetados (modo demo, sin credenciales reales) */
export function simulateAliExpressProduct(id: string): SupplierProduct {
  return {
    provider: 'ALIEXPRESS',
    supplierProductId: id,
    sourceUrl: `https://es.aliexpress.com/item/${id}.html`,
    title: 'Producto de ejemplo (AliExpress DS · modo demo)',
    description: '<p>Datos generados en modo demo: añade tus credenciales de AliExpress Open Platform para obtener datos reales.</p>',
    currency: 'EUR',
    costPrice: 9.9,
    stock: 850,
    images: [],
    variants: [
      { supplierVariantId: 'demo-1', sku: 'DEMO-1', title: 'Ejemplo A', costPrice: 9.9, stock: 400 },
      { supplierVariantId: 'demo-2', sku: 'DEMO-2', title: 'Ejemplo B', costPrice: 10.9, stock: 450 },
    ],
    shipping: { cost: 0, minDays: 8, maxDays: 18, country: 'ES' },
    source: 'simulated',
  };
}
