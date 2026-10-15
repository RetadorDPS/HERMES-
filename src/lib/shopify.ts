/**
 * src/lib/shopify.ts — Integración con Shopify (Fase 4)
 *
 * Cubre la GraphQL Admin API 2025-01:
 *   • connectStore(shopUrl, accessToken)  → valida credenciales y scopes
 *   • publishProduct(store, productData)  → crea producto + variantes + imágenes
 *   • updateInventory(store, ids, stock)  → ajuste de stock en tiempo real
 *   • updatePrice(store, ids, price)      → actualiza precio cuando cambia el costo
 *   • setProductStatus(store, id, status) → ACTIVE/DRAFT/ARCHIVED (agotado)
 *   • registerWebhooks / listenOrderWebhook → alta de suscripciones orders/create
 *   • fetchOrders / pushTracking           → sincronización inversa y tracking
 *
 * En DEMO_MODE (sin token real) todas las llamadas se simulan y se registran,
 * de modo que el dashboard y los workers son totalmente funcionales sin tienda.
 */
import { decryptSecret } from './crypto';
import { round2, sleep, stableHash } from './utils';
import type { ScrapedProduct, ScrapedVariant } from './types';

export const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION ?? '2025-01';
const DEMO_TOKENS = ['shpat_demo_encrypted_token', 'demo', ''];

export interface ShopifyCredentials {
  domain: string;
  accessToken: string;
  apiVersion?: string;
}

export interface ShopifyResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
  userErrors?: { field: string[]; message: string }[];
  cost?: { requestedQueryCost: number; actualQueryCost: number };
  simulated?: boolean;
}

export interface ShopifyProductInput {
  title: string;
  descriptionHtml: string;
  vendor?: string;
  productType?: string;
  tags: string[];
  handle?: string;
  status?: 'ACTIVE' | 'DRAFT' | 'ARCHIVED';
  seoTitle?: string;
  seoDescription?: string;
  images: { url: string; altText?: string }[];
  options: { name: string; values: string[] }[];
  variants: {
    sku: string;
    price: number;
    compareAtPrice?: number;
    inventoryQuantity: number;
    optionValues: { optionName: string; name: string }[];
    imageSrc?: string;
    weightGrams?: number;
    barcode?: string;
  }[];
  metafields?: { namespace: string; key: string; value: string; type: string }[];
}

// ───────────────────────────── Cliente HTTP ─────────────────────────────────

interface GraphQLResponse<T> {
  data?: T;
  errors?: { message: string; extensions?: { code?: string } }[];
  extensions?: { cost?: { requestedQueryCost: number; actualQueryCost: number } };
}

export function isDemoStore(store: { domain: string; accessTokenEnc?: string | null }) {
  const token = decryptSecret(store.accessTokenEnc);
  return DEMO_TOKENS.includes(token) || process.env.SHOPIFY_DEMO_MODE === 'true' || !token;
}

/** Ejecuta una query/mutación GraphQL con reintentos ante THROTTLED y 5xx */
export async function shopifyGraphQL<T>(
  creds: ShopifyCredentials,
  query: string,
  variables: Record<string, unknown> = {},
  opts: { retries?: number; silent?: boolean } = {},
): Promise<ShopifyResult<T>> {
  const { domain, accessToken } = creds;
  if (!domain || !accessToken) return { ok: false, error: 'Credenciales de Shopify incompletas (domain/accessToken)' };

  const version = creds.apiVersion ?? SHOPIFY_API_VERSION;
  const url = `https://${domain}/admin/api/${version}/graphql.json`;
  const retries = opts.retries ?? 3;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': accessToken,
        },
        body: JSON.stringify({ query, variables }),
        cache: 'no-store',
      });

      if (res.status === 401 || res.status === 403) {
        return { ok: false, error: `Shopify ${res.status}: token inválido o sin scopes suficientes` };
      }
      if (res.status === 404) return { ok: false, error: 'Shopify 404: dominio de tienda incorrecto' };
      if (res.status === 429 || res.status >= 500) {
        await sleep(1200 * attempt);
        continue;
      }

      const json = (await res.json()) as GraphQLResponse<T>;
      const throttled = json.errors?.some((e) => /throttl/i.test(e.message) || e.extensions?.code === 'THROTTLED');
      if (throttled) {
        await sleep(1500 * attempt);
        continue;
      }
      if (json.errors?.length) {
        return { ok: false, error: json.errors.map((e) => e.message).join(' | '), cost: json.extensions?.cost };
      }
      return { ok: true, data: json.data, cost: json.extensions?.cost };
    } catch (err) {
      if (attempt === retries) return { ok: false, error: (err as Error).message };
      await sleep(800 * attempt);
    }
  }
  return { ok: false, error: 'Máximo de reintentos alcanzado (rate limit de Shopify)' };
}

