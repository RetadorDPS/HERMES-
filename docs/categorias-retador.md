# Categorías de Retador: diseño para cuando haya miles de productos (propuesta, 28/11/2026)

Estado: **PROPUESTA de DropshipPilot, NO enviada a Retador** (Daniel decide cuándo). Va en el mensaje de
`docs/pendiente-retador.md`. Nada de esto cambia todavía la app: hoy se usan las categorías que informa Retador.

## 1. El problema

- Retador tiene hoy 17 categorías y unas 150 subcategorías (leídas con `retador_categorias` el 28/11/2026). Muchas son
  de servicios y productos locales (Alimentos, Servicios, Casas & Rentas, la parte de servicios de Eventos), que están bien
  para eso, pero para lo que llega de CJ y AliExpress se quedan cortas.
- Ejemplo real: la pirámide decorativa de cristal quedó en «Hogar › Muebles» (ver el punto 6). Con 10 000 productos, una
  subcategoría como «Moda › Mujer» o «Electrónica › Accesorios tech» tendría miles y nadie encontraría nada.
- Los proveedores tienen muchas más (CJ: 14 grandes grupos y 578 finales, en inglés; AliExpress: 548, en español), pero
  copiarlas tal cual no sirve: se repiten entre los dos, muchas son casi iguales («Women's Sweaters» y «Sudaderas y jerséis»),
  cambian cuando ellos quieren y algunas están mal puestas (la pirámide estaba en «Home Office Storage»).

## 2. Cómo lo hacen los marketplaces grandes (criterio)

1. **Dos niveles fijos** (categoría › subcategoría) y, si hace falta, un tercero más adelante. Más niveles cansan al comprador.
2. **Subcategorías por TIPO de producto**, no por persona: «Vestidos», «Pantalones», «Sudaderas». Para quién es (mujer,
   hombre, niños, unisex) va como **filtro** (atributo «Para»), igual que la talla, el color, el precio o «envío a mi país».
   Así una sudadera unisex no se repite en dos sitios y la lista no se duplica por cada público.
3. **Entre 20 y 60 productos por subcategoría como mínimo útil, y que ninguna pase de unos 500.** Con 10 000 productos eso
   pide unas 200 subcategorías, que es lo que propone este documento (cifra orientativa, no dato de Retador).
4. **Una sola lista propia, en español**, y una tabla de equivalencias por detrás: cada categoría de CJ y de AliExpress
   apunta a UNA subcategoría de Retador. Si CJ y AliExpress tienen la misma cosa con dos nombres, en Retador es una sola.
5. **Nunca se borra ni se renombra una subcategoría que ya tiene productos**: solo se añaden. Si alguna sobra, se oculta
   cuando quede vacía.

## 3. Propuesta (lo que YA existe se mantiene; «+» = subcategoría NUEVA)

Las categorías de servicios y productos locales (Alimentos, Servicios, Casas & Rentas) no se tocan.

**Hogar** — Muebles · Decoración · Electrodomésticos · Cocina · Iluminación · Organización · Jardín · Herramientas hogar ·
Ropa de cama · Baño · + Vajilla y cristalería · + Textiles y cortinas · + Alfombras · + Velas y aromas · + Relojes de pared ·
+ Iluminación exterior y solar · + Linternas · + Limpieza del hogar · + Lavandería · + Climatización (ventiladores y
calefactores) · + Seguridad del hogar (cámaras, alarmas, cerraduras) · + Casa inteligente

**Electrónica** — Teléfonos · Tablets · Laptops · Audífonos · Smartwatches · Cargadores · Gaming · Cámaras · TV · Accesorios
tech · Accesorios de móvil · Cables y adaptadores · Fundas y protectores · + Altavoces · + Audio y vídeo para casa ·
+ Proyectores · + Drones · + Baterías y estaciones de energía · + Repuestos de móvil · + Componentes de ordenador ·
+ Teclados, ratones y periféricos · + Almacenamiento y memorias · + Redes y wifi · + Impresión 3D · + Componentes
electrónicos

**Moda** — Mujer · Hombre · Niños · Zapatos · Bolsos · Accesorios · Relojes · Joyas · Perfumes · Gorras · Deportiva · Lencería ·
Abrigos y chaquetas · Calzado deportivo · Ropa de invierno · + Vestidos · + Camisetas y tops · + Camisas y blusas ·
+ Pantalones y vaqueros · + Faldas y shorts · + Sudaderas y jerséis · + Trajes y americanas · + Conjuntos · + Ropa de baño ·
+ Pijamas y ropa de casa · + Ropa interior de hombre · + Calcetines · + Gafas de sol · + Cinturones y carteras ·
+ Bufandas y guantes · + Mochilas · + Maletas y viaje · + Disfraces y cosplay · + Ropa de fiesta y boda · + Tallas grandes
(«Mujer», «Hombre» y «Niños» se quedan para lo que ya está ahí; lo nuevo entra por tipo y con el filtro «Para».)

**Belleza** — Maquillaje · Skincare · Cabello · Uñas · Perfumes · Barbería · Naturales · Herramientas · Aparatos de belleza ·
Cuidado corporal · Depilación y afeitado · + Pelucas y extensiones · + Pestañas y cejas · + Brochas y esponjas ·
+ Higiene bucal · + Protección solar

**Juguetes y juegos (CATEGORÍA NUEVA)** — + Construcción · + Peluches · + Figuras de acción · + Muñecas · + Radiocontrol ·
+ Educativos · + Juegos de mesa y puzles · + Antiestrés · + Vehículos de juguete · + Juguetes de exterior · + Coleccionables y
maquetas · + Disfraces infantiles
(Hoy los juguetes van a «Bebés › Juguetes»; en dropshipping son de las familias más grandes y no son solo de bebé.)

**Bebés** — Ropa bebé · Juguetes · Coches · Alimentación · Aseo · Maternales · Seguridad · + Lactancia · + Pañales y cambio ·
+ Mobiliario de bebé · + Portabebés · + Juguetes de bebé (0 a 3 años)

**Vehículos** — Autos · Motos · Bicicletas · Eléctricos · Piezas · Mecánica · Lavado · Rentas · + Electrónica para coche ·
+ Accesorios de interior · + Accesorios de exterior · + Faros e iluminación · + Diagnóstico y herramientas · + Accesorios de
moto

**Mascotas** — Alimentos · Accesorios · Veterinaria · Juguetes · Paseo · Adopción · + Camas y casas · + Comederos y
bebederos · + Higiene y aseo · + Ropa para mascotas · + Transportines · + Rascadores y gatos · + Acuarios y peces · + Pájaros

**Salud & Fitness** — Fitness · Suplementos · Equipos médicos · Ejercicio · Nutrición · Terapias · + Masajeadores ·
+ Ortopedia y soportes · + Monitores de salud · + Yoga y pilates

**Deportes** — Fútbol · Béisbol · Ciclismo · Gimnasio · Extremos · Ropa · Equipos · Accesorios · Calzado deportivo · Ropa de
invierno · + Pesca · + Camping y senderismo · + Natación y playa · + Baloncesto · + Tenis y pádel · + Patinaje y skate ·
+ Boxeo y artes marciales · + Running

**Herramientas** — Eléctricas · Manuales · Construcción · Pintura · Soldadura · Ferretería · Equipos trabajo · Materiales ·
Accesorios y repuestos · Herramientas de mano · Medición · + Material eléctrico · + Fontanería · + Herramientas de jardín ·
+ Seguridad laboral · + Abrasivos y corte · + Juegos de herramientas

**Educación** — Libros · Papelería · Útiles · Cursos presenciales · Cursos online · Idiomas · Tecnología · + Material de
oficina · + Organización de escritorio · + Escritura y dibujo

**Arte** — Pinturas · Manualidades · Artesanías · Cuadros · Instrumentos · Coleccionables · + Costura y punto · + Pintura con
diamantes · + Bordado · + Material de dibujo · + Accesorios de música

**Eventos** — (servicios actuales) · + Artículos de fiesta · + Globos · + Navidad · + Halloween · + Bodas · + Cumpleaños

**Otros / Varios** — Gadgets · Novedades · Regalos · Varios

Total: 18 categorías y 263 subcategorías (151 que ya existen y 112 nuevas), sin borrar ni renombrar nada.

## 4. Equivalencias con los proveedores (sin repetidos)

Cada categoría de proveedor apunta a UNA subcategoría de Retador. Ejemplos con nombres reales:

| CJ (inglés) | AliExpress (español) | Retador |
|---|---|---|
| Phones & Accessories › Mobile Phones | (categoría 5090301, Teléfonos móviles) | Electrónica › Teléfonos |
| Phones & Accessories › Cases & Covers | Fundas y carcasas para móviles · Película protectora para teléfono móvil | Electrónica › Fundas y protectores |
| Phones & Accessories › Mobile Phone Parts | — | Electrónica › Repuestos de móvil (+) |
| Consumer Electronics › Portable Audio & Video › Speakers | Audio portátil y vídeo | Electrónica › Altavoces (+) |
| Consumer Electronics › Camera & Photo | Cámara y fotografía | Electrónica › Cámaras |
| Computer & Office › Storage Devices | Almacenamiento Externo | Electrónica › Almacenamiento y memorias (+) |
| Home Improvement › Outdoor Lighting · Solar Lamps | Iluminación novedosa · Lámparas portátiles | Hogar › Iluminación exterior y solar (+) |
| Home, Garden & Furniture › Home Storage | Almacenamiento y organización del hogar | Hogar › Organización |
| (decoración, aunque CJ la guarde en «Home Storage») | Decoración para el hogar | Hogar › Decoración |
| Women's Clothing › Women's Sweaters · Sweatshirts & Hoodies | Sudaderas y jerséis | Moda › Sudaderas y jerséis (+) |
| Jewelry & Watches › Fashion Jewelry | Joyería de moda | Moda › Joyas |
| Health, Beauty & Hair › Wigs & Extensions · Synthetic Hair | Cabello sintético | Belleza › Pelucas y extensiones (+) |
| Toys, Kids & Babies › Toys & Hobbies › Building | Juguetes de construcción | Juguetes y juegos › Construcción (+) |
| Pet Supplies › Pet Bedding · Pet Furnitures | — | Mascotas › Camas y casas (+) |
| Sports & Outdoors › Fishing | Pesca | Deportes › Pesca (+) |
| Automobiles & Motorcycles › Car Electronics | Electrónica para coches | Vehículos › Electrónica para coche (+) |

La tabla completa (las 578 de CJ y las 548 de AliExpress) se genera en DropshipPilot cuando Retador confirme la lista final con
sus identificadores: `src/lib/retador/sugerir-categoria.ts` pasará a usarla. Hoy la sugerencia ya funciona con palabras clave
y solo propone subcategorías que existen.

## 5. Qué hace cada lado

- **Retador:** añadir las subcategorías nuevas y la categoría «Juguetes y juegos» (sin tocar las que ya existen), sacarlas en
  `dropship-config` y en `retador_categorias`, y, si puede, el filtro «Para» (mujer, hombre, niños, unisex) como atributo del
  producto. Devolver la lista final con identificadores.
- **DropshipPilot:** con la lista final, generar la tabla de equivalencias completa, usarla en la sugerencia al publicar (uno
  y varios) y proponer reubicar los productos ya publicados que hoy estén en una subcategoría demasiado general (siempre con
  la confirmación del vendedor, nunca solo).

## 6. Arreglado ya en DropshipPilot (v84)

La sugerencia ponía la pirámide en «Muebles» porque la categoría de CJ era «Home, Garden & **Furniture** › Home Storage ›
Home Office Storage» y la palabra «Furniture» del nivel de arriba pesaba más que «Decoration» del título. Ahora el último
nivel de la categoría y el título valen lo mismo, los niveles de arriba casi nada, y en empate gana el título: sugiere
«Hogar › Decoración» (prueba en `tests/retador/envio-incluido-categorias.test.ts`). El producto ya publicado sigue en
«Muebles» en Retador: se cambia desde la app de Retador.
