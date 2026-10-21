/**
 * src/lib/real/datos.ts — Lectura de datos REALES desde Supabase (versión estática).
 *
 * Cada función devuelve la misma forma de datos que ya usan las pantallas
 * (las mismas que producía Prisma en el servidor), para reutilizar los
 * componentes. La seguridad la pone la base de datos (RLS): cada cliente solo
 * recibe sus filas aunque la consulta no las filtre.
 *
 * Importante: las tablas con columnas secretas (User, Store, SupplierAccount,
 * Supplier, CatalogItem) se leen SIEMPRE con la lista explícita de columnas
 * permitidas; un «select *» fallaría por permisos.
 */
import { supabase } from '../supabase/cliente';
import { computeSellingPrice, DEFAULT_RULE } from '../pricing';
import type { PricingRuleLike } from '../types';
import type { CatalogFacet, CatalogQuery, CatalogResult, CatalogRow } from '../catalog';
import type { ProductListItem, StoreView } from '../data';

const COL_USUARIO = 'id,email,name,image,role,plan,timezone,lastLoginAt,emailVerifiedAt,totpEnabledAt,alertSyncFailures,alertStockChanges,alertWebhookErrors,alertBilling,alertOnboarding,createdAt';
const COL_TIENDA = 'id,userId,platform,name,domain,apiVersion,scopes,status,lastPingAt,lastError,settings,createdAt';
const COL_PROVEEDOR = 'id,type,name,baseUrl,logoUrl,isEnabled,rateLimitRpm';
const COL_CATALOGO =
  'id,provider,externalId,title,description,categoryId,categoryName,imageUrl,images,currency,costPrice,suggestedPrice,stock,rating,ordersCount,shippingCost,shippingMinDays,shippingMaxDays,shipFrom,freeShipping,isTrending,tags,sourceUrl,source,lastSyncedAt,views,importedCount,warehouses,envioResumen';

const num = (v: unknown, defecto = 0) => (v === null || v === undefined || v === '' ? defecto : Number(v));
const fecha = (v: unknown) => (v ? new Date(v as string) : null);

function comprobar<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return (r.data ?? ([] as unknown)) as T;
}

/* ───────────────────────────── Perfil y cuenta ───────────────────────────── */

export interface Perfil {
  id: string;
  email: string;
  name: string | null;
  role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'SUPPORT';
  plan: 'TRIAL' | 'STARTER' | 'PRO' | 'ENTERPRISE';
  timezone: string;
  emailVerifiedAt: Date | null;
  totpEnabledAt: Date | null;
  createdAt: Date | null;
  alertas: { sync: boolean; stock: boolean; webhooks: boolean; billing: boolean; onboarding: boolean };
}

export interface Suscripcion {
  plan: string;
  status: string;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  creditsUsed: number;
  creditsLimit: number;
  stripeSubscriptionId: string | null;
  lemonSubscriptionId: string | null;
}

export async function obtenerPerfil(): Promise<{ perfil: Perfil | null; suscripcion: Suscripcion | null }> {
  const cliente = supabase();
  const { data: auth } = await cliente.auth.getUser();
  const id = auth.user?.id;
  if (!id) return { perfil: null, suscripcion: null };

  const [u, s] = await Promise.all([
    cliente.from('User').select(COL_USUARIO).eq('id', id).maybeSingle(),
    cliente
      .from('Subscription')
      .select('plan,status,currentPeriodEnd,cancelAtPeriodEnd,creditsUsed,creditsLimit,stripeSubscriptionId,lemonSubscriptionId')
      .eq('userId', id)
      .maybeSingle(),
  ]);
  if (u.error) throw new Error(u.error.message);
  const f: any = u.data;
  const sub: any = s.data;
  return {
    perfil: f
      ? {
          id: f.id,
          email: f.email,
          name: f.name,
          role: f.role,
          plan: f.plan,
          timezone: f.timezone,
          emailVerifiedAt: fecha(f.emailVerifiedAt),
          totpEnabledAt: fecha(f.totpEnabledAt),
          createdAt: fecha(f.createdAt),
          alertas: {
            sync: f.alertSyncFailures,
            stock: f.alertStockChanges,
            webhooks: f.alertWebhookErrors,
            billing: f.alertBilling,
            onboarding: f.alertOnboarding,
          },
        }
      : null,
    suscripcion: sub
      ? {
          plan: sub.plan,
          status: sub.status,
          currentPeriodEnd: fecha(sub.currentPeriodEnd),
          cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
          creditsUsed: sub.creditsUsed,
          creditsLimit: sub.creditsLimit,
          stripeSubscriptionId: sub.stripeSubscriptionId,
          lemonSubscriptionId: sub.lemonSubscriptionId,
        }
      : null,
  };
}

