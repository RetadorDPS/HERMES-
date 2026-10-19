-- Estado de la conexión con cada proveedor, para la pantalla «Proveedores y APIs».
-- La tabla PlatformCredential es privada (guarda tokens). Esta función enseña a cualquier usuario con sesión SOLO lo inocuo:
-- si el proveedor responde, cuándo se comprobó y si la cuenta de AliExpress está autorizada. El último error y las llamadas del mes solo los ve el administrador.
create or replace function public.estado_proveedores()
returns table (provider text, estado text, ultima_comprobacion timestamp without time zone, cuenta_autorizada boolean, ultimo_error text, llamadas_mes integer)
language sql stable security definer set search_path = public as $$
  select c.provider::text,
         c.status::text,
         c."lastTestAt",
         coalesce((c.settings -> 'aliToken' ->> 'accessToken') is not null, false),
         case when private.es_admin() then c."lastError" else null end,
         case when private.es_admin() then c."usedThisMonth" else null end
  from "PlatformCredential" c
  where auth.uid() is not null;
$$;
revoke all on function public.estado_proveedores() from public, anon;
grant execute on function public.estado_proveedores() to authenticated, service_role;
