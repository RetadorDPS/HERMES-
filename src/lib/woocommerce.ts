/**
 * src/lib/woocommerce.ts — Adaptador WooCommerce (REST API v3)
 *
 * Misma interfaz conceptual que src/lib/shopify.ts para que el worker de sync
 * sea agnóstico de la plataforma:
 *   connectStore → publishProduct → updateInventory / updatePrice → webhooks
 */
import { decryptSecret } from './crypto';
import { round2, sleep } from './utils';
import type { ScrapedProduct } from './types';

export interface WooCredentials {
  baseUrl: string;
  consumerKey: string;
  consumerSecret: string;
}

export interface WooResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
  simulated?: boolean;
}

export const wooIsDemo = (store: { domain: string; accessTokenEnc?: string | null }) => {
  const key = decryptSecret(store.accessTokenEnc);
  return !key || key.startsWith('ck_demo') || process.env.WOO_DEMO_MODE === 'true';
};

async function wooFetch<T>(
  creds: WooCredentials,
  path: string,
  init: RequestInit = {},
): Promise<WooResult<T>> {
  const url = `${creds.baseUrl.replace(/\/$/, '')}/wp-json/wc/v3${path}`;
  const auth = Buffer.from(`${creds.consumerKey}:${creds.consumerSecret}`).toString('base64');
  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(init.headers ?? {}),
      },
      cache: 'no-store',
    });
    if (!res.ok) {
      const body = await res.text();
      return { ok: false, error: `WooCommerce ${res.status}: ${body.slice(0, 300)}` };
    }
    const data = (await res.json()) as T;
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function connectStore(baseUrl: string, consumerKey: string, consumerSecret: string) {
  const root = baseUrl.trim().replace(/\/$/, '');
  // Comprobación de credenciales: system_status requiere permisos de lectura
  const res = await wooFetch<{ environment?: { site_url?: string; wc_version?: string } }>(
    { baseUrl: root, consumerKey, consumerSecret },
    '/system_status',
  );
  if (!res.ok) return { ok: false as const, error: res.error };
  return {
    ok: true as const,
    domain: root.replace(/^https?:\/\//, ''),
    shop: {
      siteUrl: res.data?.environment?.site_url ?? root,
      platform: 'WooCommerce',
      version: res.data?.environment?.wc_version,
    },
    scopes: ['read_write'],
    missingScopes: [],
  };
}

export async function publishProduct(
  store: { domain: string; accessTokenEnc?: string | null; consumerSecretEnc?: string | null },
  product: ScrapedProduct,
  opts: { status?: 'draft' | 'publish' } = {},
): Promise<WooResult<{ id: number; permalink: string; variantIds: number[] }>> {
  if (wooIsDemo(store)) {
    await sleep(420);
    return {
      ok: true,
      simulated: true,
      data: { id: Math.floor(Math.random() * 90000 + 10000), permalink: `https://${store.domain}/?p=${Math.floor(Math.random() * 90000)}`, variantIds: product.variants.map((_, i) => 10000 + i) },
    };
  }

  const creds: WooCredentials = {
    baseUrl: `https://${store.domain}`,
    consumerKey: decryptSecret(store.accessTokenEnc),
    consumerSecret: decryptSecret(store.consumerSecretEnc),
  };

  const attributes = buildAttributes(product);

  const body = {
    name: product.title,
    type: product.variants.length > 1 ? 'variable' : 'simple',
    status: opts.status ?? 'draft',
    description: product.description,
    short_description: product.bullets.join('\n') || product.description.replace(/<[^>]+>/g, '').slice(0, 300),
    sku: product.variants[0]?.sku,
    regular_price: String(round2(product.variants[0]?.compareAtPrice ?? product.variants[0]?.price ?? 0)),
    sale_price: product.variants[0]?.compareAtPrice ? String(round2(product.variants[0].price)) : undefined,
    manage_stock: true,
    stock_quantity: product.stockTotal,
    categories: product.category ? [{ name: product.category }] : [],
    tags: product.tags.map((name) => ({ name })),
    images: product.images.slice(0, 20).map((img) => ({ src: img.hdUrl ?? img.url, alt: img.alt ?? product.title })),
    meta_data: [
      { key: '_dropship_source_url', value: product.sourceUrl },
      { key: '_dropship_supplier', value: product.supplier },
      { key: '_dropship_supplier_product_id', value: product.supplierProductId ?? '' },
    ],
    attributes,
  };

  const created = await wooFetch<{ id: number; permalink: string }>(creds, '/products', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!created.ok || !created.data) return { ok: false, error: created.error };

  const variantIds: number[] = [];
  if (attributes.length) {
    const variantsPayload = product.variants.map((v, i) => {
      const opts: Record<string, string> = {};
      if (v.option1Name && v.option1Value) opts[v.option1Name] = v.option1Value;
      if (v.option2Name && v.option2Value) opts[v.option2Name] = v.option2Value;
      return {
        regular_price: String(round2(v.compareAtPrice ?? v.price)),
        sale_price: v.compareAtPrice ? String(round2(v.price)) : undefined,
        sku: v.sku,
        manage_stock: true,
        stock_quantity: v.stock,
        image: v.imageUrl ? { src: v.imageUrl } : undefined,
        attributes: Object.entries(opts).map(([name, option]) => ({ name, option })),
        weight: v.weightGrams ? String(v.weightGrams / 1000) : undefined,
      };
    });

    const variants = await wooFetch<{ id: number }[]>(creds, `/products/${created.data.id}/variations/batch`, {
      method: 'POST',
      body: JSON.stringify({ create: variantsPayload }),
    });
    if (variants.ok && Array.isArray(variants.data)) variantIds.push(...variants.data.map((v) => v.id));
  }

  return { ok: true, data: { id: created.data.id, permalink: created.data.permalink, variantIds } };
}

function buildAttributes(product: ScrapedProduct) {
  const attrs: { name: string; visible: boolean; variation: boolean; options: string[] }[] = [];
  const opt1 = product.variants[0]?.option1Name;
  const opt2 = product.variants[0]?.option2Name;
  if (opt1) {
    attrs.push({
      name: opt1,
      visible: true,
      variation: true,
      options: [...new Set(product.variants.map((v) => v.option1Value ?? v.title).filter(Boolean) as string[])],
    });
  }
  if (opt2) {
    attrs.push({
      name: opt2,
      visible: true,
      variation: true,
      options: [...new Set(product.variants.map((v) => v.option2Value ?? 'Única').filter(Boolean) as string[])],
    });
  }
  return attrs;
}

export async function updateInventory(
  store: { domain: string; accessTokenEnc?: string | null; consumerSecretEnc?: string | null },
  storeVariantId: string | number,
  newStock: number,
  isVariation = true,
): Promise<WooResult<{ quantity: number }>> {
  if (wooIsDemo(store)) {
    await sleep(180);
    return { ok: true, simulated: true, data: { quantity: newStock } };
  }
  const creds: WooCredentials = {
    baseUrl: `https://${store.domain}`,
    consumerKey: decryptSecret(store.accessTokenEnc),
    consumerSecret: decryptSecret(store.consumerSecretEnc),
  };
  const path = isVariation ? `/products/${storeVariantId}/variations/${storeVariantId}` : `/products/${storeVariantId}`;
  const fallbackPath = isVariation ? `/products/${storeVariantId}` : path;
  const res = await wooFetch(creds, fallbackPath, {
    method: 'PUT',
    body: JSON.stringify({ manage_stock: true, stock_quantity: newStock, stock_status: newStock > 0 ? 'instock' : 'outofstock' }),
  });
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, data: { quantity: newStock } };
}

