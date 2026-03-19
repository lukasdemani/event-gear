# ==============================================================
# Environment: prod
# Purpose: Production environment
# Remote state: s3://eventgear-terraform-state/prod/terraform.tfstate
# CAUTION: Apply with explicit approval. enable_pitr = true.
# ==============================================================

terraform {
  required_version = ">= 1.6.0"

  backend "s3" {
    bucket         = "eventgear-terraform-state"
    key            = "prod/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "eventgear-terraform-locks"
    encrypt        = true
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "us-east-1"

  default_tags {
    tags = {
      Project     = "eventgear"
      Environment = "prod"
      ManagedBy   = "terraform"
    }
  }
}

locals {
  env            = "prod"
  aws_account_id = data.aws_caller_identity.current.account_id
}

data "aws_caller_identity" "current" {}

module "dynamodb" {
  source      = "../../modules/dynamodb"
  environment = local.env
  enable_pitr = true # Always true in prod
}

module "eventbridge" {
  source                 = "../../modules/eventbridge"
  environment            = local.env
  archive_retention_days = 90
}

module "api_gateway" {
  source          = "../../modules/api-gateway"
  environment     = local.env
  allowed_origins = ["https://app.eventgear.io"]
}

# NOTE: Lambda modules for prod follow same pattern as dev
# with production-appropriate memory/timeout settings
