variable "function_name" {
  description = "Short function name (e.g., 'inventory', 'reservations'). Prefixed with 'eventgear-'."
  type        = string
}

variable "environment" {
  description = "Deployment environment"
  type        = string
}

variable "handler" {
  description = "Lambda handler (e.g., 'dist/handler.handler')"
  type        = string
  default     = "dist/handler.handler"
}

variable "deployment_package_path" {
  description = "Path to the Lambda deployment ZIP"
  type        = string
}

variable "environment_vars" {
  description = "Environment variables for the Lambda"
  type        = map(string)
  default     = {}
}

variable "iam_policy_statements" {
  description = "Additional IAM policy statements (beyond basic execution)"
  type        = list(any)
  default     = []
}

variable "timeout" {
  description = "Lambda timeout in seconds"
  type        = number
  default     = 30
}

variable "memory_size" {
  description = "Lambda memory in MB"
  type        = number
  default     = 256
}

variable "log_retention_days" {
  description = "CloudWatch log retention in days"
  type        = number
  default     = 14
}
