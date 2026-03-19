/**
 * @file publisher.ts
 * @package @eventgear/events
 * @purpose EventBridge publisher — wraps PutEventsCommand with typed event envelope
 *
 * @inputs  EventName (typed union), payload T, optional correlationId
 * @outputs void (fires-and-forgets to EventBridge)
 *
 * @dependencies @aws-sdk/client-eventbridge, @eventgear/core, @eventgear/config
 * @ai-notes ALL EventBridge publishing goes through this class.
 *   PutEvents has a hard limit of 10 entries per call — publishBatch handles chunking.
 *   The source is derived from the event name: "inventory.equipment.created" → "eventgear.inventory"
 *   Event envelope fields (eventId, timestamp, correlationId) are added automatically.
 */
import {
  EventBridgeClient,
  PutEventsCommand,
  type PutEventsRequestEntry,
} from '@aws-sdk/client-eventbridge';
import { generateId, generateCorrelationId } from '@eventgear/core';
import { getConfig } from '@eventgear/config';
import { BUS_NAMES } from './bus-names.js';
import type { EventDetail, EventName } from './contracts.js';

const EVENTBRIDGE_BATCH_LIMIT = 10;

export class EventPublisher {
  private readonly client: EventBridgeClient;

  constructor() {
    const config = getConfig();
    this.client = new EventBridgeClient({ region: config.awsRegion });
  }

  /**
   * Publish a single typed event to the EventGear EventBridge bus.
   *
   * @param eventName  - Must be a valid EventName (see contracts.ts)
   * @param payload    - The typed event payload
   * @param correlationId - Optional. Generated automatically if omitted.
   */
  async publish<T>(
    eventName: EventName,
    payload: T,
    correlationId?: string,
  ): Promise<void> {
    const entry = this.buildEntry(eventName, payload, correlationId);
    await this.client.send(
      new PutEventsCommand({ Entries: [entry] }),
    );
  }

  /**
   * Publish multiple events, automatically batching into chunks of ≤10.
   * All events in a batch share the same correlationId if not provided.
   */
  async publishBatch<T>(
    events: ReadonlyArray<{
      eventName: EventName;
      payload: T;
      correlationId?: string;
    }>,
  ): Promise<void> {
    const entries = events.map(({ eventName, payload, correlationId }) =>
      this.buildEntry(eventName, payload, correlationId),
    );

    for (let i = 0; i < entries.length; i += EVENTBRIDGE_BATCH_LIMIT) {
      const chunk = entries.slice(i, i + EVENTBRIDGE_BATCH_LIMIT);
      await this.client.send(
        new PutEventsCommand({ Entries: chunk }),
      );
    }
  }

  private buildEntry<T>(
    eventName: EventName,
    payload: T,
    correlationId?: string,
  ): PutEventsRequestEntry {
    const detail: EventDetail<T> = {
      eventId: generateId(),
      eventVersion: '1.0',
      timestamp: new Date().toISOString(),
      correlationId: correlationId ?? generateCorrelationId(),
      payload,
    };

    // "inventory.equipment.created" → "eventgear.inventory"
    const domainSegment = eventName.split('.')[0] ?? 'eventgear';
    const source = `eventgear.${domainSegment}`;

    return {
      EventBusName: BUS_NAMES.main,
      Source: source,
      DetailType: eventName,
      Detail: JSON.stringify(detail),
      Time: new Date(),
    };
  }
}
