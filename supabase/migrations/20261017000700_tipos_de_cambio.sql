-- Tipos de cambio reales (Banco Central Europeo) para convertir el coste de los proveedores (USD) a euros.
-- La tabla la rellena la función `fx-tasas` (como mucho una vez cada 12 h). Los clientes solo pueden leerla.
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
CREATE POLICY "fx_visible" ON public."FxRate" FOR SELECT TO authenticated USING (true);
