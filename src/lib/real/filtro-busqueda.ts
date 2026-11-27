/** Filtros del buscador de proveedores: se aplican sobre lo que devolvió el proveedor y no gastan búsquedas. */

/**
 * Accesorios: al buscar un modelo («Poco F7 Pro», «Galaxy S26») los proveedores devuelven sobre todo fundas y piezas,
 * porque llevan el nombre del modelo en el título. Se ocultan salvo que lo que se busca sea un accesorio.
 */
const ACCESORIO = /\b(fundas?|carcasas?|protector(es)?|cristal(es)? templado|vidrio templado|mica|case|cover|covers|holster|sleeve|tempered glass|screen protector|soporte|holder|cable|cargador(es)?|charger|correas?|strap|pegatinas?|sticker|repuestos?|placa|flex|bater[ií]a para|battery for|lente de c[aá]mara|camera lens protector|anillo soporte)\b/i;
const PARA_MODELO = /^\s*(para|for|compatible (con|with))\b|\bbater[ií]as?\b.{0,40}\bpara\b|\bbatter(y|ies)\b.{0,40}\bfor\b/i;
export const esAccesorio = (titulo: string) => ACCESORIO.test(titulo) || PARA_MODELO.test(titulo);
const quitarTildes = (t: string) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
/** Palabras de la búsqueda que deben aparecer en el título (sin las vacías ni las de un solo carácter) */
const VACIAS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'para', 'con', 'y', 'en', 'un', 'una', 'telefono', 'movil', 'celular']);
export function palabrasClave(busqueda: string) {
  return quitarTildes(busqueda).split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !VACIAS.has(w));
}
export function tieneTodas(titulo: string, claves: string[]) {
  const t = quitarTildes(titulo).replace(/[^a-z0-9]+/g, ' ');
  const compacto = t.replace(/ /g, '');
  return claves.every((w) => t.split(' ').includes(w) || compacto.includes(w));
}
