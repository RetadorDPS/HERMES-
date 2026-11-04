-- Con los avisos firmados de Retador funcionando (pedidos, productos y tarifas llegan solos), el barrido de pedidos pasa a ser solo una red de seguridad: cada 30 minutos en vez de cada 5.
select cron.alter_job((select jobid from cron.job where jobname = 'pedidos-barrido'), schedule := '*/30 * * * *');
