/**
 * @file guardrails.ts
 * @purpose Input sanitisation: prompt injection detection and offensive content filter
 *
 * @inputs  Raw user message string
 * @outputs { safe: true } | { safe: false; reason: string }
 */
import { Filter } from 'bad-words';

const offensiveFilter = new Filter();

/**
 * Patterns that attempt to override the system prompt or escape the assistant role.
 * Kept as a denylist of known injection vectors.
 */
const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions/i,
  /forget\s+(all\s+)?(previous|prior|above)\s+instructions/i,
  /you\s+are\s+now\s+(?!an?\s+eventgear)/i,
  /disregard\s+(all\s+)?(previous|prior|above)/i,
  /new\s+instructions?\s*:/i,
  /system\s*prompt\s*:/i,
  /\[INST\]/i,
  /<<SYS>>/i,
  /<\|im_start\|>/i,
];

export type GuardrailResult =
  | { safe: true }
  | { safe: false; reason: string };

export function checkInput(message: string): GuardrailResult {
  const trimmed = message.trim();

  if (trimmed.length === 0) {
    return { safe: false, reason: 'Message is empty.' };
  }

  if (trimmed.length > 2000) {
    return { safe: false, reason: 'Message is too long (max 2000 characters).' };
  }

  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { safe: false, reason: 'Message contains disallowed content.' };
    }
  }

  if (offensiveFilter.isProfane(trimmed)) {
    return { safe: false, reason: 'Message contains offensive language.' };
  }

  return { safe: true };
}
