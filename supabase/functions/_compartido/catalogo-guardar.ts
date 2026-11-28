/**
 * Guardar en el catálogo común lo que llega de un LISTADO del proveedor (descargas de Administración), sin pisar lo que ya se
 * sabe de un producto con ficha completa.
 *
 * Lo usan las dos funciones de proveedor (`cj-catalogo` y `ali-catalogo`), cada una con sus filas ya normalizadas: aquí no hay
 * ninguna lógica de proveedor, solo la regla común del catálogo:
 *  · producto NUEVO → se guarda entero;
 *  · producto que ya estaba SIN ficha → se refresca entero con lo que trae el listado (precio, fotos, popularidad);
 *  · producto que ya estaba CON ficha → solo lo ligero (popularidad, valoración y fecha). Antes una descarga le volvía a poner
 *    la descripción vacía, las fotos y el precio del listado aunque la ficha tuviera los buenos.
 * Devuelve cuántos eran nuevos y cuántos ya estaban, para que la pantalla diga la verdad («N nuevos · M que ya tenías»).
 */
export interface ResultadoGuardado {
  nuevos: number;
  actualizados: number;
  conFicha: number;
  error?: string;
}

export async function guardarListado(servicio: any, proveedor: string, filas: any[]): Promise<ResultadoGuardado> {
  const unicas = new Map<string, any>();
  for (const f of filas) if (f?.externalId) unicas.set(String(f.externalId), f);
  if (!unicas.size) return { nuevos: 0, actualizados: 0, conFicha: 0 };
  const externos = [...unicas.keys()];

  const { data: ya, error: eYa } = await servicio.from("CatalogItem").select("id,externalId").eq("provider", proveedor).in("externalId", externos);
  if (eYa) return { nuevos: 0, actualizados: 0, conFicha: 0, error: eYa.message };
  const idPorExterno = new Map<string, string>((ya ?? []).map((x: any) => [String(x.externalId), String(x.id)]));
  const existentes = [...idPorExterno.values()];
  const { data: fichas } = existentes.length ? await servicio.from("CatalogItemDetail").select("itemId").in("itemId", existentes) : { data: [] };
  const conFicha = new Set<string>((fichas ?? []).map((f: any) => String(f.itemId)));

  const completas: any[] = [];
  const ligeras: Array<{ id: string; fila: any }> = [];
  for (const [externo, fila] of unicas) {
    const id = idPorExterno.get(externo);
    if (id && conFicha.has(id)) ligeras.push({ id, fila });
    else completas.push(fila);
  }

  if (completas.length) {
    const { error } = await servicio.from("CatalogItem").upsert(completas, { onConflict: "provider,externalId" });
    if (error) return { nuevos: 0, actualizados: 0, conFicha: 0, error: error.message };
  }
  const ahora = new Date().toISOString();
  for (const { id, fila } of ligeras) {
    const cambios: Record<string, unknown> = { lastSyncedAt: ahora, updatedAt: ahora };
    if (typeof fila.ordersCount === "number") cambios.ordersCount = fila.ordersCount;
    if (typeof fila.rating === "number") cambios.rating = fila.rating;
    await servicio.from("CatalogItem").update(cambios).eq("id", id);
  }
  const nuevos = externos.filter((e) => !idPorExterno.has(e)).length;
  return { nuevos, actualizados: unicas.size - nuevos, conFicha: ligeras.length };
}
