terraform {
  backend "s3" {
    bucket         = "vanlife-terraform-state"
    key            = "lambda/terraform.tfstate"
    region         = "eu-west-3"
    encrypt        = true
    dynamodb_table = "terraform-locks"
  }
}
