-- Monitor de precio y existencias del proveedor.
-- · Un bloqueo para que nunca corran dos revisiones a la vez (CJ y AliExpress cortan si se les llama en paralelo).
-- · La clave del barrido programado vive en el almacén de secretos de Supabase (vault), con el nombre `monitor_secreto`;
--   NUNCA en este archivo ni en el texto de la tarea programada. La función `monitor-proveedor` la comprueba con `monitor_secreto_valido`.
-- · Un barrido cada 30 minutos revisa, como mucho, 3 productos que toquen (cada producto se vuelve a mirar a las 6 horas).
create table if not exists "MonitorBloqueo" (
  id text primary key,
  hasta timestamp without time zone not null
);
alter table "MonitorBloqueo" enable row level security;
revoke all on "MonitorBloqueo" from anon, authenticated;

create or replace function public.monitor_adquirir(p_segundos integer) returns boolean
language plpgsql security definer set search_path = public as $$
declare ok boolean;
begin
  insert into "MonitorBloqueo" (id, hasta) values ('monitor', (now() at time zone 'utc') + make_interval(secs => p_segundos))
  on conflict (id) do update set hasta = excluded.hasta where "MonitorBloqueo".hasta < (now() at time zone 'utc')
  returning true into ok;
  return coalesce(ok, false);
end $$;

create or replace function public.monitor_liberar() returns void
language sql security definer set search_path = public as $$
  update "MonitorBloqueo" set hasta = (now() at time zone 'utc') - interval '1 second' where id = 'monitor';
$$;

create or replace function public.monitor_secreto_valido(p_secreto text) returns boolean
language sql security definer set search_path = public, vault as $$
  select coalesce(p_secreto, '') <> '' and exists (select 1 from vault.decrypted_secrets where name = 'monitor_secreto' and decrypted_secret = p_secreto);
$$;

revoke all on function public.monitor_adquirir(integer), public.monitor_liberar(), public.monitor_secreto_valido(text) from public, anon, authenticated;
grant execute on function public.monitor_adquirir(integer), public.monitor_liberar(), public.monitor_secreto_valido(text) to service_role;

-- Para encontrar enseguida los productos publicados que hay que vigilar
create index if not exists "Product_vigilancia" on "Product" ("supplierId", "supplierProductId") where "isMonitored";
create index if not exists "SyncLog_producto_fecha" on "SyncLog" ("productId", "createdAt");
