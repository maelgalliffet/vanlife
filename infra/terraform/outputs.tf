output "public_ip" {
  value = aws_instance.vanlife_app.public_ip
}

output "public_dns" {
  value = aws_instance.vanlife_app.public_dns
}
