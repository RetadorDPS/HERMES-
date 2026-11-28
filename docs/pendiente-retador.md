# Pendiente con Retador (lista única, al día el 28/11/2026)

Daniel ha decidido **no enviar nada al Claude de Retador todavía**: la base de datos de DropshipPilot está conectada aquí y no
allí. Aquí se junta TODO lo que hay que pedir o preguntar a Retador, para mandarlo de una vez y bien dado cuando él lo decida.
Al enviarlo: copiar el bloque del final (punto 3) y apuntar aquí la fecha y la respuesta.

## 1. Lista (de más a menos importante)

| # | Tema | Qué se pide | Estado |
|---|---|---|---|
| 1 | Categorías | Ampliar subcategorías y añadir «Juguetes y juegos» según `docs/categorias-retador.md`; filtro «Para» (mujer, hombre, niños, unisex); devolver la lista final con identificadores | Sin enviar |
| 2 | Envío que cotiza Retador | Confirmar que Retador cotiza el envío al comprador EN VIVO y por su cuenta (con su conexión a CJ y AliExpress, caché y presupuesto diario): con qué país, para qué cantidad y si usa el `envio` que manda DropshipPilot o lo ignora. Ver punto 2 | Sin enviar |
| 3 | `dropship-eliminar` | Comprobarla con un producto de prueba (desde el 2/11/2026 está sin probar en vivo) | Sin enviar |
| 4 | Velocidad | `dropship-config` y `dropship-estado` tardaron 12 a 16 s cada una en los registros del 28/11/2026 | Sin enviar |
| 5 | Envío gratis para el comprador | Permitirlo por producto (la parte de DropshipPilot ya está escrita) | Sin enviar |
| 6 | Asistente de IA en el MCP de Retador | Herramientas `dropship_*` según `docs/asistente-ia-retador.md` (fase 1 primero) | Plan, sin enviar |
| 7 | Envío incluido al editar | Poder cambiar `envio_incluido` en un producto ya publicado (en DropshipPilot falta la pantalla) | Pendiente nuestro |
| 8 | `peso_gramos` por variante | Retador ya lo admite (`capacidades.peso_variante`); falta mandarlo desde aquí | Pendiente nuestro |

## 2. Lo que se ha visto del envío (28/11/2026, datos reales)

- Pirámide decorativa de CJ: al publicarla (13:16) solo estaba cotizado el envío a EE. UU. (13:14); España se cotizó después
  (13:20). Aun así, Retador enseñaba «envío disponible a España».
- Explicación: el envío NO viene dentro del producto (ni CJ ni AliExpress lo dan en la ficha; hay que preguntarlo país por
  país). Lo de España lo calculó Retador por su cuenta: su herramienta `retador_cotizar_envio` dice que «usa primero su caché y
  un presupuesto diario» y cotiza en vivo. Es decir, Retador gasta SUS llamadas al proveedor para el comprador.
- Para qué sirve entonces cotizar en DropshipPilot: (a) saber ANTES de publicar si el proveedor envía (si no envía a EE. UU.,
  tampoco llega a Cuba); (b) que el vendedor vea el coste y el plazo; (c) el envío incluido por país. Para publicar en Retador
  basta EE. UU.; los demás países solo hacen falta si el vendedor quiere verlos o incluir el envío en su precio.
- Pregunta a Retador (punto 2 de la tabla): si confirma que no necesita nuestras cotizaciones para mostrar el envío al
  comprador, DropshipPilot puede dejar de cotizar por defecto los países que no sean EE. UU. y ahorrar llamadas. Decisión de
  Daniel después de la respuesta.

## 3. Mensaje preparado (NO enviado)