export async function guardarPerfil(cambios: { name?: string; timezone?: string; alertas?: Partial<Perfil['alertas']> }) {
  const cliente = supabase();
  const { data: auth } = await cliente.auth.getUser();
  if (!auth.user) throw new Error('No hay sesión iniciada');
  const fila: Record<string, unknown> = {};
  if (cambios.name !== undefined) fila.name = cambios.name;
  if (cambios.timezone !== undefined) fila.timezone = cambios.timezone;
  const a = cambios.alertas;
  if (a?.sync !== undefined) fila.alertSyncFailures = a.sync;
  if (a?.stock !== undefined) fila.alertStockChanges = a.stock;
  if (a?.webhooks !== undefined) fila.alertWebhookErrors = a.webhooks;
  if (a?.billing !== undefined) fila.alertBilling = a.billing;
  if (a?.onboarding !== undefined) fila.alertOnboarding = a.onboarding;
  const r = await cliente.from('User').update(fila).eq('id', auth.user.id);
  if (r.error) throw new Error(r.error.message);
}

/* ───────────────────────────────── Resumen ───────────────────────────────── */

export interface ResumenCuenta {
  productos: number;
  productosAgotados: number;
  tiendas: number;
  tiendasConError: number;
  pedidos: number;
  pedidosPendientes: number;
  sinPreparar: number;
  ingresos: number;
  beneficio: number;
  reglas: number;
  cuentasProveedor: number;
  catalogo: number;
}

export async function obtenerResumen(): Promise<ResumenCuenta> {
  const c = supabase();
  const cuenta = (tabla: string, filtro?: (q: any) => any) => {
    let q: any = c.from(tabla).select('id', { count: 'exact', head: true });
    if (filtro) q = filtro(q);
    return q.then((r: any) => {
      if (r.error) throw new Error(r.error.message);
      return (r.count as number) ?? 0;
    });
  };
  const [productos, agotados, tiendas, tiendasError, pedidos, pendientes, sinPreparar, reglas, cuentasProveedor, catalogo, importes] = await Promise.all([
    cuenta('Product'),
    cuenta('Product', (q) => q.eq('status', 'OUT_OF_STOCK')),
    cuenta('Store'),
    cuenta('Store', (q) => q.eq('status', 'ERROR')),
    cuenta('Order'),
    cuenta('Order', (q) => q.eq('status', 'PENDING')),
    cuenta('Order', (q) => q.eq('fulfillmentStatus', 'UNFULFILLED')),
    cuenta('PricingRule'),
    cuenta('SupplierAccount'),
    cuenta('CatalogItem'),
    c.from('Order').select('total,profitAmount').limit(5000),
  ]);
  const filas = comprobar<any[]>(importes);
  return {
    productos,
    productosAgotados: agotados,
    tiendas,
    tiendasConError: tiendasError,
    pedidos,
    pedidosPendientes: pendientes,
    sinPreparar,
    ingresos: filas.reduce((a, f) => a + num(f.total), 0),
    beneficio: filas.reduce((a, f) => a + num(f.profitAmount), 0),
    reglas,
    cuentasProveedor,
    catalogo,
  };
}

/* ───────────────────────────────── Productos ───────────────────────────────── */

export type ProductoListado = ProductListItem & { storeId: string };

