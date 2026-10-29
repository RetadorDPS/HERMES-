/**
 * Pasos del tutorial guiado (datos puros: los usa la interfaz y las pruebas).
 *
 * Cada paso lleva a una pestaña distinta y señala un trozo concreto de esa
 * pantalla. `targets` son selectores probados en orden: se resalta el primero
 * que exista (si el usuario tiene la pantalla vacía, cae al contenedor).
 */

/**
 * Escala de `User.tourVersion`:
 *   0 = todavía no ha decidido   → se le ofrece la tarjeta
 *   1 = aceptó y lo está viendo  → si recarga, se reanuda donde iba (sin tarjeta)
 *   2 = ya lo vio (o lo saltó)   → no vuelve a salir solo; sí desde Configuración
 */
export const TOUR_PENDING = 0;
export const TOUR_STARTED = 1;
export const TOUR_VERSION = 2;

export interface TourStep {
  id: string;
  /** Pestaña a la que hay que ir */
  route: string;
  /** Nombre corto de la pestaña (para la cabecera de la burbuja) */
  tab: string;
  title: string;
  text: string;
  tip?: string;
  /** Selectores candidatos a resaltar, de más preciso a más general */
  targets: string[];
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'dashboard',
    route: '/dashboard',
    tab: 'Dashboard',
    title: 'Esta es tu portada',
    text: 'Aquí ves el resumen de tu negocio: productos publicados, pedidos y beneficio. Arriba solo aparece lo que necesita tu atención (un producto agotado, una tienda que no conecta).',
    tip: 'Si aquí no hay avisos, todo va bien.',
    targets: ['[data-tour="dash:kpis"]', '[data-tour="screen:dashboard"]'],
  },
  {
    id: 'catalog',
    route: '/catalog',
    tab: 'Catálogo',
    title: 'Tu escaparate de productos',
    text: 'Productos reales con foto, coste, tu precio de venta y tu beneficio. Busca por nombre o categoría y filtra por proveedor, almacén y coste. Elige el país de envío arriba y verás plazo y precio.',
    tip: 'Abre un producto, mira su envío y publícalo con «Publicar en…». Si el que buscas no está, pega su enlace en «Importar por URL».',
    targets: ['[data-tour="catalog:card"]', '[data-tour="catalog:search"]', '[data-tour="screen:catalog"]'],
  },
  {
    id: 'import',
    route: '/import',
    tab: 'Importar por URL',
    title: 'Pegar un enlace y ver lo que hay dentro',
    text: 'Pega la dirección de un producto de AliExpress o CJ. Traemos las variantes, las fotos, las opiniones y el envío al país que elijas, y te proponemos el precio.',
    tip: 'Importar no publica nada: el producto queda en tu catálogo y lo publicas cuando quieras.',
    targets: ['[data-tour="import:url"]', '[data-tour="screen:import"]'],
  },
  {
    id: 'products',
    route: '/products',
    tab: 'Productos',
    title: 'Tus productos publicados',
    text: 'Cada producto con su precio, su stock y su beneficio estimado. Puedes cambiar el precio y el stock, pausarlo o eliminarlo.',
    tip: 'Pausar solo lo oculta del mercado; Eliminar lo quita de todos los sitios y podrás importarlo otra vez.',
    targets: ['[data-tour="screen:products"]'],
  },
  {
    id: 'orders',
    route: '/orders',
    tab: 'Pedidos',
    title: 'Los pedidos que entran de tu tienda',
    text: 'Cuando un cliente paga, el pedido aparece aquí. Desde aquí configuras si se compra al proveedor y apruebas cada compra.',
    tip: 'La compra al proveedor empieza en «Simulación»: no se compra nada hasta que tú lo decidas.',
    targets: ['[data-tour="screen:orders"]'],
  },
  {
    id: 'monitor',
    route: '/monitor',
    tab: 'Monitor de sync',
    title: 'Vigilancia de precios y stock',
    text: 'Revisamos el coste y las existencias de tus productos publicados y te avisamos de lo importante: una subida de coste, un producto agotado o una variante nueva.',
    tip: 'Nunca cambiamos tus precios solos: tú decides qué hacer con cada aviso.',
    targets: ['[data-tour="screen:monitor"]'],
  },
  {
    id: 'pricing',
    route: '/pricing',
    tab: 'Precios y márgenes',
    title: 'Tu regla de beneficio',
    text: 'Aquí decides cuánto ganas: un porcentaje sobre el coste, un margen fijo mínimo, o ambos. Los precios del catálogo se calculan con tu regla.',
    tip: 'Si no tienes regla propia, se usa una por defecto (40 %) y se te avisa.',
    targets: ['[data-tour="screen:pricing"]'],
  },
  {
    id: 'stores',
    route: '/stores',
    tab: 'Tiendas',
    title: 'Conecta tu tienda',
    text: 'Aquí conectas tu tienda de Retador con tu clave y ves el estado de la conexión. Shopify y WooCommerce llegarán más adelante.',
    tip: 'Sin tienda conectada no se puede publicar: es el primer paso.',
    targets: ['[data-tour="screen:stores"]'],
  },
  {
    id: 'billing',
    route: '/billing',
    tab: 'Facturación',
    title: 'Tu plan',
    text: 'Aquí ves tu plan. Los planes de pago se activarán pronto.',
    targets: ['[data-tour="screen:billing"]'],
  },
  {
    id: 'setup',
    route: '/setup',
    tab: 'Puesta en marcha',
    title: 'Lo que ya está listo y lo que falta',
    text: 'Una lista de comprobación para empezar a vender: tu cuenta, tu tienda y tus proveedores. En verde, listo; en ámbar, falta algo.',
    tip: 'Si algo no funciona, empieza por aquí.',
    targets: ['[data-tour="screen:setup"]'],
  },
  {
    id: 'help',
    route: '/settings',
    tab: 'Configuración',
    title: 'Y aquí lo tienes siempre',
    text: 'Este es el final del recorrido. En Configuración queda este mismo bloque de ayuda: puedes volver a ver el tutorial cuando quieras, descargar todos tus datos o borrar tu cuenta.',
    tip: 'Nada de esto es obligatorio: si lo cierras, no volverá a aparecer solo.',
    targets: ['[data-tour="tour-help"]', '[data-tour="screen:settings"]'],
  },
];

