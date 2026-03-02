#!/usr/bin/env bash
set -euo pipefail

# Script pour migrer les données de EC2/Docker vers Lambda/S3
# Usage: ./scripts/migrate-to-lambda.sh

# Couleurs
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() {
  echo -e "${BLUE}[MIGRATE]${NC} $1"
}

success() {
  echo -e "${GREEN}[SUCCESS]${NC} $1"
}

warn() {
  echo -e "${YELLOW}[WARN]${NC} $1"
}

SSH_HOST="${1:-aws-instance}"
TERRAFORM_DIR="terraform"

log "📦 Migration des données EC2 → Lambda/S3"
echo ""

# 1. Download data from EC2
log "1. Téléchargement des données depuis EC2..."
mkdir -p tmp/migration
scp -r "$SSH_HOST:/home/ubuntu/vanlife/apps/api/data/db.json" tmp/migration/ || true
scp -r "$SSH_HOST:/home/ubuntu/vanlife/apps/api/uploads/*" tmp/migration/uploads/ 2>/dev/null || true
success "Données téléchargées"
echo ""

# 2. Get S3 buckets from Terraform
log "2. Récupération des buckets S3..."
cd "$TERRAFORM_DIR"
DATA_BUCKET=$(terraform output -raw data_bucket 2>/dev/null || echo "")
UPLOADS_BUCKET=$(terraform output -raw uploads_bucket 2>/dev/null || echo "")
cd ../..

if [ -z "$DATA_BUCKET" ] || [ -z "$UPLOADS_BUCKET" ]; then
  warn "Infrastructure Lambda pas encore déployée"
  echo "Exécutez d'abord: ./scripts/deploy-lambda.sh"
  exit 1
fi

success "Buckets trouvés: $DATA_BUCKET, $UPLOADS_BUCKET"
echo ""

# 3. Upload data to S3
log "3. Upload de db.json vers S3..."
if [ -f "tmp/migration/db.json" ]; then
  aws s3 cp tmp/migration/db.json "s3://$DATA_BUCKET/db.json"
  success "db.json migré"
else
  warn "Aucun db.json trouvé"
fi
echo ""

# 4. Upload images to S3
log "4. Upload des images vers S3..."
if [ -d "tmp/migration/uploads" ] && [ "$(ls -A tmp/migration/uploads 2>/dev/null)" ]; then
  aws s3 sync tmp/migration/uploads "s3://$UPLOADS_BUCKET/" --exclude ".*"
  success "Images migrées"
else
  log "Aucune image à migrer"
fi
echo ""

# 5. Clean up
log "5. Nettoyage..."
rm -rf tmp/migration
success "Nettoyage terminé"
echo ""

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}✨ Migration terminée !${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Prochaines étapes:"
echo "  1. Vérifiez les données: aws s3 ls s3://$DATA_BUCKET/"
echo "  2. Vérifiez les images: aws s3 ls s3://$UPLOADS_BUCKET/"
echo "  3. Testez l'API Lambda"
echo ""
echo "⚠️  N'oubliez pas de désactiver l'instance EC2 pour économiser:"
echo "  - Arrêter: aws ec2 stop-instances --instance-ids <instance-id>"
echo "  - Ou supprimer: terraform destroy (dans infra/terraform/)"
echo ""
