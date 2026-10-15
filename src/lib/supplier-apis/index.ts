/**
 * src/lib/supplier-apis/index.ts — Registro de proveedores y utilidades.
 *
 * Puerta de entrada única: dada una cuenta del cliente (SupplierAccount) o un
 * proveedor, devuelve el cliente de API adecuado. También detecta el proveedor
 * a partir de una URL, para que la importación use la API oficial antes de
 * intentar el scraping.
 */
import type { SupplierAccount, SupplierType } from '@prisma/client';
import { decryptSecret } from '@/lib/crypto';
import { prisma } from '@/lib/prisma';
import { AliExpressClient, simulateAliExpressProduct } from './aliexpress';
import { CjClient, simulateCjProduct } from './cj';
import { AmazonClient, simulateAmazonProduct } from './amazon';
import type { SupplierApiClient, SupplierApiContext, SupplierProduct } from './types';

export * from './types';

export interface ProviderDefinition {
  provider: SupplierType;
  name: string;
  tagline: string;
  /** ¿Permite crear el pedido en el proveedor (fulfillment automático)? */
  canPlaceOrders: boolean;
  docsUrl: string;
  signupUrl: string;
  notes: string;
  available: boolean;
}

export const PROVIDERS: ProviderDefinition[] = [
  {
    provider: 'ALIEXPRESS',
    name: 'AliExpress Open Platform',
    tagline: 'DS API oficial · catálogo, precios, envíos y creación de pedidos',
    canPlaceOrders: true,
    docsUrl: 'https://openservice.aliexpress.com/doc/doc.htm',
    signupUrl: 'https://openservice.aliexpress.com/',
    notes:
      'Requiere cuenta de desarrollador y app aprobada (gratis). Con el Access Token OAuth se pueden crear pedidos reales. Es la vía recomendada frente al scraping: sin captchas ni bloqueos.',
    available: true,
  },
  {
    provider: 'CJ_DROPSHIPPING',
    name: 'CJ Dropshipping',
    tagline: 'API v2 · la más rápida de configurar, permite envío automático',
    canPlaceOrders: true,
    docsUrl: 'https://developers.cjdropshipping.com/en/api/api2/api/auth.html',
    signupUrl: 'https://cjdropshipping.com/',
    notes:
      'Sólo necesitas el email de tu cuenta y la API Key (Autorización → API Key). CJ envía directamente a tu cliente final, incluso con tu marca.',
    available: true,
  },
  {
    provider: 'AMAZON',
    name: 'Amazon PA-API 5.0',
    tagline: 'Fichas de producto e imágenes HD (sólo lectura)',
    canPlaceOrders: false,
    docsUrl: 'https://webservices.amazon.com/paapi5/documentation/',
    signupUrl: 'https://affiliate-program.amazon.com/',
    notes:
      'Necesita cuenta de afiliado con 3 ventas en 180 días. No permite crear pedidos: para compra automática haría falta Amazon Business / SP-API.',
    available: true,
  },
  {
    provider: 'ALIBABA',
    name: 'Alibaba.com',
    tagline: 'Mayorista · disponible como scraping con proxies',
    canPlaceOrders: false,
    docsUrl: 'https://open.alibaba.com/',
    signupUrl: 'https://open.alibaba.com/',
    notes: 'La API abierta requiere ser proveedor o acuerdo comercial. De momento se trabaja con el extractor + proxies residenciales.',
    available: false,
  },
  {
    provider: 'TEMU',
    name: 'Temu',
    tagline: 'Sin API pública · scraping con proxies residenciales',
    canPlaceOrders: false,
    docsUrl: 'https://www.temu.com/',
    signupUrl: 'https://www.temu.com/',
    notes: 'Temu no ofrece API pública de dropshipping: se usa el extractor web (requiere proxies).',
    available: false,
  },
];

