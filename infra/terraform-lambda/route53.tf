# Route 53 Zone pour galliffet.fr
data "aws_route53_zone" "galliffet" {
  name = "galliffet.fr"
}

# Extraire le domaine d'API Gateway (without protocol and path)
locals {
  api_domain = replace(
    replace(aws_api_gateway_stage.api.invoke_url, "https://", ""),
    "/prod",
    ""
  )
}

# DNS CNAME vers API Gateway
resource "aws_route53_record" "api_gateway" {
  zone_id = data.aws_route53_zone.galliffet.zone_id
  name    = "api.${var.domain_name}"
  type    = "CNAME"
  ttl     = 300
  records = [local.api_domain]

  depends_on = [aws_api_gateway_stage.api]
}

# Optionnel: CNAME pour www.api
resource "aws_route53_record" "api_gateway_www" {
  zone_id = data.aws_route53_zone.galliffet.zone_id
  name    = "www.api.${var.domain_name}"
  type    = "CNAME"
  ttl     = 300
  records = [local.api_domain]

  depends_on = [aws_api_gateway_stage.api]
}
