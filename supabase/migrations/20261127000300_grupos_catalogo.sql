-- Categorías SENCILLAS del catálogo (las generales de Retador: hogar, moda, electrónica…), calculadas en la base.
-- GENERADO con scripts/catalogo/generar-grupos-sql.ts desde src/lib/catalogo/grupos.ts: no editar a mano.
-- Regla: manda la categoría del proveedor (primer grupo de la lista con una palabra presente); si no dice nada, el título
-- (gana la palabra que aparece antes; a igual posición, el grupo que va antes); si nada encaja, 'otros'.

create or replace function public.grupo_normalizar(p_texto text)
returns text language sql immutable parallel safe set search_path = public as $f$
  select ' ' || btrim(regexp_replace(translate(lower(coalesce(p_texto, '')), 'áàâäãåāéèêëēíìîïīóòôöõōúùûüūñçýÿ', 'aaaaaaaeeeeeiiiiioooooouuuuuncyy'), '[^a-z0-9]+', ' ', 'g')) || ' ';
$f$;

create or replace function public.grupo_catalogo(p_titulo text, p_categoria text)
returns text language plpgsql immutable parallel safe set search_path = public as $f$
declare
  reglas constant jsonb := '[["mascotas",[" pet "," pets ","mascota"," dog","perro"," cat "," cats ","gato","barking","kitten","puppy","cachorro","aquarium","acuario","bird cage","jaula"]],["bebes",["baby","bebe","newborn","recien nacido","toddler","maternidad","maternity","embarazo","pregnan"," toy","juguete","jugar ","plush","peluche","stuffed"," doll "," dolls ","muneca","figura","figure","puzzle","rompecabezas","building block","lego","stroller","carrito de bebe","pacifier","chupete","biberon","feeding bottle","diaper","panal"]],["vehiculos",[" car "," cars ","automobile","automovil","automotive","vehicle","vehiculo"," coche","motorcycle","motocicleta"," moto ","scooter","dash cam","faros de coche","car accessor","exterior parts","interior parts","piezas exteriores","piezas interiores","exterior accessor","accesorios de interior","seat cover","funda de asiento"," tire "," tires ","neumatico","wiper","limpiaparabrisas"]],["belleza",["makeup","make up","maquillaje","cosmetic","cosmetico","lipstick","labial","eyelash","pestana","eyeshadow","mascara de pestanas"," nail "," nails ","manicur","pedicur","esmalte","skin care","skincare","cuidado de la piel","facial","face care","serum","beauty","belleza"," hair","cabello"," pelo","peluca"," wig "," wigs ","braid","trenza","straighten","plancha de pelo","curling","rizador","shampoo","champu","razor","shaver","afeitad","depilad","epilat","trimmer","barber","barberia","perfume","fragrance","colonia","cologne","essential oil","aceite esencial","body care","cuidado corporal","cuidado personal","personal care","higiene","oral care","toothbrush","cepillo de dientes","face mask","mascarilla"]],["salud",["fitness","bodybuilding","culturismo","dumbbell","mancuerna","resistance band","yoga mat","esterilla","gym equipment","workout","health","salud","medical","medico","massage","masaje","massager","masajeador","thermometer","termometro","blood pressure","tensiometro","supplement","suplemento","vitamin","vitamina","posture","postura","orthopedic","ortopedic"]],["electronica",["smartwatch","smart watch","smart wristband","smart band","fitness tracker"," cases ","cases for","phone case","fundas y carcasas","screen protector","protector de pantalla"]],["hogar",["ropa de cama","bedding","pillow","almohada","cushion","cojin","duvet","edredon","sabana","blanket"," manta","curtain","cortina","towel","toalla","textil de hogar","home textile"]],["moda",["shoe","zapat","calzado","sneaker","zapatilla","trainers","boots"," boot "," bota","sandal","sandalia","slipper","chancla","pantufla","loafer","mocasin","pumps"," flats","heels","tacon","vulcaniz","insole","plantilla","handbag"," bag","bags","bolso","purse","backpack","mochila","wallet","cartera","portatarjeta","tote","clutch","crossbody","briefcase","maletin","luggage","maleta","equipaje","belt","cinturon","cummerbund","scarf","scarves","bufanda","panuelo","glove","guante","mitten","manopla","sunglass","gafas de sol","eyewear","keychain","llavero"," hat "," hats "," cap "," caps ","gorra","gorro","sombrero","beanie","jewel","joya","joyeria","necklace","collar ","collares","pendant","colgante","bracelet","pulsera","bangle","brazalete","earring","pendiente","arete"," ring "," rings ","anillo","charm","silver"," plata ","watch","reloj","wristband","dress","vestido","blouse","blusa","shirt","camisa","camiseta"," tee ","t shirt"," top "," tops ","camis"," tank "," tanks ","skirt","falda","pants","pantalon","trousers","jeans","vaquero","shorts","leggings","capris","jumpsuit"," mono ","romper"," overalls","hoodie","sudadera","sweatshirt","sweater","jersey","jerse","cardigan","knit","jacket","chaqueta"," coat "," coats ","abrigo","trench","gabardina","parka","blazer","americana"," suit "," suits ","traje"," vest "," vests ","chaleco"," down ","plumifero","wool"," lana ","leather","cuero","suede","bikini","swimwear","swimsuit","banador","one piece","two piece","lingerie","lenceria","underwear","ropa interior"," bra "," bras ","sujetador","panties","bragas","boxer","socks","calcetin","sleepwear","pajama","pijama"," robe "," robes "," bata ","lounge","clothing","clothes","ropa de mujer","ropa de hombre","ropa de nin","ropa deportiva","apparel","women","woman","mujer"," men "," mens "," man ","hombre","lady","ladies","girl","nina","boy","nino","children","kids","cosplay","disfraz","costume"," solid "," striped "," print "," patterned "," fabric "]],["deportes",["sport","deport","cycling","ciclismo","bicycle","bicicleta"," bike","fishing","pesca"," lure","senuelo","camping","hiking","senderismo","hunting"," caza","climbing","escalada"," tent","tienda de campana","soccer","futbol","football","basketball","baloncesto","baseball","beisbol","tennis","tenis","golf"," ski ","esqui","swim","natacion","skate","patin","helmet","casco","running","correr"]],["electronica",["phone","telefono","movil","smartphone","iphone","samsung","xiaomi"," case "," cases ","fundas y carcasas","carcasa","screen protector","protector de pantalla","tempered glass","charger","cargador","charging","power bank","bateria externa","cable","adapter","adaptador","usb","earphone","earbud","headphone","headset","auricular","audifono","speaker","altavoz","audio","amplifier","amplificador","microphone","microfono","camera","camara","lens","lente","tripod","tripode","drone","dvr","surveillance","vigilancia","security camera","alarm","alarma","sensor","gps","tracker","localizador","smart home","hogar inteligente","inteligencia familiar","network","dispositivos de red","router","wifi","computer","ordenador","laptop","portatil de ","tablet","keyboard","teclado","mouse","raton","printer","impresora","projector","proyector"," tv ","television","gaming","gamer"," game","videojuego","juegos y accesorios","console","consola","controller"," mando","periferico","electronic","electronica","componentes activos","housing","smartwatch","smart watch","battery","batteries","baterias"," pilas ","storage device","almacenamiento externo","power station","estacion de energia","generador","generator","memory card","tarjeta de memoria","video"," radio"]],["educacion",["stationery","papeleria","office supplies","office school","material de oficina","school","escuela","escolar"," pen "," pens ","boligrafo","pencil","lapiz","lapices","notebook","cuaderno","paper","papel"," book"," books","libro","learning","aprendizaje","educa","printed media","medios impresos"]],["herramientas",["power tool","herramienta electrica","herramientas electricas","hand tool","herramientas manuales","herramienta manual","tool set","sets de herramientas","juego de herramientas","recambios de herramientas","drill","taladro","broca"," saw","sierra","wrench","llave inglesa","screwdriver","destornillador","hammer","martillo","pliers","alicate","abrasiv","welding","soldadura","solder","hardware","ferreteria","screw","tornillo","measur","medicion","multimeter","multimetro"," tape "," tapes ","adhesiv","fontaneria","plumbing","electrical equipment","equipamiento electrico","safety supplies","seguridad laboral","workplace","construction","construccion","paint tool","herramienta"]],["hogar",["furniture","mueble","sofa","chair","silla"," table "," tables "," mesa","desk","escritorio","shelf","estante","cabinet","armario","wardrobe","kitchen","cocina","cooking","molde","ice cube","cubitos de hielo","cookware","utensil","knife","knives","cuchillo","drinkware","dinnerware","tableware","vajilla"," cup "," cups "," mug","taza","bottle","botella","jar","tarro","lamp","lampara","light","luz","luces","lighting","iluminacion","foco","floodlight","spotlight","downlight","flashlight","torch","linterna","bulb","bombilla","solar","storage","almacenamiento","organizer","organizador","organizacion","basket","cesta","hanger","percha","garden","jardin","jardineria","planter","maceta","bedding","ropa de cama","sabana","blanket","manta","pillow","almohada","cojin","cushion","duvet","edredon","curtain","cortina","towel","toalla","textil","bathroom","bano","shower","ducha","appliance","electrodomestico","cleaning","limpieza","vacuum","aspiradora","fan ","ventilador","heater","calefactor","decor","decoracion","ornament","ornamental","adorno","wall art"," vase","jarron"," frame"," marco"," puerta"," ventana","home","hogar","household","casa"]],["arte",["craft","manualidad","artesania","handmade","hecho a mano","sewing","costura","painting","pintura","diamond painting","cross stitch","punto de cruz"," diy ","instrument","instrumento","guitar","guitarra","piano","ukulele"," drum","tambor","collectible","coleccion","hobbies"]],["eventos",["party","fiesta","festiv","event","evento","wedding","boda","balloon","globo","birthday","cumpleanos","christmas","navidad","halloween"]]]'::jsonb;
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
  return coalesce(mejor, 'otros');
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
