# 🚀 Despliegue en un solo comando (Docker)

> **Aviso:** este documento describe la versión COMPLETA con servidor propio, que NO es la que está publicada hoy. Para saber qué funciona de verdad, lee [`docs/estado-real.md`](./docs/estado-real.md).

Esta es la vía **automática**: HTTPS con Let's Encrypt, renovación de certificados,
esquema de base de datos, workers 24/7 (sync, pedidos y catálogo) y copias de seguridad diarias, todo levantado
con un comando.

---

## Comprobaciones automáticas

`./scripts/deploy.sh` no termina en verde sin pasar dos pruebas contra el despliegue recién hecho:

1. **Prueba de humo** (`npm run smoke`): salud de PostgreSQL y Redis, página de acceso y los tres
   endpoints de webhook (Stripe, Lemon Squeezy, WooCommerce) respondiendo por HTTPS.
2. **Preflight dentro del contenedor** (`docker compose exec web npm run preflight`): credenciales
   críticas (base de datos, Redis, cifrado, sesiones) y aviso de las recomendadas pendientes.

Puedes repetirlas cuando quieras:

```bash
npm run smoke -- --url=https://tu-dominio.com
docker compose -f docker-compose.prod.yml exec web npm run preflight
```

## Requisitos (una vez)

1. Un servidor (VPS) con **Docker** y **Docker Compose v2**.
2. Un **dominio** (o subdominio) con un registro DNS **tipo A** apuntando a la IP del servidor.
3. Los puertos **80 y 443** libres.

---

## Desplegar

```bash
cd autods-clone
./scripts/deploy.sh
```

El script, en orden:

1. Comprueba Docker, el DNS de tu dominio, y que los puertos 80/443 estén libres.
2. Te pide **3 datos**: dominio, email para Let's Encrypt y las credenciales del panel.
3. Genera `.env.prod` con **secretos aleatorios** (`openssl rand -hex 32`), permisos `600`.
4. Mueve el `.env.local` de desarrollo a `.env.local.dev.bak` (nunca se despliega).
5. Construye las imágenes y levanta los servicios.
6. Espera a que `https://tudominio.com/api/health` responda y te muestra el estado.

**Al terminar:** entra en `https://tudominio.com`, haz login y conecta tu tienda.

```bash
./scripts/deploy.sh --estado       # salud + estado de los servicios
./scripts/deploy.sh --actualizar   # git pull + reconstruir + reiniciar sin perder datos
```

---

## Qué se levanta (9 servicios)

| Servicio | Función | ¿Expuesto a internet? |
|---|---|---|
| `nginx-proxy` | Reverse proxy + HTTPS | **Sí** (80/443) |
| `acme` | Emite y renueva los certificados Let's Encrypt | No |
| `web` | Next.js 14: panel + API | Sólo a través del proxy |
| `worker` | BullMQ 24/7: sincronización por plan, pedidos y **catálogo** (3 hijos) | No |
| `scraper` | FastAPI + Playwright | No (red interna) |
| `db` / `redis` | PostgreSQL 16 / Redis 7 | No (red interna) |
| `migrate` | Aplica el esquema Prisma y termina | No (one-shot) |
| `backup` | `pg_dump` diario comprimido en `./backups` | No |

Sólo los puertos **80 y 443** quedan abiertos. La base de datos, Redis y el scraper
viven en una red interna de Docker, inaccesible desde fuera.

---

## Variables que puedes añadir después

En `.env.prod` y luego `./scripts/deploy.sh --actualizar`:

| Variable | Para qué |
|---|---|
| `PROXY_PROVIDER`, `PROXY_USERNAME`, `PROXY_PASSWORD` | Extracción real de proveedores (ver página *Proxies y anti-bot*) |
| `CJ_API_KEY` | API oficial de CJ Dropshipping (sin proxies) |
| `SEED_DEMO_DATA="false"` | Instalación limpia, sin productos de ejemplo |
| `SYNC_INTERVAL_MINUTES` | Frecuencia del re-escaneo (por defecto 60) |
| `BACKUP_KEEP_DAYS` | Días de copias conservadas (por defecto 14) |

---

## Modo manual (sin Docker) — resumen

Si prefieres procesos nativos en el servidor:

