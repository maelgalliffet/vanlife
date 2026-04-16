terraform {
  required_version = "~> 1.14.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.40, < 6.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.4"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# Provider pour us-east-1 (requis pour les certificats CloudFront)
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
}
