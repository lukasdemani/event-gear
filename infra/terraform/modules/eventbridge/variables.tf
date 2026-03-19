variable "environment" {
  description = "Deployment environment"
  type        = string
}

variable "archive_retention_days" {
  description = "Days to retain archived events"
  type        = number
  default     = 30
}
