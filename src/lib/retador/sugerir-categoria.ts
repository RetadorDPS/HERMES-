/**
 * Sugerencia de categoría de Retador para un producto del proveedor.
 *
 * Retador tiene su propia lista cerrada de categorías y subcategorías (la que informa `dropship-config`); los proveedores (CJ y
 * AliExpress) usan otras, casi siempre en inglés. Aquí se compara el título y la categoría del proveedor con palabras clave y se
 * propone la categoría de Retador más cercana. NUNCA se inventa una categoría: la sugerencia solo vale si la categoría y la
 * subcategoría existen en la lista que Retador acaba de enviar. La persona siempre confirma con un clic; no se aplica sola.
 */
import type { CategoriaRetador } from '@/lib/real/retador';

export interface SugerenciaCategoria {
  cat: string;
  nombreCat: string;
  subcat: string;
  /** true si nada encajaba y se propone «Otros / Varios» (solo si Retador tiene esa categoría). */
  porDefecto?: boolean;
}

/** Cada regla: palabras (en minúsculas, sin tildes) y el destino en Retador. Van de lo más concreto a lo más general. */
const REGLAS: Array<{ palabras: string[]; cat: string; subcat: string }> = [
  // Depilación y afeitado va primero: un «para mujer» o «para hombre» en el título no debe convertirla en ropa (solo si Retador tiene esa subcategoría)
  { palabras: ['depilad', 'epilat', 'afeitad', 'shaver', 'razor', 'trimmer'], cat: 'belleza', subcat: 'Depilación y afeitado' },
  // Moda
  { palabras: ['zapat', 'sneaker', 'shoe', 'footwear', 'calzado', 'boot', 'bota', 'sandal', 'slipper', 'chancla', 'loafer', 'heels', 'tacon', 'tenis', 'zapatilla', 'insole', 'plantilla'], cat: 'moda', subcat: 'Zapatos' },
  { palabras: ['handbag', 'bolso', 'purse', 'backpack', 'mochila', 'wallet', 'cartera', 'tote', 'clutch', 'crossbody', 'luggage', 'maleta'], cat: 'moda', subcat: 'Bolsos' },
  { palabras: ['watch', 'reloj'], cat: 'moda', subcat: 'Relojes' },
  { palabras: ['jewel', 'joya', 'joyeria', 'necklace', 'collar', 'bracelet', 'pulsera', 'earring', 'pendiente', 'ring ', 'anillo', 'pendant', 'silver', 'plata'], cat: 'moda', subcat: 'Joyas' },
  { palabras: ['perfume', 'fragrance', 'cologne', 'colonia'], cat: 'moda', subcat: 'Perfumes' },
  { palabras: ['cap ', 'hat', 'sombrero', 'gorra', 'beanie', 'gorro'], cat: 'moda', subcat: 'Gorras' },
  { palabras: ['bra ', 'lingerie', 'lenceria', 'underwear', 'ropa interior', 'panties', 'bragas', 'pijama', 'sleepwear'], cat: 'moda', subcat: 'Lencería' },
  { palabras: ['kids clothing', 'boys', 'girls', 'ninos', 'ninas', "children's", 'toddler'], cat: 'moda', subcat: 'Niños' },
  { palabras: ['leggings', 'yoga', 'sportswear', 'activewear', 'ropa deportiva', 'tracksuit', 'chandal', 'gym wear'], cat: 'moda', subcat: 'Deportiva' },
  { palabras: ['dress', 'vestido', 'blouse', 'blusa', 'skirt', 'falda', "women's", 'womens', 'lady', 'ladies', 'mujer', 'female', 'jacket women', 'cardigan', 'sweater women'], cat: 'moda', subcat: 'Mujer' },
  { palabras: ["men's", 'mens', 'hombre', 'male', 'camisa', 'shirt', 'hoodie', 'sudadera', 'jacket', 'chaqueta', 'jeans', 'pantalon', 'trousers', 'coat', 'abrigo', 'down jacket'], cat: 'moda', subcat: 'Hombre' },
  { palabras: ['scarf', 'bufanda', 'belt', 'cinturon', 'glove', 'guante', 'sunglass', 'gafas', 'hair clip', 'accesorio de moda', 'fashion accessor'], cat: 'moda', subcat: 'Accesorios' },
  // Electrónica
  { palabras: ['smartwatch', 'smart watch', 'band ', 'pulsera inteligente'], cat: 'electronica', subcat: 'Smartwatches' },
  { palabras: ['earphone', 'earbud', 'headphone', 'headset', 'audifono', 'auricular', 'bluetooth speaker', 'altavoz'], cat: 'electronica', subcat: 'Audífonos' },
  { palabras: ['charger', 'cargador', 'power bank', 'cable usb', 'charging', 'adapter', 'adaptador'], cat: 'electronica', subcat: 'Cargadores' },
  { palabras: ['phone case', 'funda', 'screen protector', 'mobile phone', 'telefono movil', 'smartphone', 'phone holder', 'soporte movil'], cat: 'electronica', subcat: 'Accesorios tech' },
  { palabras: ['camera', 'camara', 'tripod', 'tripode', 'drone', 'gopro', 'lens'], cat: 'electronica', subcat: 'Cámaras' },
  { palabras: ['gaming', 'gamer', 'joystick', 'controller', 'mando', 'console'], cat: 'electronica', subcat: 'Gaming' },
  { palabras: ['laptop', 'portatil', 'notebook', 'keyboard', 'teclado', 'mouse', 'raton', 'usb hub', 'webcam'], cat: 'electronica', subcat: 'Laptops' },
  { palabras: ['tablet'], cat: 'electronica', subcat: 'Tablets' },
  { palabras: ['electronic', 'electronica'], cat: 'electronica', subcat: 'Accesorios tech' },
  // Mascotas
  { palabras: ['pet toy', 'juguete para mascota', 'cat toy', 'dog toy'], cat: 'mascotas', subcat: 'Juguetes' },
  { palabras: ['pet food', 'comida para mascota'], cat: 'mascotas', subcat: 'Alimentos' },
  { palabras: ['leash', 'correa', 'harness', 'arnes', 'pet ', 'pets', 'mascota', 'dog', 'perro', 'cat ', 'gato', 'collar de perro'], cat: 'mascotas', subcat: 'Accesorios' },
  // Belleza
  { palabras: ['makeup', 'maquillaje', 'lipstick', 'labial', 'mascara', 'eyeshadow', 'sombra', 'foundation', 'base de maquillaje', 'cosmetic'], cat: 'belleza', subcat: 'Maquillaje' },
  { palabras: ['skincare', 'skin care', 'serum', 'cream', 'crema', 'facial', 'moisturizer', 'cuidado de la piel'], cat: 'belleza', subcat: 'Skincare' },
  { palabras: ['hair', 'cabello', 'pelo', 'wig', 'peluca', 'shampoo', 'champu', 'hair dryer', 'secador', 'straightener', 'plancha de pelo'], cat: 'belleza', subcat: 'Cabello' },
  { palabras: ['nail', 'manicur', 'esmalte'], cat: 'belleza', subcat: 'Uñas' },
  { palabras: ['beard', 'barba', 'shaver', 'afeitadora', 'razor', 'trimmer', 'barber'], cat: 'belleza', subcat: 'Barbería' },
  { palabras: ['brush', 'brocha', 'tweezer', 'pinza', 'beauty tool', 'depilad', 'epilat'], cat: 'belleza', subcat: 'Herramientas' },
  // Hogar
  { palabras: ['furniture', 'mueble', 'sofa', 'chair', 'silla', 'table ', 'tables', 'mesa', 'desk', 'escritorio', 'shelf', 'estante', 'cabinet', 'wardrobe'], cat: 'hogar', subcat: 'Muebles' },
  { palabras: ['kitchen', 'cocina', 'cookware', 'utensil', 'drinkware', 'cup', 'mug', 'taza', 'bottle', 'botella', 'tableware', 'vajilla'], cat: 'hogar', subcat: 'Cocina' },
  { palabras: ['lamp', 'lampara', 'lighting', 'iluminacion', 'night light', 'led strip', 'bulb', 'bombilla'], cat: 'hogar', subcat: 'Iluminación' },
  { palabras: ['storage', 'organizer', 'organizador', 'almacenamiento', 'rack', 'basket', 'cesta', 'hanger', 'percha'], cat: 'hogar', subcat: 'Organización' },
  { palabras: ['garden', 'jardin', 'planter', 'maceta', 'outdoor', 'patio'], cat: 'hogar', subcat: 'Jardín' },
  { palabras: ['bedding', 'sabana', 'blanket', 'manta', 'pillow', 'almohada', 'duvet', 'edredon', 'curtain', 'cortina'], cat: 'hogar', subcat: 'Ropa de cama' },
  { palabras: ['appliance', 'electrodomestico', 'blender', 'licuadora', 'fryer', 'freidora', 'vacuum', 'aspiradora', 'fan ', 'ventilador', 'heater'], cat: 'hogar', subcat: 'Electrodomésticos' },
  { palabras: ['decor', 'decoracion', 'wall art', 'vase', 'jarron', 'frame', 'marco', 'ornament', 'adorno', 'sticker', 'pegatina'], cat: 'hogar', subcat: 'Decoración' },
  // Bebés
  { palabras: ['baby clothes', 'ropa de bebe', 'newborn', 'recien nacido'], cat: 'bebes', subcat: 'Ropa bebé' },
  { palabras: ['stroller', 'carriage', 'coche de bebe', 'pram'], cat: 'bebes', subcat: 'Coches' },
  { palabras: ['toy', 'juguete', 'doll', 'muneca', 'puzzle', 'lego', 'building block', 'figura', 'action figure', 'plush', 'peluche'], cat: 'bebes', subcat: 'Juguetes' },
  { palabras: ['baby', 'bebe', 'feeding', 'pacifier', 'chupete', 'biberon'], cat: 'bebes', subcat: 'Alimentación' },
  // Salud y deportes
  { palabras: ['fitness', 'bodybuilding', 'dumbbell', 'mancuerna', 'resistance band', 'banda elastica', 'gym', 'workout', 'exercise', 'ejercicio'], cat: 'salud', subcat: 'Fitness' },
  { palabras: ['massage', 'masaje', 'medical', 'medico', 'thermometer', 'termometro', 'blood pressure', 'tension'], cat: 'salud', subcat: 'Equipos médicos' },
  { palabras: ['supplement', 'suplemento', 'vitamin', 'vitamina'], cat: 'salud', subcat: 'Suplementos' },
  { palabras: ['cycling', 'ciclismo', 'bicycle', 'bicicleta', 'bike'], cat: 'deportes', subcat: 'Ciclismo' },
  { palabras: ['soccer', 'football', 'futbol'], cat: 'deportes', subcat: 'Fútbol' },
  { palabras: ['baseball', 'beisbol'], cat: 'deportes', subcat: 'Béisbol' },
  { palabras: ['camping', 'hiking', 'senderismo', 'fishing', 'pesca', 'tent', 'tienda de campana', 'outdoor sport', 'climbing', 'escalada'], cat: 'deportes', subcat: 'Extremos' },
  { palabras: ['sport', 'deporte', 'sports equipment'], cat: 'deportes', subcat: 'Equipos' },
  // Herramientas
  { palabras: ['power tool', 'herramienta electrica', 'drill', 'taladro', 'electric tool'], cat: 'herramientas', subcat: 'Eléctricas' },
  { palabras: ['hand tool', 'herramienta manual', 'wrench', 'llave', 'screwdriver', 'destornillador', 'hammer', 'martillo', 'tool set', 'sets de herramientas', 'pliers', 'alicate'], cat: 'herramientas', subcat: 'Manuales' },
  { palabras: ['welding', 'soldadura', 'solder'], cat: 'herramientas', subcat: 'Soldadura' },
  { palabras: ['hardware', 'ferreteria', 'screw', 'tornillo', 'bolt', 'nut ', 'tuerca'], cat: 'herramientas', subcat: 'Ferretería' },
  { palabras: ['tool', 'herramienta', 'electrical equipment', 'equipamiento electrico'], cat: 'herramientas', subcat: 'Equipos trabajo' },
  // Vehículos
  { palabras: ['car ', 'auto ', 'coche', 'vehicle', 'vehiculo', 'automotive', 'motorcycle', 'moto ', 'replacement part', 'recambio', 'car accessor'], cat: 'vehiculos', subcat: 'Piezas' },
  // Educación y arte
  { palabras: ['stationery', 'papeleria', 'notebook paper', 'cuaderno', 'pen ', 'boligrafo', 'school', 'escuela', 'office supplies'], cat: 'educacion', subcat: 'Papelería' },
  { palabras: ['book', 'libro'], cat: 'educacion', subcat: 'Libros' },
  { palabras: ['painting', 'pintura artistica', 'craft', 'manualidad', 'sewing', 'costura', 'diy', 'handmade', 'artesania'], cat: 'arte', subcat: 'Manualidades' },
  { palabras: ['instrument', 'guitar', 'guitarra', 'piano', 'ukulele', 'drum'], cat: 'arte', subcat: 'Instrumentos' },
  // Eventos
  { palabras: ['party', 'fiesta', 'event', 'evento', 'wedding', 'boda', 'balloon', 'globo', 'birthday', 'cumpleanos', 'christmas', 'navidad', 'halloween'], cat: 'eventos', subcat: 'Decoración' },
  // Otros / Varios (categoría que Retador añadió el 18/11/2026)
  { palabras: ['gadget'], cat: 'otros', subcat: 'Gadgets' },
  { palabras: ['gift', 'regalo'], cat: 'otros', subcat: 'Regalos' },
];

