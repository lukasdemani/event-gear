# ==============================================================
# Environment: dev
# Purpose: Development environment — wires all modules together
# Remote state: s3://eventgear-terraform-state/dev/terraform.tfstate
# ==============================================================

terraform {
  required_version = ">= 1.6.0"

  backend "s3" {
    bucket         = "eventgear-terraform-state"
    key            = "dev/terraform.tfstate"
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
      Environment = "dev"
      ManagedBy   = "terraform"
    }
  }
}

locals {
  env            = "dev"
  aws_account_id = data.aws_caller_identity.current.account_id
}

data "aws_caller_identity" "current" {}

# ── DynamoDB ──────────────────────────────────────────────────
module "dynamodb" {
  source      = "../../modules/dynamodb"
  environment = local.env
  enable_pitr = false
}

# ── EventBridge ───────────────────────────────────────────────
module "eventbridge" {
  source                 = "../../modules/eventbridge"
  environment            = local.env
  archive_retention_days = 7
}

# ── API Gateway ───────────────────────────────────────────────
module "api_gateway" {
  source          = "../../modules/api-gateway"
  environment     = local.env
  allowed_origins = ["http://localhost:5173", "https://dev.eventgear.internal"]
}

# ── Lambda: Inventory ─────────────────────────────────────────
module "lambda_inventory" {
  source                  = "../../modules/lambda"
  function_name           = "inventory"
  environment             = local.env
  deployment_package_path = "../../../domains/inventory/dist/inventory.zip"

  environment_vars = {
    DYNAMODB_TABLE_NAME    = module.dynamodb.table_name
    EVENTBRIDGE_BUS_NAME   = module.eventbridge.bus_name
    NODE_ENV               = "production"
    LOG_LEVEL              = "debug"
  }

  iam_policy_statements = [
    {
      Effect   = "Allow"
      Action   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:Query", "dynamodb:Scan"]
      Resource = [module.dynamodb.table_arn, "${module.dynamodb.table_arn}/index/*"]
    },
    {
      Effect   = "Allow"
      Action   = ["events:PutEvents"]
      Resource = module.eventbridge.bus_arn
    }
  ]
}

# ── Lambda: Reservations ──────────────────────────────────────
module "lambda_reservations" {
  source                  = "../../modules/lambda"
  function_name           = "reservations"
  environment             = local.env
  deployment_package_path = "../../../domains/reservations/dist/reservations.zip"

  environment_vars = {
    DYNAMODB_TABLE_NAME  = module.dynamodb.table_name
    EVENTBRIDGE_BUS_NAME = module.eventbridge.bus_name
    NODE_ENV             = "production"
    LOG_LEVEL            = "debug"
  }

  iam_policy_statements = [
    {
      Effect   = "Allow"
      Action   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:Query"]
      Resource = [module.dynamodb.table_arn, "${module.dynamodb.table_arn}/index/*"]
    },
    {
      Effect   = "Allow"
      Action   = ["events:PutEvents"]
      Resource = module.eventbridge.bus_arn
    }
  ]
}

# ── Bedrock (AI) ──────────────────────────────────────────────
module "bedrock" {
  source         = "../../modules/bedrock"
  environment    = local.env
  aws_account_id = local.aws_account_id
  action_group_lambda_arns = [
    module.lambda_inventory.function_arn,
    module.lambda_reservations.function_arn,
  ]
}

# ── Outputs ───────────────────────────────────────────────────
output "api_endpoint" {
  value = module.api_gateway.api_endpoint
}

output "dynamodb_table_name" {
  value = module.dynamodb.table_name
}

output "eventbridge_bus_name" {
  value = module.eventbridge.bus_name
}
