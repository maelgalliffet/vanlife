# Documentation technique — Fichiers de code TS/TSX

Ce document couvre uniquement les fichiers TypeScript/TSX du projet.

## Backend (`apps/api-lambda/src`)

- `apps/api-lambda/src/index.ts`
  - Point d’entrée principal de l’API Express.
  - Déclare les routes métier (bookings, photos, outils dev), branche les sous-modules de routes, puis exporte le handler Lambda via `serverless-http`.

- `apps/api-lambda/src/local.ts`
  - Bootstrap local du backend.
  - Force le mode local (`LOCAL_DEV=true`) et démarre l’application sur le port local.

- `apps/api-lambda/src/s3-db.ts`
  - Couche d’accès aux données et stockage fichiers.
  - Gère lecture/écriture de la base JSON (S3 ou local), upload/suppression des fichiers, compression d’images, et les types de données backend.

- `apps/api-lambda/src/push.ts`
  - Logique métier des notifications push.
  - Configure VAPID, envoie les notifications, et gère les abonnements (upsert/suppression/filtrage).

- `apps/api-lambda/src/push-routes.ts`
  - Routes HTTP dédiées au push (`public-key`, `status`, `subscribe`, `unsubscribe`).
  - Contient la validation des payloads liés aux abonnements.

- `apps/api-lambda/src/booking-interactions-routes.ts`
  - Routes interactions sur réservations.
  - Gère réactions et commentaires (CRUD) et déclenche les notifications associées.

## Frontend (`apps/web/src`)

- `apps/web/src/main.tsx`
  - Point d’entrée React.
  - Monte `App` dans le DOM et active `React.StrictMode`.

- `apps/web/src/App.tsx`
  - Composant principal de l’interface.
  - Orchestre calendrier, réservations, édition, commentaires, outils dev, et interactions UI globales.

- `apps/web/src/types.ts`
  - Types métier frontend (`User`, `Booking`, `BookingComment`, `PhotoItem`, etc.).

- `apps/web/src/api-client.ts`
  - Client HTTP frontend centralisé.
  - Encapsule les appels API et la normalisation des erreurs réseau/API.

- `apps/web/src/http-errors.ts`
  - Utilitaires partagés de gestion d’erreurs HTTP côté frontend.
  - Centralise l’extraction de messages d’erreur API et la vérification des réponses HTTP.

- `apps/web/src/usePushNotifications.ts`
  - Hook React dédié aux notifications push.
  - Gère support navigateur, synchronisation état abonnement, subscribe/unsubscribe, et erreurs UI.

## Fichier TypeScript de tooling front

- `apps/web/vite.config.ts`
  - Configuration Vite du frontend.
  - Active le plugin React pour le build/dev server.

## Application Android (`apps/web/android`)

L'application Android est générée par **Capacitor** (Ionic), qui encapsule l'application web React dans une WebView native Android. L'interface et l'infrastructure restent identiques.

### Comment ça fonctionne

- Capacitor wrappe le build web (`apps/web/dist`) dans un projet Android natif.
- La WebView charge les fichiers locaux et appelle l'API CloudFront via HTTPS (`https://vanlife.galliffet.fr/prod/api`).
- L'API est configurée avec `cors: "*"`, donc elle accepte les requêtes depuis la WebView Android.

### Générer l'APK

#### Prérequis
- Java 21+
- Android SDK (API 34+)
- Node.js 22+

#### Build local

```bash
# 1. Installer les dépendances
npm install

# 2. Builder le web et synchroniser avec Android
npm run build:android

# 3. Configurer le SDK Android
echo "sdk.dir=$ANDROID_SDK_ROOT" > apps/web/android/local.properties

# 4. Builder l'APK debug
cd apps/web/android && ./gradlew assembleDebug
```

L'APK se trouve dans `apps/web/android/app/build/outputs/apk/debug/app-debug.apk`.

#### Build automatique (GitHub Actions)

Le workflow `.github/workflows/build-android.yml` se déclenche automatiquement à chaque push sur `main` et publie l'APK en tant qu'artefact GitHub Actions (disponible 30 jours).

Pour télécharger l'APK :
1. Aller dans l'onglet **Actions** du dépôt GitHub
2. Sélectionner le dernier run **Build Android APK**
3. Télécharger l'artefact **vanlife-android-debug**

### Structure du projet Android

| Fichier/Dossier | Rôle |
|---|---|
| `apps/web/android/` | Projet Android natif généré par Capacitor |
| `apps/web/android/app/src/main/java/` | Activité principale Android (MainActivity) |
| `apps/web/android/app/src/main/AndroidManifest.xml` | Manifeste Android (permissions, activité) |
| `apps/web/android/variables.gradle` | Versions SDK Android et dépendances |
| `apps/web/capacitor.config.ts` | Configuration Capacitor |
| `apps/web/public/manifest.json` | PWA manifest (icônes, nom, thème) |
| `apps/web/public/icons/` | Icônes de l'application (192x192, 512x512) |

## Fichiers TypeScript de tooling front (ajouts)

- `apps/web/capacitor.config.ts`
  - Configuration Capacitor pour le packaging Android.
  - Définit l'ID (`fr.galliffet.vanlife`), le nom de l'app, le répertoire web (`dist`) et les options Android.
