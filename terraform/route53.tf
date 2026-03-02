# Route 53 Zone pour galliffet.fr
data "aws_route53_zone" "galliffet" {
  name = "galliffet.fr"
}

# API Gateway CNAME records supprimés - utiliser l'URL d'API Gateway directement dans le frontend
