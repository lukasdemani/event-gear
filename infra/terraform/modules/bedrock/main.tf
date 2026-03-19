# ==============================================================
# Module: bedrock
# Purpose: Bedrock Agent + Knowledge Base for EventGear AI Assistant
# NOTE: Bedrock Agent resources require careful ordering — knowledge base
# must exist before the agent, and the agent before action groups.
# ==============================================================

# S3 bucket for knowledge base source documents
resource "aws_s3_bucket" "kb_sources" {
  bucket = "eventgear-kb-sources-${var.environment}-${var.aws_account_id}"
}

resource "aws_s3_bucket_versioning" "kb_sources" {
  bucket = aws_s3_bucket.kb_sources.id
  versioning_configuration {
    status = "Enabled"
  }
}

# IAM role for Bedrock Knowledge Base
resource "aws_iam_role" "bedrock_kb_role" {
  name = "eventgear-bedrock-kb-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "bedrock.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "bedrock_kb_policy" {
  name = "bedrock-kb-s3-access"
  role = aws_iam_role.bedrock_kb_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:ListBucket"]
        Resource = [
          aws_s3_bucket.kb_sources.arn,
          "${aws_s3_bucket.kb_sources.arn}/*"
        ]
      },
      {
        Effect   = "Allow"
        Action   = ["bedrock:InvokeModel"]
        Resource = "*"
      }
    ]
  })
}

# IAM role for Bedrock Agent
resource "aws_iam_role" "bedrock_agent_role" {
  name = "eventgear-bedrock-agent-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "bedrock.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "bedrock_agent_policy" {
  name = "bedrock-agent-policy"
  role = aws_iam_role.bedrock_agent_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["bedrock:InvokeModel", "bedrock:Retrieve", "bedrock:RetrieveAndGenerate"]
        Resource = "*"
      },
      {
        Effect   = "Allow"
        Action   = ["lambda:InvokeFunction"]
        Resource = var.action_group_lambda_arns
      }
    ]
  })
}
