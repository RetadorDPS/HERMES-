/**
 * src/lib/catalog/sample.ts — Catálogo de MUESTRA.
 *
 * Para que un usuario nuevo vea un catálogo navegable desde el primer segundo
 * (sin esperar a que el worker descargue nada), la plataforma trae un catálogo
 * de muestra pre-cargado. Está **etiquetado** (`source: 'sample'`) y la interfaz
 * lo dice con claridad: sirve para explorar y probar el flujo completo, y en
 * cuanto lleguen las claves reales el worker lo sustituye por el del proveedor.
 *
 * Los precios son realistas (coste en euros del proveedor, no precio de venta).
 */
import type { SupplierType } from '@prisma/client';

export interface SampleItem {
  provider: SupplierType;
  externalId: string;
  title: string;
  categoryName: string;
  imageUrl: string;
  costPrice: number;
  stock: number;
  rating: number;
  ordersCount: number;
  shippingCost: number;
  shippingMinDays: number;
  shippingMaxDays: number;
  shipFrom: string;
  freeShipping: boolean;
  isTrending: boolean;
  tags: string[];
  variantTitles: string[];
}

const CATEGORY_IMAGES: Record<string, string> = {
  'Relojes y wearables': '/catalog/sample-wearables.jpg',
  'Audio y auriculares': '/catalog/sample-audio.jpg',
  'Hogar inteligente': '/catalog/sample-home.jpg',
  'Mascotas': '/catalog/sample-pets.jpg',
  'Fitness y deporte': '/catalog/sample-fitness.jpg',
  'Belleza y cuidado': '/catalog/sample-beauty.jpg',
};

export const SAMPLE_CATEGORIES = Object.keys(CATEGORY_IMAGES).map((name, i) => ({
  name,
  slug: name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
  imageUrl: CATEGORY_IMAGES[name],
  sortOrder: i,
  itemCount: 0,
}));

/** Definición compacta: título, coste, stock, valoración, pedidos, envío, almacén */
type Row = [title: string, cost: number, stock: number, rating: number, orders: number, shipCost: number, days: number, shipFrom: string, tags: string];