```bash
npm ci && npx prisma generate && npx prisma db push && npm run build
python3 -m venv services/scraper/.venv && services/scraper/.venv/bin/pip install -r services/scraper/requirements.txt
services/scraper/.venv/bin/playwright install --with-deps chromium
# + 3 servicios systemd (web, worker, scraper) y Nginx + certbot (plantillas más abajo)
```

En ese caso necesitas: `DATABASE_URL`, `REDIS_URL`, `ENCRYPTION_KEY`, `NEXTAUTH_SECRET`,
`NEXTAUTH_URL="https://tudominio.com"`, `AUTH_ENABLED="true"`, `AUTH_EMAIL`, `AUTH_PASSWORD`
y `ALLOW_IFRAME_EMBED="false"` (cierra las cabeceras relajadas del visor de previsualización).

### Plantillas systemd

`/etc/systemd/system/dropship-web.service`
```ini
[Unit]
Description=DropshipPilot web
After=network.target postgresql.service redis-server.service

[Service]
Type=simple
WorkingDirectory=/opt/autods-clone
EnvironmentFile=/opt/autods-clone/.env
ExecStart=/usr/bin/npm run start
Restart=always
User=www-data

[Install]
WantedBy=multi-user.target
```

`/etc/systemd/system/dropship-worker.service`
```ini
[Unit]
Description=DropshipPilot workers 24/7
After=network.target redis-server.service

[Service]
Type=simple
WorkingDirectory=/opt/autods-clone
EnvironmentFile=/opt/autods-clone/.env
ExecStart=/usr/bin/npm run worker   # sync + pedidos + catálogo
Restart=always
User=www-data

[Install]
WantedBy=multi-user.target
```

`/etc/systemd/system/dropship-scraper.service`
```ini
[Unit]
Description=DropshipPilot scraper (FastAPI + Playwright)
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/autods-clone/services/scraper
ExecStart=/opt/autods-clone/services/scraper/.venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now dropship-web dropship-worker dropship-scraper
```

### Nginx + certbot (sin Docker)

`/etc/nginx/sites-available/dropshippilot`
```nginx
server {
    listen 80;
    server_name tudominio.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;   # las extracciones pueden tardar
    }
}
```
```bash
sudo ln -s /etc/nginx/sites-available/dropshippilot /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx && sudo certbot --nginx -d tudominio.com
```

---

## Webhooks de tus tiendas

| Origen | URL a registrar |
|---|---|
| Shopify (orders/create, orders/paid, fulfillments/update) | `https://tudominio.com/api/webhooks/shopify` |
| WooCommerce (order.created, order.updated) | `https://tudominio.com/api/webhooks/woocommerce/<dominio-de-tu-tienda>` |

La app los registra **sola** al conectar la tienda (y captura el secreto de WooCommerce
para verificar la firma). Si los creas a mano, define `SHOPIFY_WEBHOOK_SECRET` /
`WOO_WEBHOOK_SECRET`.

---

## Checklist de “funcionando de verdad”

```bash
./scripts/deploy.sh --estado                  # o:
curl -s https://tudominio.com/api/health | jq # mode=production + postgres/redis/scraper en verde
docker compose -f docker-compose.prod.yml logs -f worker   # barrido cada hora
```

- [ ] `/api/health` en `production` con postgres, redis y scraper en verde
- [ ] `/login` pide credenciales y entra sólo con las tuyas (las de demo quedan bloqueadas)
- [ ] El worker registra un barrido completo cada hora (sin errores)
- [ ] Conectar tu tienda real → aparece `CONNECTED` y los webhooks registrados
- [ ] Importar un producto y publicarlo en la tienda
- [ ] Pedido de prueba en la tienda → entra en *Pedidos* y se envía al proveedor
- [ ] `./backups/` con la primera copia de la base de datos

---

## Actualizaciones y copias

```bash
./scripts/deploy.sh --actualizar        # actualizar código y reiniciar sin perder datos
ls -la backups/                          # copias diarias automáticas (14 días por defecto)
```

Restaurar una copia:

```bash
gunzip -c backups/autods-2026-10-15-0300.sql.gz | \
  docker compose -f docker-compose.prod.yml exec -T db psql -U autods -d autods
```

---

## Lo que NUNCA se despliega

- `.env.local` (desarrollo): el script lo aparta; además `.dockerignore` impide que
  los `.env` entren en ninguna imagen.
- `docs/` con las capturas y este tipo de documentación.
- El puerto **8000** del scraper y el **5432** de PostgreSQL: quedan en la red interna.
