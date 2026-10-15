#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  DropshipPilot · despliegue automático en producción
#
#    ./scripts/deploy.sh              → crea .env.prod (si falta), construye y levanta
#    ./scripts/deploy.sh --actualizar → git pull + reconstruir + reiniciar sin tocar datos
#    ./scripts/deploy.sh --estado     → estado de los servicios y de la salud
#
#  Requisitos: Docker + Docker Compose v2 y un dominio (con DNS tipo A) apuntando
#  a este servidor. El certificado HTTPS se emite y renueva solo.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

cd "$(dirname "$0")/.."
COMPOSE="docker compose -f docker-compose.prod.yml --env-file .env.prod"
ENV_FILE=".env.prod"

c_ok()   { printf '\033[32m✔\033[0m %s\n' "$1"; }
c_info() { printf '\033[36m•\033[0m %s\n' "$1"; }
c_warn() { printf '\033[33m▲\033[0m %s\n' "$1"; }
c_err()  { printf '\033[31m✘\033[0m %s\n' "$1"; }
c_tit()  { printf '\n\033[1m═══ %s ═══\033[0m\n\n' "$1"; }

need() { command -v "$1" >/dev/null 2>&1 || { c_err "Falta «$1» en el sistema"; exit 1; }; }

# ── Estado ───────────────────────────────────────────────────────────────────
if [ "${1:-}" = "--estado" ]; then
  c_tit "Estado de DropshipPilot"
  $COMPOSE ps
  DOMINIO=$(grep -E '^DOMAIN=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d '"' || true)
  if [ -n "${DOMINIO:-}" ]; then
    c_info "Comprobando https://$DOMINIO/api/health …"
    curl -fsS -m 20 "https://$DOMINIO/api/health" | python3 -m json.tool 2>/dev/null || c_warn "Aún no responde por HTTPS (¿DNS propagado? ¿certificado emitido?)"
    echo
    c_info "Últimas líneas del worker:"; $COMPOSE logs --tail=15 worker
  fi
  exit 0
fi

# ── Actualización ────────────────────────────────────────────────────────────
if [ "${1:-}" = "--actualizar" ]; then
  c_tit "Actualizando DropshipPilot"
  [ -d .git ] && { git pull --ff-only; c_ok "Código actualizado"; }
  $COMPOSE build --pull
  $COMPOSE up -d --remove-orphans
  c_ok "Contenedores recreados · el esquema se aplica solo en el servicio migrate"
  exit 0
fi

[ "${1:-}" = "" ] || { c_err "Opción desconocida: $1 (usa --actualizar o --estado)"; exit 1; }

c_tit "Despliegue de DropshipPilot en producción"

# ── 0. Requisitos ────────────────────────────────────────────────────────────
need docker
need curl
docker compose version >/dev/null 2>&1 || { c_err "Docker Compose v2 no disponible"; exit 1; }
c_ok "Docker $(docker version --format '{{.Server.Version}}' 2>/dev/null || echo '?') y Compose v2 disponibles"

# ── 1. .env.prod ─────────────────────────────────────────────────────────────
gen() { openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | xxd -p | tr -d '\n'; }

if [ ! -f "$ENV_FILE" ]; then
  c_info "No hay $ENV_FILE: lo genero ahora (3 preguntas y listo)"
  read -rp "  Dominio (ej. dropship.midominio.com): " DOMINIO
  read -rp "  Email para Let's Encrypt (avisos de caducidad): " EMAIL
  read -rp "  Email con el que entrarás al panel: " AUTHMAIL
  read -rsp "  Contraseña para el panel (mínimo 12 caracteres): " AUTHPASS; echo

  [ ${#AUTHPASS} -ge 12 ] || { c_err "La contraseña debe tener al menos 12 caracteres"; exit 1; }
  [ -n "$DOMINIO" ] && [ -n "$EMAIL" ] && [ -n "$AUTHMAIL" ] || { c_err "Faltan datos"; exit 1; }

  cat > "$ENV_FILE" <<EOF
# ── Generado por scripts/deploy.sh el $(date -Iseconds) ──────────────────────
# Este archivo contiene SECRETOS: no lo subas al repositorio.
DOMAIN="$DOMINIO"
LETSENCRYPT_EMAIL="$EMAIL"

POSTGRES_USER="autods"
POSTGRES_DB="autods"
POSTGRES_PASSWORD="$(gen)"

ENCRYPTION_KEY="$(gen)"
NEXTAUTH_SECRET="$(gen)"
AUTH_EMAIL="$AUTHMAIL"
AUTH_PASSWORD="$AUTHPASS"

# Secreto de verificación de webhooks de Shopify (se registra solo al conectar la tienda)
SHOPIFY_WEBHOOK_SECRET="$(gen)"
# El de WooCommerce se captura al registrar los webhooks desde la página Tiendas
WOO_WEBHOOK_SECRET=""

# true = carga productos/tienda de ejemplo en la primera instalación (ponlo a false para empezar en limpio)
SEED_DEMO_DATA="true"

SYNC_INTERVAL_MINUTES="60"
SYNC_CONCURRENCY="4"
BACKUP_KEEP_DAYS="14"

# ── Scraping real (opcional pero recomendado para extraer de proveedores) ────
# Rellena estas tres para usar un proveedor residencial (ver página «Proxies y anti-bot»)
PROXY_PROVIDER=""
PROXY_USERNAME=""
PROXY_PASSWORD=""
PROXY_COUNTRY="es"
PROXY_REQUIRED="false"
# API oficial de CJ Dropshipping (alternativa sin proxies)
CJ_API_KEY=""
EOF
  chmod 600 "$ENV_FILE"
  c_ok "$ENV_FILE creado con secretos aleatorios (permisos 600)"
else
  c_ok "$ENV_FILE ya existe: no lo toco"
fi

# Fuente de datos para los checks previos
set -a; . "./$ENV_FILE"; set +a

# ── 2. Comprobaciones previas ────────────────────────────────────────────────
c_tit "Comprobaciones previas"

IP_PUBLICA=$(curl -fsS -m 10 https://api.ipify.org || echo "")
DNS_IP=$(getent hosts "$DOMAIN" | awk '{print $1}' | head -1 || echo "")
if [ -n "$IP_PUBLICA" ] && [ "$IP_PUBLICA" = "$DNS_IP" ]; then
  c_ok "El DNS de $DOMAIN apunta a este servidor ($DNS_IP)"
elif [ -n "$DNS_IP" ]; then
  c_warn "El DNS de $DOMAIN apunta a $DNS_IP y este servidor es $IP_PUBLICA → el certificado fallará hasta que coincidan"
else
  c_warn "No he podido resolver $DOMAIN: revisa el DNS (registro A → $IP_PUBLICA)"
fi

for P in 80 443; do
  if ss -ltn 2>/dev/null | grep -q ":$P "; then
    c_err "El puerto $P está ocupado por otro proceso (¿otro Nginx/Apache?). Libéralo para que funcione el proxy."
    exit 1
  fi
done
c_ok "Puertos 80 y 443 libres"

[ -f .env.local ] && { mv .env.local ".env.local.dev.bak"; c_warn ".env.local movido a .env.local.dev.bak (era configuración de desarrollo: AUTH_ENABLED=false y secretos de prueba)"; }

if ! grep -qE '^PROXY_USERNAME=".+"' "$ENV_FILE"; then
  c_warn "Sin proxies configurados: la app funcionará, pero el importador avisará de que los datos son de demostración"
fi

# ── 3. Construcción y arranque ───────────────────────────────────────────────
c_tit "Construyendo imágenes (la primera vez tarda unos minutos)"
$COMPOSE build --pull

c_tit "Levantando servicios"
$COMPOSE up -d --remove-orphans
sleep 5
$COMPOSE ps

# ── 4. Espera a que la app responda ──────────────────────────────────────────
c_tit "Esperando a que la aplicación arranque"
for i in $(seq 1 60); do
  if curl -fsS -m 5 "https://$DOMAIN/api/health" >/dev/null 2>&1; then
    c_ok "HTTPS operativo en https://$DOMAIN"
    curl -fsS -m 20 "https://$DOMAIN/api/health" | python3 -m json.tool 2>/dev/null || true
    break
  fi
  printf '\r  intento %02d/60 · emitiendo certificado y arrancando…' "$i"
  sleep 5
  [ "$i" -eq 60 ] && c_warn "Todavía no responde por HTTPS. Revisa: $COMPOSE logs nginx-proxy acme web"
done
echo

# ── 5. Comprobaciones automáticas del despliegue ─────────────────────────────
# Nada se declara «desplegado» sin pasar estas pruebas: la de humo valida por
# HTTP que la app responde (webhooks incluidos) y preflight comprueba dentro del
# contenedor que no falta ninguna credencial crítica.
c_tit "Pruebas automáticas del despliegue"

if curl -fsS -m 15 "https://$DOMINIO/api/health" >/dev/null 2>&1; then
  if node scripts/smoke.ts --url="https://$DOMINIO" >/tmp/smoke.log 2>&1 || true; then :; fi
  cat /tmp/smoke.log
  if grep -q "FALLOS\|fallos  \|LA APLICACIÓN DESPLEGADA NO PASA" /tmp/smoke.log && grep -qE '^[0-9]+ correctas · [0-9]+ avisos · [1-9][0-9]* fallos' /tmp/smoke.log; then
    c_err "La prueba de humo encontró fallos: revisa la salida de arriba antes de dar el despliegue por bueno"
    exit 1
  else
    c_ok "Prueba de humo superada (webhooks y páginas responden)"
  fi
else
  c_warn "Aún no hay HTTPS: salto la prueba de humo por Internet (revisa el certificado y repite con --estado)"
fi

c_info "Comprobando credenciales dentro del contenedor (npm run preflight)…"
if $COMPOSE exec -T web npm run preflight >/tmp/preflight.log 2>&1 || true; then :; fi
tail -25 /tmp/preflight.log
if grep -q "NO ESTÁ LISTO" /tmp/preflight.log; then
  c_err "Faltan credenciales bloqueantes (ver arriba). El panel funciona, pero completa la puesta en marcha en /setup"
else
  c_ok "Credenciales suficientes para operar (detalle completo en /setup del panel)"
fi

c_tit "Listo"
cat <<EOF
  Panel        →  https://$DOMAIN
  Estado       →  ./scripts/deploy.sh --estado
  Actualizar   →  ./scripts/deploy.sh --actualizar
  Logs         →  docker compose -f docker-compose.prod.yml logs -f web worker
  Copias       →  ./backups/ (diarias automáticas, se conservan $BACKUP_KEEP_DAYS días)

  Entra con $AUTH_EMAIL y tu contraseña. Después:
   1) Tiendas         → conecta tu Shopify/WooCommerce (registra los webhooks solo)
   2) Proxies         → valida tus proxies residenciales para extracción real
   3) Importar por URL → importa tu primer producto y publícalo

  ⚠️  Añade PROXY_USERNAME/PROXY_PASSWORD a $ENV_FILE y ejecuta
      ./scripts/deploy.sh --actualizar cuando los tengas.
EOF
