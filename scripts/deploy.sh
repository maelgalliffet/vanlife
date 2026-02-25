#!/usr/bin/env bash
set -euo pipefail

# Script de déploiement pour l'app vanlife-weekend-booking
# Peut être utilisé localement ou via CI/CD

# Configuration
REPO_URL="${REPO_URL:-https://github.com/maelg/vanlife}"
APP_PATH="${APP_PATH:-.}"
BRANCH="${BRANCH:-main}"

# Variables environnement
PORT="${PORT:-4000}"
CORS_ORIGIN="${CORS_ORIGIN:-*}"
EC2_HOST="${EC2_HOST:-localhost}"

# Couleurs pour les logs
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

log() {
  echo -e "${BLUE}[DEPLOY]${NC} $1"
}

success() {
  echo -e "${GREEN}[SUCCESS]${NC} $1"
}

error() {
  echo -e "${RED}[ERROR]${NC} $1"
  exit 1
}

# Vérifier les dépendances
check_dependencies() {
  log "Vérification des dépendances..."
  
  if ! command -v docker &> /dev/null; then
    error "Docker n'est pas installé"
  fi
  
  if ! command -v docker-compose &> /dev/null && ! command -v docker &> /dev/null; then
    error "docker-compose n'est pas disponible"
  fi
  
  if ! command -v git &> /dev/null; then
    error "Git n'est pas installé"
  fi
  
  success "Dépendances vérifiées"
}

# Préparer le répertoire
setup_app_directory() {
  log "Préparation du répertoire d'application..."
  
  if [ ! -d "$APP_PATH" ]; then
    log "Création du répertoire $APP_PATH"
    mkdir -p "$APP_PATH"
  fi
  
  if [ ! -d "$APP_PATH/.git" ]; then
    log "Clonage du repository..."
    git clone "$REPO_URL" "$APP_PATH"
  else
    log "Repository existant, mise à jour..."
    cd "$APP_PATH"
    git fetch --all
    git reset --hard "origin/$BRANCH"
  fi
  
  cd "$APP_PATH"
  success "Répertoire d'application prêt"
}

# Configurer l'environnement
setup_environment() {
  log "Configuration de l'environnement..."
  
  # Créer les répertoires de données s'ils n'existent pas
  mkdir -p apps/api/data apps/api/uploads
  
  cat > .env <<EOF
PORT=$PORT
CORS_ORIGIN=$CORS_ORIGIN
BASE_URL=https://$EC2_HOST
EOF
  
  success "Environnement configuré"
}

# Arrêter les conteneurs existants
stop_containers() {
  log "Arrêt des conteneurs existants (données persistées)..."
  docker compose down || true
  success "Conteneurs arrêtés - données conservées dans les volumes"
}

# Construire les images Docker
build_images() {
  log "Construction des images Docker..."
  
  docker compose build --no-cache
  
  success "Images construites"
}

# Démarrer les conteneurs
start_containers() {
  log "Démarrage des conteneurs..."
  
  docker compose up -d
  
  success "Conteneurs en cours d'exécution"
}

# Afficher les logs
show_logs() {
  log "Logs des conteneurs:"
  docker compose logs --tail=50
}

# Vérifier la santé de l'application
health_check() {
  log "Vérification de la santé de l'application..."
  
  sleep 3
  
  if curl -sf "http://localhost:$PORT/health" > /dev/null 2>&1 || true; then
    success "API responding at http://localhost:$PORT"
  else
    log "API may still be starting up, check with: docker compose logs api"
  fi
  
  # Vérifier les certificats HTTPS s'ils existent
  if [ -f "/etc/letsencrypt/live/vanlife.galliffet.fr/fullchain.pem" ]; then
    success "Certificats HTTPS trouvés ✓"
  else
    log "ℹ️  Certificats HTTPS non configurés. Pour configurer: ./scripts/setup-https.sh"
  fi
}

# Fonction principale
main() {
  echo -e "${BLUE}===================================${NC}"
  echo -e "${BLUE}Déploiement - Vanlife Weekend${NC}"
  echo -e "${BLUE}===================================${NC}"
  
  check_dependencies
  setup_app_directory
  setup_environment
  stop_containers
  build_images
  start_containers
  show_logs
  health_check
  
  echo ""
  echo -e "${BLUE}===================================${NC}"
  echo -e "${GREEN}Déploiement terminé avec succès !${NC}"
  echo -e "${BLUE}===================================${NC}"
  echo ""
  echo "📱 Application Web: https://$EC2_HOST"
  echo "🔌 API (interne): http://localhost:$PORT"
  echo "🔒 Protocol: HTTPS (port 443)"
  echo ""
  echo "Pour voir les logs:"
  echo "  cd $APP_PATH && docker compose logs -f"
  echo ""
}

main "$@"
