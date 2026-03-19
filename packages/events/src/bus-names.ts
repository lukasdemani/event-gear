/**
 * @file bus-names.ts
 * @package @eventgear/events
 * @purpose EventBridge bus name constants
 *
 * @inputs  EVENTBRIDGE_BUS_NAME from @eventgear/config
 * @outputs BUS_NAMES object with typed bus name accessors
 *
 * @dependencies @eventgear/config
 * @ai-notes Bus names follow the pattern eventgear-{env}.
 *   All publishers must use BUS_NAMES.main — never hardcode bus names.
 */
import { getConfig } from '@eventgear/config';

export const BUS_NAMES = {
  /** The primary EventGear EventBridge bus — eventgear-{env} */
  get main(): string {
    return getConfig().eventBridgeBusName;
  },
} as const;
