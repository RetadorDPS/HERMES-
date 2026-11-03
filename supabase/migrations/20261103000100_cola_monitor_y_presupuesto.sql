-- Fase 2 y 3: cola con prioridad del monitor, presupuesto por proveedor y mantenimiento de envío y opiniones.
-- 1) Sumar las llamadas reales que hace cada proveedor en el día (las usan el monitor y la puerta de los usuarios). Es atómica.
create or replace function public.sumar_llamadas_proveedor(p_proveedor text, p_llamadas integer, p_rechazos integer default 0)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public."UsoProveedorDia" (proveedor, dia, llamadas, rechazos)
  values (p_proveedor, (now() at time zone 'utc')::date, greatest(coalesce(p_llamadas, 0), 0), greatest(coalesce(p_rechazos, 0), 0))
  on conflict (proveedor, dia) do update
    set llamadas = public."UsoProveedorDia".llamadas + greatest(coalesce(p_llamadas, 0), 0),
        rechazos = public."UsoProveedorDia".rechazos + greatest(coalesce(p_rechazos, 0), 0);
$$;
revoke all on function public.sumar_llamadas_proveedor(text, integer, integer) from public, anon, authenticated;
grant execute on function public.sumar_llamadas_proveedor(text, integer, integer) to service_role;

-- 2) El barrido pasa de cada 30 a cada 10 minutos. Cuántos productos revisa por vuelta lo manda el cuerpo (`maximo`, hasta 15),
--    pero lo que de verdad manda es el presupuesto por proveedor y la prioridad de cada producto (urgente 1 h, normal 6 h, ocioso 24 h).
select cron.unschedule('monitor-proveedor');
select cron.schedule(
  'monitor-proveedor',
  '*/10 * * * *',
  $cron$ select net.http_post(
    url := 'https://zucoorfalpylffustiax.supabase.co/functions/v1/monitor-proveedor',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-monitor-secreto', (select decrypted_secret from vault.decrypted_secrets where name = 'monitor_secreto')),
    body := '{"maximo":6}'::jsonb,
    timeout_milliseconds := 150000
  ) $cron$
);

-- 3) Para poner el tope real de llamadas al día de un proveedor cuando se conozca (hasta entonces rige un freno provisional nuestro):
--    insert into "UsoProveedorDia" (proveedor, dia, llamadas, tope) values ('CJ_DROPSHIPPING', (now() at time zone 'utc')::date, 0, 5000)
--      on conflict (proveedor, dia) do update set tope = 5000;
--    (vale el último tope que se haya puesto, hasta que se ponga otro)
