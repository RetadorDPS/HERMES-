/**
 * Categorías SENCILLAS del catálogo: los proveedores usan cientos de categorías finas y casi siempre en inglés (CJ tiene más de
 * 300: «Speakers», «Solar Lamps», «Blazers»…). Aquí se agrupan en las categorías generales de Retador (mismo identificador
 * que en Retador: «hogar», «moda»…), para que el usuario elija entre pocas y entendibles.
 *
 * Cómo se decide (sin inventar nada: solo se leen la categoría del proveedor y el título):
 *  1. Manda la categoría del proveedor (corta y fiable). Se recorren los grupos EN ORDEN y gana el primero que tenga una palabra
 *     que aparezca. El orden importa: lo más concreto va antes («Pet Sweaters» es de mascotas, no de moda).
 *  2. Si la categoría no dice nada (o no hay), se mira el título: gana la palabra que aparece ANTES en el título (el nombre del
 *     producto suele ir delante: «Auriculares inalámbricos… para deporte» es electrónica); a igual posición, el grupo que va antes.
 *  3. Si nada encaja: «otros».
 *
 * La MISMA lista la usa la base de datos (función `grupo_catalogo`, generada desde este archivo con
 * `npx tsx scripts/catalogo/generar-grupos-sql.ts`): si se cambia aquí, hay que regenerar y aplicar la migración.
 */

import type { CatalogFacet } from '@/lib/catalog';

export interface GrupoCatalogo {
  /** Identificador de la categoría de Retador */
  id: string;
  /** Nombre para el usuario */
  nombre: string;
  /** Palabras (minúsculas, sin tildes). Un espacio al principio o al final exige que la palabra empiece o acabe ahí. */
  palabras: string[];
}

