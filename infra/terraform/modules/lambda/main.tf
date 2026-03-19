# ==============================================================
# Module: lambda
# Purpose: Reusable Lambda function with IAM role + CloudWatch
# Usage: one module block per Lambda function
# ==============================================================

resource "aws_iam_role" "lambda_role" {
  name = "eventgear-${var.function_name}-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "basic" {
  role       = aws_iam_role.lambda_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "custom" {
  count  = length(var.iam_policy_statements) > 0 ? 1 : 0
  name   = "eventgear-${var.function_name}-policy"
  role   = aws_iam_role.lambda_role.id
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = var.iam_policy_statements
  })
}

resource "aws_cloudwatch_log_group" "lambda_logs" {
  name              = "/aws/lambda/eventgear-${var.function_name}-${var.environment}"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "fn" {
  function_name = "eventgear-${var.function_name}-${var.environment}"
  role          = aws_iam_role.lambda_role.arn
  handler       = var.handler
  runtime       = "nodejs20.x"
  filename      = var.deployment_package_path
  timeout       = var.timeout
  memory_size   = var.memory_size

  environment {
    variables = var.environment_vars
  }

  depends_on = [
    aws_cloudwatch_log_group.lambda_logs,
    aws_iam_role_policy_attachment.basic,
  ]
}
