/**
 * @file types.ts
 * @package @eventgear/ai
 * @purpose Type definitions for Bedrock Agent invocations and RAG queries
 *
 * @ai-notes AgentQuery/AgentResponse wrap Bedrock Agent Runtime calls.
 *   RAGQuery/RAGResult wrap Knowledge Base retrieve calls.
 *   documentType metadata filter values must match those set during KB ingestion.
 */

// ---------------------------------------------------------------------------
// Agent Client Types
// ---------------------------------------------------------------------------

export interface AgentQuery {
  /** Session ID — maintains conversation context across turns */
  readonly sessionId: string;
  /** User input text */
  readonly input: string;
  /** Optional correlation ID for tracing across the platform */
  readonly correlationId?: string;
}

export interface AgentResponse {
  /** Session ID — echo back for client tracking */
  readonly sessionId: string;
  /** Final assembled text response from the agent */
  readonly text: string;
  /** Whether the agent used action groups to answer */
  readonly usedActionGroups: boolean;
  /** Trace info for debugging (only populated when trace is enabled) */
  readonly traces?: readonly AgentTrace[];
}

export interface AgentTrace {
  readonly traceId: string;
  readonly type: 'ORCHESTRATION' | 'PRE_PROCESSING' | 'POST_PROCESSING' | 'GUARDRAIL';
  readonly text: string;
}

// ---------------------------------------------------------------------------
// Knowledge Base / RAG Types
// ---------------------------------------------------------------------------

export type DocumentType = 'catalog' | 'policy' | 'manual' | 'guide';

export interface RAGQuery {
  /** The natural language query to retrieve relevant chunks for */
  readonly query: string;
  /** Filter by document type for more focused retrieval */
  readonly documentType?: DocumentType;
  /** Max number of results to return (default: 5) */
  readonly numberOfResults?: number;
}

export interface RAGResult {
  /** Retrieved text chunk */
  readonly content: string;
  /** Source document S3 location */
  readonly sourceUri: string;
  /** Relevance score (0–1, higher is better) */
  readonly score: number;
  /** Document metadata (type, title, etc.) */
  readonly metadata: Record<string, string>;
}
