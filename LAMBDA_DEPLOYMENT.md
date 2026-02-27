# Déploiement Lambda + S3 (Serverless)

## Architecture

```
┌─────────────────┐
│  Utilisateur    │
└────────┬────────┘
         │
         │ HTTPS
         ▼
┌─────────────────────────────────────────┐
│         CloudFront (optionnel)          │
└────────┬────────────────────┬───────────┘
         │                    │
         │ Frontend           │ API
         ▼                    ▼
┌─────────────────┐  ┌─────────────────────┐
│   S3 Bucket     │  │   API Gateway       │
│   (Frontend)    │  │   + Lambda Function │
└─────────────────┘  └──────────┬──────────┘
                               │
                 ┌─────────────┴──────────────┐
                 │                            │
                 ▼                            ▼
        ┌──────────────────┐        ┌──────────────────┐
        │   S3 Bucket      │        │   S3 Bucket      │
        │   (Uploads)      │        │   (Data/db.json) │
        └──────────────────┘        └──────────────────┘
```

## Avantages

- **Coût très faible** : ~3-5€/mois (vs 15€/mois avec EC2)
- **Zéro maintenance** : Pas de serveur à gérer
- **Auto-scaling** : S'adapte automatiquement à la charge
- **Haute disponibilité** : Par défaut avec AWS

## Déploiement

### Prérequis

- AWS CLI configuré
- Terraform installé
- Node.js 22+

### Première installation

```bash
# 1. Déployer l'infrastructure complète
npm run deploy:lambda

# 2. Migrer les données depuis EC2 (optionnel)
npm run migrate:lambda
```

### Mises à jour

**Frontend uniquement:**
```bash
npm run build -w apps/web
aws s3 sync apps/web/dist s3://vanlife-frontend-prod --delete
```

**API uniquement:**
```bash
cd apps/api-lambda
npm run package
aws lambda update-function-code \
  --function-name vanlife-api-prod \
  --zip-file fileb://lambda-api.zip
```

**Infrastructure complète:**
```bash
npm run deploy:lambda
```

## Structure des fichiers

```
apps/
  api-lambda/          # API Lambda (nouvelle version serverless)
    src/
      index.ts         # Handler Lambda + Express
      s3-db.ts         # Gestion db.json sur S3
  web/                 # Frontend React (inchangé)
  
infra/
  terraform-lambda/    # Infrastructure serverless
    main.tf            # S3 buckets + IAM
    lambda.tf          # Configuration Lambda
    api-gateway.tf     # Configuration API Gateway
    
scripts/
  deploy-lambda.sh     # Déploiement complet
  migrate-to-lambda.sh # Migration EC2 → Lambda
```

## Coûts estimés (très faible trafic)

| Service | Usage | Coût/mois |
|---------|--------|-----------|
| **Lambda** | ~300 requêtes | $0 (1M gratuit) |
| **API Gateway** | ~300 requêtes | $0.01 |
| **S3 (Frontend)** | Hosting | $0.50 |
| **S3 (Uploads)** | Stockage + GET | $1-2 |
| **S3 (Data)** | db.json | $0 |
| **Total** | | **~3-5€** |

## Comparaison EC2 vs Lambda

| Critère | EC2 | Lambda |
|---------|-----|--------|
| **Coût/mois** | 15€ | 3-5€ |
| **Maintenance** | Manuelle | Zéro |
| **Scaling** | Manuel | Auto |
| **Disponibilité** | 1 instance | Multi-AZ |
| **Idempotence** | Non | Oui |

## Monitoring

**Logs Lambda:**
```bash
aws logs tail /aws/lambda/vanlife-api-prod --follow
```

**Métriques:**
```bash
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Invocations \
  --dimensions Name=FunctionName,Value=vanlife-api-prod \
  --start-time 2024-01-01T00:00:00Z \
  --end-time 2024-01-02T00:00:00Z \
  --period 3600 \
  --statistics Sum
```

## Désactiver EC2 (économiser)

Une fois Lambda déployé :

```bash
# Arrêter l'instance EC2
aws ec2 stop-instances --instance-ids <instance-id>

# OU supprimer complètement
cd infra/terraform
terraform destroy
```

Économie: **~150€/an** 💰

## Rollback vers EC2

Si besoin de revenir à EC2 :

```bash
# 1. Télécharger les données de S3
aws s3 cp s3://vanlife-data-prod/db.json apps/api/data/
aws s3 sync s3://vanlife-uploads-prod apps/api/uploads/

# 2. Redéployer sur EC2
npm run deploy:aws
```

## Support

En cas de problème :
- Vérifier les logs Lambda: `aws logs tail /aws/lambda/vanlife-api-prod --follow`
- Vérifier API Gateway: Console AWS → API Gateway
- Tester l'API: `curl https://<api-gateway-url>/health`
