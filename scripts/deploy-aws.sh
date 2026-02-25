#!/usr/bin/env bash
set -euo pipefail

# Script de déploiement rapide sur aws-instance
# Utilise la configuration SSH créée dans ~/.ssh/config
# Usage: ./scripts/deploy-aws.sh [branch] [app-path]

BRANCH="${1:-main}"
APP_PATH="${2:-/home/ubuntu/vanlife}"
EC2_HOST="ec2-13-39-80-93.eu-west-3.compute.amazonaws.com"
REPO_URL="https://github.com/maelgalliffet/vanlife.git"

# Couleurs
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

log() {
  echo -e "${BLUE}[DEPLOY AWS]${NC} $1"
}

success() {
  echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log "Déploiement de la branche '$BRANCH' vers aws-instance"
log "Chemin de l'app: $APP_PATH"
echo ""

# Déployer via SSH en utilisant le profil aws-instance
ssh aws-instance bash -s "$BRANCH" "$APP_PATH" "$EC2_HOST" "$REPO_URL" <<'DEPLOY_SCRIPT'
#!/bin/bash
set -euo pipefail

BRANCH="$1"
APP_PATH="$2"
EC2_HOST="$3"
REPO_URL="$4"

# Script d'exécution sur le serveur
echo "Préparation du répertoire d'application..."
mkdir -p "$APP_PATH"
cd "$APP_PATH"

if [ ! -d ".git" ]; then
  echo "Clonage du repository..."
  # Utiliser SSH pour un meilleur support avec les clés
  git clone "$REPO_URL" . || {
    echo "Erreur: Impossible de cloner le repository"
    echo "Assurez-vous que:"
    echo "  1. Le repository existe: $REPO_URL"
    echo "  2. Le serveur a une clé SSH déployée sur GitHub"
    echo "  3. La connectivité vers GitHub est disponible"
    exit 1
  }
fi

echo "Récupération des dernières modifications..."
git fetch --all
git reset --hard "origin/$BRANCH"

echo "Préparation des répertoires de données..."
mkdir -p apps/api/data apps/api/uploads

echo "Configuration de l'environnement..."
cat > .env <<EOF
PORT=4000
CORS_ORIGIN=*
BASE_URL=http://$EC2_HOST:4000
EOF

echo "Arrêt des conteneurs existants (données persistées)..."
docker compose down || true

echo "Construction des images..."
docker compose build --no-cache

echo "Démarrage des conteneurs..."
docker compose up -d

echo ""
echo "Déploiement terminé !"
echo "API: http://$EC2_HOST:4000"
echo "Web: http://$EC2_HOST:80"
echo ""
echo "Logs:"
docker compose logs --tail=20 api

DEPLOY_SCRIPT

success "Déploiement terminé !"
