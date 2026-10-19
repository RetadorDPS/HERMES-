-- Barrido programado del monitor: cada 30 minutos pide a `monitor-proveedor` que revise, como mucho, 3 productos que toquen.
-- Requiere que exista el secreto `monitor_secreto` en el almacén de secretos de Supabase (vault). Se crea UNA vez, a mano, con:
--   select vault.create_secret(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'monitor_secreto', 'Clave del barrido programado');
-- La clave no se escribe aquí ni en el texto de la tarea: la tarea la lee del almacén en cada ejecución.
select cron.schedule(
  'monitor-proveedor',
  '*/30 * * * *',
  $cron$ select net.http_post(
    url := 'https://zucoorfalpylffustiax.supabase.co/functions/v1/monitor-proveedor',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-monitor-secreto', (select decrypted_secret from vault.decrypted_secrets where name = 'monitor_secreto')),
    body := '{"maximo":3}'::jsonb,
    timeout_milliseconds := 150000
  ) $cron$
);
