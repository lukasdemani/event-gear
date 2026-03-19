/**
 * @file knowledge-base.ts
 * @package @eventgear/ai
 * @purpose Bedrock Knowledge Base client — RAG retrieval for EventGear documents
 *
 * @inputs  RAGQuery with natural language query and optional documentType filter
 * @outputs RAGResult[] with content chunks, source URIs, and relevance scores
 *
 * @dependencies @aws-sdk/client-bedrock-agent-runtime, @eventgear/config
 * @ai-notes Knowledge base contains: equipment catalog, rental policies, maintenance docs, event guides.
 *   documentType metadata filter narrows results: 'catalog' | 'policy' | 'manual' | 'guide'
 *   Default numberOfResults is 5; max is 100 per Bedrock limits.
 *   BEDROCK_KNOWLEDGE_BASE_ID must be set in config (from Terraform outputs).
 */
import {
  BedrockAgentRuntimeClient,
  RetrieveCommand,
} from '@aws-sdk/client-bedrock-agent-runtime';
import { getConfig } from '@eventgear/config';
import type { RAGQuery, RAGResult } from './types.js';

const DEFAULT_RESULTS = 5;

export class KnowledgeBaseClient {
  private readonly client: BedrockAgentRuntimeClient;

  constructor() {
    const config = getConfig();
    this.client = new BedrockAgentRuntimeClient({ region: config.bedrockRegion });
  }

  /**
   * Retrieve relevant document chunks from the Bedrock Knowledge Base.
   * Uses vector similarity search (cosine) with optional metadata filtering.
   */
  async retrieve(query: RAGQuery): Promise<RAGResult[]> {
    const config = getConfig();

    if (!config.bedrockKnowledgeBaseId) {
      throw new Error('BEDROCK_KNOWLEDGE_BASE_ID must be configured');
    }

    const numberOfResults = query.numberOfResults ?? DEFAULT_RESULTS;

    const response = await this.client.send(
      new RetrieveCommand({
        knowledgeBaseId: config.bedrockKnowledgeBaseId,
        retrievalQuery: { text: query.query },
        retrievalConfiguration: {
          vectorSearchConfiguration: {
            numberOfResults,
            ...(query.documentType
              ? {
                  filter: {
                    equals: {
                      key: 'documentType',
                      value: query.documentType,
                    },
                  },
                }
              : {}),
          },
        },
      }),
    );

    const results = response.retrievalResults ?? [];

    return results.map((result): RAGResult => {
      const content = result.content?.text ?? '';
      const sourceUri =
        result.location?.s3Location?.uri ??
        result.location?.webLocation?.url ??
        '';
      const score = result.score ?? 0;

      const metadata: Record<string, string> = {};
      if (result.metadata) {
        for (const [key, value] of Object.entries(result.metadata)) {
          if (typeof value === 'string') {
            metadata[key] = value;
          } else {
            metadata[key] = String(value);
          }
        }
      }

      return { content, sourceUri, score, metadata };
    });
  }
}