/**
 * Tutorial del operador (quien vende el servicio): 5 pasos por la zona de
 * Administración. Sólo lo ven las cuentas con rol ADMIN y sólo después de haber
 * hecho (o saltado) el recorrido del cliente.
 */
export const ADMIN_TOUR_STEPS: TourStep[] = [
  {
    id: 'admin-metrics',
    route: '/admin',
    tab: 'Administración',
    title: 'Tu negocio, de un vistazo',
    text: 'Aquí ves lo que pasa en la plataforma entera: cuántos clientes tienes y cuántos pagan, el MRR estimado, tiendas y productos totales, y cuánto ha trabajado el robot en las últimas 24 horas.',
    tip: 'El MRR es una estimación por planes activos: sirve para saber por dónde vas, no para facturar.',
    targets: ['[data-tour="admin:kpis"]', '[data-tour="screen:admin"]'],
  },
  {
    id: 'admin-tenants',
    route: '/admin',
    tab: 'Administración',
    title: 'Atender a un cliente sin tocar la base de datos',
    text: 'En «Clientes» los tienes a todos con su plan, sus créditos y su estado. Desde aquí puedes subirle el plan, darle créditos, hacerle operador o verificarle el correo a mano si el mensaje se le perdió.',
    tip: 'Todo lo que hagas aquí queda firmado en el registro de auditoría: nada es invisible.',
    targets: ['[data-tour="admin:tenants"]', '[data-tour="screen:admin"]'],
  },
  {
    id: 'admin-credentials',
    route: '/admin',
    tab: 'Administración',
    title: 'Las claves que usan todos tus clientes',
    text: 'Esto es lo único que tienes que conseguir tú: las claves de AliExpress y CJdropshipping. Se pegan una sola vez aquí y las usa toda la plataforma; tus clientes no configuran nada.',
    tip: 'Mientras no las pongas, el catálogo enseña productos de muestra y todo lo demás funciona igual.',
    targets: ['[data-tour="admin:credentials"]', '[data-tour="screen:admin"]'],
  },
  {
    id: 'admin-catalog',
    route: '/admin',
    tab: 'Administración',
    title: 'El catálogo que ven tus clientes',
    text: 'En cuanto haya claves, el robot de catálogo las usa para traer productos reales y refrescarlos cada pocas horas. Aquí en Administración queda registrado el estado de ese trabajo.',
    tip: 'Si el catálogo se queda viejo, mira el Monitor de sync: ahí se ve el trabajo de catálogo paso a paso.',
    targets: ['[data-tour="admin:credentials"]', '[data-tour="screen:admin"]'],
  },
  {
    id: 'admin-maintenance',
    route: '/admin',
    tab: 'Administración',
    title: 'Lo que se mantiene solo',
    text: 'Los tipos de cambio se descargan del BCE, las copias de seguridad se hacen cada madrugada y se comprueba que se pueden restaurar, y la vigilancia del sistema avisa a los operadores si algo se rompe.',
    tip: 'Si el panel se pone raro, empieza por Puesta en marcha: dice en verde o ámbar qué pieza falla.',
    targets: ['[data-tour="screen:admin"]'],
  },
];

export const ADMIN_TOUR_INTRO = {
  title: '¿Te enseño la zona de operador?',
  text: 'Son 5 pasos por Administración: tus clientes, sus planes, las claves de los proveedores y lo que se mantiene solo. Puedes salir cuando quieras.',
  accept: 'Sí, enséñame la administración',
  decline: 'No, gracias',
} as const;

export const TOUR_SIDE_STEPS = TOUR_STEPS.map((s) => s.route).reduce<string[]>((acc, r) => (acc.includes(r) ? acc : [...acc, r]), []);

/** Textos de la tarjeta de bienvenida */
export const TOUR_INTRO = {
  title: `¿Te enseño la plataforma en ${TOUR_STEPS.length} pasos?`,
  text: 'Te llevo pestaña por pestaña y te voy señalando dónde tocar en cada una. Dura un par de minutos y puedes salir cuando quieras: si lo cierras, no vuelve a salir solo.',
  accept: 'Sí, enséñame',
  decline: 'No, gracias (ya me apaño)',
} as const;