// ───────────────────────── 1) Conexión de tienda ────────────────────────────

export const SHOP_QUERY = /* GraphQL */ `
  query ConnectStore {
    shop {
      id
      name
      myshopifyDomain
      primaryDomain { url host }
      currencyCode
      ianaTimezone
      plan { displayName partnerDevelopment }
      billingAddress { countryCodeV2 }
    }
    currentAppInstallation {
      accessScopes { handle }
    }
  }
`;

export async function connectStore(shopUrl: string, accessToken: string) {
  const domain = normalizeShopDomain(shopUrl);
  const creds: ShopifyCredentials = { domain, accessToken };

  const res = await shopifyGraphQL<{
    shop: {
      id: string;
      name: string;
      myshopifyDomain: string;
      primaryDomain: { url: string; host: string };
      currencyCode: string;
      ianaTimezone: string;
      plan: { displayName: string };
      billingAddress?: { countryCodeV2?: string };
    };
    currentAppInstallation: { accessScopes: { handle: string }[] };
  }>(creds, SHOP_QUERY);

  if (!res.ok || !res.data) {
    return { ok: false as const, error: res.error ?? 'No se pudo validar la tienda', domain };
  }

  const shop = res.data.shop;
  const scopes = res.data.currentAppInstallation?.accessScopes?.map((s) => s.handle) ?? [];
  const required = ['write_products', 'read_orders', 'write_inventory'];
  const missing = required.filter((r) => !scopes.includes(r));

  return {
    ok: true as const,
    domain,
    shop: {
      id: shop.id,
      name: shop.name,
      myshopifyDomain: shop.myshopifyDomain,
      primaryDomain: shop.primaryDomain?.host,
      currencyCode: shop.currencyCode,
      timezone: shop.ianaTimezone,
      plan: shop.plan?.displayName,
      country: shop.billingAddress?.countryCodeV2,
    },
    scopes,
    missingScopes: missing,
    warning: missing.length ? `Faltan scopes: ${missing.join(', ')}` : undefined,
  };
}

export function normalizeShopDomain(input: string) {
  let d = input.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!d.includes('.')) d = `${d}.myshopify.com`;
  return d;
}

// ───────────────────────── 2) Publicar producto ─────────────────────────────

export const PRODUCT_CREATE_MUTATION = /* GraphQL */ `
  mutation ProductCreate($product: ProductCreateInput!, $media: [CreateMediaInput!]) {
    productCreate(product: $product, media: $media) {
      product {
        id
        handle
        title
        status
        variants(first: 100) {
          nodes {
            id
            sku
            price
            inventoryQuantity
            inventoryItem { id }
          }
        }
      }
      userErrors { field message }
    }
  }
`;

