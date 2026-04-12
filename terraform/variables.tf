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

variable "eventbridge_api_key" {
  description = "API key for EventBridge to call internal endpoints"
  type        = string
  default     = ""
  sensitive   = true
}

variable "push_vapid_public_key" {
  description = "VAPID public key for push notifications"
  type        = string
  default     = ""
  sensitive   = true
}

variable "push_vapid_private_key" {
  description = "VAPID private key for push notifications"
  type        = string
  default     = ""
  sensitive   = true
}

variable "vapid_private_key" {
  description = "[DEPRECATED] Legacy VAPID private key. Prefer push_vapid_private_key"
  type        = string
  default     = ""
  sensitive   = true
}

variable "push_vapid_subject" {
  description = "VAPID subject for push notifications"
  type        = string
  default     = ""
}
