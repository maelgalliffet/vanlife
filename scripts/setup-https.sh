#!/usr/bin/env bash
set -euo pipefail

# Script de configuration HTTPS avec Let's Encrypt
# Usage: ./scripts/setup-https.sh <domain> [email]

DOMAIN="${1:-vanlife.galliffet.fr}"
EMAIL="${2:-admin@galliffet.fr}"
SSH_HOST="${3:-aws-instance}"

# Couleurs
BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() {
  echo -e "${BLUE}[HTTPS]${NC} $1"
}

success() {
  echo -e "${GREEN}[SUCCESS]${NC} $1"
}

warn() {
  echo -e "${YELLOW}[WARN]${NC} $1"
}

log "Configuration HTTPS pour $DOMAIN"
echo ""

# Vérifier que le domaine est accessible

success "Domaine résolvable"

# Installez Certbot sur le serveur et générez le certificat
log "Installation de Certbot et génération du certificat..."
ssh "$SSH_HOST" bash << CERTBOT_INSTALL
  set -euo pipefail
  
  DOMAIN="$DOMAIN"
  EMAIL="$EMAIL"
  
  echo "Mise à jour des packages..."
  sudo apt-get update -y >/dev/null
  
  echo "Installation de Certbot..."
  sudo apt-get install -y certbot python3-certbot-nginx >/dev/null
  
  echo "Vérification du certificat existant..."
  if [ -f /etc/letsencrypt/live/\$DOMAIN/fullchain.pem ]; then
    echo "Certificat existant trouvé"
  else
    echo "Génération d'un nouveau certificat pour \$DOMAIN..."
    sudo certbot certonly \
      --standalone \
      -d \$DOMAIN \
      --agree-tos \
      --email \$EMAIL \
      --non-interactive || {
        echo "Erreur : Impossible de générer le certificat"
        echo "Vérifiez que :"
        echo "  1. Le port 80 est accessible"
        echo "  2. Le domaine est enregistré correctement"
        exit 1
      }
  fi
  
  # Vérifier les permissions
  sudo chown -R :www-data /etc/letsencrypt/live 2>/dev/null || true
  sudo chmod -R 755 /etc/letsencrypt/live 2>/dev/null || true
  
  echo "Certificat configuré avec succès"
CERTBOT_INSTALL

success "Certificat généré pour $DOMAIN"
echo ""
echo "Certificat installé à :"
echo "  /etc/letsencrypt/live/$DOMAIN/"
echo ""
echo "Prochaines étapes :"
echo "  1. Redéployer l'application : npm run deploy:aws"
echo "  2. Vérifier HTTPS : curl -v https://$DOMAIN"
echo ""
echo "Le certificat se renouvellera automatiquement via une tâche cron."
echo ""