export async function obtenerProductos(): Promise<ProductoListado[]> {
  const r = await supabase()
    .from('Product')
    .select(
      'id,title,category,costPrice,sellingPrice,profitAmount,marginPct,stockTotal,status,isMonitored,lastSyncedAt,lastSyncStatus,nextSyncAt,ordersCount,ratingAvg,currency,storeId,store:Store(name),supplier:Supplier(name),images:ProductImage(url,position),variants:ProductVariant(count)',
    )
    .order('updatedAt', { ascending: false })
    .limit(1000);
  return comprobar<any[]>(r).map((p) => {
    const imagenes = ([...(p.images ?? [])] as any[]).sort((a, b) => num(a.position) - num(b.position));
    return {
      id: p.id,
      title: p.title,
      image: imagenes[0]?.url ?? null,
      category: p.category ?? 'General',
      supplierName: p.supplier?.name ?? '—',
      storeName: p.store?.name ?? 'Sin tienda',
      storeId: p.storeId ?? '',
      costPrice: num(p.costPrice),
      sellingPrice: num(p.sellingPrice),
      profitAmount: num(p.profitAmount),
      marginPct: num(p.marginPct),
      stockTotal: p.stockTotal,
      variantsCount: num(p.variants?.[0]?.count),
      status: p.status,
      isMonitored: p.isMonitored,
      lastSyncedAt: fecha(p.lastSyncedAt),
      lastSyncStatus: p.lastSyncStatus,
      nextSyncAt: fecha(p.nextSyncAt),
      ordersCount: p.ordersCount,
      ratingAvg: p.ratingAvg,
      currency: p.currency,
    } as ProductoListado;
  });
}

/* ───────────────────────────────── Tiendas ───────────────────────────────── */

export async function obtenerTiendas(): Promise<StoreView[]> {
  // Retador tiene su propia tarjeta (conexión con token); aquí solo van Shopify y WooCommerce
  const r = await supabase().from('Store').select(`${COL_TIENDA},products:Product(count),orders:Order(count)`).neq('platform', 'RETADOR').order('createdAt', { ascending: true });
  return comprobar<any[]>(r).map((s) => ({
    id: s.id,
    platform: s.platform === 'SHOPIFY' ? 'SHOPIFY' : 'WOOCOMMERCE',
    name: s.name,
    domain: s.domain,
    status: s.status,
    currency: s.settings?.currency ?? 'EUR',
    productsCount: num(s.products?.[0]?.count),
    ordersCount: num(s.orders?.[0]?.count),
    lastPingAt: fecha(s.lastPingAt),
    lastError: s.lastError,
    createdAt: new Date(s.createdAt),
    settings: s.settings ?? null,
  }));
}

export async function obtenerProveedores() {
  const r = await supabase().from('Supplier').select(`${COL_PROVEEDOR},products:Product(count)`).order('name', { ascending: true });
  return comprobar<any[]>(r).map((s) => ({
    id: s.id as string,
    type: s.type as string,
    name: s.name as string,
    productsCount: num(s.products?.[0]?.count),
    avgDelivery: '—',
    rateLimitRpm: s.rateLimitRpm as number,
    isEnabled: s.isEnabled as boolean,
  }));
}

/* ───────────────────────────────── Pedidos ───────────────────────────────── */

export async function obtenerPedidos() {
  const r = await supabase()
    .from('Order')
    .select(
      'id,storeId,status,fulfillmentStatus,storeOrderNumber,customerName,customerEmail,shippingCity,shippingCountry,total,supplierCost,profitAmount,currency,trackingNumber,trackingCompany,trackingUrl,supplierOrderId,autoFulfilled,errorMessage,orderedAt,store:Store(name),items:OrderItem(title,sku,quantity,unitPrice,productId,imageUrl)',
    )
    .order('orderedAt', { ascending: false })
    .limit(200);
  const filas = comprobar<any[]>(r).map((o) => ({
    id: o.id,
    number: o.storeOrderNumber,
    storeId: o.storeId,
    storeName: o.store?.name ?? '—',
    status: o.status,
    fulfillmentStatus: o.fulfillmentStatus,
    customerName: o.customerName ?? '—',
    customerEmail: o.customerEmail ?? '',
    shippingCity: o.shippingCity ?? '',
    shippingCountry: o.shippingCountry ?? '',
    total: num(o.total),
    supplierCost: num(o.supplierCost),
    profitAmount: num(o.profitAmount),
    currency: o.currency,
    trackingNumber: o.trackingNumber,
    trackingCompany: o.trackingCompany,
    trackingUrl: o.trackingUrl,
    supplierOrderId: o.supplierOrderId,
    autoFulfilled: o.autoFulfilled,
    errorMessage: o.errorMessage,
    orderedAt: new Date(o.orderedAt),
    items: (o.items ?? []).map((i: any) => ({
      title: i.title,
      sku: i.sku ?? '—',
      quantity: i.quantity,
      unitPrice: num(i.unitPrice),
      productId: i.productId ?? '',
      imageUrl: i.imageUrl,
    })),
  }));
  const resumen = {
    total: filas.length,
    pending: filas.filter((o) => o.status === 'PENDING').length,
    toFulfill: filas.filter((o) => o.fulfillmentStatus === 'UNFULFILLED').length,
    shipped: filas.filter((o) => o.fulfillmentStatus === 'FULFILLED').length,
    errors: filas.filter((o) => o.status === 'SUPPLIER_ERROR').length,
    revenue: Math.round(filas.reduce((a, o) => a + o.total, 0) * 100) / 100,
    profit: Math.round(filas.reduce((a, o) => a + o.profitAmount, 0) * 100) / 100,
  };
  return { pedidos: filas, resumen };
}

