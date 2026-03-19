variable "environment" {
  description = "Deployment environment"
  type        = string
}

variable "aws_account_id" {
  description = "AWS account ID (used for globally unique bucket naming)"
  type        = string
}

variable "action_group_lambda_arns" {
  description = "ARNs of Lambda functions used as Bedrock action groups"
  type        = list(string)
  default     = []
}
