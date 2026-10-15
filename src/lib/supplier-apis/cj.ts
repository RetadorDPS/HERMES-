/**
 * src/lib/supplier-apis/cj.ts — CJ Dropshipping API v2.
 *
 * La API de CJ es la más sencilla de las tres para empezar: con un email y una
 * API Key se obtiene un token y ya se pueden consultar productos, calcular
 * envíos y **crear pedidos reales** (CJ los envía a tu cliente final).
 *
 * Flujo de autenticación:
 *   POST /authentication/getAccessToken { email, password: apiKey }
 *   → accessToken con caducidad de 15 días (se cachea en memoria y se renueva).
 *
 * Endpoints usados:
 *   GET  /product/query?pid=…          → detalle de producto
 *   GET  /product/variant/queryByPid   → variantes
 *   POST /logistic/freightCalculate    → coste y plazo de envío
 *   POST /shopping/order/createOrder   → compra del pedido (fulfillment)
 *
 * Documentación: https://developers.cjdropshipping.com/en/api/api2/api/auth.html
 */
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

const BASE = 'https://developers.cjdropshipping.com/api2.0/v1';

/** Caché de tokens por email (evita pedir uno nuevo en cada llamada) */
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

export class CjClient implements SupplierApiClient {
  readonly provider = 'CJ_DROPSHIPPING' as const;
  readonly docsUrl = 'https://developers.cjdropshipping.com/en/api/api2/api/auth.html';
  readonly credentialFields = [
    { key: 'email', label: 'Email de la cuenta CJ' },
    { key: 'apiKey', label: 'API Key', hint: 'CJ → Autorización → API Key', secret: true },
  ];

  constructor(private readonly ctx: SupplierApiContext) {}

  private get credentials() {
    return this.ctx.credentials ?? {};
  }

  private missingFields() {
    const missing: string[] = [];
    if (!this.credentials.email) missing.push('email');
    if (!this.credentials.apiKey) missing.push('apiKey');
    return missing;
  }

