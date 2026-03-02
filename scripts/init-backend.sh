#!/usr/bin/env bash
set -euo pipefail

# Script d'initialisation du Terraform remote state
# Crée le bucket S3 et la table DynamoDB pour les locks Terraform

echo "🔧 Initialisation du backend Terraform S3..."

BUCKET_NAME="vanlife-terraform-state"
REGION="eu-west-3"

# Vérifier que AWS CLI est disponible
if ! command -v aws &> /dev/null; then
  echo "❌ AWS CLI n'est pas installé"
  exit 1
fi

# Créer le bucket S3 s'il n'existe pas
echo "📦 Vérification du bucket S3 '$BUCKET_NAME'..."
if ! aws s3 ls "s3://$BUCKET_NAME" 2>/dev/null; then
  echo "   Création du bucket..."
  aws s3api create-bucket \
    --bucket "$BUCKET_NAME" \
    --region "$REGION" \
    --create-bucket-configuration LocationConstraint="$REGION"
  
  # Activer le versioning
  aws s3api put-bucket-versioning \
    --bucket "$BUCKET_NAME" \
    --versioning-configuration Status=Enabled
  
  # Activer le chiffrement par défaut
  aws s3api put-bucket-encryption \
    --bucket "$BUCKET_NAME" \
    --server-side-encryption-configuration '{
      "Rules": [{
        "ApplyServerSideEncryptionByDefault": {
          "SSEAlgorithm": "AES256"
        }
      }]
    }'
  
  echo "✅ Bucket créé et configuré"
else
  echo "✅ Bucket existe déjà"
fi

echo ""
echo "✨ Backend S3 prêt!"
echo ""
echo "Prochaines étapes:"
echo "1. cd terraform"
echo "2. terraform init -reconfigure"
echo "3. terraform plan"
echo "4. terraform apply"
