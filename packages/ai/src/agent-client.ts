/**
 * @file agent-client.ts
 * @package @eventgear/ai
 * @purpose Bedrock Agent Runtime client — invoke the EventGear AI assistant
 *
 * @inputs  sessionId (conversation thread), input text
 * @outputs AgentResponse with assembled text, action group usage flag, optional traces
 *
 * @dependencies @aws-sdk/client-bedrock-agent-runtime, @eventgear/config
 * @ai-notes The agent streams response chunks — this client assembles them into full text.
 *   BEDROCK_AGENT_ID and BEDROCK_AGENT_ALIAS_ID must be set in config (from Terraform outputs).
 *   Sessions maintain conversation context — use the same sessionId across turns.
 *   Traces are only populated when BEDROCK_TRACE_ENABLED env is set (for debugging).
 */
import {
  BedrockAgentRuntimeClient,
  InvokeAgentCommand,
} from '@aws-sdk/client-bedrock-agent-runtime';
import { getConfig } from '@eventgear/config';
import type { AgentResponse, AgentTrace } from './types.js';

export class BedrockAgentClient {
  private readonly client: BedrockAgentRuntimeClient;

  constructor() {
    const config = getConfig();
    this.client = new BedrockAgentRuntimeClient({ region: config.bedrockRegion });
  }

  /**
   * Invoke the Bedrock Agent and return the assembled text response.
   * Streams chunks internally and assembles into a single string.
   *
   * @throws InternalError if agent ID or alias is not configured
   */
  async invoke(sessionId: string, input: string): Promise<AgentResponse> {
    const config = getConfig();

    if (!config.bedrockAgentId || !config.bedrockAgentAliasId) {
      throw new Error(
        'BEDROCK_AGENT_ID and BEDROCK_AGENT_ALIAS_ID must be configured',
      );
    }

    const response = await this.client.send(
      new InvokeAgentCommand({
        agentId: config.bedrockAgentId,
        agentAliasId: config.bedrockAgentAliasId,
        sessionId,
        inputText: input,
      }),
    );

    let fullText = '';
    let usedActionGroups = false;
    const traces: AgentTrace[] = [];
    const decoder = new TextDecoder('utf-8');

    if (response.completion) {
      for await (const event of response.completion) {
        if (event.chunk?.bytes) {
          fullText += decoder.decode(event.chunk.bytes);
        }

        if (event.trace?.trace?.orchestrationTrace) {
          usedActionGroups = true;
          const traceObj = event.trace.trace.orchestrationTrace;

          // Collect trace info when available
          if (traceObj.modelInvocationInput?.traceId) {
            traces.push({
              traceId: traceObj.modelInvocationInput.traceId,
              type: 'ORCHESTRATION',
              text: JSON.stringify(traceObj),
            });
          }
        }
      }
    }

    return {
      sessionId,
      text: fullText,
      usedActionGroups,
      ...(traces.length > 0 ? { traces } : {}),
    };
  }
}
