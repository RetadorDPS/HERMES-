-- v80: todo lo que se hace con los proveedores va acorde al plan.
--  · IMPORTACION: productos añadidos al catálogo (por enlace o desde el buscador). Cada uno trae su ficha completa y el envío a
--    EE. UU. (2 o 3 llamadas al proveedor), así que cuenta con el plan igual que las fichas y las cotizaciones. Antes era un
--    tope fijo de 30 al día para todos, y el plan Prueba podía añadir más productos al día que fichas en total.
--  · PlanCapacidad: cuántos productos se manejan A LA VEZ (elegir en el buscador para añadir y publicar varios en Retador) y
--    cuántas páginas tiene cada búsqueda (bajar para ver más no gasta del plan, pero sí llama al proveedor).
-- Quien tiene la marca «sin límite» (y el administrador) no gasta cupo.

alter table public."PlanLimite" drop constraint if exists "PlanLimite_tipo_check";
alter table public."PlanLimite" add constraint "PlanLimite_tipo_check" check (tipo = any (array['FICHA', 'COTIZACION_ENVIO', 'BUSQUEDA', 'IMPORTACION']));
alter table public."UsoCuota" drop constraint if exists "UsoCuota_tipo_check";
alter table public."UsoCuota" add constraint "UsoCuota_tipo_check" check (tipo = any (array['FICHA', 'COTIZACION_ENVIO', 'BUSQUEDA', 'IMPORTACION']));

insert into public."PlanLimite" (plan, tipo, ventana, "limiteVentana", "limiteDia") values
  ('TRIAL', 'IMPORTACION', 'TOTAL', 20, 10),
  ('STARTER', 'IMPORTACION', 'MES', 150, 25),
  ('PRO', 'IMPORTACION', 'MES', 600, 60),
  ('ENTERPRISE', 'IMPORTACION', 'MES', 2000, 150)
on conflict (plan, tipo) do update set ventana = excluded.ventana, "limiteVentana" = excluded."limiteVentana", "limiteDia" = excluded."limiteDia";

create table if not exists public."PlanCapacidad" (
  plan "PlanTier" primary key,
  "productosPorTanda" integer not null check ("productosPorTanda" between 1 and 50),
  "paginasPorBusqueda" integer not null check ("paginasPorBusqueda" between 1 and 50)
);
alter table public."PlanCapacidad" enable row level security;
drop policy if exists "PlanCapacidad_ver" on public."PlanCapacidad";
create policy "PlanCapacidad_ver" on public."PlanCapacidad" for select using (true);

insert into public."PlanCapacidad" (plan, "productosPorTanda", "paginasPorBusqueda") values
  ('TRIAL', 5, 3),
  ('STARTER', 10, 5),
  ('PRO', 20, 10),
  ('ENTERPRISE', 20, 15)
on conflict (plan) do update set "productosPorTanda" = excluded."productosPorTanda", "paginasPorBusqueda" = excluded."paginasPorBusqueda";