const DATA: Record<string, Row[]> = {
  'Relojes y wearables': [
    ['Reloj inteligente AMOLED 1.96" con llamadas Bluetooth y 100 modos deportivos', 11.54, 1198, 4.8, 4120, 0, 12, 'CN', 'tendencia,amoled,ip68'],
    ['Smartwatch deportivo con GPS, SpO2 y batería de 14 días', 18.9, 640, 4.7, 2310, 0, 14, 'CN', 'gps,deporte,regalo'],
    ['Correa de silicona líquida para Apple Watch 38-45 mm (pack 3)', 2.35, 5200, 4.9, 18900, 0, 9, 'CN', 'apple,correa,pack'],
    ['Banda de actividad con pantalla a color y monitor de sueño', 8.2, 1500, 4.6, 7800, 1.45, 11, 'CN', 'fitness,barato'],
    ['Reloj infantil con GPS y botón SOS para padres', 15.4, 430, 4.5, 1560, 0, 15, 'CN', 'infantil,gps,sos'],
    ['Soporte de carga magnético 3 en 1 para reloj, móvil y auriculares', 6.8, 2200, 4.7, 3400, 0, 10, 'ES', 'carga,magnetico,magSafe'],
  ],
  'Audio y auriculares': [
    ['Auriculares TWS con cancelación activa de ruido y estuche de carga', 13.2, 3400, 4.8, 15600, 0, 11, 'CN', 'anc,tws,tendencia'],
    ['Auriculares inalámbricos deportivos IPX7 con gancho de oreja', 7.9, 2800, 4.6, 9200, 0, 12, 'CN', 'deporte,ipx7'],
    ['Altavoz Bluetooth portátil 20 W resistente al agua IPX6', 12.4, 1900, 4.7, 6100, 1.9, 13, 'CN', 'altavoz,ipx6,playa'],
    ['Micrófono de solapa inalámbrico para móvil y cámara (2 emisores)', 19.5, 870, 4.8, 4300, 0, 10, 'CN', 'creadores,mic'],
    ['Auriculares con cable USB-C con micrófono y control en línea', 3.1, 6400, 4.5, 22000, 0, 8, 'CN', 'barato,cable'],
    ['Adaptador Bluetooth 5.3 para coche con manos libres y doble USB', 4.7, 3100, 4.6, 8400, 0, 9, 'CN', 'coche,bluetooth'],
  ],
  'Hogar inteligente': [
    ['Tira LED RGB inteligente 5 m con WiFi y control por app', 6.4, 7200, 4.7, 31000, 0, 10, 'CN', 'rgb,wifi,hogar'],
    ['Bombilla LED inteligente E27 RGB compatible con Alexa y Google', 4.2, 5600, 4.6, 18700, 0, 9, 'CN', 'alexa,google,rgb'],
    ['Enchufe inteligente WiFi con medición de consumo (2 uds)', 9.8, 3300, 4.8, 11200, 0, 11, 'ES', 'enchufe,wifi,mide'],
    ['Cámara de vigilancia WiFi 2K con visión nocturna y seguimiento', 17.6, 2100, 4.7, 7400, 0, 12, 'CN', 'camara,seguridad'],
    ['Sensor de puerta y ventana inteligente con alertas al móvil', 3.9, 4100, 4.5, 5200, 0, 12, 'CN', 'sensor,seguridad'],
    ['Robot aspirador compacto 3 en 1 con mapeo y app', 78.5, 320, 4.6, 2100, 0, 18, 'ES', 'robot,aspirador,premium'],
  ],
  Mascotas: [
    ['Fuente de agua automática para mascotas 2,5 L con filtro y luz LED', 12.8, 1800, 4.8, 8600, 0, 12, 'CN', 'gatos,perros,fuente'],
    ['Cepillo desenredante automático para perros y gatos (autolimpiable)', 5.6, 3900, 4.7, 15400, 0, 10, 'CN', 'pelo,cepillo'],
    ['Cama ortopédica para perros medianos con funda lavable', 21.4, 640, 4.6, 3200, 2.4, 14, 'ES', 'cama,descanso'],
    ['Bebedero y comedero doble antideslizante de acero inoxidable', 8.9, 2600, 4.5, 6100, 0, 11, 'CN', 'comedero'],
    ['Cortapelo eléctrico silencioso para mascotas con 4 peines', 16.2, 1200, 4.6, 4800, 0, 12, 'CN', 'pelo,maquina'],
    ['Arnés antitirón ajustable con correa reflectante', 4.8, 4400, 4.7, 9800, 0, 9, 'CN', 'paseo,arnes'],
  ],
  'Fitness y deporte': [
    ['Comba digital con contador de calorías y lastre ajustable', 5.2, 5100, 4.7, 14300, 0, 9, 'CN', 'cardio,comba'],
    ['Banda elástica de resistencia (set de 5 niveles con anclaje)', 7.4, 3600, 4.8, 12600, 0, 10, 'ES', 'fuerza,bandas'],
    ['Rodillo abdominal con rueda doble y alfombrilla', 6.1, 2900, 4.6, 8700, 0, 10, 'CN', 'core,abdominales'],
    ['Pistola de masaje muscular 4 cabezales y 30 velocidades', 23.8, 1100, 4.7, 5400, 0, 12, 'ES', 'recuperacion,masaje'],
    ['Guantes de entrenamiento con muñequera integrada', 3.6, 6200, 4.5, 7100, 0, 8, 'CN', 'gimnasio,guantes'],
    ['Mancuernas ajustables 2 en 1 (par, 2 × 10 kg)', 42.5, 480, 4.6, 1900, 0, 16, 'ES', 'fuerza,peso'],
  ],
  'Belleza y cuidado': [
    ['Cepillo limpiador facial eléctrico con 5 cabezales y base de carga', 11.9, 1900, 4.7, 9200, 0, 11, 'CN', 'facial,limpieza'],
    ['Secador de pelo iónico plegable 1800 W con difusor', 14.5, 1400, 4.6, 5600, 0, 12, 'CN', 'pelo,secador'],
    ['Plancha alisadora cerámica con control de temperatura digital', 13.2, 1700, 4.7, 7300, 0, 11, 'CN', 'pelo,plancha'],
    ['Depiladora eléctrica de precisión recargable (4 en 1)', 9.4, 2300, 4.5, 4100, 0, 10, 'CN', 'depilacion'],
    ['Masajeador facial con calor y vibración para el contorno de ojos', 8.7, 1600, 4.6, 3800, 0, 10, 'ES', 'skincare,masaje'],
    ['Kit de manicura profesional 12 piezas con luz UV portátil', 16.9, 900, 4.6, 2900, 1.6, 13, 'CN', 'unas,kit'],
  ],
};

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 70);

/** Catálogo de muestra completo (determinista: siempre el mismo). */
export function sampleCatalogItems(): SampleItem[] {
  const items: SampleItem[] = [];
  let n = 0;
  for (const [categoryName, rows] of Object.entries(DATA)) {
    rows.forEach((row, i) => {
      const [title, cost, stock, rating, orders, shippingCost, days, shipFrom, tags] = row;
      n += 1;
      // Reparto realista: la mayoría de CJ (almacén propio y envío rápido) y el
      // resto de AliExpress, como ocurrirá con el catálogo real.
      const provider: SupplierType = n % 3 === 0 ? 'ALIEXPRESS' : 'CJ_DROPSHIPPING';
      items.push({
        provider,
        externalId: `sample-${slugify(categoryName).slice(0, 12)}-${i + 1}`,
        title,
        categoryName,
        imageUrl: CATEGORY_IMAGES[categoryName],
        costPrice: cost,
        stock,
        rating,
        ordersCount: orders,
        shippingCost,
        shippingMinDays: days,
        shippingMaxDays: days + 9,
        shipFrom,
        freeShipping: shippingCost === 0,
        isTrending: orders > 6000 || tags.includes('tendencia'),
        tags: tags.split(',').map((t) => t.trim()),
        variantTitles: CATEGORY_IMAGES[categoryName].includes('wearables')
          ? ['Negro', 'Plata', 'Oro rosa']
          : CATEGORY_IMAGES[categoryName].includes('audio')
            ? ['Blanco', 'Negro']
            : ['Estándar'],
      });
    });
  }
  return items;
}

export const SAMPLE_IMAGE_FOR_CATEGORY = (name: string | null | undefined) => (name ? CATEGORY_IMAGES[name] ?? null : null);
