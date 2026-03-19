/**
 * @file index.ts
 * @package @eventgear/ai
 * @purpose Public API for Bedrock Agent + RAG utilities
 *
 * @exports BedrockAgentClient, KnowledgeBaseClient, action group utilities
 *
 * @ai-notes This package wraps AWS Bedrock Agent Runtime.
 * The Bedrock Agent is configured in Terraform (infra/terraform/modules/bedrock/).
 * Action groups are Lambda functions — their schemas must match the agent's OpenAPI spec.
 */

export { BedrockAgentClient } from './agent-client.js';
export { KnowledgeBaseClient } from './knowledge-base.js';
export type {
  AgentQuery,
  AgentResponse,
  RAGQuery,
  RAGResult,
} from './types.js';
