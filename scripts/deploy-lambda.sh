#!/usr/bin/env bash
set -euo pipefail

GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

log() {
  echo -e "${BLUE}[DEPLOY LAMBDA]${NC} $1"
}

success() {
  echo -e "${GREEN}[SUCCESS]${NC} $1"
}

error() {
  echo -e "\033[0;31m[ERROR]\033[0m $1"
}

require_tfvars_value() {
  local key="$1"
  local file="$2"
  sed -n -E "s|^[[:space:]]*${key}[[:space:]]*=[[:space:]]*\"([^\"]+)\".*$|\1|p" "$file" | head -1
}

resolve_required_secret() {
  local env_name="$1"
  local tfvars_key="$2"
  local tfvars_file="terraform/terraform.tfvars"

  local value="${!env_name:-}"
  if [ -z "$value" ] && [ -f "$tfvars_file" ]; then
    value="$(require_tfvars_value "$tfvars_key" "$tfvars_file")"
  fi

  if [ -z "$value" ]; then
    error "Variable requise manquante: ${env_name}. Définis-la en env (CI) ou dans ${tfvars_file} (${tfvars_key})."
    exit 1
  fi

  echo "$value"
}

TERRAFORM_DIR="terraform"
API_LAMBDA_DIR="apps/api-lambda"
WEB_DIR="apps/web"

log "🚀 Déploiement sur AWS Lambda + S3"
echo ""

DEPLOY_EVENTBRIDGE_KEY="$(resolve_required_secret "EVENTBRIDGE_API_KEY" "eventbridge_api_key")"
DEPLOY_PUSH_VAPID_PRIVATE_KEY="$(resolve_required_secret "PUSH_VAPID_PRIVATE_KEY" "push_vapid_private_key")"

log "1. Préparation Lambda"
npm install -w "$API_LAMBDA_DIR"
npm run prepare-lambda -w "$API_LAMBDA_DIR"
success "Lambda prête"
echo ""

log "2. Initialisation backend Terraform"
bash ./scripts/init-backend.sh
success "Backend prêt"
echo ""

log "3. Terraform apply"
cd "$TERRAFORM_DIR"
terraform init -reconfigure
terraform apply -lock=false -auto-approve \
  -var "eventbridge_api_key=${DEPLOY_EVENTBRIDGE_KEY}" \
  -var "push_vapid_private_key=${DEPLOY_PUSH_VAPID_PRIVATE_KEY}"
API_URL=$(terraform output -raw api_url)
FRONTEND_BUCKET=$(terraform output -raw frontend_bucket)
FRONTEND_URL=$(terraform output -raw frontend_url)
CLOUDFRONT_DIST_ID=$(terraform output -raw cloudfront_distribution_id)
cd ..
success "Infra déployée"

log "API URL: $API_URL"
log "Frontend bucket: $FRONTEND_BUCKET"
echo ""

log "4. Build frontend"
npm run build -w apps/web
success "Frontend prêt"
echo ""

log "5. Upload frontend"
aws s3 sync "$WEB_DIR/dist" "s3://$FRONTEND_BUCKET" --delete
success "Frontend déployé"
echo ""

log "6. Invalidation CloudFront"
INVALIDATION_ID=$(aws cloudfront create-invalidation \
  --distribution-id "$CLOUDFRONT_DIST_ID" \
  --paths "/*" \
  --query 'Invalidation.Id' \
  --output text)
success "Invalidation créée: $INVALIDATION_ID"
echo ""

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}✨ Déploiement terminé avec succès !${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "🌐 Application: $FRONTEND_URL"
echo "🔌 API: $API_URL"
echo ""
