#!/usr/bin/env bash
set -euo pipefail

# Script de migration des réservations distantes pour ajouter le champ title manquant
# Usage:
#   ./scripts/migrate-remote-booking-titles.sh [DATA_BUCKET]
#   ./scripts/migrate-remote-booking-titles.sh --dry-run [DATA_BUCKET]

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log() {
  echo -e "${BLUE}[MIGRATE TITLES]${NC} $1"
}

success() {
  echo -e "${GREEN}[SUCCESS]${NC} $1"
}

warn() {
  echo -e "${YELLOW}[WARN]${NC} $1"
}

error() {
  echo -e "${RED}[ERROR]${NC} $1"
}

DRY_RUN="false"
DATA_BUCKET=""
TERRAFORM_DIR="terraform"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN="true"
      shift
      ;;
    -h|--help)
      echo "Usage: $0 [--dry-run] [DATA_BUCKET]"
      exit 0
      ;;
    *)
      DATA_BUCKET="$1"
      shift
      ;;
  esac
done

if ! command -v aws >/dev/null 2>&1; then
  error "AWS CLI introuvable. Installez/configurez aws cli avant de lancer la migration."
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  error "Node.js introuvable."
  exit 1
fi

if [[ -z "$DATA_BUCKET" ]]; then
  log "Récupération du bucket data via Terraform..."
  if [[ -d "$TERRAFORM_DIR" ]]; then
    DATA_BUCKET=$(cd "$TERRAFORM_DIR" && terraform output -raw data_bucket 2>/dev/null || true)
  fi
fi

if [[ -z "$DATA_BUCKET" ]]; then
  error "Impossible de déterminer DATA_BUCKET. Passez-le en argument: ./scripts/migrate-remote-booking-titles.sh <bucket>"
  exit 1
fi

DB_KEY="db.json"
TIMESTAMP=$(date -u +"%Y%m%dT%H%M%SZ")
BACKUP_KEY="migrations/backups/db-before-title-migration-${TIMESTAMP}.json"

TMP_DIR=$(mktemp -d)
ORIGINAL_DB_PATH="$TMP_DIR/db-original.json"
MIGRATED_DB_PATH="$TMP_DIR/db-migrated.json"
REPORT_PATH="$TMP_DIR/report.env"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

log "Téléchargement de s3://${DATA_BUCKET}/${DB_KEY}"
aws s3 cp "s3://${DATA_BUCKET}/${DB_KEY}" "$ORIGINAL_DB_PATH" >/dev/null

log "Analyse et migration locale des réservations..."
REPORT_PATH="$REPORT_PATH" ORIGINAL_DB_PATH="$ORIGINAL_DB_PATH" MIGRATED_DB_PATH="$MIGRATED_DB_PATH" node <<'NODE'
const fs = require("node:fs");

const reportPath = process.env.REPORT_PATH;
const originalPath = process.env.ORIGINAL_DB_PATH;
const migratedPath = process.env.MIGRATED_DB_PATH;

const raw = fs.readFileSync(originalPath, "utf8");
const db = JSON.parse(raw);

if (!db || typeof db !== "object") {
  throw new Error("db.json invalide: objet attendu");
}

if (!Array.isArray(db.bookings)) {
  throw new Error("db.json invalide: bookings doit être un tableau");
}

let changed = 0;
let alreadySet = 0;

for (const booking of db.bookings) {
  const existingTitle = typeof booking.title === "string" ? booking.title.trim() : "";
  if (existingTitle.length > 0) {
    alreadySet += 1;
    continue;
  }

  const startDate = typeof booking.startDate === "string" && booking.startDate ? booking.startDate : booking.weekendKey || "";
  const endDate = typeof booking.endDate === "string" && booking.endDate ? booking.endDate : startDate;
  booking.title = `${startDate} -> ${endDate}`;
  changed += 1;
}

fs.writeFileSync(migratedPath, JSON.stringify(db, null, 2), "utf8");
fs.writeFileSync(reportPath, `TOTAL=${db.bookings.length}\nCHANGED=${changed}\nUNCHANGED=${alreadySet}\n`, "utf8");
NODE

# shellcheck disable=SC1090
source "$REPORT_PATH"

log "Résultat: ${CHANGED}/${TOTAL} réservations mises à jour (${UNCHANGED} déjà conformes)."

if [[ "$CHANGED" -eq 0 ]]; then
  success "Aucune migration nécessaire."
  exit 0
fi

if [[ "$DRY_RUN" == "true" ]]; then
  warn "Mode dry-run activé: aucun upload S3 effectué."
  exit 0
fi

log "Sauvegarde de sécurité vers s3://${DATA_BUCKET}/${BACKUP_KEY}"
aws s3 cp "$ORIGINAL_DB_PATH" "s3://${DATA_BUCKET}/${BACKUP_KEY}" --content-type "application/json" >/dev/null
success "Backup créé"

log "Upload de la base migrée vers s3://${DATA_BUCKET}/${DB_KEY}"
aws s3 cp "$MIGRATED_DB_PATH" "s3://${DATA_BUCKET}/${DB_KEY}" --content-type "application/json" >/dev/null
success "Migration appliquée sur la base distante"

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}✨ Migration des titles terminée${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Bucket data: $DATA_BUCKET"
echo "Réservations mises à jour: $CHANGED/$TOTAL"
echo "Backup: s3://$DATA_BUCKET/$BACKUP_KEY"
