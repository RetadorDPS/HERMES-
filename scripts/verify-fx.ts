/**
 * scripts/verify-fx.ts — Verifica el cambio de divisa.
 *
 *   npm run verify:fx
 *
 * El motor de precios trabaja en EUR, pero los proveedores cobran en su divisa
 * (CJ y muchas tiendas en USD). Este script comprueba, con la base de datos
 * real, que:
 *   1. `fx.ts` convierte con la tasa configurada (y respeta el 1:1 y el aviso
 *      cuando la divisa no está en la tabla),
 *   2. el catálogo entrega el coste convertido y el precio de venta calculado
 *      sobre euros, no sobre la divisa del proveedor,
 *   3. lo que se guardaría en la ficha (coste, envío y beneficio) cuadra con la
 *      vista previa: el mismo número en los tres sitios,
 *   4. las tasas automáticas del BCE: descarga real, caché en disco, prioridad de
 *      `FX_RATES` y comportamiento cuando el feed no responde.
 *
 * Crea un artículo de catálogo temporal y lo borra al terminar.
 */
import '../workers/env';
import fs from 'node:fs';
import path from 'node:path';
import { BASE_CURRENCY, fxEnabled, fxInfo, toEur, convertCosts, fxLine, fxStatus, refreshFxRates, SUPPORTED_CURRENCIES } from '../src/lib/fx';
import { queryCatalog } from '../src/lib/catalog';
import { prisma } from '../src/lib/prisma';
import { withSystem } from '../src/lib/tenant-context';
import { computeSellingPrice } from '../src/lib/pricing';

let passed = 0;
let failed = 0;
const check = (ok: boolean, msg: string, extra = '') => {
  console.log(`${ok ? '✔' : '✘'} ${msg}${extra ? ` — ${extra}` : ''}`);
  ok ? passed++ : failed++;
};

/**
 * Tasa efectiva del dólar en este momento: sale de `FX_RATES` si está definido,
 * o de la última descarga del BCE. Los checks se comparan contra ESTA tasa (no
 * contra un número fijo), porque lo importante es que todo el sistema use la
 * misma: catálogo, vista previa, ficha y base de datos.
 */
const usdRate = () => fxStatus().rates.USD;

