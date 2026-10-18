-- Resumen de envío por destino en cada producto del catálogo.
-- Las cotizaciones reales viven en la ficha (CatalogItemDetail.ficha.envio). Aquí se guarda, por destino, la opción más
-- barata y la más rápida, para que la tarjeta del catálogo enseñe precio y días de envío sin cargar la ficha entera.
-- No se inventa nada: un destino sin cotización simplemente no aparece. Sin DROP ni UPDATE masivo sin condición.

alter table "CatalogItem" add column if not exists "envioResumen" jsonb;
comment on column "CatalogItem"."envioResumen" is
  'Por país de destino: {precio, diasMin, diasMax, origen, rapido:{precio,diasMin,diasMax}}. Derivado de ficha.envio; nunca escrito a mano.';

create or replace function public.catalogo_resumen_envio(p_envio jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  with opc as (
    select d.key as destino,
           o.key as origen,
           (x->>'precio')::numeric as precio,
           case when (x->>'diasMin') ~ '^[0-9]+$' then (x->>'diasMin')::int end as dmin,
           case when (x->>'diasMax') ~ '^[0-9]+$' then (x->>'diasMax')::int end as dmax
    from jsonb_each(coalesce(p_envio->'porOrigen', '{}'::jsonb)) o
    cross join lateral jsonb_each(case when jsonb_typeof(o.value) = 'object' then o.value else '{}'::jsonb end) d
    cross join lateral jsonb_array_elements(case when jsonb_typeof(d.value->'opciones') = 'array' then d.value->'opciones' else '[]'::jsonb end) x
    where (x->>'precio') ~ '^[0-9]+(\.[0-9]+)?$'
  ),
  barato as (
    select distinct on (destino) destino, origen, precio, dmin, dmax from opc order by destino, precio asc, dmin asc nulls last
  ),
  rapido as (
    select distinct on (destino) destino, precio, dmin, dmax from opc where dmax is not null order by destino, dmax asc, precio asc
  )
  select coalesce(
    jsonb_object_agg(
      b.destino,
      jsonb_build_object(
        'precio', b.precio, 'diasMin', b.dmin, 'diasMax', b.dmax, 'origen', b.origen,
        'rapido', (select jsonb_build_object('precio', r.precio, 'diasMin', r.dmin, 'diasMax', r.dmax) from rapido r where r.destino = b.destino)
      )
    ),
    '{}'::jsonb
  )
  from barato b;
$$;

create or replace function public.catalogo_guardar_resumen_envio()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update "CatalogItem"
     set "envioResumen" = public.catalogo_resumen_envio(new.ficha->'envio')
   where id::text = new."itemId";
  return new;
end;
$$;

create or replace trigger catalogo_detalle_resumen_envio
  after insert or update of ficha on "CatalogItemDetail"
  for each row execute function public.catalogo_guardar_resumen_envio();

-- Los usuarios con sesión leen el resumen igual que el resto de columnas públicas del catálogo
grant select ("envioResumen") on "CatalogItem" to authenticated;

-- Relleno de lo que ya estaba cotizado
update "CatalogItem" ci
   set "envioResumen" = public.catalogo_resumen_envio(d.ficha->'envio')
  from "CatalogItemDetail" d
 where d."itemId" = ci.id::text;
