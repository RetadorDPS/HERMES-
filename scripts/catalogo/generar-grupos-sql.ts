/**
 * Genera la migración de las categorías sencillas del catálogo a partir de `src/lib/catalogo/grupos.ts` (una sola lista de
 * reglas para la pantalla y la base de datos). Uso: `npx tsx scripts/catalogo/generar-grupos-sql.ts > supabase/migrations/…sql`
 */
import { GRUPOS_CATALOGO, GRUPO_OTROS, normalizarPalabra } from '../../src/lib/catalogo/grupos';

const reglas = GRUPOS_CATALOGO.map((g) => [g.id, g.palabras.map(normalizarPalabra)]);
const json = JSON.stringify(reglas).replace(/'/g, "''");
// Letras con tilde o signo que la pantalla convierte a su letra base (normalize NFD); el resto de símbolos pasa a espacio
const conTilde = 'áàâäãåāéèêëēíìîïīóòôöõōúùûüūñçýÿ';
const sinTilde = 'aaaaaaaeeeeeiiiiioooooouuuuuncyy';

process.stdout.write(`-- Categorías SENCILLAS del catálogo (las generales de Retador: hogar, moda, electrónica…), calculadas en la base.
-- GENERADO con scripts/catalogo/generar-grupos-sql.ts desde src/lib/catalogo/grupos.ts: no editar a mano.
-- Regla: manda la categoría del proveedor (primer grupo de la lista con una palabra presente); si no dice nada, el título
-- (gana la palabra que aparece antes; a igual posición, el grupo que va antes); si nada encaja, '${GRUPO_OTROS.id}'.

create or replace function public.grupo_normalizar(p_texto text)
returns text language sql immutable parallel safe set search_path = public as $f$
  select ' ' || btrim(regexp_replace(translate(lower(coalesce(p_texto, '')), '${conTilde}', '${sinTilde}'), '[^a-z0-9]+', ' ', 'g')) || ' ';
$f$;

create or replace function public.grupo_catalogo(p_titulo text, p_categoria text)
returns text language plpgsql immutable parallel safe set search_path = public as $f$
declare
  reglas constant jsonb := '${json}'::jsonb;
  c text := public.grupo_normalizar(p_categoria);
  t text := public.grupo_normalizar(p_titulo);
  g jsonb;
  p text;
  pos int;
  mejor_pos int := null;
  mejor text := null;
begin
  if btrim(c) <> '' then
    for g in select value from jsonb_array_elements(reglas) loop
      for p in select value from jsonb_array_elements_text(g->1) loop
        if strpos(c, p) > 0 then return g->>0; end if;
      end loop;
    end loop;
  end if;
  if btrim(t) <> '' then
    for g in select value from jsonb_array_elements(reglas) loop
      for p in select value from jsonb_array_elements_text(g->1) loop
        pos := strpos(t, p);
        if pos > 0 and (mejor_pos is null or pos < mejor_pos) then
          mejor_pos := pos;
          mejor := g->>0;
        end if;
      end loop;
    end loop;
  end if;
  return coalesce(mejor, '${GRUPO_OTROS.id}');
end;
$f$;

alter table public."CatalogItem" add column if not exists grupo text;

create or replace function public.catalogo_poner_grupo()
returns trigger language plpgsql set search_path = public as $f$
begin
  new.grupo := public.grupo_catalogo(new.title, new."categoryName");
  return new;
end;
$f$;

drop trigger if exists catalogo_poner_grupo on public."CatalogItem";
create trigger catalogo_poner_grupo before insert or update of title, "categoryName" on public."CatalogItem"
  for each row execute function public.catalogo_poner_grupo();

-- Todos los productos que ya están en el catálogo (sin tocar su fecha de actualización: solo se añade el grupo)
alter table public."CatalogItem" disable trigger "tocar_updated_at_CatalogItem";
update public."CatalogItem" set grupo = public.grupo_catalogo(title, "categoryName");
alter table public."CatalogItem" enable trigger "tocar_updated_at_CatalogItem";

create index if not exists catalogitem_grupo_idx on public."CatalogItem" (grupo);
`);