  private async getToken(force = false): Promise<string> {
    const missing = this.missingFields();
    if (missing.length) throw new SupplierApiError(`Faltan credenciales de CJ: ${missing.join(', ')}`, this.provider, 'MISSING_CREDENTIALS', { missing });

    const cacheKey = `${this.credentials.email}:${this.credentials.apiKey.slice(0, 6)}`;
    const cached = tokenCache.get(cacheKey);
    if (!force && cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

    const res = await apiFetch(`${BASE}/authentication/getAccessToken`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: this.credentials.email, password: this.credentials.apiKey }),
      timeoutMs: this.ctx.timeoutMs ?? 20_000,
    });

    const json: any = await res.json().catch(() => ({}));
    if (!json?.result) {
      const message = String(json?.message ?? `HTTP ${res.status}`);
      const traducciones: Record<string, string> = {
        'AccessToken is empty': 'Faltan credenciales',
        'Username or password is incorrect': 'Email o API Key incorrectos',
      };
      throw new SupplierApiError(
        `${message}${traducciones[message] ? ` — ${traducciones[message]}` : ''}`,
        this.provider,
        String(json?.code ?? res.status),
        json,
      );
    }

    const token = String(json.data.accessToken);
    const expiry = json.data.accessTokenExpiryDate ? new Date(json.data.accessTokenExpiryDate).getTime() : Date.now() + 14 * 86400_000;
    tokenCache.set(cacheKey, { token, expiresAt: expiry });
    return token;
  }

  private async call<T = any>(path: string, init: { method?: 'GET' | 'POST' | 'PUT'; body?: any; query?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const token = await this.getToken();
    const url = new URL(`${BASE}${path}`);
    for (const [k, v] of Object.entries(init.query ?? {})) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));

    const res = await apiFetch(url.toString(), {
      method: init.method ?? 'GET',
      headers: { 'CJ-Access-Token': token, 'Content-Type': 'application/json' },
      body: init.body ? JSON.stringify(init.body) : undefined,
      timeoutMs: this.ctx.timeoutMs ?? 25_000,
    });

    const json: any = await res.json().catch(() => ({}));
    if (json?.result === false) {
      const message = String(json?.message ?? '');
      // Token caducado → reintento único con token nuevo
      if (String(json?.code) === '1600200' || /token/i.test(message)) {
        await this.getToken(true);
        return this.call<T>(path, init);
      }
      // Límite de peticiones por segundo de CJ (1 req/s) → se respeta y se reintenta
      if (res.status === 429 || /Too Many Requests|QPS limit|frequency/i.test(message)) {
        const attempt = ((init as any).__qpsAttempt ?? 0) + 1;
        if (attempt <= 3) {
          // 1,2 s de margen: el doble del límite declarado por CJ
          await new Promise((r) => setTimeout(r, 1_200));
          return this.call<T>(path, { ...init, __qpsAttempt: attempt } as any);
        }
        throw new SupplierApiError('CJ limitó las peticiones (1 por segundo): el catálogo se descarga más despacio a propósito', this.provider, 'RATE_LIMIT', json);
      }
      throw new SupplierApiError(String(json?.message ?? `Error de CJ (${res.status})`), this.provider, String(json?.code ?? res.status), json);
    }
    return (json?.data ?? json) as T;
  }

  /**
   * CATÁLOGO: lista de productos con filtros (endpoint oficial `product/listV2`).
   * Es la llamada que alimenta el catálogo que ve el usuario: palabras clave,
   * categoría, rango de precio, país de almacén, envío gratis y ordenación.
   */
  async listProducts(params: {
    keyword?: string;
    page?: number;
    size?: number;
    categoryId?: string;
    countryCode?: string;
    minPrice?: number;
    maxPrice?: number;
    freeShipping?: boolean;
    orderBy?: number; // 0 mejor coincidencia · 1 listados · 2 precio · 3 fecha · 4 inventario
    sort?: 'asc' | 'desc';
  } = {}): Promise<SupplierProduct[]> {
    const data = await this.call<any>('/product/listV2', {
      query: {
        keyWord: params.keyword,
        page: params.page ?? 1,
        size: Math.min(params.size ?? 50, 100),
        categoryId: params.categoryId,
        countryCode: params.countryCode ?? this.ctx.country ?? 'ES',
        startSellPrice: params.minPrice,
        endSellPrice: params.maxPrice,
        addMarkStatus: params.freeShipping ? 1 : undefined,
        orderBy: params.orderBy ?? 0,
        sort: params.sort ?? 'desc',
        productType: 4,
      },
    });

    const list: any[] = Array.isArray(data?.list) ? data.list : Array.isArray(data) ? data : [];
    return list.map((item) => this.mapCatalogItem(item));
  }

  /** Categorías de CJ (para la navegación visual del catálogo). */
  async listCategories(): Promise<{ id: string; name: string; parentName?: string }[]> {
    const data = await this.call<any>('/product/getCategory').catch(() => null);

    // La respuesta de CJ llega anidada en tres niveles (categoría → subcategoría
    // → tipo). Se recorre cualquiera de las formas conocidas y se aplana.
    const CHILD_KEYS = ['children', 'categoryList', 'childCategoryList', 'categorySecondList', 'categoryThirdList', 'subCategories', 'list'];
    const flatten = (nodes: any[], parent?: string): { id: string; name: string; parentName?: string }[] =>
      (Array.isArray(nodes) ? nodes : []).flatMap((n) => {
        const name = String(n.categoryName ?? n.name ?? n.categoryNameEn ?? '');
        const id = String(n.categoryId ?? n.id ?? n.categoryCode ?? '');
        const children = CHILD_KEYS.flatMap((k) => (Array.isArray(n?.[k]) ? n[k] : []));
        return [
          ...(id && name ? [{ id, name, parentName: parent }] : []),
          ...flatten(children, name || parent),
        ];
      });

    const roots = data?.categoryFirstList ?? data?.categoryList ?? data?.categories ?? data?.list ?? data ?? [];
    return flatten(Array.isArray(roots) ? roots : []);
  }

  /** Normaliza un elemento de listado de CJ al contrato común. */
  private mapCatalogItem(item: any): SupplierProduct {
    const id = String(item.pid ?? item.productId ?? item.id ?? '');
    const images: string[] = String(item.productImage ?? item.bigImage ?? '')
      .split(/[;,|]/)
      .map((u) => u.trim())
      .filter(Boolean);
    const cost = Number(item.sellPrice ?? item.variantSellPrice ?? item.price ?? 0);
    const stock = Number(item.warehouseInventoryNum ?? item.variantStock ?? item.stock ?? item.inventory ?? 0);
    return {
      provider: this.provider,
      supplierProductId: id,
      sourceUrl: `https://cjdropshipping.com/product/-p-${id}.html`,
      title: String(item.productNameEn ?? item.productName ?? item.nameEn ?? 'Producto CJ'),
      description: String(item.description ?? item.remark ?? ''),
      category: item.categoryName ? String(item.categoryName) : item.categoryId ? `CJ #${item.categoryId}` : undefined,
      currency: 'USD',
      costPrice: cost,
      stock,
      images,
      variants: [
        {
          supplierVariantId: String(item.variantId ?? `${id}-default`),
          sku: item.variantSku ? String(item.variantSku) : undefined,
          title: 'Único',
          costPrice: cost,
          stock,
          weightGrams: item.productWeight ? Number(item.productWeight) : undefined,
          imageUrl: images[0],
        },
      ],
      shipping: {
        cost: item.freightPrice ? Number(item.freightPrice) : undefined,
        minDays: Number(item.deliveryTimeMin ?? 7),
        maxDays: Number(item.deliveryTimeMax ?? 20),
        country: this.ctx.country ?? 'ES',
      } as SupplierProduct['shipping'],
      rating: item.productRating ? Number(item.productRating) : undefined,
      orders: item.listedNum ? Number(item.listedNum) : undefined,
      source: 'api',
    };
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const started = Date.now();
    const missing = this.missingFields();
    if (missing.length) {
      return { ok: false, message: `Faltan credenciales: ${missing.join(', ')}`, missing, docs: this.docsUrl };
    }
    try {
      await this.getToken(true);
      // Comprobación adicional: consulta de producto de ejemplo (valida el token)
      const balance = await this.call<{ amount?: number; currency?: string }>('/shopping/pay/getBalance').catch(() => null);
      return {
        ok: true,
        message: 'Credenciales válidas: puedes consultar productos, calcular envíos y crear pedidos.',
        latencyMs: Date.now() - started,
        account: { email: this.credentials.email, balance: balance?.amount, currency: balance?.currency ?? 'USD' },
        docs: this.docsUrl,
      };
    } catch (err) {
      const e = err as SupplierApiError;
      return { ok: false, message: e.message, latencyMs: Date.now() - started, missing: (e.raw as any)?.missing, docs: this.docsUrl };
    }
  }

  async fetchProduct({ productId, url }: { productId?: string; url?: string }): Promise<SupplierProduct> {
    const id = productId ?? url?.match(/[?&](?:pid|id)=([\w-]+)/)?.[1] ?? url?.split('/').filter(Boolean).pop();
    if (!id) throw new SupplierApiError('No he podido extraer el id del producto de CJ', this.provider, 'BAD_INPUT');

    const product = await this.call<any>('/product/query', { query: { pid: id } });
    const variants = await this.call<any[]>('/product/variant/queryByPid', { query: { pid: id } }).catch(() => []);

    const images: string[] = String(product.productImage ?? '')
      .split(/[;,|]/)
      .filter(Boolean);

    const variantList = Array.isArray(variants) ? variants : [];
    const shipping = variantList[0]?.variantSellPrice
      ? await this.quoteShipping({ productId: id, country: this.ctx.country ?? 'ES' }).catch(() => undefined)
      : undefined;

    return {
      provider: this.provider,
      supplierProductId: String(product.pid ?? id),
      sourceUrl: url ?? `https://cjdropshipping.com/product/-p-${id}.html`,
      title: String(product.productNameEn ?? product.productName ?? 'Producto CJ'),
      description: String(product.description ?? ''),
      category: product.categoryName ? String(product.categoryName) : undefined,
      currency: 'USD',
      costPrice: Number(variantList[0]?.variantSellPrice ?? product.sellPrice ?? 0),
      stock: variantList.reduce((acc: number, v: any) => acc + Number(v.variantStock ?? 0), 0),
      images,
      variants: variantList.map((v: any, i: number) => ({
        supplierVariantId: String(v.vid ?? `cj-${i}`),
        sku: v.variantSku ? String(v.variantSku) : undefined,
        title: String(v.variantNameEn ?? v.variantName ?? `Variante ${i + 1}`),
        color: v.variantKey?.split('-')?.[0],
        size: v.variantKey?.split('-')?.[1],
        costPrice: Number(v.variantSellPrice ?? 0),
        stock: Number(v.variantStock ?? 0),
        weightGrams: v.variantWeight ? Math.round(Number(v.variantWeight) * 1000) : undefined,
        imageUrl: v.variantImage ?? images[i],
      })),
      shipping: shipping ?? { cost: 0, minDays: 7, maxDays: 15, country: this.ctx.country ?? 'ES' },
      source: 'api',
    };
  }

  async quoteShipping({ productId, country, quantity = 1 }: { productId: string; country: string; quantity?: number }) {
    const data = await this.call<any>('/logistic/freightCalculate', {
      method: 'POST',
      body: { startCountryCode: 'CN', endCountryCode: country, products: [{ quantity, pid: productId }] },
    });
    const options = (Array.isArray(data) ? data : [data]).filter(Boolean).map((o: any) => ({
      name: String(o.logisticName ?? 'Envío CJ'),
      cost: Number(o.logisticPrice ?? 0),
      minDays: Number(o.logisticAging?.split('-')?.[0] ?? 8),
      maxDays: Number(o.logisticAging?.split('-')?.[1] ?? 18),
    }));
    const best = options.sort((a, b) => a.cost - b.cost)[0];
    return { cost: best?.cost ?? 0, minDays: best?.minDays ?? 8, maxDays: best?.maxDays ?? 18, country, methods: options };
  }

  async createOrder({ items, address, reference }: { items: SupplierOrderItem[]; address: SupplierOrderAddress; reference?: string }): Promise<CreateOrderResult> {
    try {
      const order = await this.call<any>('/shopping/order/createOrder', {
        method: 'POST',
        body: {
          orderNumber: reference ?? `DSP-${Date.now()}`,
          shippingZip: address.zip ?? '',
          shippingCountryCode: address.country,
          shippingCountry: address.country,
          shippingProvince: address.province ?? '',
          shippingCity: address.city,
          shippingAddress: [address.address1, address.address2].filter(Boolean).join(' '),
          shippingCustomerName: address.name,
          shippingPhone: address.phone ?? '',
          remark: 'DropshipPilot',
          products: items.map((i) => ({ vid: i.supplierVariantId, quantity: i.quantity })),
        },
      });

      return {
        ok: true,
        supplierOrderId: String(order.orderId ?? order.orderNum ?? ''),
        status: String(order.orderStatus ?? 'CREATED'),
        cost: Number(order.productAmount ?? order.amount ?? 0),
        trackingNumber: order.trackNumber ? String(order.trackNumber) : undefined,
      };
    } catch (err) {
      return { ok: false, error: (err as SupplierApiError).message };
    }
  }
}

export function simulateCjProduct(id: string): SupplierProduct {
  return {
    provider: 'CJ_DROPSHIPPING',
    supplierProductId: id,
    sourceUrl: `https://cjdropshipping.com/product/-p-${id}.html`,
    title: 'Producto de ejemplo (CJ Dropshipping · modo demo)',
    description: '<p>Datos de ejemplo: añade tu email y API Key de CJ para trabajar con el catálogo real.</p>',
    currency: 'USD',
    costPrice: 7.5,
    stock: 1200,
    images: [],
    variants: [
      { supplierVariantId: 'cj-demo-1', sku: 'CJ-DEMO-1', title: 'Ejemplo A', costPrice: 7.5, stock: 700 },
      { supplierVariantId: 'cj-demo-2', sku: 'CJ-DEMO-2', title: 'Ejemplo B', costPrice: 8.2, stock: 500 },
    ],
    shipping: { cost: 1.2, minDays: 7, maxDays: 15, country: 'ES' },
    source: 'simulated',
  };
}