/** Convierte un ScrapedProduct en el input GraphQL de Shopify */
export function mapProductToShopify(
  product: ScrapedProduct,
  opts: {
    status?: 'ACTIVE' | 'DRAFT' | 'ARCHIVED';
    handle?: string;
    optionNames?: { option1: string; option2?: string };
    margins?: { fixedFee?: number };
  } = {},
): ShopifyProductInput {
  // Derivamos las opciones reales de las variantes (Color/Talla/…)
  const opt1Name = opts.optionNames?.option1 ?? product.variants[0]?.option1Name ?? 'Opción';
  const opt2Name = opts.optionNames?.option2 ?? product.variants[0]?.option2Name;

  const options = [
    { name: opt1Name, values: unique(product.variants.map((v) => v.option1Value ?? v.title)) },
  ];
  if (opt2Name) {
    options.push({ name: opt2Name, values: unique(product.variants.map((v) => v.option2Value ?? 'Única').filter(Boolean) as string[]) });
  }

  return {
    title: product.title.slice(0, 255),
    descriptionHtml: product.description,
    vendor: product.brand ?? 'DropshipPilot',
    productType: product.category ?? 'Dropshipping',
    tags: [...new Set([...(product.tags ?? []), 'dropshipping', `supplier:${product.supplier.toLowerCase()}`])].slice(0, 40),
    handle: opts.handle,
    status: opts.status ?? 'DRAFT',
    seoTitle: product.seoTitle,
    seoDescription: product.description.replace(/<[^>]+>/g, '').slice(0, 320),
    images: product.images.slice(0, 20).map((img, i) => ({ url: img.hdUrl ?? img.url, altText: img.alt ?? `${product.title} — ${i + 1}` })),
    options,
    variants: product.variants.slice(0, 100).map((v) => ({
      sku: v.sku,
      price: round2(v.price),
      compareAtPrice: v.compareAtPrice ? round2(v.compareAtPrice) : undefined,
      inventoryQuantity: v.stock,
      optionValues: [
        { optionName: opt1Name, name: v.option1Value ?? v.title },
        ...(opt2Name ? [{ optionName: opt2Name, name: v.option2Value ?? 'Única' }] : []),
      ],
      imageSrc: v.imageUrl,
      weightGrams: v.weightGrams,
    })),
    metafields: [
      { namespace: 'dropship', key: 'supplier_url', value: product.sourceUrl, type: 'single_line_text_field' },
      { namespace: 'dropship', key: 'supplier_id', value: product.supplierProductId ?? '', type: 'single_line_text_field' },
      { namespace: 'dropship', key: 'supplier_key', value: product.supplier, type: 'single_line_text_field' },
      { namespace: 'dropship', key: 'cost_price', value: String(product.variants[0]?.price ?? 0), type: 'single_line_text_field' },
    ],
  };
}

