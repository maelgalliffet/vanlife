# Archive des fichiers Lambda (packaging déterministe)
data "archive_file" "lambda_zip" {
  type        = "zip"
  source_dir  = "${path.module}/../apps/api-lambda/dist"
  output_path = "${path.module}/../dist/lambda-api.zip"
  excludes    = [".git"]
}

# Lambda function pour l'API
resource "aws_lambda_function" "api" {
  filename      = data.archive_file.lambda_zip.output_path
  function_name = "${var.project_name}-api-${var.environment}"
  role          = aws_iam_role.lambda_role.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  timeout       = 30
  memory_size   = 512

  source_code_hash = data.archive_file.lambda_zip.output_base64sha256

  environment {
    variables = {
      NODE_ENV                 = var.environment
      DATA_BUCKET              = aws_s3_bucket.data.id
      UPLOADS_BUCKET           = aws_s3_bucket.uploads.id
      CLOUDFRONT_CUSTOM_DOMAIN = var.domain_name
      PUSH_VAPID_PRIVATE_KEY   = var.vapid_private_key
      PUSH_VAPID_SUBJECT       = var.vapid_subject
    }
  }

  tags = {
    Name        = "${var.project_name}-api"
    Environment = var.environment
  }
}

# CloudWatch Log Group
resource "aws_cloudwatch_log_group" "api_logs" {
  name              = "/aws/lambda/${aws_lambda_function.api.function_name}"
  retention_in_days = 7
}
