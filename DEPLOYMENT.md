# Guide de Déploiement

Ce document explique comment déployer l'application Vanlife weekend booking.

## 🚀 Déploiement rapide sur AWS

### Prérequis
- Clé SSH configurée dans `~/.ssh/config` avec le profil `aws-instance`
- Docker et docker-compose installés sur le serveur AWS
- Accès au repository GitHub

### Déploiement en une commande

```bash
# Déployer la branche main
npm run deploy:aws

# Ou avec un branch spécifique
npm run deploy:aws -- develop /home/ubuntu/vanlife
```

Le script va automatiquement :
1. Se connecter au serveur via SSH
2. Cloner ou mettre à jour le repository
3. Configurer les variables d'environnement
4. Arrêter les anciens conteneurs
5. Construire les images Docker
6. Démarrer les nouveaux conteneurs

## 📦 Scripts de déploiement disponibles

### `npm run deploy`
Déploie l'application localement (teste le processus de déploiement).

**Variables d'environnement** :
```bash
export PORT=4000
export CORS_ORIGIN=*
export EC2_HOST=localhost
npm run deploy
```

### `npm run deploy:aws`
Déploie l'application sur le serveur AWS via SSH.

**Options** :
```bash
# Branche (défaut: main)
./scripts/deploy-aws.sh main

# Branche + chemin application
./scripts/deploy-aws.sh develop /home/ubuntu/vanlife
```

## 🔄 Configuration CI/CD

Le déploiement automatique est configuré dans `.github/workflows/deploy.yml`.

**Secrets GitHub requis** :
- `EC2_HOST` : Adresse IP ou hostname du serveur
- `EC2_USER` : Utilisateur SSH (ubuntu)
- `EC2_SSH_KEY` : Clé SSH privée (contenu du fichier)
- `EC2_APP_PATH` : Chemin d'installation (ex: /home/ubuntu/vanlife)

### Configuration automatique au push sur main
À chaque commit sur la branche `main`, GitHub Actions :
1. Clone le repository
2. Lance le workflow de déploiement
3. Exécute le script `scripts/deploy.sh` sur le serveur

## 🔐 Configuration SSH

Le déploiement utilise le profil SSH `aws-instance` configuré dans `~/.ssh/config` :

```
Host aws-instance
    HostName ec2-13-39-80-93.eu-west-3.compute.amazonaws.com
    User ubuntu
    IdentityFile ~/.ssh/maelg-keypair.pem
    IdentitiesOnly yes
```

Pour tester la connexion :
```bash
ssh aws-instance
```

## 📋 Structure du déploiement

```
User (Push to main)
    ↓
GitHub Actions Workflow
    ↓
SSH to EC2 (aws-instance)
    ↓
scripts/deploy.sh
    ├─ Clone/Update repo
    ├─ Configure environment
    ├─ Build Docker images
    ├─ Stop old containers
    └─ Start new containers
```

## 🐳 Variables d'environnement du serveur

Le fichier `.env` est généré automatiquement avec:
- `PORT=4000` - Port de l'API
- `CORS_ORIGIN=*` - CORS ouvert pour la démo
- `BASE_URL=http://<EC2_HOST>:4000` - URL de base de l'API

À modifier dans le script de déploiement si besoin :

```bash
# Dans scripts/deploy.sh, fonction setup_environment()
cat > .env <<EOF
PORT=4000
CORS_ORIGIN=$CORS_ORIGIN
BASE_URL=http://$EC2_HOST:$PORT
EOF
```

## 🔍 Dépannage

### La connexion SSH échoue
```bash
# Vérifier la configuration SSH
ssh -v aws-instance

# Vérifier les permissions du fichier clé
ls -l ~/.ssh/maelg-keypair.pem
chmod 600 ~/.ssh/maelg-keypair.pem
```

### Docker n'est pas disponible sur le serveur
```bash
# Installer Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Ajouter l'utilisateur au groupe docker
sudo usermod -aG docker ubuntu
```

### Voir les logs du déploiement
```bash
# SSH sur le serveur
ssh aws-instance

# Voir les logs en temps réel
cd /home/ubuntu/vanlife && docker compose logs -f

# Voir seulement les erreurs
docker compose logs api | grep -i error
```

## 📝 Notes

- Le déploiement crée ou réutilise le répertoire `EC2_APP_PATH`
- Les images Docker sont reconstruites à chaque déploiement (`--no-cache`)
- Les conteneurs précédents sont arrêtés proprement avant le déploiement
- Les fichiers persistants (uploads, db.json) sont conservés via les volumes Docker

## 🛠️ Personnalisation

Pour modifier le processus de déploiement :

1. **Scripts de déploiement** : `scripts/deploy.sh` et `scripts/deploy-aws.sh`
2. **CI/CD Workflow** : `.github/workflows/deploy.yml`
3. **Docker Compose** : `docker-compose.yml`
4. **Vars d'environnement** : `setup_environment()` dans les scripts