/**
 * Afinado: una vez elegida la categoría, si Retador tiene una subcategoría más concreta y el texto lo pide, se usa esa
 * (por ejemplo Zapatos → Calzado deportivo). Solo se aplica si la subcategoría de destino existe en la lista de Retador.
 */
const AFINADOS: Array<{ desde: Array<[string, string]>; a: [string, string]; palabras: string[] }> = [
  { desde: [['moda', 'Zapatos']], a: ['moda', 'Calzado deportivo'], palabras: ['sneaker', 'running', 'sport', 'deportiv', 'basketball', 'baloncesto', 'tenis', 'trainer', 'correr', 'athletic'] },
  { desde: [['moda', 'Hombre'], ['moda', 'Mujer']], a: ['moda', 'Abrigos y chaquetas'], palabras: ['jacket', 'chaqueta', 'coat', 'abrigo', 'parka', 'windbreaker', 'cortavientos', 'chaleco', 'vest '] },
  { desde: [['moda', 'Hombre'], ['moda', 'Mujer']], a: ['moda', 'Ropa de invierno'], palabras: ['winter', 'invierno', 'thermal', 'termic', 'fleece', 'polar', 'abrigad'] },
  { desde: [['electronica', 'Accesorios tech']], a: ['electronica', 'Fundas y protectores'], palabras: ['case', 'funda', 'cover', 'protector', 'tempered glass', 'vidrio templado'] },
  { desde: [['electronica', 'Accesorios tech']], a: ['electronica', 'Accesorios de movil'], palabras: ['phone', 'movil', 'telefono', 'smartphone', 'holder', 'soporte'] },
  { desde: [['electronica', 'Cargadores']], a: ['electronica', 'Cables y adaptadores'], palabras: ['cable', 'adapter', 'adaptador', 'converter', 'conversor', 'hub'] },
  { desde: [['belleza', 'Barbería'], ['belleza', 'Herramientas'], ['belleza', 'Cabello']], a: ['belleza', 'Depilación y afeitado'], palabras: ['depil', 'epilat', 'hair remov', 'shaver', 'afeitad', 'razor', 'trimmer', 'wax', 'cera'] },
  { desde: [['belleza', 'Skincare'], ['belleza', 'Herramientas']], a: ['belleza', 'Aparatos de belleza'], palabras: ['device', 'aparato', 'machine', 'maquina', 'electric', 'electrico', 'massager', 'led mask'] },
  { desde: [['belleza', 'Skincare']], a: ['belleza', 'Cuidado corporal'], palabras: ['body', 'corporal', 'lotion', 'locion'] },
  { desde: [['hogar', 'Organización'], ['hogar', 'Decoración'], ['hogar', 'Electrodomésticos']], a: ['hogar', 'Baño'], palabras: ['bathroom', 'bano', 'shower', 'ducha', 'toilet', 'inodoro', 'towel', 'toalla'] },
  { desde: [['herramientas', 'Manuales'], ['herramientas', 'Equipos trabajo']], a: ['herramientas', 'Medición'], palabras: ['measur', 'medicion', 'medir', 'tape measure', 'cinta metrica', 'caliper', 'calibrador', 'multimeter', 'multimetro'] },
];