/* ─────────────────────────────── Reglas de precio ─────────────────────────────── */

export interface ReglaPrecio {
  id: string;
  name: string;
  markupPct: number;
  fixedFee: number;
  minProfit: number;
  minPrice: number | null;
  maxPrice: number | null;
  roundTo: number;
  includeShipping: boolean;
  applyToCategory: string | null;
  isDefault: boolean;
  isActive: boolean;
}

const mapRegla = (r: any): ReglaPrecio => ({
  id: r.id,
  name: r.name,
  markupPct: num(r.markupPct),
  fixedFee: num(r.fixedFee),
  minProfit: num(r.minProfit),
  minPrice: r.minPrice === null ? null : num(r.minPrice),
  maxPrice: r.maxPrice === null ? null : num(r.maxPrice),
  roundTo: num(r.roundTo, 0.99),
  includeShipping: r.includeShipping,
  applyToCategory: r.applyToCategory,
  isDefault: r.isDefault,
  isActive: r.isActive,
});

export async function obtenerReglas(): Promise<ReglaPrecio[]> {
  const r = await supabase().from('PricingRule').select('*').order('isDefault', { ascending: false }).order('name', { ascending: true });
  return comprobar<any[]>(r).map(mapRegla);
}

export type EntradaRegla = Omit<ReglaPrecio, 'id' | 'isActive'> & { id?: string };

export async function guardarRegla(regla: EntradaRegla) {
  const c = supabase();
  const { data: auth } = await c.auth.getUser();
  if (!auth.user) throw new Error('No hay sesión iniciada');
  const fila = {
    name: regla.name.trim(),
    markupPct: regla.markupPct,
    fixedFee: regla.fixedFee,
    minProfit: regla.minProfit,
    minPrice: regla.minPrice,
    maxPrice: regla.maxPrice,
    roundTo: regla.roundTo,
    includeShipping: regla.includeShipping,
    applyToCategory: regla.applyToCategory?.trim() || null,
    isDefault: regla.isDefault,
  };
  // Solo puede haber una regla predeterminada
  if (regla.isDefault) {
    const q = c.from('PricingRule').update({ isDefault: false }).eq('userId', auth.user.id);
    const r0 = await (regla.id ? q.neq('id', regla.id) : q);
    if (r0.error) throw new Error(r0.error.message);
  }
  const r = regla.id
    ? await c.from('PricingRule').update(fila).eq('id', regla.id)
    : await c.from('PricingRule').insert({ ...fila, userId: auth.user.id });
  if (r.error) throw new Error(r.error.message);
}

export async function borrarRegla(id: string) {
  const r = await supabase().from('PricingRule').delete().eq('id', id);
  if (r.error) throw new Error(r.error.message);
}

/* ───────────────────────────────── Catálogo ───────────────────────────────── */

const mapCatalogo = (i: any): CatalogRow => ({
  id: i.id,
  provider: i.provider,
  externalId: i.externalId,
  title: i.title,
  categoryName: i.categoryName,
  imageUrl: i.imageUrl,
  images: i.images ?? [],
  currency: i.currency,
  costPrice: num(i.costPrice),
  stock: i.stock,
  rating: i.rating === null ? null : num(i.rating),
  ordersCount: i.ordersCount,
  shippingCost: i.shippingCost === null ? null : num(i.shippingCost),
  shippingMinDays: i.shippingMinDays,
  shippingMaxDays: i.shippingMaxDays,
  shipFrom: i.shipFrom,
  warehouses: i.warehouses ?? [],
  freeShipping: i.freeShipping,
  isTrending: i.isTrending,
  source: i.source,
  lastSyncedAt: new Date(i.lastSyncedAt),
  importedCount: i.importedCount ?? 0,
  envioResumen: i.envioResumen ?? null,
});

