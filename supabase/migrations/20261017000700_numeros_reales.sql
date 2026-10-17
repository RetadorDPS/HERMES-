-- ESTADO: PENDIENTE DE APLICAR. Se intentó aplicar al proyecto real y se canceló; no se aplicará hasta que Daniel lo confirme.
-- Números reales en el catálogo.
--
-- 1) «Envío gratis» ya no se toma de una marca del listado del proveedor (en CJ `addMarkStatus` marcaba como «gratis»
--    productos que luego cotizaban 5 USD de envío). Ahora se DERIVA siempre de las cotizaciones guardadas en la ficha:
--    es true solo si algún destino cotizado tiene una opción de envío gratuita. Sin cotización, es false (no se sabe).
-- 2) Tipos de cambio reales (Banco Central Europeo) para convertir el coste del proveedor (USD) a euros.

CREATE OR REPLACE FUNCTION public.catalogo_envio_gratis(p_item uuid)
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
REVOKE ALL ON FUNCTION public.catalogo_envio_gratis(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_envio_gratis(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.catalogo_forzar_envio_gratis()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW."freeShipping" := COALESCE(public.catalogo_envio_gratis(NEW.id), false);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS catalogo_envio_gratis_antes ON public."CatalogItem";
CREATE TRIGGER catalogo_envio_gratis_antes BEFORE INSERT OR UPDATE ON public."CatalogItem"
  FOR EACH ROW EXECUTE FUNCTION public.catalogo_forzar_envio_gratis();

CREATE OR REPLACE FUNCTION public.catalogo_recalcular_envio_gratis()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public."CatalogItem" SET "freeShipping" = COALESCE(public.catalogo_envio_gratis(NEW."itemId"), false) WHERE id = NEW."itemId";
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS catalogo_envio_gratis_despues ON public."CatalogItemDetail";
CREATE TRIGGER catalogo_envio_gratis_despues AFTER INSERT OR UPDATE OF ficha ON public."CatalogItemDetail"
  FOR EACH ROW EXECUTE FUNCTION public.catalogo_recalcular_envio_gratis();

-- Corrige lo ya guardado (el disparador recalcula cada fila)
UPDATE public."CatalogItem" SET "freeShipping" = false;

-- Tipos de cambio (1 unidad de la moneda = X euros). Los rellena la función `fx-tasas` con los datos del BCE.
CREATE TABLE IF NOT EXISTS public."FxRate" (
  currency text PRIMARY KEY,
  "eurPerUnit" numeric NOT NULL CHECK ("eurPerUnit" > 0),
  "rateDate" date,
  source text NOT NULL DEFAULT 'BCE',
  "fetchedAt" timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public."FxRate" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."FxRate" FROM anon, authenticated;
GRANT SELECT ON public."FxRate" TO authenticated;
DROP POLICY IF EXISTS "fx_visible" ON public."FxRate";
CREATE POLICY "fx_visible" ON public."FxRate" FOR SELECT TO authenticated USING (true);
