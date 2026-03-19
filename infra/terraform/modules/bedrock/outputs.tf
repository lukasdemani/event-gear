output "kb_sources_bucket" {
  description = "S3 bucket for knowledge base source documents"
  value       = aws_s3_bucket.kb_sources.bucket
}

output "kb_role_arn" {
  description = "IAM role ARN for Bedrock Knowledge Base"
  value       = aws_iam_role.bedrock_kb_role.arn
}

output "agent_role_arn" {
  description = "IAM role ARN for Bedrock Agent"
  value       = aws_iam_role.bedrock_agent_role.arn
}