const slugCat = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60);

/* ─────────────── Tipos de cambio (BCE) ─────────────── */

const redondear2 = (n: number) => Math.round(n * 100) / 100;

/** Euros que vale 1 unidad de cada moneda, con la fecha del BCE. Si lo guardado tiene más de 24 h, se pide a la función `fx-tasas`. */
export async function tasasEnEuros(): Promise<Record<string, { rate: number; fecha: string | null }>> {
  const c = supabase();
  const leer = async () => {
    const { data } = await c.from('FxRate').select('currency,eurPerUnit,rateDate,fetchedAt');
    return (data ?? []) as { currency: string; eurPerUnit: number | string; rateDate: string | null; fetchedAt: string }[];
  };
  let filas = await leer().catch(() => []);
  const ultima = Math.max(0, ...filas.map((f) => new Date(f.fetchedAt).getTime()));
  if (filas.length < 2 || Date.now() - ultima > 24 * 3_600_000) {
    try {
      await c.functions.invoke('fx-tasas', { body: {} });
      filas = await leer();
    } catch {
      /* se usa lo que haya guardado, con su fecha; nunca un tipo supuesto */
    }
  }
  return Object.fromEntries(filas.map((f) => [f.currency, { rate: Number(f.eurPerUnit), fecha: f.rateDate }]));
}

/**
 * Convierte el coste del proveedor a euros con el tipo de cambio real y, solo entonces, calcula precio de venta y beneficio
 * con la regla del usuario. Sin tipo de cambio NO se calcula nada (antes se trataban los dólares como si fueran euros).
 * El beneficio es ANTES del envío: el catálogo no conoce el país de destino. Tampoco se inventa un «precio antes».
 */
function conPreciosEnEuros(
  filas: CatalogRow[],
  regla: ReglaPrecio | null,
  tasas: Record<string, { rate: number; fecha: string | null }>,
  destino?: string,
): CatalogRow[] {
  // Sin regla propia se aplica la regla por defecto (40 %) y la tarjeta lo dice: es mejor ver una cifra orientativa que ninguna.
  const reglaUso = (regla ?? DEFAULT_RULE) as unknown as PricingRuleLike;
  const nombreRegla = regla?.name ?? 'regla por defecto';
  return filas.map((f) => {
    const moneda = (f.currency || 'USD').toUpperCase();
    const t = moneda === 'EUR' ? { rate: 1, fecha: null } : tasas[moneda];
    if (!t || !(t.rate > 0)) {
      return { ...f, costPriceEur: undefined, shippingCostEur: undefined, fx: { currency: moneda, rate: 0, converted: false, unknown: true } };
    }
    const costeEur = redondear2(f.costPrice * t.rate);
    // Envío cotizado al destino elegido (las cotizaciones de los proveedores van en USD)
    const resumen = destino ? f.envioResumen?.[destino] : undefined;
    const tUsd = tasas.USD;
    const envioEur = resumen && tUsd?.rate > 0 ? redondear2(resumen.precio * tUsd.rate) : null;
    const envio = destino && resumen ? { destino, precioEur: envioEur, diasMin: resumen.diasMin ?? null, diasMax: resumen.diasMax ?? null, origen: resumen.origen ?? null } : null;
    const base: CatalogRow = {
      ...f,
      costPriceEur: costeEur,
      fx: { currency: moneda, rate: Math.round(t.rate * 10000) / 10000, converted: moneda !== 'EUR', date: t.fecha },
      envio,
      envioSinCotizar: Boolean(destino) && destino !== 'CU' && !resumen,
      envioEnFicha: destino === 'CU',
      shippingMinDays: envio?.diasMin ?? null,
      shippingMaxDays: envio?.diasMax ?? null,
    };
    const b = computeSellingPrice(costeEur, envioEur ?? 0, reglaUso, nombreRegla);
    // El beneficio real descuenta el envío cuando se conoce; si no, es «antes del envío»
    const beneficio = b.sellingPrice - costeEur - (envioEur ?? 0);
    return {
      ...base,
      sellingPrice: b.sellingPrice,
      compareAtPrice: null,
      profit: redondear2(beneficio),
      profitMarginPct: redondear2((beneficio / Math.max(b.sellingPrice, 0.01)) * 100),
      reglaPorDefecto: !regla,
      beneficioConEnvio: envioEur !== null,
    };
  });
}

