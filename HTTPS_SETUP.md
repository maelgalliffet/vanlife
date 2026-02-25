# Configuration du domaine et HTTPS

## ✅ Étape 1 : Configurer le domaine vanlife.galliffet.fr

### À faire dans votre registrar (OVH, GoDaddy, etc.)

Ajoutez un **enregistrement DNS A** :
```
Type   : A
Name   : vanlife
Value  : 13.39.80.93  (l'IP de votre instance AWS)
TTL    : 3600
```

Attendez quelques minutes pour la propagation DNS.

## ✅ Étape 2 : Configurer HTTPS avec Certbot + Let's Encrypt

### Installation sur le serveur

```bash
# SSH sur le serveur
ssh aws-instance

# Installer Certbot et nginx plugin
sudo apt-get update
sudo apt-get install -y certbot python3-certbot-nginx

# Générer le certificat
sudo certbot certonly --standalone -d vanlife.galliffet.fr --agree-tos --email votre-email@example.com

# Le certificat sera sauvegardé dans :
# /etc/letsencrypt/live/vanlife.galliffet.fr/
```

## ✅ Étape 3 : Configurer Nginx/Docker pour HTTPS

### Créer un nginx.conf custom

Créez un fichier `apps/web/nginx.conf` :

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name vanlife.galliffet.fr;

    # Redirection HTTP vers HTTPS
    location / {
        return 301 https://$server_name$request_uri;
    }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name vanlife.galliffet.fr;

    # Certificats SSL
    ssl_certificate /etc/letsencrypt/live/vanlife.galliffet.fr/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/vanlife.galliffet.fr/privkey.pem;

    # Configuration SSL sécurisée
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    # HSTS
    add_header Strict-Transport-Security "max-age=31536000" always;

    # Comprendre les requêtes
    client_max_body_size 50M;

    # SPA routing
    location / {
        root /usr/share/nginx/html;
        try_files $uri $uri/ /index.html;
    }

    # Fichiers statiques
    location ~* \.(js|css|jpeg|jpg|png|gif|ico|woff|woff2|ttf|eot|svg)$ {
        root /usr/share/nginx/html;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # Réduire le bruit des 404
    location = /favicon.ico {
        access_log off;
        log_not_found off;
    }
}
```

### Mettre à jour le Dockerfile du web

```dockerfile
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json ./
COPY tsconfig.base.json ./
COPY apps/web/package.json ./apps/web/package.json
RUN npm install

COPY apps/web ./apps/web
RUN npm run build -w apps/web

FROM nginx:1.27-alpine
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80 443
CMD ["nginx", "-g", "daemon off;"]
```

## ✅ Étape 4 : Mettre à jour docker-compose.yml

```yaml
version: "3.9"

services:
  api:
    build:
      context: .
      dockerfile: apps/api/Dockerfile
    environment:
      - PORT=4000
      - CORS_ORIGIN=https://vanlife.galliffet.fr
      - BASE_URL=https://vanlife.galliffet.fr:4000
    ports:
      - "4000:4000"
    volumes:
      - vanlife-data:/app/apps/api/data
      - vanlife-uploads:/app/apps/api/uploads

  web:
    build:
      context: .
      dockerfile: apps/web/Dockerfile
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /etc/letsencrypt:/etc/letsencrypt:ro  # Certificats en lecture seule
    depends_on:
      - api

volumes:
  vanlife-data:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: ./apps/api/data
  vanlife-uploads:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: ./apps/api/uploads
```

## ✅ Étape 5 : Mettre à jour App.tsx

```typescript
// Construire l'API URL de manière dynamique à l'exécution
const getApiUrl = () => {
  if (import.meta.env.DEV) {
    return "http://localhost:4000";
  }
  // En production, utiliser le protocole courant (https en prod)
  return `${window.location.protocol}//${window.location.hostname}:4000`;
};

const API_URL = getApiUrl();
```

## ✅ Étape 6 : Renouvellement automatique des certificats

```bash
# Ajouter une tâche cron (sur le serveur)
sudo crontab -e

# Ajouter cette ligne :
0 3 * * * certbot renew --quiet && systemctl reload docker
```

## 🚀 Déploiement final

```bash
# Depuis votre machine locale
npm run deploy:aws
```

## 🔍 Vérifier le HTTPS

```bash
curl -v https://vanlife.galliffet.fr
```

Vous devriez voir :
- `SSL certificate verify ok`
- HTTP 200 OK
- Redirection HTTP → HTTPS fonctionnelle

## 📝 Notes importantes

1. **CORS** : N'oubliez pas de mettre à jour `CORS_ORIGIN` dans docker-compose.yml
2. **Certificat** : Le certificat se renouvelle tous les 90 jours (automatique avec cron)
3. **Port 4000** : L'API reste sur un port custom, accessible via `https://vanlife.galliffet.fr:4000`
4. **Cache** : Les fichiers statiques sont cachés 1 an (immutable)

## Ordre d'exécution recommandé

1. ✅ Configurer le DNS (A record)
2. ✅ Attendre la propagation DNS (quelques minutes)
3. ✅ Installer Certbot sur le serveur
4. ✅ Créer les fichiers nginx.conf et mettre à jour les Dockerfiles
5. ✅ Redéployer avec `npm run deploy:aws`
6. ✅ Vérifier avec `curl -v https://vanlife.galliffet.fr`