export async function publishProduct(
  store: { domain: string; accessTokenEnc?: string | null; apiVersion?: string | null },
  product: ShopifyProductInput,
): Promise<ShopifyResult<{ id: string; handle: string; variants: { id: string; sku: string; inventoryItemId: string }[] }>> {
  if (isDemoStore(store)) {
    await sleep(400 + Math.random() * 500);
    const id = `gid://shopify/Product/${Math.floor(Math.random() * 9e11 + 1e11)}`;
    return {
      ok: true,
      simulated: true,
      data: {
        id,
        handle: product.handle ?? slugHandle(product.title),
        variants: product.variants.map((v, i) => ({
          id: `gid://shopify/ProductVariant/${Math.floor(Math.random() * 9e11 + 1e11)}`,
          sku: v.sku,
          inventoryItemId: `gid://shopify/InventoryItem/${Math.floor(Math.random() * 9e11 + 1e11)}`,
        })),
      },
    };
  }

  const creds: ShopifyCredentials = {
    domain: store.domain,
    accessToken: decryptSecret(store.accessTokenEnc),
    apiVersion: store.apiVersion ?? undefined,
  };

  const productInput = {
    title: product.title,
    descriptionHtml: product.descriptionHtml,
    vendor: product.vendor,
    productType: product.productType,
    tags: product.tags,
    handle: product.handle,
    status: product.status ?? 'DRAFT',
    seo: { title: product.seoTitle, description: product.seoDescription },
    options: product.options.map((o) => o.name),
    variants: product.variants.map((v) => ({
      sku: v.sku,
      price: String(v.price),
      compareAtPrice: v.compareAtPrice ? String(v.compareAtPrice) : undefined,
      inventoryItem: { tracked: true, sku: v.sku, measurement: v.weightGrams ? { weight: { value: v.weightGrams, unit: 'GRAMS' } } : undefined },
      optionValues: v.optionValues.map((ov) => ({ optionName: ov.optionName, name: ov.name })),
      barcode: v.barcode,
    })),
    metafields: product.metafields?.map((m) => ({ ...m })),
  };

  const media = product.images.map((img, i) => ({
    originalSource: img.url,
    alt: img.altText ?? product.title,
    mediaContentType: 'IMAGE',
  }));

  const res = await shopifyGraphQL<{
    productCreate: {
      product: {
        id: string;
        handle: string;
        title: string;
        status: string;
        variants: { nodes: { id: string; sku: string; price: string; inventoryQuantity: number; inventoryItem: { id: string } }[] };
      };
      userErrors: { field: string[]; message: string }[];
    };
  }>(creds, PRODUCT_CREATE_MUTATION, { product: productInput, media });

  const userErrors = res.data?.productCreate?.userErrors ?? [];
  if (!res.ok || userErrors.length) {
    return { ok: false, error: userErrors.map((e) => `${e.field?.join('.')}: ${e.message}`).join(' | ') || res.error };
  }

  const created = res.data!.productCreate.product;

  // Inventario: activamos tracking y fijamos cantidades por variante
  for (const [i, variant] of created.variants.nodes.entries()) {
    const qty = product.variants[i]?.inventoryQuantity ?? 0;
    const invRes = await setInventoryQuantity(creds, variant.inventoryItem.id, created.id, qty);
    if (!invRes.ok) {
      return { ok: false, error: `Producto creado pero falló el stock de ${variant.sku}: ${invRes.error}` };
    }
  }

  return {
    ok: true,
    data: {
      id: created.id,
      handle: created.handle,
      variants: created.variants.nodes.map((v) => ({ id: v.id, sku: v.sku, inventoryItemId: v.inventoryItem.id })),
    },
    cost: res.cost,
  };
}

// ───────────────────────── 3) Stock en tiempo real ───────────────────────────

const INVENTORY_SET_MUTATION = /* GraphQL */ `
  mutation InventorySet($input: InventorySetQuantitiesInput!) {
    inventorySetQuantities(input: $input) {
      inventoryAdjustmentGroup { reason changes { name delta quantityAfterChange } }
      userErrors { field message }
    }
  }
`;

const INVENTORY_ITEM_LOOKUP = /* GraphQL */ `
  query InventoryItem($id: ID!) {
    inventoryItem(id: $id) {
      id
      tracked
      inventoryLevel(locationId: $locationId) { id location { id name } quantities(names: ["available"]) { name quantity } }
    }
  }
`;

/** Localización primaria de la tienda (almacén de fulfillment) */
export async function getPrimaryLocationId(store: { domain: string; accessTokenEnc?: string | null }) {
  if (isDemoStore(store)) return 'gid://shopify/Location/1';
  const creds: ShopifyCredentials = { domain: store.domain, accessToken: decryptSecret(store.accessTokenEnc) };
  const res = await shopifyGraphQL<{ locations: { nodes: { id: string; name: string; isPrimary?: boolean }[] } }>(
    creds,
    /* GraphQL */ `query Locations { locations(first: 10) { nodes { id name } } }`,
  );
  return res.data?.locations.nodes[0]?.id;
}

