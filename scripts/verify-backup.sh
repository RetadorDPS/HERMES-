#!/usr/bin/env bash
#
# scripts/verify-backup.sh — Comprueba que las copias de seguridad SIRVEN.
#
# Una copia que nunca se ha restaurado no es una copia: es una esperanza. Este
# script hace el ciclo completo contra la base de datos real:
#
#   1. Vuelca la base de datos (mismo comando que el servicio `backup` del compose).
#   2. Crea una base de datos temporal.
#   3. Restaura el volcado en ella.
#   4. Compara el número de filas de las tablas clave (original vs restaurada).
#   5. Borra la base temporal y deja el fichero .sql.gz en ./backups.
#
#   ./scripts/verify-backup.sh
#
# Variables (o .env.local): DATABASE_URL, PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE
set -euo pipefail

cd "$(dirname "$0")/.."

# ── Configuración: primero el entorno, si no .env.local ────────────────────
if [ -f .env.local ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env.local
  set +a
fi

if [ -n "${DATABASE_URL:-}" ]; then
  # postgresql://usuario:clave@host:puerto/base
  proto_stripped="${DATABASE_URL#*://}"
  creds="${proto_stripped%@*}"
  hostpart="${proto_stripped#*@}"
  PGUSER="${PGUSER:-${creds%%:*}}"
  PGPASSWORD="${PGPASSWORD:-${creds#*:}}"
  hostport="${hostpart%%/*}"
  PGHOST="${PGHOST:-${hostport%%:*}}"
  PGPORT="${PGPORT:-${hostport##*:}}"
  PGDATABASE="${PGDATABASE:-${hostpart#*/}}"
  PGDATABASE="${PGDATABASE%%\?*}"
fi

PGUSER="${PGUSER:-autods}"
PGDATABASE="${PGDATABASE:-autods}"
PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
export PGPASSWORD PGUSER PGHOST PGPORT PGDATABASE

STAMP="$(date +%F-%H%M%S)"
SCRATCH="${PGDATABASE}_restoretest_${STAMP//-/_}"
BACKUP_DIR="backups"
BACKUP_FILE="${BACKUP_DIR}/autods-${STAMP}.sql.gz"

psql_do() { psql -v ON_ERROR_STOP=1 -tA "$@"; }

echo "── 1. Volcando ${PGDATABASE} (como hace el servicio 'backup' del compose) ──"
mkdir -p "$BACKUP_DIR"
pg_dump -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" --no-owner --no-privileges \
  | gzip > "$BACKUP_FILE"

SIZE="$(du -h "$BACKUP_FILE" | cut -f1)"
TABLES="$(gzip -dc "$BACKUP_FILE" | grep -c '^CREATE TABLE' || true)"
echo "   ✔ Copia creada: ${BACKUP_FILE} (${SIZE}, ${TABLES} tablas)"

echo "── 2. Creando base de datos temporal ${SCRATCH} ──"
psql_do -d postgres -c "DROP DATABASE IF EXISTS \"${SCRATCH}\";" >/dev/null
psql_do -d postgres -c "CREATE DATABASE \"${SCRATCH}\";" >/dev/null
echo "   ✔ Creada"

echo "── 3. Restaurando la copia ──"
gzip -dc "$BACKUP_FILE" | psql -v ON_ERROR_STOP=1 -q -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$SCRATCH" >/dev/null
echo "   ✔ Restaurada"

echo "── 4. Comparando datos (original vs restaurada) ──"
TABLES_TO_CHECK="User Store Product ProductVariant ProductReview Order SyncLog AuditLog Supplier SupplierAccount Subscription"
FAILED=0

count_in() { # $1 = base de datos, $2 = tabla
  psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$1" -tA \
    -c "SELECT count(*) FROM \"$2\";" 2>/dev/null || echo "n/a"
}

printf "   %-18s %10s %10s\n" "TABLA" "ORIGINAL" "RESTAURADA"
for table in $TABLES_TO_CHECK; do
  original="$(count_in "$PGDATABASE" "$table")"
  restored="$(count_in "$SCRATCH" "$table")"
  if [ "$original" = "$restored" ]; then
    mark="✔"
  else
    mark="✘"
    FAILED=1
  fi
  printf "   %s %-16s %10s %10s\n" "$mark" "$table" "$original" "$restored"
done

echo "── 5. Limpieza ──"
psql_do -d postgres -c "DROP DATABASE \"${SCRATCH}\";" >/dev/null
echo "   ✔ Base temporal eliminada (la copia se conserva en ${BACKUP_FILE})"

echo ""
if [ "$FAILED" -eq 0 ]; then
  echo "  COPIA DE SEGURIDAD VERIFICADA: se ha restaurado y los datos coinciden  "
  echo "  Para restaurar en producción: ./scripts/restore.sh ${BACKUP_FILE}"
  exit 0
fi

echo "✘ La restauración NO coincide con el original. Revisa la copia antes de confiar en ella."
exit 1
