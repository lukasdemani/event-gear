# ==============================================================
# Module: dynamodb
# Purpose: EventGear single-table DynamoDB with all GSIs
# ==============================================================

resource "aws_dynamodb_table" "main" {
  name         = "eventgear-${var.environment}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "PK"
  range_key    = "SK"

  attribute {
    name = "PK"
    type = "S"
  }

  attribute {
    name = "SK"
    type = "S"
  }

  attribute {
    name = "GSI1PK"
    type = "S"
  }

  attribute {
    name = "GSI1SK"
    type = "S"
  }

  attribute {
    name = "EntityType"
    type = "S"
  }

  attribute {
    name = "CreatedAt"
    type = "S"
  }

  attribute {
    name = "Status"
    type = "S"
  }

  attribute {
    name = "GSI3SK"
    type = "S"
  }

  # GSI1: Reverse lookups (customer→reservations, equipment→reservations, unit→maintenance)
  global_secondary_index {
    name            = "GSI1"
    hash_key        = "GSI1PK"
    range_key       = "GSI1SK"
    projection_type = "ALL"
  }

  # GSI2: List all entities of a type, sorted by creation date
  global_secondary_index {
    name            = "GSI2"
    hash_key        = "EntityType"
    range_key       = "CreatedAt"
    projection_type = "ALL"
  }

  # GSI3: Query by status + secondary sort key (date/ID combinations)
  global_secondary_index {
    name            = "GSI3"
    hash_key        = "Status"
    range_key       = "GSI3SK"
    projection_type = "ALL"
  }

  point_in_time_recovery {
    enabled = var.enable_pitr
  }

  server_side_encryption {
    enabled = true
  }

  tags = {
    Name = "eventgear-${var.environment}"
  }
}
