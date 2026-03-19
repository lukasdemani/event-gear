# ADR-002: AWS Bedrock Agents for AI Orchestration

**Status**: Accepted
**Date**: 2024-01-15
**Deciders**: Platform Team

---

## Context

EventGear needs an AI assistant that can:
- Answer natural language questions about availability ("Do we have 20 stage decks free in August?")
- Generate quotes from conversational input
- Detect and resolve reservation conflicts
- Query equipment documentation (manuals, policies) without hallucinating specifications

The assistant must integrate with real system state — not just language generation. It must call actual Lambda functions to check live DynamoDB data.

## Decision

Use **AWS Bedrock Agents** with:
- **Action Groups** backed by Lambda functions for system interactions
- **Knowledge Bases** (vector store + RAG) for equipment catalog and policy documents
- Claude 3 Sonnet or Amazon Titan as the foundation model

## Consequences

### Positive
- **Stays within AWS** — no external LLM API calls, data never leaves VPC perimeter; important for B2B customers with data residency requirements
- **Structured tool use built-in** — Bedrock Agents handle the ReAct loop, tool invocation, and response synthesis without custom orchestration code
- **RAG managed** — Knowledge Base handles ingestion, chunking, embedding, and retrieval; no vector DB to operate
- **Auditability** — all agent traces logged to CloudWatch; every tool call is inspectable
- **IAM-native auth** — no API keys to manage for the AI layer

### Negative
- **AWS lock-in** — harder to switch foundation models or move to a different provider; Bedrock's model selection is smaller than e.g. OpenAI's
- **Bedrock Agents latency** — cold invocation can take 3-5 seconds; not suitable for real-time autocomplete
- **Terraform support limited** — Bedrock Agent resources have partial Terraform provider coverage; some config may require console or AWS CLI at initial setup
- **Knowledge Base sync is async** — document ingestion jobs take minutes; near-real-time RAG is not possible

### Mitigations
- Agent is used for asynchronous operations (quote generation, availability reports) — 3-5s latency is acceptable
- Knowledge Base synced nightly for equipment catalog; manual trigger on policy changes
- Terraform modules wrap what's supported; `aws_bedrockagent_*` resources used where available

## Alternatives Considered

| Option | Rejected Because |
|---|---|
| OpenAI GPT-4 + LangChain | Data leaves AWS; external API dependency; more custom orchestration code |
| Anthropic API directly | Same data residency concern; Bedrock gives same Claude access within AWS |
| Custom RAG (Lambda + OpenSearch) | More infrastructure to operate; Bedrock KB gives managed embeddings and retrieval |
| No AI layer | Significant competitive disadvantage; availability queries and quote generation are the primary UX differentiators |
