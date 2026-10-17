-- Tienda Retador: proveedores base y reglas que evitan publicaciones duplicadas.
-- Sin DROP ni UPDATE masivo (el conector de Supabase los cancela).

-- Proveedores base (los productos publicados necesitan un proveedor)
insert into "Supplier" (id, type, name, "baseUrl", "isEnabled", "rateLimitRpm")
values
  ('proveedor-cj', 'CJ_DROPSHIPPING', 'CJ Dropshipping', 'https://developers.cjdropshipping.com', true, 60),
  ('proveedor-aliexpress', 'ALIEXPRESS', 'AliExpress', 'https://api-sg.aliexpress.com', true, 60)
on conflict (id) do nothing;

-- Un producto del proveedor solo puede publicarse una vez por tienda (idempotencia de la publicación)
create unique index if not exists product_tienda_proveedor_uq
  on "Product" ("storeId", "supplierProductId")
  where "storeId" is not null and "supplierProductId" is not null;

-- Stock verificado por variante: null = no se sabe (nunca se inventa un número)
alter table "ProductVariant" add column if not exists "stockVerificado" boolean;
comment on column "ProductVariant"."stockVerificado" is
  'true = el stock viene de una consulta real al proveedor; false = estimado por la tienda de destino; null = no se sabe.';

-- Cada usuario tiene como mucho una conexión con Retador
create unique index if not exists store_usuario_retador_uq
  on "Store" ("userId")
  where platform = 'RETADOR';
