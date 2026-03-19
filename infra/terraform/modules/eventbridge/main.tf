# ==============================================================
# Module: eventbridge
# Purpose: EventBridge custom event bus for EventGear domains
# ==============================================================

resource "aws_cloudwatch_event_bus" "main" {
  name = "eventgear-${var.environment}"
}

# Archive all events for replay / debugging
resource "aws_cloudwatch_event_archive" "main" {
  name             = "eventgear-${var.environment}-archive"
  event_source_arn = aws_cloudwatch_event_bus.main.arn
  retention_days   = var.archive_retention_days
}

# Dead letter queue for failed event deliveries
resource "aws_sqs_queue" "dlq" {
  name                      = "eventgear-events-dlq-${var.environment}"
  message_retention_seconds = 1209600 # 14 days
}
