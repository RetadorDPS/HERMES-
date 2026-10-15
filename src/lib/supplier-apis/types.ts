/**
 * src/lib/supplier-apis/types.ts — Contrato común de las APIs oficiales de
 * proveedor (AliExpress Open Platform, CJ Dropshipping, Amazon PA-API…).
 *
 * Todos los clientes implementan la misma interfaz, de modo que la importación,
 * el worker de pedidos y la interfaz de usuario no necesitan saber con quién
 * están hablando. Cuando no hay credenciales reales, cada cliente entra en
 * `simulated` y lo declara explícitamente en la respuesta (nunca miente).
 */
import type { SupplierType } from '@prisma/client';

/** Credenciales en claro: se descifran sólo en memoria, nunca se registran. */
export type SupplierCredentials = Record<string, string>;

export interface SupplierApiContext {
  provider: SupplierType;
  credentials: SupplierCredentials;
  /** true = el cliente debe responder con datos de ejemplo etiquetados */
  simulated?: boolean;
  timeoutMs?: number;
  country?: string;
}

export interface SupplierProductVariant {
  supplierVariantId: string;
  sku?: string;
  title: string;
  color?: string;
  size?: string;
  costPrice: number;
  stock: number;
  weightGrams?: number;
  imageUrl?: string;
}

export interface SupplierProduct {
  provider: SupplierType;
  supplierProductId: string;
  sourceUrl: string;
  title: string;
  description: string;
  category?: string;
  currency: string;
  costPrice: number;
  stock: number;
  images: string[];
  variants: SupplierProductVariant[];
  shipping: {
    cost: number;
    minDays: number;
    maxDays: number;
    country: string;
    methods?: { name: string; cost: number; minDays: number; maxDays: number }[];
  };
  reviews?: { rating: number; author: string; text: string; date: string }[];
  rating?: number;
  orders?: number;
  /** 'api' = datos reales del proveedor · 'simulated' = ejemplo etiquetado */
  source: 'api' | 'simulated';
}

export interface SupplierOrderItem {
  supplierVariantId?: string;
  supplierProductId?: string;
  sku?: string;
  quantity: number;
  unitCost?: number;
}

export interface SupplierOrderAddress {
  name: string;
  address1: string;
  address2?: string | null;
  city: string;
  province?: string | null;
  country: string;
  zip?: string | null;
  phone?: string | null;
}

export interface CreateOrderResult {
  ok: boolean;
  supplierOrderId?: string;
  status?: string;
  cost?: number;
  trackingNumber?: string;
  simulated?: boolean;
  error?: string;
}

export interface ConnectionTestResult {
  ok: boolean;
  message: string;
  /** Campos que faltan o no son válidos */
  missing?: string[];
  account?: { name?: string; email?: string; balance?: number; currency?: string };
  latencyMs?: number;
  simulated?: boolean;
  /** Documentación donde conseguir las credenciales */
  docs?: string;
}

export interface SupplierApiClient {
  readonly provider: SupplierType;
  readonly docsUrl: string;
  /** Campos de credenciales que espera este proveedor */
  readonly credentialFields: { key: string; label: string; hint?: string; secret?: boolean }[];
  /** Comprueba credenciales contra la API real */
  testConnection(): Promise<ConnectionTestResult>;
  /** Obtiene un producto por su id o URL del proveedor */
  fetchProduct(input: { productId?: string; url?: string }): Promise<SupplierProduct>;
  /** Crea el pedido en el proveedor (compra real al dropshipper) */
  createOrder(input: { items: SupplierOrderItem[]; address: SupplierOrderAddress; reference?: string }): Promise<CreateOrderResult>;
  /** Consulta el envío disponible para un producto y destino */
  quoteShipping?(input: { productId: string; country: string; quantity?: number }): Promise<SupplierProduct['shipping']>;
}

export class SupplierApiError extends Error {
  constructor(
    message: string,
    public readonly provider: SupplierType,
    public readonly code?: string,
    public readonly raw?: unknown,
  ) {
    super(message);
    this.name = 'SupplierApiError';
  }
}

/** fetch con timeout y errores legibles */
export async function apiFetch(url: string, init: RequestInit & { timeoutMs?: number } = {}) {
  const { timeoutMs = 20_000, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...rest, signal: controller.signal, cache: 'no-store' });
  } finally {
    clearTimeout(timer);
  }
}
