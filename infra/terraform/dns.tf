# Configuration DNS pour vanlife.galliffet.fr
# À utiliser si le domaine est enregistré chez AWS Route 53

data "aws_route53_zone" "vanlife" {
  name = "galliffet.fr"
}

resource "aws_route53_record" "vanlife" {
  zone_id = data.aws_route53_zone.vanlife.zone_id
  name    = "vanlife.galliffet.fr"
  type    = "A"
  ttl     = 300
  records = [aws_instance.vanlife_app.public_ip]
}

output "vanlife_dns_name" {
  value       = aws_route53_record.vanlife.fqdn
  description = "FQDN de vanlife.galliffet.fr"
}
