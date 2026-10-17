-- «Envío gratis» ya no se toma de una marca del listado del proveedor (en CJ `addMarkStatus` marcaba como «gratis» productos
-- que luego cotizaban 5 USD de envío). Se DERIVA siempre de las cotizaciones guardadas en la ficha: es true solo si algún destino
-- cotizado tiene una opción de envío gratuita. Sin cotización es false (no se sabe). Un disparador lo impone aunque alguien
-- (una descarga, una función) intente escribir otro valor.
CREATE OR REPLACE FUNCTION public.catalogo_envio_gratis(p_item text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH q AS (
    SELECT dest.key AS destino,
           min((op->>'precio')::numeric) AS minimo,
           bool_or(COALESCE((op->>'gratis')::boolean, false)) AS marcada
      FROM public."CatalogItemDetail" d,
           jsonb_each(COALESCE(d.ficha->'envio'->'porOrigen', '{}'::jsonb)) o,
           jsonb_each(o.value) dest,
           jsonb_array_elements(COALESCE(dest.value->'opciones', '[]'::jsonb)) op
     WHERE d."itemId" = p_item
     GROUP BY dest.key
  )
  SELECT COALESCE(bool_or(COALESCE(minimo, 1) = 0 OR marcada), false) FROM q;
$$;
REVOKE ALL ON FUNCTION public.catalogo_envio_gratis(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_envio_gratis(text) TO service_role;

CREATE OR REPLACE FUNCTION public.catalogo_forzar_envio_gratis()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW."freeShipping" := COALESCE(public.catalogo_envio_gratis(NEW.id::text), false);
  RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER catalogo_envio_gratis_antes BEFORE INSERT OR UPDATE ON public."CatalogItem"
  FOR EACH ROW EXECUTE FUNCTION public.catalogo_forzar_envio_gratis();

CREATE OR REPLACE FUNCTION public.catalogo_recalcular_envio_gratis()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public."CatalogItem" SET "freeShipping" = COALESCE(public.catalogo_envio_gratis(NEW."itemId"::text), false) WHERE id::text = NEW."itemId"::text;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER catalogo_envio_gratis_despues AFTER INSERT OR UPDATE OF ficha ON public."CatalogItemDetail"
  FOR EACH ROW EXECUTE FUNCTION public.catalogo_recalcular_envio_gratis();

-- Corrige lo ya guardado: el disparador recalcula cada fila afectada
UPDATE public."CatalogItem" SET "freeShipping" = false WHERE "freeShipping" = true;
