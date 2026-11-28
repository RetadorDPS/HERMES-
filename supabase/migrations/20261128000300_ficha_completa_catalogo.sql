-- v82: marca «ficha completa» en cada producto del catálogo, para el filtro «Listos para publicar» de Mi catálogo.
-- Se deriva SIEMPRE de la ficha (CatalogItemDetail.ficha.variantes): nunca se escribe a mano. Listo para publicar =
-- ficha completa Y envío cotizado a EE. UU. (envioResumen ? 'US'), que es lo que Retador exige.

alter table public."CatalogItem" add column if not exists "fichaCompleta" boolean not null default false;
comment on column public."CatalogItem"."fichaCompleta" is
  'Verdadero si la ficha del proveedor tiene variantes. Derivado de CatalogItemDetail por disparador; nunca escrito a mano.';

-- El mismo disparador que ya guarda el resumen de envío guarda también la marca (una sola actualización por cambio de ficha)
create or replace function public.catalogo_guardar_resumen_envio()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update "CatalogItem"
     set "envioResumen" = public.catalogo_resumen_envio(new.ficha->'envio'),
         "fichaCompleta" = coalesce(jsonb_typeof(new.ficha->'variantes') = 'array' and jsonb_array_length(new.ficha->'variantes') > 0, false)
   where id::text = new."itemId";
  return new;
end;
$$;

-- Si se borra la ficha, el producto deja de estar completo
create or replace function public.catalogo_quitar_ficha_completa()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update "CatalogItem" set "fichaCompleta" = false where id::text = old."itemId";
  return old;
end;
$$;

drop trigger if exists catalogo_detalle_quitar_ficha on public."CatalogItemDetail";
create trigger catalogo_detalle_quitar_ficha
  after delete on public."CatalogItemDetail"
  for each row execute function public.catalogo_quitar_ficha_completa();

-- Los usuarios con sesión leen la marca (la tabla da permisos columna por columna: sin esto el catálogo falla)
grant select ("fichaCompleta") on public."CatalogItem" to authenticated;

-- Relleno de lo que ya tiene ficha, sin tocar la fecha de actualización de cada producto
alter table public."CatalogItem" disable trigger "tocar_updated_at_CatalogItem";
update public."CatalogItem" ci
   set "fichaCompleta" = true
  from public."CatalogItemDetail" d
 where d."itemId" = ci.id::text
   and jsonb_typeof(d.ficha->'variantes') = 'array'
   and jsonb_array_length(d.ficha->'variantes') > 0
   and ci."fichaCompleta" = false;
alter table public."CatalogItem" enable trigger "tocar_updated_at_CatalogItem";

create index if not exists "CatalogItem_listo_idx" on public."CatalogItem" ("fichaCompleta") where "fichaCompleta";
