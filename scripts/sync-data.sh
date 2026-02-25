#!/usr/bin/env bash
set -euo pipefail

# Script de synchronisation des données vers le serveur AWS
# Usage: ./scripts/sync-data.sh [host] [app-path]
# Exemple: ./scripts/sync-data.sh aws-instance /home/ubuntu/vanlife

SSH_HOST="${1:-aws-instance}"
APP_PATH="${2:-/home/ubuntu/vanlife}"
# Les vraies données sont dans apps/api/apps/api/ (structure du workspace monorepo)
LOCAL_DATA_PATH="apps/api/apps/api/data"
LOCAL_UPLOADS_PATH="apps/api/apps/api/uploads"

# Couleurs
BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() {
  echo -e "${BLUE}[SYNC]${NC} $1"
}

success() {
  echo -e "${GREEN}[SUCCESS]${NC} $1"
}

warn() {
  echo -e "${YELLOW}[WARN]${NC} $1"
}

log "Synchronisation des données vers $SSH_HOST:$APP_PATH"
echo ""

# Vérifier si les répertoires locaux existent et ne sont pas vides
if [ ! -d "$LOCAL_DATA_PATH" ] || [ -z "$(ls -A "$LOCAL_DATA_PATH" 2>/dev/null)" ]; then
  warn "Le répertoire local $LOCAL_DATA_PATH est vide ou inexistant"
  read -p "Continuer quand même ? (y/n) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Synchronisation annulée"
    exit 0
  fi
fi

# Fonction pour synchroniser via tar (plus compatible avec Docker)
sync_via_tar() {
  local source_dir="$1"
  local container_dest_path="$2"  # Le chemin DANS le conteneur (relatif à /app/)
  
  if [ -z "$(ls -A "$source_dir" 2>/dev/null)" ]; then
    log "Le répertoire $source_dir est vide, copie ignorée"
    return
  fi
  
  log "Synchronisation de $source_dir vers le serveur (cible: /app/$container_dest_path)..."
  
  # Créer une archive tar des fichiers locaux
  tar -czf /tmp/sync-data.tar.gz -C "$source_dir" . || {
    warn "Aucun fichier à copier dans $source_dir"
    return
  }
  
  # Copier l'archive sur le serveur et l'extraire via Docker
  scp -q /tmp/sync-data.tar.gz "$SSH_HOST:/tmp/sync-data.tar.gz"
  
  # Utiliser docker cp pour copier dans le conteneur
  ssh "$SSH_HOST" << EOF
    set -e
    echo "Extraction des données via docker..."
    
    # Vérifier que le conteneur API existe
    if ! docker ps -a | grep -q vanlife-api-1; then
      echo "Le conteneur vanlife-api-1 n'existe pas"
      exit 1
    fi
    
    # Copier l'archive dans le conteneur
    docker cp /tmp/sync-data.tar.gz vanlife-api-1:/tmp/sync-data.tar.gz
    
    # Extraire l'archive dans le conteneur (qui a les bonnes permissions)
    docker exec vanlife-api-1 tar -xzf /tmp/sync-data.tar.gz -C /app/$container_dest_path
    
    # Nettoyer l'archive temporaire
    rm -f /tmp/sync-data.tar.gz
    docker exec vanlife-api-1 rm -f /tmp/sync-data.tar.gz
    
    echo "Données synchronisées avec succès"
EOF
  
  # Nettoyer l'archive locale
  rm -f /tmp/sync-data.tar.gz
  
  success "Synchronisation de $source_dir terminée"
}

# Synchroniser les données
# LOCAL_DATA_PATH et LOCAL_UPLOADS_PATH sont en apps/api/apps/api/*
# Mais dans le conteneur ils sont montés à /app/apps/api/*
sync_via_tar "$LOCAL_DATA_PATH" "apps/api/data"
sync_via_tar "$LOCAL_UPLOADS_PATH" "apps/api/uploads"

# Afficher les statistiques
log "Affichage des données copiées..."
echo ""
echo "=== Données sur le serveur ==="
ssh "$SSH_HOST" "cd $APP_PATH && docker compose exec -T api find apps/api/data apps/api/uploads -type f 2>/dev/null | head -20 || true"

success "Synchronisation des données terminée !"
echo ""
echo "Pour voir toutes les données:"
echo "  ssh $SSH_HOST 'cd $APP_PATH && docker compose exec -T api du -sh apps/api/data apps/api/uploads'"
echo ""
