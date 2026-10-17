-- Almacenes de salida por producto.
-- Antes el filtro «Almacén de salida» miraba la columna shipFrom, que estaba vacía en TODOS los productos
-- (el listado de los proveedores no dice desde qué almacén sale cada producto). Ahora cada producto guarda la
-- lista de almacenes (códigos de país) en los que se SABE que tiene existencias: se rellena cuando se descarga
-- por almacén y cuando se completa la ficha (stock por almacén). Nunca se inventa: sin dato, la lista queda vacía.

ALTER TABLE public."CatalogItem" ADD COLUMN IF NOT EXISTS warehouses text[] NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS "CatalogItem_warehouses_idx" ON public."CatalogItem" USING gin (warehouses);
GRANT SELECT (warehouses) ON public."CatalogItem" TO authenticated;

-- Añade un almacén (sin repetir) a los productos indicados. Solo la usan las funciones del servidor.
CREATE OR REPLACE FUNCTION public.catalogo_anadir_almacen(p_provider text, p_ids text[], p_almacen text)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH u AS (
    UPDATE public."CatalogItem"
       SET warehouses = (SELECT array_agg(DISTINCT x ORDER BY x) FROM unnest(warehouses || p_almacen) AS x)
     WHERE provider::text = p_provider
       AND "externalId" = ANY (p_ids)
       AND NOT (p_almacen = ANY (warehouses))
    RETURNING 1
  )
  SELECT count(*)::integer FROM u;
$$;
REVOKE ALL ON FUNCTION public.catalogo_anadir_almacen(text, text[], text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_anadir_almacen(text, text[], text) TO service_role;

-- Relleno con lo que ya se sabe: los almacenes con existencias de las fichas ya completadas.
UPDATE public."CatalogItem" i
   SET warehouses = sub.alm
  FROM (
    SELECT d."itemId" AS id,
           (SELECT array_agg(DISTINCT o->>'pais' ORDER BY o->>'pais')
              FROM jsonb_array_elements(COALESCE(d.ficha->'origenes', '[]'::jsonb)) o
             WHERE o->>'pais' IS NOT NULL AND COALESCE((o->>'total')::numeric, 0) > 0) AS alm
      FROM public."CatalogItemDetail" d
  ) sub
 WHERE sub.id = i.id AND sub.alm IS NOT NULL;