async function setInventoryQuantity(
  creds: ShopifyCredentials,
  inventoryItemId: string,
  productId: string,
  quantity: number,
): Promise<ShopifyResult<unknown>> {
  const locationId = await getLocationForCreds(creds);
  const res = await shopifyGraphQL<{ inventorySetQuantities: { userErrors: { field: string[]; message: string }[] } }>(
    creds,
    INVENTORY_SET_MUTATION,
    {
      input: {
        name: 'available',
        reason: 'correction',
        ignoreCompareQuantity: true,
        quantities: [{ inventoryItemId, locationId, quantity }],
      },
    },
  );
  const errs = res.data?.inventorySetQuantities?.userErrors ?? [];
  if (!res.ok || errs.length) return { ok: false, error: errs.map((e) => e.message).join(' | ') || res.error };
  return { ok: true, data: { productId, inventoryItemId, quantity } };
}

const credsLocationCache = new Map<string, string>();
async function getLocationForCreds(creds: ShopifyCredentials) {
  const key = `${creds.domain}:${creds.apiVersion ?? ''}`;
  if (credsLocationCache.has(key)) return credsLocationCache.get(key)!;
  const res = await shopifyGraphQL<{ locations: { nodes: { id: string }[] } }>(
    creds,
    /* GraphQL */ `query PrimaryLocation { locations(first: 1) { nodes { id } } }`,
  );
  const id = res.data?.locations.nodes[0]?.id ?? 'gid://shopify/Location/1';
  credsLocationCache.set(key, id);
  return id;
}

/**
 * Actualiza el stock de una variante en Shopify.
 * stock === 0 → además marca el producto como DRAFT/AGOTADO (regla del worker).
 */
export async function updateInventory(
  store: { domain: string; accessTokenEnc?: string | null; apiVersion?: string | null },
  input: { storeVariantId?: string | null; inventoryItemId?: string | null; newStock: number; productId?: string | null },
): Promise<ShopifyResult<{ quantity: number }>> {
  if (isDemoStore(store)) {
    await sleep(180 + Math.random() * 260);
    return { ok: true, simulated: true, data: { quantity: input.newStock } };
  }
  const creds: ShopifyCredentials = { domain: store.domain, accessToken: decryptSecret(store.accessTokenEnc), apiVersion: store.apiVersion ?? undefined };

  let inventoryItemId = input.inventoryItemId;
  if (!inventoryItemId && input.storeVariantId) {
    const res = await shopifyGraphQL<{ productVariant: { inventoryItem: { id: string } } }>(
      creds,
      /* GraphQL */ `query VariantInv($id: ID!) { productVariant(id: $id) { inventoryItem { id } } }`,
      { id: input.storeVariantId },
    );
    inventoryItemId = res.data?.productVariant.inventoryItem.id;
  }
  if (!inventoryItemId) return { ok: false, error: 'Sin inventoryItemId ni storeVariantId' };

  const upd = await setInventoryQuantity(creds, inventoryItemId, input.productId ?? '', input.newStock);
  if (!upd.ok) return { ok: false, error: upd.error };

  if (input.newStock === 0 && input.productId) {
    await setProductStatus(store, input.productId, 'DRAFT', /* alsoTag */ true);
  }
  return { ok: true, data: { quantity: input.newStock } };
}

// ───────────────────────── 4) Precio ────────────────────────────────────────

const VARIANTS_BULK_UPDATE = /* GraphQL */ `
  mutation VariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants { id price compareAtPrice }
      userErrors { field message }
    }
  }
`;