```
Hola, soy DropshipPilot (el importador de productos de CJ y AliExpress conectado a Retador). Te mando todo lo pendiente de una vez. Respóndeme punto por punto, con lo que ya está hecho, lo que harás y lo que no.

1) CATEGORÍAS. Con 17 categorías y unas 150 subcategorías, cuando haya miles de productos importados las subcategorías generales (Moda › Mujer, Electrónica › Accesorios tech) tendrán miles de productos. Propuesta (sin borrar ni renombrar nada de lo que existe, solo añadir):
- Subcategorías por TIPO de producto y, para quién es (mujer, hombre, niños, unisex), como filtro/atributo «Para» del producto.
- Categoría nueva «Juguetes y juegos»: Construcción, Peluches, Figuras de acción, Muñecas, Radiocontrol, Educativos, Juegos de mesa y puzles, Antiestrés, Vehículos de juguete, Juguetes de exterior, Coleccionables y maquetas, Disfraces infantiles.
- Hogar: Vajilla y cristalería, Textiles y cortinas, Alfombras, Velas y aromas, Relojes de pared, Iluminación exterior y solar, Linternas, Limpieza del hogar, Lavandería, Climatización, Seguridad del hogar, Casa inteligente.
- Electrónica: Altavoces, Audio y vídeo para casa, Proyectores, Drones, Baterías y estaciones de energía, Repuestos de móvil, Componentes de ordenador, Teclados ratones y periféricos, Almacenamiento y memorias, Redes y wifi, Impresión 3D, Componentes electrónicos.
- Moda: Vestidos, Camisetas y tops, Camisas y blusas, Pantalones y vaqueros, Faldas y shorts, Sudaderas y jerséis, Trajes y americanas, Conjuntos, Ropa de baño, Pijamas y ropa de casa, Ropa interior de hombre, Calcetines, Gafas de sol, Cinturones y carteras, Bufandas y guantes, Mochilas, Maletas y viaje, Disfraces y cosplay, Ropa de fiesta y boda, Tallas grandes.
- Belleza: Pelucas y extensiones, Pestañas y cejas, Brochas y esponjas, Higiene bucal, Protección solar.
- Bebés: Lactancia, Pañales y cambio, Mobiliario de bebé, Portabebés, Juguetes de bebé (0 a 3 años).
- Vehículos: Electrónica para coche, Accesorios de interior, Accesorios de exterior, Faros e iluminación, Diagnóstico y herramientas, Accesorios de moto.
- Mascotas: Camas y casas, Comederos y bebederos, Higiene y aseo, Ropa para mascotas, Transportines, Rascadores y gatos, Acuarios y peces, Pájaros.
- Salud & Fitness: Masajeadores, Ortopedia y soportes, Monitores de salud, Yoga y pilates.
- Deportes: Pesca, Camping y senderismo, Natación y playa, Baloncesto, Tenis y pádel, Patinaje y skate, Boxeo y artes marciales, Running.
- Herramientas: Material eléctrico, Fontanería, Herramientas de jardín, Seguridad laboral, Abrasivos y corte, Juegos de herramientas.
- Educación: Material de oficina, Organización de escritorio, Escritura y dibujo.
- Arte: Costura y punto, Pintura con diamantes, Bordado, Material de dibujo, Accesorios de música.
- Eventos: Artículos de fiesta, Globos, Navidad, Halloween, Bodas, Cumpleaños.
Que salgan en dropship-config y en retador_categorias, y devuélveme la lista final con el identificador de cada subcategoría. DropshipPilot hará la tabla de equivalencias de las 578 categorías de CJ y las 548 de AliExpress hacia la vuestra (sin repetidos) y la usará para sugerir la categoría al publicar.

2) ENVÍO AL COMPRADOR. Publiqué un producto de CJ con solo el envío a EE. UU. cotizado en DropshipPilot y Retador enseñaba «envío disponible a España». Confirma: ¿Retador cotiza el envío en vivo por su cuenta para el país del comprador? ¿Con qué cantidad y variante? ¿Usa o ignora el campo «envio» que manda DropshipPilot al publicar? ¿Qué pasa si se acaba vuestro presupuesto diario de cotizaciones? Lo pregunto para no gastar llamadas al proveedor que no hacen falta.

3) dropship-eliminar: ¿la habéis probado ya en vivo con un producto de prueba?

4) VELOCIDAD: dropship-config y dropship-estado tardaron 12 a 16 segundos cada una el 28/11/2026. ¿Se puede acelerar?

5) ENVÍO GRATIS PARA EL COMPRADOR por producto: ¿cuándo estará? En DropshipPilot ya está escrito.

6) ASISTENTE DE IA: propuesta de herramientas dropship_* en vuestro MCP para buscar, importar y publicar desde el chat; te mando el plan aparte cuando quieras empezar por la fase 1.
```

## 4. Historial de envíos

- (vacío: todavía no se ha enviado nada de esta lista)
