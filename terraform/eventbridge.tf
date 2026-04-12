# EventBridge rules for checking ended bookings around 08:00 Europe/Paris local time.
# 07:00 UTC matches winter time (CET), 06:00 UTC matches summer time (CEST).
resource "aws_cloudwatch_event_rule" "check_ended_bookings_winter" {
  name                = "${var.project_name}-check-ended-bookings-winter-${var.environment}"
  description         = "Trigger ended bookings check at 07:00 UTC (08:00 CET)"
  schedule_expression = "cron(0 7 * * ? *)"

  tags = {
    Name        = "${var.project_name}-check-ended-bookings-winter"
    Environment = var.environment
  }
}

resource "aws_cloudwatch_event_rule" "check_ended_bookings_summer" {
  name                = "${var.project_name}-check-ended-bookings-summer-${var.environment}"
  description         = "Trigger ended bookings check at 06:00 UTC (08:00 CEST)"
  schedule_expression = "cron(0 6 * * ? *)"

  tags = {
    Name        = "${var.project_name}-check-ended-bookings-summer"
    Environment = var.environment
  }
}

# API destination for HTTP endpoint
resource "aws_cloudwatch_event_connection" "api_connection" {
  name               = "${var.project_name}-api-connection-${var.environment}"
  description        = "Connection to Vanlife API"
  authorization_type = "API_KEY"

  auth_parameters {
    api_key {
      key   = "x-eventbridge-key"
      value = var.eventbridge_api_key
    }
  }
}

resource "aws_cloudwatch_event_api_destination" "check_ended_bookings" {
  name                             = "${var.project_name}-check-ended-bookings-${var.environment}"
  description                      = "API destination for checking ended bookings"
  http_method                      = "GET"
  invocation_endpoint              = "${aws_api_gateway_stage.api.invoke_url}/internal/check-ended-bookings"
  invocation_rate_limit_per_second = 10
  connection_arn                   = aws_cloudwatch_event_connection.api_connection.arn
}

# EventBridge target - invoke API destination
resource "aws_cloudwatch_event_target" "check_ended_bookings_winter" {
  rule      = aws_cloudwatch_event_rule.check_ended_bookings_winter.name
  target_id = "CheckEndedBookingsAPIWinter"
  arn       = aws_cloudwatch_event_api_destination.check_ended_bookings.arn
  role_arn  = aws_iam_role.eventbridge_api_role.arn

  http_target {
    path_parameter_values = []
    query_string_parameters = {
      source = "eventbridge"
    }
    header_parameters = {
      "x-eventbridge-key" = var.eventbridge_api_key
    }
  }
}

resource "aws_cloudwatch_event_target" "check_ended_bookings_summer" {
  rule      = aws_cloudwatch_event_rule.check_ended_bookings_summer.name
  target_id = "CheckEndedBookingsAPISummer"
  arn       = aws_cloudwatch_event_api_destination.check_ended_bookings.arn
  role_arn  = aws_iam_role.eventbridge_api_role.arn

  http_target {
    path_parameter_values = []
    query_string_parameters = {
      source = "eventbridge"
    }
    header_parameters = {
      "x-eventbridge-key" = var.eventbridge_api_key
    }
  }
}

# IAM role for EventBridge to invoke API
resource "aws_iam_role" "eventbridge_api_role" {
  name = "${var.project_name}-eventbridge-api-role-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "events.amazonaws.com"
        }
      }
    ]
  })

  tags = {
    Name        = "${var.project_name}-eventbridge-api-role"
    Environment = var.environment
  }
}

# IAM policy for EventBridge to invoke connections
resource "aws_iam_role_policy" "eventbridge_api_policy" {
  name = "${var.project_name}-eventbridge-api-policy-${var.environment}"
  role = aws_iam_role.eventbridge_api_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "events:InvokeApiDestination"
        ]
        Resource = "*"
      }
    ]
  })
}