export async function updatePrice(
  store: { domain: string; accessTokenEnc?: string | null; apiVersion?: string | null },
  input: { productId: string; storeVariantId?: string | null; newPrice: number; compareAtPrice?: number | null },
): Promise<ShopifyResult<{ price: number }>> {
  if (isDemoStore(store)) {
    await sleep(160 + Math.random() * 240);
    return { ok: true, simulated: true, data: { price: round2(input.newPrice) } };
  }
  const creds: ShopifyCredentials = { domain: store.domain, accessToken: decryptSecret(store.accessTokenEnc), apiVersion: store.apiVersion ?? undefined };

  const variants = [
    {
      id: input.storeVariantId ?? undefined,
      price: String(round2(input.newPrice)),
      ...(input.compareAtPrice != null ? { compareAtPrice: String(round2(input.compareAtPrice)) } : {}),
    },
  ].filter((v) => v.id);

  const res = await shopifyGraphQL<{ productVariantsBulkUpdate: { userErrors: { field: string[]; message: string }[] } }>(
    creds,
    VARIANTS_BULK_UPDATE,
    { productId: input.productId, variants },
  );
  const errs = res.data?.productVariantsBulkUpdate?.userErrors ?? [];
  if (!res.ok || errs.length) return { ok: false, error: errs.map((e) => e.message).join(' | ') || res.error };
  return { ok: true, data: { price: round2(input.newPrice) } };
}

/** Actualiza precio de todas las variantes de un producto en una sola llamada */
export async function updateProductPrices(
  store: { domain: string; accessTokenEnc?: string | null; apiVersion?: string | null },
  productId: string,
  variants: { storeVariantId: string; price: number; compareAtPrice?: number }[],
): Promise<ShopifyResult<{ updated: number }>> {
  if (isDemoStore(store)) {
    await sleep(220);
    return { ok: true, simulated: true, data: { updated: variants.length } };
  }
  const creds: ShopifyCredentials = { domain: store.domain, accessToken: decryptSecret(store.accessTokenEnc), apiVersion: store.apiVersion ?? undefined };
  const res = await shopifyGraphQL<{ productVariantsBulkUpdate: { userErrors: { field: string[]; message: string }[] } }>(
    creds,
    VARIANTS_BULK_UPDATE,
    {
      productId,
      variants: variants.map((v) => ({
        id: v.storeVariantId,
        price: String(round2(v.price)),
        compareAtPrice: v.compareAtPrice ? String(round2(v.compareAtPrice)) : undefined,
      })),
    },
  );
  const errs = res.data?.productVariantsBulkUpdate?.userErrors ?? [];
  if (!res.ok || errs.length) return { ok: false, error: errs.map((e) => e.message).join(' | ') || res.error };
  return { ok: true, data: { updated: variants.length } };
}

// ───────────────────────── 5) Estado del producto ───────────────────────────

export async function setProductStatus(
  store: { domain: string; accessTokenEnc?: string | null; apiVersion?: string | null },
  productId: string,
  status: 'ACTIVE' | 'DRAFT' | 'ARCHIVED',
  addTag = false,
): Promise<ShopifyResult<{ status: string }>> {
  if (isDemoStore(store)) {
    await sleep(140);
    return { ok: true, simulated: true, data: { status } };
  }
  const creds: ShopifyCredentials = { domain: store.domain, accessToken: decryptSecret(store.accessTokenEnc), apiVersion: store.apiVersion ?? undefined };
  const res = await shopifyGraphQL<{ productUpdate: { userErrors: { field: string[]; message: string }[] } }>(
    creds,
    /* GraphQL */ `
      mutation SetStatus($product: ProductUpdateInput!) {
        productUpdate(product: $product) { product { id status } userErrors { field message } }
      }
    `,
    { product: { id: productId, status, ...(addTag ? { tags: ['agotado', 'sync:out-of-stock'] } : {}) } },
  );
  const errs = res.data?.productUpdate?.userErrors ?? [];
  if (!res.ok || errs.length) return { ok: false, error: errs.map((e) => e.message).join(' | ') || res.error };
  return { ok: true, data: { status } };
}

// ───────────────────────── 6) Webhooks ──────────────────────────────────────

export const WEBHOOK_CREATE = /* GraphQL */ `
  mutation WebhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
    webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
      webhookSubscription { id topic endpoint { __typename ... on WebhookHttpEndpoint { callbackUrl } } }
      userErrors { field message }
    }
  }
`;

