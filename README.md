# Vanlife weekend booking

Application web TypeScript (Front + API Serverless) pour réserver un week-end avec le van familial.

## Fonctionnalités
- Réservation provisoire (plusieurs personnes sur le même week-end)
- Réservation définitive (une seule personne par week-end)
- Identification de la personne à la première visite (popup + liste)
- Texte d'information sur chaque réservation
- Ajout de photos liées à une réservation
- Album global des photos

## Architecture

Application entièrement serverless déployée sur AWS:

### Frontend
- **Hosting**: AWS S3 + CloudFront
- **Stack**: React + TypeScript + Vite
- **URL**: https://vanlife.galliffet.fr

### Backend
- **Runtime**: AWS Lambda (Node.js 22)
- **Framework**: Express + TypeScript
- **Storage**: AWS S3 (database + uploads)
- **API Gateway**: Regional REST API
- **URL**: https://l9tfi28yik.execute-api.eu-west-3.amazonaws.com/prod

### Infrastructure as Code
- **IaC**: Terraform
- **Services**: Lambda, API Gateway, S3, CloudFront, Route 53, ACM, IAM, CloudWatch

## Démarrage local

```bash
npm install
npm run dev
```

- API: http://localhost:4000 (apps/api-lambda)
- Web: http://localhost:5173 (apps/web)

## Déploiement

### Configuration AWS requise

Ajouter les credentials AWS en GitHub Secrets:
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`

### Déploiement manuel

```bash
# Déploiement complet (Lambda + Frontend + S3)
npm run deploy:lambda

# Mettre à jour uniquement le frontend
aws s3 sync apps/web/dist s3://vanlife-frontend-prod --delete

# Migrer les données depuis l'ancienne EC2
npm run migrate:lambda
```

### Déploiement automatique

- Les pushes sur `main` déclenche le workflow GitHub Actions
- Le workflow teste le build, puis déploie sur Lambda
- Voir `.github/workflows/deploy.yml`

## Coûts

Estimation mensuelle: **3-5€**
- Lambda: ~1-2€ (free tier à 1M requêtes/mois)
- S3: ~1€
- CloudFront: ~1-2€
- Route 53: ~0.50€

## Fichiers principaux

```
apps/
├── api-lambda/       # Express API pour Lambda
│   ├── src/
│   │   ├── index.ts  # Handler serverless-http
│   │   └── s3-db.ts  # Client S3 pour persistance
│   └── package.json
└── web/              # Frontend React
    ├── src/
    │   ├── App.tsx   # Composant principal
    │   └── types.ts  # Types TypeScript
    └── package.json

infra/terraform-lambda/
├── main.tf           # S3, IAM, CloudWatch
├── lambda.tf         # Configuration Lambda
├── api-gateway.tf    # REST API
├── cloudfront.tf     # CDN frontend
└── outputs.tf        # Outputs

scripts/
├── deploy-lambda.sh  # Déploiement complet
└── migrate-to-lambda.sh  # Migration EC2→S3
```

## Documentation

- [LAMBDA_DEPLOYMENT.md](./LAMBDA_DEPLOYMENT.md) - Guide détaillé du déploiement serverless
