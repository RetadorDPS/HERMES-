-- Retador SIMULADO: guarda el estado de las pruebas de la conexión con Retador (solo para el administrador).
-- Tabla privada: sin políticas ni permisos para clientes; solo la lee y escribe la función `retador-simulado`.
create table if not exists "RetadorSimulado" (
  ref text primary key,
  data jsonb not null,
  "createdAt" timestamp without time zone not null default current_timestamp,
  "updatedAt" timestamp without time zone not null default current_timestamp
);
alter table "RetadorSimulado" enable row level security;
revoke all on "RetadorSimulado" from anon, authenticated;
comment on table "RetadorSimulado" is 'Estado del Retador simulado (pruebas). No contiene datos reales.';