export async function updatePrice(
  store: { domain: string; accessTokenEnc?: string | null; consumerSecretEnc?: string | null },
  productId: string | number,
  input: { newPrice: number; compareAtPrice?: number; variationId?: string | number },
): Promise<WooResult<{ price: number }>> {
  if (wooIsDemo(store)) {
    await sleep(150);
    return { ok: true, simulated: true, data: { price: round2(input.newPrice) } };
  }
  const creds: WooCredentials = {
    baseUrl: `https://${store.domain}`,
    consumerKey: decryptSecret(store.accessTokenEnc),
    consumerSecret: decryptSecret(store.consumerSecretEnc),
  };
  const body = input.compareAtPrice
    ? { regular_price: String(round2(input.compareAtPrice)), sale_price: String(round2(input.newPrice)) }
    : { regular_price: String(round2(input.newPrice)), sale_price: '' };

  const path = input.variationId ? `/products/${productId}/variations/${input.variationId}` : `/products/${productId}`;
  const res = await wooFetch(creds, path, { method: 'PUT', body: JSON.stringify(body) });
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, data: { price: round2(input.newPrice) } };
}

/** Registra los webhooks de pedidos en WordPress */
export async function listenOrderWebhook(
  store: { domain: string; accessTokenEnc?: string | null; consumerSecretEnc?: string | null },
  callbackBaseUrl: string,
): Promise<WooResult<{ registered: string[]; secrets?: string[] }>> {
  if (wooIsDemo(store)) return { ok: true, simulated: true, data: { registered: ['order.created', 'order.updated'] } };

  const creds: WooCredentials = {
    baseUrl: `https://${store.domain}`,
    consumerKey: decryptSecret(store.accessTokenEnc),
    consumerSecret: decryptSecret(store.consumerSecretEnc),
  };
  const topics = ['order.created', 'order.updated'];
  const registered: string[] = [];
  const secrets: string[] = [];
  for (const topic of topics) {
    const res = await wooFetch<{ secret?: string }>(creds, '/webhooks', {
      method: 'POST',
      body: JSON.stringify({ name: `DropshipPilot ${topic}`, topic, delivery_url: `${callbackBaseUrl}/api/webhooks/woocommerce/${store.domain}` }),
    });
    if (res.ok) {
      registered.push(topic);
      if (res.data?.secret) secrets.push(res.data.secret); // WordPress lo devuelve una sola vez
    }
  }
  return {
    ok: registered.length > 0,
    data: { registered, secrets },
    error: registered.length ? undefined : 'No se registró ningún webhook',
  };
}

