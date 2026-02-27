output "api_url" {
  description = "API Gateway URL"
  value       = "${aws_api_gateway_stage.api.invoke_url}"
}

output "frontend_bucket" {
  description = "S3 bucket name for frontend"
  value       = aws_s3_bucket.frontend.id
}

output "frontend_url" {
  description = "Frontend website URL"
  value       = "http://${aws_s3_bucket.frontend.bucket}.s3-website.${var.aws_region}.amazonaws.com"
}

output "uploads_bucket" {
  description = "S3 bucket name for uploads"
  value       = aws_s3_bucket.uploads.id
}

output "data_bucket" {
  description = "S3 bucket name for data"
  value       = aws_s3_bucket.data.id
}

output "lambda_function_name" {
  description = "Lambda function name"
  value       = aws_lambda_function.api.function_name
}
