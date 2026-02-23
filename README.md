# Vanlife weekend booking

Application web TypeScript (Front + Back) pour réserver un week-end avec le van familial.

## Fonctionnalités
- Réservation provisoire (plusieurs personnes sur le même week-end)
- Réservation définitive (une seule personne par week-end)
- Identification de la personne à la première visite (popup + liste)
- Texte d'information sur chaque réservation
- Ajout de photos liées à une réservation
- Album global des photos

## Stack
- Front: React + TypeScript + Vite
- Back: Node.js + Express + TypeScript
- Upload: Multer (stockage local)
- Infra: Terraform (AWS EC2 + sécurité réseau)
- CI/CD: GitHub Actions (build + déploiement)

## Démarrage local
```bash
npm install
npm run dev -w apps/api
npm run dev -w apps/web
```

API: `http://localhost:4000`
Web: `http://localhost:5173`

## Déploiement
- Terraform dans `infra/terraform`
- Workflows GitHub Actions dans `.github/workflows`

Variables à configurer dans GitHub Secrets:
- `EC2_HOST`
- `EC2_USER`
- `EC2_SSH_KEY`
- `EC2_APP_PATH`

## Terraform (AWS)
```bash
cd infra/terraform
terraform init
terraform apply -var="key_name=<your-keypair-name>"
```
