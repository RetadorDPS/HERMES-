# Escalabilidad — qué aguanta hoy y qué hay que tocar para crecer

Revisión hecha **midiendo** (`npm run loadtest`), no opinando. Los números están tomados de la app en
marcha con la base de datos actual.

---

## 1. Capacidad medida hoy (una sola instancia)

| Medición | Resultado |
|---|---|
| Portada del panel (con datos reales) | p50 **660 ms** · p95 902 ms · 29 pet./s |
| Listado de productos | p50 **337 ms** · p95 401 ms · 59 pet./s |
| Catálogo | p50 **612 ms** · p95 682 ms · 32 pet./s |
| `/api/health` (sin renderizar HTML) | p50 **66 ms** · 285 pet./s |
| `/api/account/onboarding` | p50 **71 ms** · 278 pet./s |
| Consultas PostgreSQL | **1–4 ms** |
| Cola (BullMQ + Redis, concurrencia 8) | **521 trabajos/s** (trabajo sintético) |
| Sincronización real de un producto | **350–480 ms** medidos en el ciclo E2E (con datos locales) |

**Lectura:** el cuello de botella hoy no es ni la base de datos ni la cola — es el **renderizado de
páginas** (cada visita consulta la base y pinta HTML en el servidor). Es lo primero que se nota al
crecer: con 20 personas navegando a la vez, la portada tarda 0,66 s.

## 2. Lo que ya está preparado para escalar (y por qué importa)

| Pieza | Por qué aguanta |
|---|---|
| **Sesiones sin estado** (`strategy: 'jwt'`, `src/lib/auth.ts`) | Se pueden levantar varias copias de la web detrás de un balanceador: no hace falta «sesión pegajosa» |
| **Colas BullMQ** (`src/lib/queue.ts`) | El trabajo pesado no vive en la petición web: se encola y lo procesan workers. Con `removeOnComplete` para que Redis no crezca |
| **Workers separables** (`Dockerfile.worker`, `workers/index.ts`) | Cada worker puede correr en su propio contenedor y multiplicarse sin tocar la web |
| **Aislamiento por inquilino en la capa de datos** (`src/lib/tenant-context.ts`) | Fail-closed: una consulta sin contexto **falla** en vez de devolver datos de otro cliente (13/13 verificado). Escalar no relaja el aislamiento |
| **Índices en las consultas calientes** | `Product[userId,status]`, `Product[isMonitored,nextSyncAt]`, `SyncLog[userId,createdAt]`, `Order[storeId,storeOrderId]`… las consultas medidas están en 1–4 ms |
| **Idempotencia** | `@@unique([userId, sourceUrl])` impide duplicar importaciones aunque se reintente; los jobs llevan 3 intentos con retroceso |
| **Reparto por plan** | El planificador escalona las sincronizaciones (`Enterprise` cada 30 min, `Prueba` cada 360) en vez de barrer todo a la vez |
| **Vigilancia** (`src/lib/watchdog.ts`) | Comprueba cada 15 min base de datos, cola y tasa de fallos, y avisa por correo a los operadores |
| **Servicios en contenedores** (`docker-compose.prod.yml`) | nginx + certbot, base de datos, Redis, scraper, web, worker y copias ya separados |

## 3. Los cuatro puntos que hay que tocar antes de 100+ clientes

Estos son los límites reales del diseño actual. No son errores: son decisiones que había que tomar
para no complicar la primera versión.

### 3.1 El limitador de peticiones vive en memoria — `src/lib/rate-limit.ts:11`
Con **una** instancia funciona perfecto. Con **dos**, cada copia lleva su cuenta y el límite real se
duplica. **Arreglo:** contador en Redis (que ya está montado en la infraestructura). Medio día de trabajo.

### 3.2 El renderizado se repite en cada visita
Las pantallas son dinámicas a propósito (datos frescos del robot). Al crecer: **caché de 30–60 s** en
las listas y el catálogo (`unstable_cache` o Redis), que es la parte que no necesita ser exacta al
segundo. Baja el p50 de 660 ms a ~50 ms en la portada. Un día de trabajo.

### 3.3 Los registros de sincronización crecen sin freno
`SyncLog` escribe una fila por comprobación: **50 productos × 24 sincronizaciones/día = 1.200 filas/día
por cliente**. Con 100 clientes: 120.000/día (~3,6 M/mes, ~600 MB/año sólo ahí). **Arreglo:** retención
(guardar 30–90 días en detalle y un resumen diario más allá), que es un job de 20 líneas, o particionar
por mes si prefieres conservarlo todo. El `AuditLog` tiene el mismo problema, más lento.

### 3.4 El scraper es el techo de verdad del negocio
`services/scraper/config.py` limita a **4 navegadores a la vez** (`max_concurrency: 4`). Con 2–4 s por
extracción: ~1–2 extracciones/s → **~5.000/hora**. Con 100 clientes de 50 productos sincronizando cada
hora hacen falta ~5.000/hora: está justo en el límite. **Arreglo:** es un servicio **sin estado**, así
que se multiplica (`docker compose up --scale scraper=3`) subiendo RAM (cada Chromium pesa 300–500 MB).
Ahí es donde irá el dinero del servidor, no en la web.

## 4. Escalera de crecimiento (qué hacer en cada tramo)

| Clientes | Lo que necesitas | Coste aproximado de servidor |
|---|---|---|
| **1–10** | Lo que ya hay en un VPS de 4 GB (web + worker + Redis + base + scraper) | ~20–30 €/mes |
| **10–50** | VPS de 8 GB · 2 copias de la web detrás de nginx · limitador en Redis · retención de SyncLog · copias fuera del servidor (S3) | ~40–70 €/mes |
| **50–200** | 16 GB · base de datos gestionada con copia continua (PITR) · 2–3 scrapers · caché de listados · registro centralizado | ~100–200 €/mes |
| **200–1.000** | Réplica de lectura para informes · particionado de `SyncLog`/`AuditLog` · cola por prioridad por plan · CDN para imágenes | ~300–600 €/mes |

Ninguno de esos pasos exige reescribir nada: son cambios de configuración, un par de jobs y
multiplicar contenedores.

## 5. Lo que hay que vigilar (ya está en el panel)

- **`/api/health`** y la vigilancia del worker: base de datos, Redis, scraper, cola y tasa de fallos.
- **Cola de sincronización**: si aparecen fallidos, el panel lo enseña y avisa por correo.
- **Falta por añadir** (recomendado): una métrica histórica de «peticiones por segundo» y «trabajos por
  hora» para ver la tendencia antes de que duela.

## 6. Lo que no se ha podido medir (y por qué)

- **Latencia real de AliExpress/CJ**: sin claves no se han hecho llamadas. Es la variable que más puede
  cambiar los números de la cola: si un proveedor tarda 2 s, con concurrencia 8 el worker hace ~4
  trabajos/s.
- **Navegación real de un cliente**: las cifras son de una máquina con los datos de prueba (9 productos,
  93 registros). Con 10.000 productos las consultas seguirán bien (índices + límites), pero conviene
  repetir `npm run loadtest` con volumen real antes de vender en serio.
- **Comportamiento con tiendas reales**: Shopify y WooCommerce imponen sus propios límites de peticiones
  (la app ya reintenta con retroceso y no llama si no hay cambios, que es la mayor parte del ahorro).

---

## Recomendación en una frase

Para vender a los primeros clientes, **lo que hay ya sirve** (con copias fuera del servidor y el
limitador en Redis como primera mejora); antes de los ~100 clientes hay que hacer los cuatro puntos del
apartado 3, que son entre 2 y 3 días de trabajo, no una reescritura.
