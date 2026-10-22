-- Barrido programado de los pedidos de Retador: cada 5 minutos llama a `pedidos-barrido` con la misma clave del almacén de secretos que usa el monitor.
select cron.schedule(
  'pedidos-barrido',
  '*/5 * * * *',
  $cron$ select net.http_post(
    url := 'https://zucoorfalpylffustiax.supabase.co/functions/v1/pedidos-barrido',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-monitor-secreto', (select decrypted_secret from vault.decrypted_secrets where name = 'monitor_secreto')),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  ) $cron$
);
