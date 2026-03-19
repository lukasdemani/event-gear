output "function_arn" {
  description = "Lambda function ARN"
  value       = aws_lambda_function.fn.arn
}

output "function_name" {
  description = "Lambda function name"
  value       = aws_lambda_function.fn.function_name
}

output "invoke_arn" {
  description = "Lambda invoke ARN (used by API Gateway)"
  value       = aws_lambda_function.fn.invoke_arn
}

output "role_arn" {
  description = "IAM role ARN"
  value       = aws_iam_role.lambda_role.arn
}
