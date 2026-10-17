-- Ficha completa de cada artículo del catálogo (detalle, variantes, stock por almacén, envío por país y reseñas).
-- `ficha` es lo que ve el usuario en la pantalla. `raw` guarda las respuestas completas del proveedor y solo la lee el servidor.

create table if not exists public."CatalogItemDetail" (
  "itemId"    text primary key references public."CatalogItem"(id) on delete cascade,
  ficha       jsonb not null default '{}'::jsonb,
  raw         jsonb not null default '{}'::jsonb,
  "fetchedAt" timestamp not null default current_timestamp
);

alter table public."CatalogItemDetail" enable row level security;

create policy ficha_visible on public."CatalogItemDetail" for select to authenticated using (true);

-- Los clientes solo pueden leer la ficha; `raw` queda reservado al servidor
revoke all on public."CatalogItemDetail" from anon, authenticated;
grant select ("itemId", ficha, "fetchedAt") on public."CatalogItemDetail" to authenticated;

-- Una categoría por proveedor e identificador (permite actualizar sin duplicar)
create unique index if not exists "CatalogCategory_provider_externalId_key" on public."CatalogCategory" (provider, "externalId");
