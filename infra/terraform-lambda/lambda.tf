# Lambda function pour l'API
resource "aws_lambda_function" "api" {
  filename      = "${path.module}/../../dist/lambda-api.zip"
  function_name = "${var.project_name}-api-${var.environment}"
  role          = aws_iam_role.lambda_role.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  timeout       = 30
  memory_size   = 512

  source_code_hash = fileexists("${path.module}/../../dist/lambda-api.zip") ? filebase64sha256("${path.module}/../../dist/lambda-api.zip") : ""

  environment {
    variables = {
      NODE_ENV        = var.environment
      DATA_BUCKET     = aws_s3_bucket.data.id
      UPLOADS_BUCKET  = aws_s3_bucket.uploads.id
      UPLOADS_BASE_URL = "https://${aws_s3_bucket.uploads.bucket}.s3.${var.aws_region}.amazonaws.com"
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