/** País de destino que el usuario eligió en el catálogo (se recuerda en este navegador); España si no eligió ninguno. */
function destinoGuardado(): string {
  try {
    return window.localStorage.getItem('hermes-destino') || 'ES';
  } catch {
    return 'ES';
  }
}

export async function reglaPredeterminada() {
  const reglas = await obtenerReglas().catch(() => [] as ReglaPrecio[]);
  return reglas.find((r) => r.isDefault) ?? reglas[0] ?? null;
}

/** Una tarjeta del catálogo por su identificador, con precio de venta y beneficio de la regla del usuario (para enseñar un producto recién importado). */
export async function consultarItemCatalogo(id: string, destino?: string): Promise<CatalogRow | null> {
  const { data, error } = await supabase().from('CatalogItem').select(COL_CATALOGO).eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const [regla, tasas] = await Promise.all([reglaPredeterminada(), tasasEnEuros()]);
  return conPreciosEnEuros([mapCatalogo(data)], regla, tasas, destino ?? destinoGuardado())[0] ?? null;
}

/** Consulta el catálogo común (CatalogItem) con filtros, orden, facetas y precio final con la regla del cliente. */
export async function consultarCatalogoSupabase(q: CatalogQuery = {}): Promise<CatalogResult> {
  const c = supabase();
  const pagina = Math.max(1, Number(q.page ?? 1));
  const tamano = Math.min(Math.max(Number(q.pageSize ?? 24), 4), 96);

  // «Tendencia» = estar entre el 20 % con más pedidos DE SU PROVEEDOR. Cada proveedor mide los pedidos a su manera
  // (CJ: tiendas que lo listan; AliExpress: ventas recientes), así que un número fijo no valía para los dos.
  const { data: pedidos } = await c.from('CatalogItem').select('provider,ordersCount').not('ordersCount', 'is', null).limit(5000);
  const umbralTendencia = new Map<string, number>();
  const porProv = new Map<string, number[]>();
  for (const f of (pedidos ?? []) as any[]) porProv.set(f.provider, [...(porProv.get(f.provider) ?? []), Number(f.ordersCount)]);
  for (const [prov, lista] of porProv) {
    const orden = lista.filter((n) => n > 0).sort((a, b) => b - a);
    if (orden.length) umbralTendencia.set(prov, orden[Math.max(0, Math.ceil(orden.length * 0.2) - 1)]);
  }
  const esTendencia = (provider: string, pedidosN: number | null | undefined) => {
    const u = umbralTendencia.get(provider);
    return u !== undefined && (pedidosN ?? 0) >= u && (pedidosN ?? 0) > 0;
  };

  let consulta: any = c.from('CatalogItem').select(COL_CATALOGO, { count: 'exact' });
  if (q.provider && q.provider !== 'ALL') consulta = consulta.in('provider', String(q.provider).split(',').filter(Boolean));
  if (q.category && q.category !== 'ALL') consulta = consulta.eq('categoryName', q.category);
  if (q.minPrice !== undefined) consulta = consulta.gte('costPrice', q.minPrice);
  if (q.maxPrice !== undefined) consulta = consulta.lte('costPrice', q.maxPrice);
  // Almacenes de salida: puede venir una lista separada por comas; sale cualquier producto con existencias en alguno de ellos
  if (q.shipFrom) consulta = consulta.overlaps('warehouses', String(q.shipFrom).split(',').filter(Boolean));
  if (q.freeShipping) consulta = consulta.eq('freeShipping', true);
  if (q.trending) {
    const clausulas = [...umbralTendencia.entries()].map(([prov, u]) => `and(provider.eq.${prov},ordersCount.gte.${u})`);
    consulta = clausulas.length ? consulta.or(clausulas.join(',')) : consulta.eq('id', '00000000-0000-0000-0000-000000000000');
  }
  if (q.minRating !== undefined) consulta = consulta.gte('rating', q.minRating);
  if (q.search?.trim()) {
    const t = q.search.trim().replace(/[%*,()]/g, ' ');
    consulta = consulta.or(`title.ilike.*${t}*,categoryName.ilike.*${t}*`);
  }
  switch (q.sort) {
    case 'price-asc':
      consulta = consulta.order('costPrice', { ascending: true });
      break;
    case 'price-desc':
      consulta = consulta.order('costPrice', { ascending: false });
      break;
    case 'newest':
      consulta = consulta.order('createdAt', { ascending: false });
      break;
    case 'trending':
      consulta = consulta.order('ordersCount', { ascending: false, nullsFirst: false });
      break;
    case 'rating':
      consulta = consulta.order('rating', { ascending: false, nullsFirst: false });
      break;
    default:
      consulta = consulta.order('ordersCount', { ascending: false, nullsFirst: false });
  }
  consulta = consulta.range((pagina - 1) * tamano, pagina * tamano - 1);

  const [pag, global] = await Promise.all([
    consulta,
    c.from('CatalogItem').select('provider,source,categoryName,freeShipping,isTrending,ordersCount,costPrice,lastSyncedAt,warehouses').limit(5000),
  ]);
  if (pag.error) throw new Error(pag.error.message);
  const filas: CatalogRow[] = (pag.data as any[]).map(mapCatalogo).map((f) => ({ ...f, isTrending: esTendencia(f.provider, f.ordersCount) }));
  const todos = comprobar<any[]>(global);
  const total = pag.count ?? filas.length;

  const conteo = new Map<string, number>();
  for (const f of todos) if (f.categoryName) conteo.set(f.categoryName, (conteo.get(f.categoryName) ?? 0) + 1);
  const facets: CatalogFacet[] = [...conteo.entries()]
    .map(([name, count]) => ({ name, slug: slugCat(name), count, imageUrl: null }))
    .sort((a, b) => b.count - a.count);

  const porProveedor = new Map<string, { count: number; hasReal: boolean }>();
  let reales = 0;
  let muestra = 0;
  let ultima: Date | null = null;
  for (const f of todos) {
    const e = porProveedor.get(f.provider) ?? { count: 0, hasReal: false };
    e.count += 1;
    if (f.source === 'api') {
      e.hasReal = true;
      reales += 1;
      const d = new Date(f.lastSyncedAt);
      if (!ultima || d > ultima) ultima = d;
    }
    if (f.source === 'sample') muestra += 1;
    porProveedor.set(f.provider, e);
  }
  const almacenes = new Map<string, number>();
  for (const f of todos) for (const w of (f.warehouses ?? []) as string[]) almacenes.set(w, (almacenes.get(w) ?? 0) + 1);
  const precios = todos.map((f) => num(f.costPrice));
  const [regla, tasas] = await Promise.all([reglaPredeterminada(), tasasEnEuros()]);

  return {
    items: conPreciosEnEuros(filas, regla, tasas, q.shipTo ?? destinoGuardado()),
    total,
    page: pagina,
    pages: Math.max(1, Math.ceil(total / tamano)),
    facets,
    providers: [...porProveedor.entries()].map(([provider, v]) => ({ provider: provider as any, count: v.count, hasReal: v.hasReal })),
    stats: {
      total: todos.length,
      real: reales,
      sample: muestra,
      lastSyncedAt: ultima,
      freeShipping: todos.filter((f) => f.freeShipping).length,
      trending: todos.filter((f) => esTendencia(f.provider, f.ordersCount)).length,
    },
    priceRange: { min: precios.length ? Math.min(...precios) : 0, max: precios.length ? Math.max(...precios) : 0 },
    warehouses: [...almacenes.entries()].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count),
  };
}

/* ───────────────────────────────── Administración ───────────────────────────────── */

export interface ClienteAdmin {
  id: string;
  email: string;
  name: string | null;
  role: string;
  plan: string;
  createdAt: Date;
  lastLoginAt: Date | null;
  emailVerified: boolean;
}

/** Solo el operador (rol ADMIN) recibe a todos los clientes; para el resto la base devuelve solo su propia ficha. */
export async function obtenerClientes(): Promise<ClienteAdmin[]> {
  const r = await supabase().from('User').select('id,email,name,role,plan,createdAt,lastLoginAt,emailVerifiedAt').order('createdAt', { ascending: false }).limit(500);
  return comprobar<any[]>(r).map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    plan: u.plan,
    createdAt: new Date(u.createdAt),
    lastLoginAt: fecha(u.lastLoginAt),
    emailVerified: Boolean(u.emailVerifiedAt),
  }));
}
