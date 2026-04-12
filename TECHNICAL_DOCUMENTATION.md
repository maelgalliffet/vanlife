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