export function parseOrderWebhook(payload: any) {
  return {
    storeOrderId: String(payload.id),
    storeOrderNumber: `#${payload.number ?? payload.id}`,
    currency: payload.currency ?? 'EUR',
    subtotal: Number(payload.total ?? 0) - Number(payload.total_tax ?? 0) - Number(payload.shipping_total ?? 0),
    shippingTotal: Number(payload.shipping_total ?? 0),
    taxTotal: Number(payload.total_tax ?? 0),
    total: Number(payload.total ?? 0),
    customerName: `${payload.billing?.first_name ?? ''} ${payload.billing?.last_name ?? ''}`.trim(),
    customerEmail: payload.billing?.email,
    customerPhone: payload.billing?.phone,
    shippingAddress: {
      name: `${payload.shipping?.first_name ?? ''} ${payload.shipping?.last_name ?? ''}`.trim(),
      address1: payload.shipping?.address_1,
      address2: payload.shipping?.address_2,
      city: payload.shipping?.city,
      province: payload.shipping?.state,
      country: payload.shipping?.country,
      zip: payload.shipping?.postcode,
    },
    items: (payload.line_items ?? []).map((li: any) => ({
      storeLineItemId: String(li.id),
      title: li.name,
      sku: li.sku,
      quantity: Number(li.quantity ?? 1),
      unitPrice: Number(li.price ?? 0),
      totalPrice: Number(li.total ?? 0),
      imageUrl: li.image?.src,
    })),
    orderedAt: payload.date_created ? new Date(payload.date_created) : new Date(),
  };
}
