/**
 * src/lib/plans.ts — Definición de los planes comerciales del SaaS.
 *
 * Los límites se aplican en el servidor (no sólo en la interfaz):
 *   • maxProducts / maxStores / maxSupplierAccounts → al crear
 *   • creditsPerMonth → cada extracción o importación consume créditos
 *   • syncIntervalMinutes → frecuencia mínima del worker para ese cliente
 *   • proxiesIncluded → si el plan incluye proxies gestionados
 *
 * Los precios están en EUR/mes y son sólo una propuesta comercial: cámbialos
 * aquí y en la configuración de precios de Stripe.
 */
import type { PlanTier } from '@prisma/client';

export interface PlanDefinition {
  tier: PlanTier;
  name: string;
  priceMonthly: number; // EUR
  priceYearly: number; // EUR (2 meses gratis)
  stripePriceEnv?: { monthly: string; yearly: string };
  maxProducts: number;
  maxStores: number;
  maxSupplierAccounts: number;
  creditsPerMonth: number;
  syncIntervalMinutes: number;
  proxiesIncluded: boolean;
  support: string;
  highlights: string[];
}

export const PLANS: Record<PlanTier, PlanDefinition> = {
  TRIAL: {
    tier: 'TRIAL',
    name: 'Prueba',
    priceMonthly: 0,
    priceYearly: 0,
    maxProducts: 25,
    maxStores: 1,
    maxSupplierAccounts: 1,
    creditsPerMonth: 200,
    syncIntervalMinutes: 360,
    proxiesIncluded: false,
    support: 'Comunidad',
    highlights: ['25 productos', '1 tienda', '1 proveedor por API', 'Sincronización cada 6 h'],
  },
  STARTER: {
    tier: 'STARTER',
    name: 'Starter',
    priceMonthly: 29,
    priceYearly: 290,
    stripePriceEnv: { monthly: 'STRIPE_PRICE_STARTER_MONTHLY', yearly: 'STRIPE_PRICE_STARTER_YEARLY' },
    maxProducts: 300,
    maxStores: 2,
    maxSupplierAccounts: 3,
    creditsPerMonth: 3000,
    syncIntervalMinutes: 120,
    proxiesIncluded: false,
    support: 'Email 48 h',
    highlights: ['300 productos', '2 tiendas', '3 proveedores por API', 'Sincronización cada 2 h'],
  },
  PRO: {
    tier: 'PRO',
    name: 'Pro',
    priceMonthly: 79,
    priceYearly: 790,
    stripePriceEnv: { monthly: 'STRIPE_PRICE_PRO_MONTHLY', yearly: 'STRIPE_PRICE_PRO_YEARLY' },
    maxProducts: 2000,
    maxStores: 5,
    maxSupplierAccounts: 10,
    creditsPerMonth: 25000,
    syncIntervalMinutes: 60,
    proxiesIncluded: false,
    support: 'Email 24 h',
    highlights: ['2.000 productos', '5 tiendas', '10 proveedores por API', 'Sincronización cada hora', 'Reprecio automático'],
  },
  ENTERPRISE: {
    tier: 'ENTERPRISE',
    name: 'Enterprise',
    priceMonthly: 249,
    priceYearly: 2490,
    stripePriceEnv: { monthly: 'STRIPE_PRICE_ENTERPRISE_MONTHLY', yearly: 'STRIPE_PRICE_ENTERPRISE_YEARLY' },
    maxProducts: 100000,
    maxStores: 50,
    maxSupplierAccounts: 100,
    creditsPerMonth: 250000,
    syncIntervalMinutes: 30,
    proxiesIncluded: true,
    support: 'Prioritario',
    highlights: ['Productos ilimitados', '50 tiendas', 'Proveedores ilimitados', 'Sincronización cada 30 min', 'Proxies incluidos', 'Soporte prioritario'],
  },
};

export const planFor = (tier: PlanTier | null | undefined): PlanDefinition => PLANS[tier ?? 'TRIAL'];

export class PlanLimitError extends Error {
  constructor(
    public readonly resource: string,
    public readonly limit: number,
    public readonly plan: PlanDefinition,
  ) {
    super(`Has alcanzado el límite de tu plan ${plan.name}: ${limit} ${resource}. Mejora tu plan para continuar.`);
    this.name = 'PlanLimitError';
  }
}

export interface UsageSnapshot {
  products: number;
  stores: number;
  supplierAccounts: number;
  creditsUsed: number;
}

/** Comprueba un recurso concreto antes de crearlo. */
export function assertWithinLimit(resource: 'products' | 'stores' | 'supplierAccounts', usage: UsageSnapshot, plan: PlanDefinition) {
  const map = {
    products: [usage.products, plan.maxProducts],
    stores: [usage.stores, plan.maxStores],
    supplierAccounts: [usage.supplierAccounts, plan.maxSupplierAccounts],
  } as const;
  const [current, limit] = map[resource];
  if (current >= limit) throw new PlanLimitError(resource === 'products' ? 'productos' : resource === 'stores' ? 'tiendas' : 'conexiones de proveedor', limit, plan);
}

export class CreditsExhaustedError extends Error {
  constructor(plan: PlanDefinition) {
    super(`Te has quedado sin créditos este mes (${plan.creditsPerMonth} en el plan ${plan.name}). Se renuevan al inicio del ciclo.`);
    this.name = 'CreditsExhaustedError';
  }
}

/** Coste en créditos de cada operación */
export const CREDIT_COSTS = {
  scrape: 1,
  import: 2,
  syncProduct: 1,
  orderPush: 3,
} as const;