/**
 * listenOrderWebhook(): registra las suscripciones necesarias en la tienda.
 * topics: ORDERS_CREATE (entra pedido) · ORDERS_UPDATED (cambio de estado)
 *          ORDER_FULFILLMENTS_UPDATE (tracking) · PRODUCTS_UPDATE
 */
export async function listenOrderWebhook(
  store: { domain: string; accessTokenEnc?: string | null; apiVersion?: string | null },
  callbackBaseUrl: string,
): Promise<ShopifyResult<{ registered: { topic: string; id: string }[] }>> {
  const topics = ['ORDERS_CREATE', 'ORDERS_UPDATED', 'ORDER_FULFILLMENTS_UPDATE', 'PRODUCTS_UPDATE'] as const;

  if (isDemoStore(store)) {
    await sleep(300);
    return {
      ok: true,
      simulated: true,
      data: { registered: topics.map((t, i) => ({ topic: t, id: `gid://shopify/WebhookSubscription/${1000 + i}` })) },
    };
  }

  const creds: ShopifyCredentials = { domain: store.domain, accessToken: decryptSecret(store.accessTokenEnc), apiVersion: store.apiVersion ?? undefined };
  const registered: { topic: string; id: string }[] = [];

  for (const topic of topics) {
    const res = await shopifyGraphQL<{ webhookSubscriptionCreate: { webhookSubscription?: { id: string }; userErrors: { message: string }[] } }>(
      creds,
      WEBHOOK_CREATE,
      {
        topic,
        webhookSubscription: { callbackUrl: `${callbackBaseUrl}/api/webhooks/shopify/${store.domain}`, format: 'JSON' },
      },
    );
    if (res.ok && res.data?.webhookSubscriptionCreate.webhookSubscription) {
      registered.push({ topic, id: res.data.webhookSubscriptionCreate.webhookSubscription.id });
    }
  }
  return { ok: registered.length > 0, data: { registered }, error: registered.length ? undefined : 'No se pudo registrar ningún webhook' };
}

/** Procesa el payload de un pedido recibido por webhook (orders/create) */
export function parseOrderWebhook(payload: any) {
  return {
    storeOrderId: String(payload.id),
    storeOrderNumber: String(payload.name ?? payload.order_number),
    externalOrderId: payload.admin_graphql_api_id,
    currency: payload.currency ?? 'USD',
    subtotal: Number(payload.subtotal_price ?? 0),
    shippingTotal: Number(payload.total_shipping_price_set?.shop_money?.amount ?? 0),
    taxTotal: Number(payload.total_tax ?? 0),
    total: Number(payload.total_price ?? 0),
    customerName: payload.customer ? `${payload.customer.first_name ?? ''} ${payload.customer.last_name ?? ''}`.trim() : payload.shipping_address?.name,
    customerEmail: payload.email ?? payload.customer?.email,
    customerPhone: payload.phone ?? payload.shipping_address?.phone,
    shippingAddress: payload.shipping_address
      ? {
          name: payload.shipping_address.name,
          address1: payload.shipping_address.address1,
          address2: payload.shipping_address.address2,
          city: payload.shipping_address.city,
          province: payload.shipping_address.province,
          country: payload.shipping_address.country_code,
          zip: payload.shipping_address.zip,
        }
      : null,
    items: (payload.line_items ?? []).map((li: any) => ({
      storeLineItemId: String(li.id),
      title: li.title,
      sku: li.sku,
      quantity: Number(li.quantity ?? 1),
      unitPrice: Number(li.price ?? 0),
      totalPrice: Number(li.price ?? 0) * Number(li.quantity ?? 1),
      imageUrl: li.image?.src,
    })),
    orderedAt: payload.created_at ? new Date(payload.created_at) : new Date(),
  };
}

// ───────────────────────── 7) Órdenes: lectura y tracking ───────────────────

