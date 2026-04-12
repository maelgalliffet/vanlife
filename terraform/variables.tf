variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "eu-west-3"
}

variable "project_name" {
  description = "Project name"
  type        = string
  default     = "vanlife"
}

variable "environment" {
  description = "Environment (dev, prod)"
  type        = string
  default     = "prod"
}

variable "domain_name" {
  description = "Domain name for the application"
  type        = string
  default     = "vanlife.galliffet.fr"
}

variable "vapid_private_key" {
  description = "Clé privée VAPID pour les notifications push (générer avec npx web-push generate-vapid-keys)"
  type        = string
  sensitive   = true
}

variable "vapid_subject" {
  description = "Subject VAPID (mailto: ou URL du site)"
  type        = string
  default     = "mailto:contact@vanlife.galliffet.fr"
}