export const GRUPOS_CATALOGO: GrupoCatalogo[] = [
  {
    id: 'mascotas',
    nombre: 'Mascotas',
    palabras: [' pet ', ' pets ', 'mascota', ' dog', 'perro', ' cat ', ' cats ', 'gato', 'barking', 'kitten', 'puppy', 'cachorro', 'aquarium', 'acuario', 'bird cage', 'jaula'],
  },
  {
    id: 'bebes',
    nombre: 'Bebés y juguetes',
    palabras: ['baby', 'bebe', 'newborn', 'recien nacido', 'toddler', 'maternidad', 'maternity', 'embarazo', 'pregnan', ' toy', 'juguete', 'jugar ', 'plush', 'peluche', 'stuffed', ' doll ', ' dolls ', 'muneca', 'figura', 'figure', 'puzzle', 'rompecabezas', 'building block', 'lego', 'stroller', 'carrito de bebe', 'pacifier', 'chupete', 'biberon', 'feeding bottle', 'diaper', 'panal'],
  },
  {
    id: 'vehiculos',
    nombre: 'Vehículos',
    palabras: [' car ', ' cars ', 'automobile', 'automovil', 'automotive', 'vehicle', 'vehiculo', ' coche', 'motorcycle', 'motocicleta', ' moto ', 'scooter', 'dash cam', 'faros de coche', 'car accessor', 'exterior parts', 'interior parts', 'piezas exteriores', 'piezas interiores', 'exterior accessor', 'accesorios de interior', 'seat cover', 'funda de asiento', ' tire ', ' tires ', 'neumatico', 'wiper', 'limpiaparabrisas'],
  },
  {
    id: 'belleza',
    nombre: 'Belleza',
    palabras: ['makeup', 'make up', 'maquillaje', 'cosmetic', 'cosmetico', 'lipstick', 'labial', 'eyelash', 'pestana', 'eyeshadow', 'mascara de pestanas', ' nail ', ' nails ', 'manicur', 'pedicur', 'esmalte', 'skin care', 'skincare', 'cuidado de la piel', 'facial', 'face care', 'serum', 'beauty', 'belleza', ' hair', 'cabello', ' pelo', 'peluca', ' wig ', ' wigs ', 'braid', 'trenza', 'straighten', 'plancha de pelo', 'curling', 'rizador', 'shampoo', 'champu', 'razor', 'shaver', 'afeitad', 'depilad', 'epilat', 'trimmer', 'barber', 'barberia', 'perfume', 'fragrance', 'colonia', 'cologne', 'essential oil', 'aceite esencial', 'body care', 'cuidado corporal', 'cuidado personal', 'personal care', 'higiene', 'oral care', 'toothbrush', 'cepillo de dientes', 'face mask', 'mascarilla'],
  },
  {
    id: 'salud',
    nombre: 'Salud y fitness',
    palabras: ['fitness', 'bodybuilding', 'culturismo', 'dumbbell', 'mancuerna', 'resistance band', 'yoga mat', 'esterilla', 'gym equipment', 'workout', 'health', 'salud', 'medical', 'medico', 'massage', 'masaje', 'massager', 'masajeador', 'thermometer', 'termometro', 'blood pressure', 'tensiometro', 'supplement', 'suplemento', 'vitamin', 'vitamina', 'posture', 'postura', 'orthopedic', 'ortopedic'],
  },
  // Antes que «Moda»: un reloj inteligente es electrónica y una funda de piel de móvil no es ropa
  { id: 'electronica', nombre: 'Electrónica', palabras: ['smartwatch', 'smart watch', 'smart wristband', 'smart band', 'fitness tracker', ' cases ', 'cases for', 'phone case', 'fundas y carcasas', 'screen protector', 'protector de pantalla'] },
  // Antes que «Moda»: la ropa de cama y los textiles de casa son del hogar
  { id: 'hogar', nombre: 'Hogar', palabras: ['ropa de cama', 'bedding', 'pillow', 'almohada', 'cushion', 'cojin', 'duvet', 'edredon', 'sabana', 'blanket', ' manta', 'curtain', 'cortina', 'towel', 'toalla', 'textil de hogar', 'home textile'] },
  {
    id: 'moda',
    nombre: 'Moda',
    palabras: [
      // calzado (antes que deportes: «Soccer Shoes» y «Basketball Shoes» son calzado)
      'shoe', 'zapat', 'calzado', 'sneaker', 'zapatilla', 'trainers', 'boots', ' boot ', ' bota', 'sandal', 'sandalia', 'slipper', 'chancla', 'pantufla', 'loafer', 'mocasin', 'pumps', ' flats', 'heels', 'tacon', 'vulcaniz', 'insole', 'plantilla',
      // bolsos y complementos
      'handbag', ' bag', 'bags', 'bolso', 'purse', 'backpack', 'mochila', 'wallet', 'cartera', 'portatarjeta', 'tote', 'clutch', 'crossbody', 'briefcase', 'maletin', 'luggage', 'maleta', 'equipaje', 'belt', 'cinturon', 'cummerbund', 'scarf', 'scarves', 'bufanda', 'panuelo', 'glove', 'guante', 'mitten', 'manopla', 'sunglass', 'gafas de sol', 'eyewear', 'keychain', 'llavero', ' hat ', ' hats ', ' cap ', ' caps ', 'gorra', 'gorro', 'sombrero', 'beanie',
      // joyas y relojes
      'jewel', 'joya', 'joyeria', 'necklace', 'collar ', 'collares', 'pendant', 'colgante', 'bracelet', 'pulsera', 'bangle', 'brazalete', 'earring', 'pendiente', 'arete', ' ring ', ' rings ', 'anillo', 'charm', 'silver', ' plata ', 'watch', 'reloj', 'wristband',
      // ropa
      'dress', 'vestido', 'blouse', 'blusa', 'shirt', 'camisa', 'camiseta', ' tee ', 't-shirt', ' top ', ' tops ', 'camis', ' tank ', ' tanks ', 'skirt', 'falda', 'pants', 'pantalon', 'trousers', 'jeans', 'vaquero', 'shorts', 'leggings', 'capris', 'jumpsuit', ' mono ', 'romper', ' overalls', 'hoodie', 'sudadera', 'sweatshirt', 'sweater', 'jersey', 'jerse', 'cardigan', 'knit', 'jacket', 'chaqueta', ' coat ', ' coats ', 'abrigo', 'trench', 'gabardina', 'parka', 'blazer', 'americana', ' suit ', ' suits ', 'traje', ' vest ', ' vests ', 'chaleco', ' down ', 'plumifero', 'wool', ' lana ', 'leather', 'cuero', 'suede', 'bikini', 'swimwear', 'swimsuit', 'banador', 'one-piece', 'two-piece', 'lingerie', 'lenceria', 'underwear', 'ropa interior', ' bra ', ' bras ', 'sujetador', 'panties', 'bragas', 'boxer', 'socks', 'calcetin', 'sleepwear', 'pajama', 'pijama', ' robe ', ' robes ', ' bata ', 'lounge', 'clothing', 'clothes', 'ropa de mujer', 'ropa de hombre', 'ropa de nin', 'ropa deportiva', 'apparel', 'women', 'woman', 'mujer', ' men ', ' mens ', ' man ', 'hombre', 'lady', 'ladies', 'girl', 'nina', 'boy', 'nino', 'children', 'kids', 'cosplay', 'disfraz', 'costume', ' solid ', ' striped ', ' print ', ' patterned ', ' fabric ',
    ],
  },
  {
    id: 'deportes',
    nombre: 'Deportes',
    palabras: ['sport', 'deport', 'cycling', 'ciclismo', 'bicycle', 'bicicleta', ' bike', 'fishing', 'pesca', ' lure', 'senuelo', 'camping', 'hiking', 'senderismo', 'hunting', ' caza', 'climbing', 'escalada', ' tent', 'tienda de campana', 'soccer', 'futbol', 'football', 'basketball', 'baloncesto', 'baseball', 'beisbol', 'tennis', 'tenis', 'golf', ' ski ', 'esqui', 'swim', 'natacion', 'skate', 'patin', 'helmet', 'casco', 'running', 'correr'],
  },
  {
    id: 'electronica',
    nombre: 'Electrónica',
    palabras: ['phone', 'telefono', 'movil', 'smartphone', 'iphone', 'samsung', 'xiaomi', ' case ', ' cases ', 'fundas y carcasas', 'carcasa', 'screen protector', 'protector de pantalla', 'tempered glass', 'charger', 'cargador', 'charging', 'power bank', 'bateria externa', 'cable', 'adapter', 'adaptador', 'usb', 'earphone', 'earbud', 'headphone', 'headset', 'auricular', 'audifono', 'speaker', 'altavoz', 'audio', 'amplifier', 'amplificador', 'microphone', 'microfono', 'camera', 'camara', 'lens', 'lente', 'tripod', 'tripode', 'drone', 'dvr', 'surveillance', 'vigilancia', 'security camera', 'alarm', 'alarma', 'sensor', 'gps', 'tracker', 'localizador', 'smart home', 'hogar inteligente', 'inteligencia familiar', 'network', 'dispositivos de red', 'router', 'wifi', 'computer', 'ordenador', 'laptop', 'portatil de ', 'tablet', 'keyboard', 'teclado', 'mouse', 'raton', 'printer', 'impresora', 'projector', 'proyector', ' tv ', 'television', 'gaming', 'gamer', ' game', 'videojuego', 'juegos y accesorios', 'console', 'consola', 'controller', ' mando', 'periferico', 'electronic', 'electronica', 'componentes activos', 'housing', 'smartwatch', 'smart watch', 'battery', 'batteries', 'baterias', ' pilas ', 'storage device', 'almacenamiento externo', 'power station', 'estacion de energia', 'generador', 'generator', 'memory card', 'tarjeta de memoria', 'video', ' radio'],
  },
  {
    id: 'educacion',
    nombre: 'Educación y oficina',
    palabras: ['stationery', 'papeleria', 'office supplies', 'office school', 'material de oficina', 'school', 'escuela', 'escolar', ' pen ', ' pens ', 'boligrafo', 'pencil', 'lapiz', 'lapices', 'notebook', 'cuaderno', 'paper', 'papel', ' book', ' books', 'libro', 'learning', 'aprendizaje', 'educa', 'printed media', 'medios impresos'],
  },
  {
    id: 'herramientas',
    nombre: 'Herramientas',
    palabras: ['power tool', 'herramienta electrica', 'herramientas electricas', 'hand tool', 'herramientas manuales', 'herramienta manual', 'tool set', 'sets de herramientas', 'juego de herramientas', 'recambios de herramientas', 'drill', 'taladro', 'broca', ' saw', 'sierra', 'wrench', 'llave inglesa', 'screwdriver', 'destornillador', 'hammer', 'martillo', 'pliers', 'alicate', 'abrasiv', 'welding', 'soldadura', 'solder', 'hardware', 'ferreteria', 'screw', 'tornillo', 'measur', 'medicion', 'multimeter', 'multimetro', ' tape ', ' tapes ', 'adhesiv', 'fontaneria', 'plumbing', 'electrical equipment', 'equipamiento electrico', 'safety supplies', 'seguridad laboral', 'workplace', 'construction', 'construccion', 'paint tool', 'herramienta'],
  },
  {
    id: 'hogar',
    nombre: 'Hogar',
    palabras: ['furniture', 'mueble', 'sofa', 'chair', 'silla', ' table ', ' tables ', ' mesa', 'desk', 'escritorio', 'shelf', 'estante', 'cabinet', 'armario', 'wardrobe', 'kitchen', 'cocina', 'cooking', 'molde', 'ice cube', 'cubitos de hielo', 'cookware', 'utensil', 'knife', 'knives', 'cuchillo', 'drinkware', 'dinnerware', 'tableware', 'vajilla', ' cup ', ' cups ', ' mug', 'taza', 'bottle', 'botella', 'jar', 'tarro', 'lamp', 'lampara', 'light', 'luz', 'luces', 'lighting', 'iluminacion', 'foco', 'floodlight', 'spotlight', 'downlight', 'flashlight', 'torch', 'linterna', 'bulb', 'bombilla', 'solar', 'storage', 'almacenamiento', 'organizer', 'organizador', 'organizacion', 'basket', 'cesta', 'hanger', 'percha', 'garden', 'jardin', 'jardineria', 'planter', 'maceta', 'bedding', 'ropa de cama', 'sabana', 'blanket', 'manta', 'pillow', 'almohada', 'cojin', 'cushion', 'duvet', 'edredon', 'curtain', 'cortina', 'towel', 'toalla', 'textil', 'bathroom', 'bano', 'shower', 'ducha', 'appliance', 'electrodomestico', 'cleaning', 'limpieza', 'vacuum', 'aspiradora', 'fan ', 'ventilador', 'heater', 'calefactor', 'decor', 'decoracion', 'ornament', 'ornamental', 'adorno', 'wall art', ' vase', 'jarron', ' frame', ' marco', ' puerta', ' ventana', 'home', 'hogar', 'household', 'casa'],
  },
  {
    id: 'arte',
    nombre: 'Arte y manualidades',
    palabras: ['craft', 'manualidad', 'artesania', 'handmade', 'hecho a mano', 'sewing', 'costura', 'painting', 'pintura', 'diamond painting', 'cross stitch', 'punto de cruz', ' diy ', 'instrument', 'instrumento', 'guitar', 'guitarra', 'piano', 'ukulele', ' drum', 'tambor', 'collectible', 'coleccion', 'hobbies'],
  },
  {
    id: 'eventos',
    nombre: 'Fiestas y eventos',
    palabras: ['party', 'fiesta', 'festiv', 'event', 'evento', 'wedding', 'boda', 'balloon', 'globo', 'birthday', 'cumpleanos', 'christmas', 'navidad', 'halloween'],
  },
];