export async function fetchOrders(
  store: { domain: string; accessTokenEnc?: string | null; apiVersion?: string | null },
  opts: { sinceIso?: string; limit?: number; status?: string } = {},
) {
  if (isDemoStore(store)) return { ok: true as const, orders: [] as any[], simulated: true };

  const creds: ShopifyCredentials = { domain: store.domain, accessToken: decryptSecret(store.accessTokenEnc), apiVersion: store.apiVersion ?? undefined };
  const query = /* GraphQL */ `
    query Orders($first: Int!, $query: String) {
      orders(first: $first, query: $query, sortKey: CREATED_AT, reverse: true) {
        nodes {
          id name createdAt displayFinancialStatus displayFulfillmentStatus
          currentTotalPriceSet { shopMoney { amount currencyCode } }
          customer { firstName lastName email }
          shippingAddress { name address1 address2 city province countryCodeV2 zip phone }
          lineItems(first: 50) { nodes { id title sku quantity originalUnitPriceSet { shopMoney { amount } } } }
          fulfillments { trackingInfo { number company url } status }
        }
      }
    }
  `;
  const filters = [
    opts.sinceIso ? `created_at:>='${opts.sinceIso}'` : '',
    opts.status ? `financial_status:${opts.status}` : 'financial_status:paid',
  ]
    .filter(Boolean)
    .join(' ');

  const res = await shopifyGraphQL<any>(creds, query, { first: Math.min(opts.limit ?? 50, 250), query: filters });
  if (!res.ok) return { ok: false as const, error: res.error, orders: [] };
  return { ok: true as const, orders: res.data?.orders?.nodes ?? [] };
}

/** Sube el tracking number y marca el pedido como fulfilled en la tienda */
export async function pushTracking(
  store: { domain: string; accessTokenEnc?: string | null; apiVersion?: string | null },
  input: { fulfillmentOrderId: string; trackingNumber: string; trackingUrl?: string; notifyCustomer?: boolean },
): Promise<ShopifyResult<{ trackingNumber: string }>> {
  if (isDemoStore(store)) {
    await sleep(200);
    return { ok: true, simulated: true, data: { trackingNumber: input.trackingNumber } };
  }
  const creds: ShopifyCredentials = { domain: store.domain, accessToken: decryptSecret(store.accessTokenEnc), apiVersion: store.apiVersion ?? undefined };
  const res = await shopifyGraphQL<{ fulfillmentCreateV2: { fulfillment?: { id: string }; userErrors: { message: string }[] } }>(
    creds,
    /* GraphQL */ `
      mutation Fulfill($fulfillment: FulfillmentInput!) {
        fulfillmentCreateV2(fulfillment: $fulfillment) {
          fulfillment { id status trackingInfo { number url } }
          userErrors { field message }
        }
      }
    `,
    {
      fulfillment: {
        lineItemsByFulfillmentOrder: [{ fulfillmentOrderId: input.fulfillmentOrderId }],
        trackingInfo: { number: input.trackingNumber, url: input.trackingUrl, company: 'DropshipPilot' },
        notifyCustomer: input.notifyCustomer ?? true,
      },
    },
  );
  const errs = res.data?.fulfillmentCreateV2?.userErrors ?? [];
  if (!res.ok || errs.length) return { ok: false, error: errs.map((e) => e.message).join(' | ') || res.error };
  return { ok: true, data: { trackingNumber: input.trackingNumber } };
}

// ───────────────────────── helpers ──────────────────────────────────────────

export const slugHandle = (title: string) =>
  title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 70);

const unique = <T,>(arr: T[]) => [...new Set(arr.filter(Boolean))];

/** Firma utilizada para deduplicar webhooks ya procesados */
export const webhookFingerprint = (topic: string, payload: unknown) => stableHash(`${topic}:${JSON.stringify(payload)}`);

export const SHOPIFY_REQUIRED_SCOPES = ['read_products', 'write_products', 'read_orders', 'write_orders', 'read_inventory', 'write_inventory', 'read_fulfillments', 'write_fulfillments'];

export type ShopifyVariantNode = ScrapedVariant;