/** Detecta el proveedor a partir de la URL del producto */
export function detectProviderFromUrl(url: string): SupplierType | null {
  const u = url.toLowerCase();
  if (u.includes('aliexpress.')) return 'ALIEXPRESS';
  if (u.includes('cjdropshipping.') || u.includes('cjdrop')) return 'CJ_DROPSHIPPING';
  if (u.includes('amazon.') || u.includes('/dp/') || u.includes('/gp/product/')) return 'AMAZON';
  if (u.includes('alibaba.')) return 'ALIBABA';
  if (u.includes('temu.')) return 'TEMU';
  return null;
}

/** Construye el cliente de API para un proveedor con las credenciales dadas */
export function buildClient(provider: SupplierType, credentials: Record<string, string>, opts: Partial<SupplierApiContext> = {}): SupplierApiClient | null {
  const ctx: SupplierApiContext = { provider, credentials, ...opts };
  switch (provider) {
    case 'ALIEXPRESS':
      return new AliExpressClient(ctx);
    case 'CJ_DROPSHIPPING':
      return new CjClient(ctx);
    case 'AMAZON':
      return new AmazonClient(ctx);
    default:
      return null;
  }
}

/** Construye el cliente a partir de una fila SupplierAccount (descifra credenciales) */
export function clientFromAccount(account: Pick<SupplierAccount, 'provider' | 'credentialsEnc'>): SupplierApiClient | null {
  let credentials: Record<string, string> = {};
  try {
    credentials = JSON.parse(decryptSecret(account.credentialsEnc) || '{}');
  } catch {
    credentials = {};
  }
  return buildClient(account.provider, credentials);
}

/**
 * Cuenta de proveedor utilizable por el usuario para un proveedor concreto:
 * prioriza la marcada como predeterminada y, si no, la conectada más reciente.
 */
export async function findAccountForProvider(userId: string, provider: SupplierType) {
  const accounts = await prisma.supplierAccount.findMany({
    where: { userId, provider, status: 'CONNECTED' },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    take: 1,
  });
  return accounts[0] ?? null;
}

/** ¿Tiene el cliente al menos una cuenta de proveedor conectada? */
export async function hasConnectedSupplier(userId: string) {
  const count = await prisma.supplierAccount.count({ where: { userId, status: 'CONNECTED' } });
  return count > 0;
}

export interface FetchFromApiResult {
  ok: boolean;
  product?: SupplierProduct;
  error?: string;
  providerUsed?: SupplierType;
}

/**
 * Importación por API oficial: intenta usarla si el cliente tiene una cuenta
 * conectada para ese proveedor. Devuelve `ok:false` si no hay cuenta o falla,
 * para que la cascada continúe con el scraping.
 */
export async function fetchProductViaApi(input: {
  userId: string;
  url?: string;
  productId?: string;
  provider?: SupplierType;
  country?: string;
}): Promise<FetchFromApiResult> {
  const provider = input.provider ?? (input.url ? detectProviderFromUrl(input.url) : null) ?? null;
  if (!provider) return { ok: false, error: 'Proveedor no reconocido por la URL' };

  const account = await findAccountForProvider(input.userId, provider);
  if (!account) return { ok: false, error: `No hay ninguna cuenta de ${provider} conectada` };

  const client = clientFromAccount(account);
  if (!client) return { ok: false, error: `${provider} todavía no tiene API soportada` };

  try {
    const product = await client.fetchProduct({ url: input.url, productId: input.productId });
    return { ok: true, product, providerUsed: provider };
  } catch (err) {
    const message = (err as Error).message;
    await prisma.supplierAccount
      .update({ where: { id: account.id }, data: { lastError: message.slice(0, 300), status: message.includes('Faltan credenciales') ? 'PENDING' : 'ERROR' } })
      .catch(() => undefined);
    return { ok: false, error: message, providerUsed: provider };
  }
}

/** Datos simulados etiquetados, para que la demo siga funcionando sin claves */
export function simulateProduct(provider: SupplierType, id: string): SupplierProduct {
  switch (provider) {
    case 'ALIEXPRESS':
      return simulateAliExpressProduct(id);
    case 'CJ_DROPSHIPPING':
      return simulateCjProduct(id);
    case 'AMAZON':
      return simulateAmazonProduct(id);
    default:
      return simulateAliExpressProduct(id);
  }
}