async function main() {
  console.log(`\n\u001b[1mCambio de divisa — verificación\u001b[0m\n`);

  // ── 1. La conversión en sí ───────────────────────────────────────────────
  check(BASE_CURRENCY === 'EUR', 'La divisa de trabajo de la tienda es EUR', BASE_CURRENCY);
  check(fxEnabled(), 'La conversión está activada (FX_ENABLED != false)');
  const usd = fxInfo('USD');
  check(usd.converted && usd.rate === usdRate(), 'USD se convierte con la tasa vigente', `1 USD = ${usd.rate} € (fuente: ${fxStatus().source})`);
  check(toEur(69, 'USD') === Math.round(69 * usdRate() * 100) / 100, '69 USD se convierten al cambio', `${toEur(69, 'USD')} €`);
  check(toEur(100, 'EUR') === 100, 'EUR no se toca (sin ida y vuelta)', '100 → 100');
  const unknown = fxInfo('XYZ');
  check(unknown.rate === 1 && unknown.unknown === true, 'Divisa desconocida: se usa 1:1 y queda marcada', `XYZ → ${unknown.rate}`);
  const conv = convertCosts({ cost: 57, shipping: 3.5 }, 'USD');
  check(conv.cost === toEur(57, 'USD') && conv.shipping === toEur(3.5, 'USD'), 'Coste y envío se convierten juntos', `${conv.cost} € + ${conv.shipping} €`);
  check(fxLine(usd, 69) === `69 USD → ${toEur(69, 'USD')} € (tipo ${usd.rate})`, 'La conversión queda en texto para el historial', fxLine(usd, 69));

  // ── 2. El catálogo entrega euros, no la divisa del proveedor ─────────────
  const marker = `FXVERIFY-${Date.now()}`;
  const created = await withSystem('verify-fx: crear artículo de prueba', () =>
    prisma.catalogItem.create({
      data: {
        source: 'api',
        provider: 'CJ_DROPSHIPPING',
        externalId: marker,
        title: `Artículo de verificación ${marker}`,
        currency: 'USD',
        costPrice: 20,
        shippingCost: 4,
        shippingMinDays: 5,
        shippingMaxDays: 12,
        shipFrom: 'CN',
        freeShipping: false,
        stock: 50,
        rating: 4.5,
        ordersCount: 10,
        tags: ['verificacion'],
        images: [],
        rawPayload: { source: 'verify-fx' },
        sourceUrl: `https://verify-fx.local/${marker}`,
        lastSyncedAt: new Date(),
      },
    }),
  );

  try {
    const rule = { name: 'Verificación FX', markupPct: 50, minProfit: 2, minPrice: 0, maxPrice: null, feeFixed: 0, roundTo: 0.99 } as any;
    const page = await queryCatalog({ search: marker, pageSize: 5, pricingRule: rule });
    const row: any = page.items.find((i) => i.externalId === marker);
    check(Boolean(row), 'El artículo de prueba aparece en el catálogo');
    if (row) {
      const expectedCost = toEur(20, 'USD');
      const expectedShip = toEur(4, 'USD');
      check(row.costPrice === 20 && row.currency === 'USD', 'El coste original y su divisa se conservan', `${row.costPrice} ${row.currency}`);
      check(row.costPriceEur === expectedCost, 'El catálogo añade el coste en euros', `${row.costPriceEur} €`);
      check(row.shippingCostEur === expectedShip, 'El envío también viaja en euros', `${row.shippingCostEur} €`);
      check(row.fx?.converted === true && row.fx?.rate === usdRate(), 'La fila informa del cambio aplicado', `tipo ${row.fx?.rate}`);

      const b = computeSellingPrice(expectedCost, expectedShip, rule, rule.name);
      check(row.sellingPrice === b.sellingPrice, 'El precio de venta se calcula sobre euros', `${row.sellingPrice} €`);
      check(row.profit === Math.round((b.sellingPrice - expectedCost - expectedShip) * 100) / 100, 'El beneficio se calcula sobre euros', `${row.profit} € frente a ${(20 + 4)} € sin convertir`);
      const wrong = b.sellingPrice - 20 - 4;
      check(row.profit !== wrong || expectedCost === 20, 'El beneficio NO es el de contar 20 USD como 20 €', `real ${row.profit} € · erróneo ${Math.round(wrong * 100) / 100} €`);
    }
  } finally {
    await withSystem('verify-fx: limpiar', () => prisma.catalogItem.deleteMany({ where: { externalId: marker } })).catch(() => undefined);
  }

  // ── 3. Coherencia con lo que se guarda en la ficha ───────────────────────
  const cost = toEur(20, 'USD');
  const shipping = toEur(4, 'USD');
  const breakdown = computeSellingPrice(cost, shipping, { name: 'x', markupPct: 50, minProfit: 2, minPrice: 0, maxPrice: null, feeFixed: 0, roundTo: 0.99 } as any, 'x');
  const storedProfit = Math.round((breakdown.sellingPrice - cost - shipping) * 100) / 100;
  check(storedProfit === breakdown.profit, 'El beneficio guardado iguala al de la vista previa', `${storedProfit} €`);
  check(Math.abs(breakdown.sellingPrice - (20 * 1.5)) > 0.5, 'El precio de venta cambia al convertir (la conversión tiene efecto)', `sin convertir sería ${20 * 1.5} €, con conversión ${breakdown.sellingPrice} €`);

  // ── 4. Tasas automáticas del BCE (gratis, sin clave) ────────────────────
  const refreshed = await refreshFxRates({ force: true });
  const status = fxStatus();
  check(refreshed.ok && status.source === 'ecb', 'Las tasas se descargan del BCE automáticamente', `fuente ${status.source} · edad ${status.ageHours} h`);
  const cacheFile = path.join(process.cwd(), 'data', 'fx-rates.json');
  check(fs.existsSync(cacheFile), 'Las tasas quedan guardadas en disco (sobreviven al reinicio)', 'data/fx-rates.json');
  const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  check(Object.keys(cached.rates ?? {}).length >= SUPPORTED_CURRENCIES.length, `Se descargan todas las divisas soportadas`, `${Object.keys(cached.rates ?? {}).length} divisas`);
  check(Number(toEur(1, 'USD')) > 0.7 && Number(toEur(1, 'USD')) < 1.15, 'El tipo del dólar está en un rango razonable', `1 USD = ${toEur(1, 'USD')} €`);

  const again = await refreshFxRates();
  check(Boolean(again.skipped) && again.ok, 'Si las tasas están frescas NO se gasta red en volver a pedirlas', again.reason);

  // Configuración manual: manda por encima de lo automático
  const previousManual = process.env.FX_RATES;
  process.env.FX_RATES = JSON.stringify({ USD: 0.5 });
  const manualStatus = fxStatus();
  const manualRefresh = await refreshFxRates();
  check(manualStatus.source === 'manual' && toEur(1, 'USD') === 0.5, 'FX_RATES manda sobre la descarga automática', `1 USD = ${toEur(1, 'USD')} €`);
  check(Boolean(manualRefresh.skipped), 'Con FX_RATES definido, el worker no descarga nada', manualRefresh.reason);
  if (previousManual === undefined) delete process.env.FX_RATES;
  else process.env.FX_RATES = previousManual;

  // Feed caído: se mantienen las últimas tasas conocidas y nada se rompe
  const previousFeed = process.env.FX_FEED_URL;
  process.env.FX_FEED_URL = 'http://127.0.0.1:9/sin-feed';
  const offline = await refreshFxRates({ force: true });
  const afterOffline = fxStatus();
  check(!offline.ok && Boolean(offline.reason), 'Feed caído: se informa del fallo sin lanzar excepción', (offline.reason ?? '').slice(0, 60));
  check(afterOffline.source === 'ecb' && afterOffline.rates.USD === status.rates.USD, 'Feed caído: se siguen usando las últimas tasas conocidas', `1 USD = ${afterOffline.rates.USD} €`);
  if (previousFeed === undefined) delete process.env.FX_FEED_URL;
  else process.env.FX_FEED_URL = previousFeed;

  console.log(`\n${passed} comprobaciones superadas · ${failed} fallidas\n`);
  if (failed > 0) {
    console.log('\u001b[41m\u001b[37m  CAMBIO DE DIVISA CON FALLOS  \u001b[0m\n');
    process.exitCode = 1;
  } else {
    console.log('\u001b[42m\u001b[30m  CAMBIO DE DIVISA VERIFICADO  \u001b[0m\n');
  }
}

main()
  .catch((err) => {
    console.error('\n✘ Error:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
