-- Resumen del catálogo calculado en la base (antes la pantalla descargaba todas las filas y la API
-- corta en 1000: por eso decía «1000 productos» aunque hubiera 1302, y las categorías contaban de menos).
-- SECURITY INVOKER: respeta las mismas reglas de lectura que la tabla.
create or replace function public.catalogo_resumen()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with base as (
    select provider::text as provider, source, "categoryName", "freeShipping", "ordersCount", "costPrice", "lastSyncedAt", warehouses
    from "CatalogItem"
  ),
  -- «Tendencia» = estar entre el 20 % con más pedidos de SU proveedor (misma cuenta que hacía la pantalla)
  orden as (
    select provider, "ordersCount" as n,
           row_number() over (partition by provider order by "ordersCount" desc) as pos,
           count(*) over (partition by provider) as cuantos
    from base where "ordersCount" > 0
  ),
  umbral as (
    select provider, n as umbral from orden where pos = greatest(1, ceil(cuantos * 0.2))
  )
  select jsonb_build_object(
    'total', (select count(*) from base),
    'real', (select count(*) from base where source = 'api'),
    'muestra', (select count(*) from base where source = 'sample'),
    'ultimaSincronizacion', (select max("lastSyncedAt") from base where source = 'api'),
    'envioGratis', (select count(*) from base where "freeShipping"),
    'tendencia', (select count(*) from base b join umbral u using (provider) where b."ordersCount" >= u.umbral and b."ordersCount" > 0),
    'umbrales', coalesce((select jsonb_object_agg(provider, umbral) from umbral), '{}'::jsonb),
    'proveedores', coalesce((select jsonb_agg(jsonb_build_object('provider', provider, 'count', c, 'hasReal', r)) from (select provider, count(*) c, bool_or(source = 'api') r from base group by provider) x), '[]'::jsonb),
    'categorias', coalesce((select jsonb_agg(jsonb_build_object('name', "categoryName", 'count', c) order by c desc) from (select "categoryName", count(*) c from base where "categoryName" is not null group by "categoryName") x), '[]'::jsonb),
    'almacenes', coalesce((select jsonb_agg(jsonb_build_object('code', w, 'count', c) order by c desc) from (select w, count(*) c from base, unnest(coalesce(warehouses, '{}')) w group by w) x), '[]'::jsonb),
    'precioMin', (select min("costPrice") from base),
    'precioMax', (select max("costPrice") from base)
  );
$$;

grant execute on function public.catalogo_resumen() to anon, authenticated;
