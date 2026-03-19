output "api_id" {
  description = "API Gateway ID"
  value       = aws_apigatewayv2_api.main.id
}

output "api_endpoint" {
  description = "API Gateway endpoint URL"
  value       = aws_apigatewayv2_api.main.api_endpoint
}

output "execution_arn" {
  description = "API Gateway execution ARN (for Lambda permissions)"
  value       = aws_apigatewayv2_api.main.execution_arn
}