function normalizar(texto: string): string {
  return ` ${texto}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ');
}

/**
 * Propone una categoría de Retador. Pesos: el ÚLTIMO nivel de la categoría del proveedor (lo más concreto) y el título valen
 * 2 cada uno; los niveles de arriba solo 0,5 (son muy generales: «Home, Garden & Furniture» hacía que una pirámide decorativa
 * guardada por CJ en «Home Storage › Home Office Storage» saliera como «Muebles»). En empate gana la regla que encaja con el
 * TÍTULO (dice qué es el producto) y, si sigue el empate, la que va antes (más concreta). Devuelve `null` si nada encaja o si lo
 * que encaja no está en la lista que informa Retador.
 */
export function sugerirCategoria(categorias: CategoriaRetador[], titulo: string, categoriaProveedor?: string | null): SugerenciaCategoria | null {
  const niveles = String(categoriaProveedor ?? '').split(/\s*(?:>|›|\/)\s*/).filter(Boolean);
  const hoja = normalizar(niveles[niveles.length - 1] ?? '');
  const arriba = normalizar(niveles.slice(0, -1).join(' '));
  const deCategoria = `${arriba} ${hoja}`;
  const deTitulo = normalizar(titulo);
  let mejor: { puntos: number; deTitulo: number; indice: number } | null = null;

  REGLAS.forEach((regla, indice) => {
    const destino = categorias.find((c) => c.cat === regla.cat);
    if (!destino || !destino.subcategorias.includes(regla.subcat)) return; // solo lo que existe en Retador
    let puntos = 0;
    let enTitulo = 0;
    for (const p of regla.palabras) {
      const clave = normalizar(p).trimEnd();
      const conEspacio = p.endsWith(' ');
      const aparece = (texto: string) => (conEspacio ? texto.includes(clave + ' ') : texto.includes(clave));
      if (aparece(hoja)) puntos += 2;
      else if (aparece(arriba)) puntos += 0.5;
      if (aparece(deTitulo)) {
        puntos += 2;
        enTitulo += 1;
      }
    }
    if (puntos <= 0) return;
    const gana = !mejor || puntos > mejor.puntos || (puntos === mejor.puntos && enTitulo > mejor.deTitulo);
    if (gana) mejor = { puntos, deTitulo: enTitulo, indice };
  });

  const existe = (cat: string, subcat: string) => categorias.find((c) => c.cat === cat && c.subcategorias.includes(subcat));
  if (!mejor) {
    // Nada encaja: «Otros / Varios» si Retador la tiene; si no, no se sugiere nada
    const otros = existe('otros', 'Varios');
    return otros ? { cat: 'otros', nombreCat: otros.nombre, subcat: 'Varios', porDefecto: true } : null;
  }
  const regla = REGLAS[(mejor as { puntos: number; deTitulo: number; indice: number }).indice];
  let cat = regla.cat;
  let subcat = regla.subcat;
  const texto = `${deCategoria} ${deTitulo}`;
  for (const af of AFINADOS) {
    if (!af.desde.some(([c, s]) => c === cat && s === subcat)) continue;
    // La subcategoría de destino se busca tal cual la nombra Retador (con o sin tilde en «móvil»)
    const destinoSub = categorias.find((c) => c.cat === af.a[0])?.subcategorias.find((x) => normalizar(x) === normalizar(af.a[1]));
    if (!destinoSub) continue;
    if (af.palabras.some((p) => texto.includes(normalizar(p).trimEnd()))) {
      cat = af.a[0];
      subcat = destinoSub;
      break;
    }
  }
  const destino = categorias.find((c) => c.cat === cat)!;
  return { cat, nombreCat: destino.nombre, subcat };
}
