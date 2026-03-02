#!/usr/bin/env bash
set -euo pipefail

# Script de déploiement Lambda + S3
# Usage: ./scripts/deploy-lambda.sh

# Couleurs
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() {
  echo -e "${BLUE}[DEPLOY LAMBDA]${NC} $1"
}

success() {
  echo -e "${GREEN}[SUCCESS]${NC} $1"
}

warn() {
  echo -e "${YELLOW}[WARN]${NC} $1"
}

TERRAFORM_DIR="terraform"
API_LAMBDA_DIR="apps/api-lambda"
WEB_DIR="apps/web"
DIST_DIR="dist"

log "🚀 Déploiement sur AWS Lambda + S3"
echo ""

# 1. Build Lambda function (Terraform créera le ZIP)
log "1. Préparation de la fonction Lambda..."
cd "$API_LAMBDA_DIR"
npm install
npm run prepare-lambda
cd ../..
success "Code Lambda préparé (Terraform créera le ZIP)"
echo ""

# 2. Deploy infrastructure with Terraform
log "2. Déploiement de l'infrastructure Terraform..."

# 2a. Initialize remote state backend
log "2a. Initialisation du backend S3..."
bash ./scripts/init-backend.sh
success "Backend S3 configuré"
echo ""

# 2b. Terraform init and apply
log "2b. Initialisation de Terraform avec backend S3..."
cd "$TERRAFORM_DIR"
terraform init -reconfigure
log "Création/mise à jour de l'infrastructure..."
terraform apply -lock=false -auto-approve
cd ..
success "Infrastructure déployée"
echo ""

# 3. Get Terraform outputs
log "3. Récupération des informations d'infrastructure..."
cd "$TERRAFORM_DIR"
API_URL=$(terraform output -raw api_url)
FRONTEND_BUCKET=$(terraform output -raw frontend_bucket)
UPLOADS_BUCKET=$(terraform output -raw uploads_bucket)
DATA_BUCKET=$(terraform output -raw data_bucket)
FRONTEND_URL=$(terraform output -raw frontend_url)
CLOUDFRONT_DIST_ID=$(terraform output -raw cloudfront_distribution_id)
cd ..
success "Configuration récupérée"
echo ""

log "  API URL: $API_URL"
log "  Frontend Bucket: $FRONTEND_BUCKET"
log "  Frontend URL: $FRONTEND_URL"
log "  CloudFront Distribution: $CLOUDFRONT_DIST_ID"
echo ""

# 4. Build frontend with API URL
log "4. Construction du frontend..."
# Le frontend utilise /api (CloudFront proxy) donc pas besoin de VITE_API_URL
npm run build -w apps/web
success "Frontend construit"
echo ""

# 5. Deploy frontend to S3
log "5. Déploiement du frontend sur S3..."
aws s3 sync "$WEB_DIR/dist" "s3://$FRONTEND_BUCKET" --delete
success "Frontend déployé"
echo ""

# 5b. Invalidate CloudFront cache
log "5b. Invalidation du cache CloudFront..."
INVALIDATION_OUTPUT=$(aws cloudfront create-invalidation \
  --distribution-id "$CLOUDFRONT_DIST_ID" \
  --paths "/*" 2>&1)

if [ $? -eq 0 ]; then
  INVALIDATION_ID=$(echo "$INVALIDATION_OUTPUT" | grep -o '"Id": "[^"]*"' | head -1 | cut -d'"' -f4)
  success "Invalidation créée (ID: $INVALIDATION_ID)"
  log "Le cache sera vidé dans 2-5 minutes"
else
  warn "Échec de l'invalidation CloudFront"
  log "Vous pouvez le faire manuellement: aws cloudfront create-invalidation --distribution-id $CLOUDFRONT_DIST_ID --paths '/*'"
fi
echo ""

# 6. Upload initial data if needed
log "6. Vérification des données..."
if aws s3 ls "s3://$DATA_BUCKET/db.json" &>/dev/null; then
  warn "db.json existe déjà sur S3, pas de mise à jour"
else
  log "Upload de db.json initial..."
  if [ -f "apps/api/apps/api/data/db.json" ]; then
    aws s3 cp "apps/api/apps/api/data/db.json" "s3://$DATA_BUCKET/db.json"
    success "db.json uploadé"
  else
    warn "Aucun fichier db.json local trouvé"
  fi
fi
echo ""

# 7. Upload existing images to S3 if any
log "7. Synchronisation des images..."
UPLOADS_DIR="apps/api/apps/api/uploads"
if [ -d "$UPLOADS_DIR" ] && [ "$(ls -A $UPLOADS_DIR)" ]; then
  aws s3 sync "$UPLOADS_DIR" "s3://$UPLOADS_BUCKET" --exclude ".*"
  success "Images synchronisées"
else
  log "Aucune image à synchroniser"
fi
echo ""

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}✨ Déploiement terminé avec succès !${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "🌐 Application: $FRONTEND_URL"
echo "🔌 API: $API_URL"
echo ""
echo "📊 Coût estimé: ~3-5€/mois"
echo ""
echo "⚠️  L'application sera disponible dans 2-5 minutes (invalidation CloudFront en cours)"
echo ""
echo "Pour mettre à jour uniquement le frontend:"
echo "  aws s3 sync $WEB_DIR/dist s3://$FRONTEND_BUCKET --delete"
echo "  aws cloudfront create-invalidation --distribution-id $CLOUDFRONT_DIST_ID --paths '/*'"
echo ""
echo "Pour mettre à jour la Lambda:"
echo "  cd $API_LAMBDA_DIR && npm run package && cd ../.."
echo "  aws lambda update-function-code --function-name vanlife-api-prod --zip-file fileb://$DIST_DIR/lambda-api.zip"
echo ""