/** Grupo final para lo que no encaja en ninguno. */
export const GRUPO_OTROS: Pick<GrupoCatalogo, 'id' | 'nombre'> = { id: 'otros', nombre: 'Otros' };

/** Nombre para enseñar de un grupo (o el propio identificador si no se conoce). */
export function nombreGrupo(id: string | null | undefined): string {
  if (!id) return GRUPO_OTROS.nombre;
  return GRUPOS_CATALOGO.find((g) => g.id === id)?.nombre ?? (id === GRUPO_OTROS.id ? GRUPO_OTROS.nombre : id);
}

/** Minúsculas, sin tildes, solo letras y números, con un espacio al principio y al final (para las palabras con borde). */
export function normalizarTexto(texto: string | null | undefined): string {
  const limpio = String(texto ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return ` ${limpio} `;
}

/** Grupo por la categoría del proveedor: el primero de la lista con alguna palabra presente. */
function primerGrupo(texto: string): string | null {
  if (!texto.trim()) return null;
  for (const g of GRUPOS_CATALOGO) {
    if (g.palabras.some((p) => texto.includes(normalizarPalabra(p)))) return g.id;
  }
  return null;
}

/** La palabra se normaliza igual que el texto, pero conservando los espacios de borde que pide la regla. */
export function normalizarPalabra(p: string): string {
  const inicio = p.startsWith(' ') ? ' ' : '';
  const fin = p.endsWith(' ') ? ' ' : '';
  return inicio + normalizarTexto(p).trim() + fin;
}

/** Grupo por el título: el de la palabra que aparece antes; a igual posición, el grupo que va antes en la lista. */
function grupoPorTitulo(texto: string): string | null {
  if (!texto.trim()) return null;
  let mejor: { pos: number; id: string } | null = null;
  for (const g of GRUPOS_CATALOGO) {
    for (const p of g.palabras) {
      const pos = texto.indexOf(normalizarPalabra(p));
      if (pos >= 0 && (!mejor || pos < mejor.pos)) mejor = { pos, id: g.id };
    }
  }
  return mejor?.id ?? null;
}

/** Grupo sencillo de un producto: primero por su categoría del proveedor, luego por el título; si nada encaja, «otros». */
export function grupoDeProducto(titulo: string | null | undefined, categoriaProveedor: string | null | undefined): string {
  return primerGrupo(normalizarTexto(categoriaProveedor)) ?? grupoPorTitulo(normalizarTexto(titulo)) ?? GRUPO_OTROS.id;
}

/** Tarjetas de «Explora por categoría»: un grupo por tarjeta (el identificador va en `slug`), los más grandes primero y «Otros» al final. */
export function facetasDeGrupos(lista: Array<{ id: string; count: number; imagen: string | null }>): CatalogFacet[] {
  return lista
    .filter((g) => g.count > 0)
    .map((g) => ({ name: nombreGrupo(g.id), slug: g.id, count: g.count, imageUrl: g.imagen }))
    .sort((a, b) => (a.slug === GRUPO_OTROS.id ? 1 : b.slug === GRUPO_OTROS.id ? -1 : b.count - a.count));
}
