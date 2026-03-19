# ADR-003: Event-Driven Architecture Between Bounded Contexts

**Status**: Accepted
**Date**: 2024-01-15
**Deciders**: Platform Team

---

## Context

EventGear is modeled as five bounded contexts (Inventory, Reservations, Logistics, Billing, AI Assistant). These contexts need to coordinate — for example, confirming a reservation must trigger dispatch planning and invoice generation — but they must remain independently deployable and testable.

Two options exist:
1. **Synchronous direct calls** — Reservations Lambda calls Billing Lambda via HTTP or SDK
2. **Asynchronous events** — Reservations publishes an event; Billing consumes it

## Decision

**No direct cross-domain calls.** All coordination between bounded contexts happens via **EventBridge events** using a shared custom bus (`eventgear-{env}`).

Rules:
- Each domain owns its data — no domain reads another domain's DynamoDB records
- Each domain publishes typed events when its state changes
- Consumers subscribe to events they care about — no knowledge of the publisher's internals
- Event contracts are versioned (`eventVersion: "1.0"`) and defined in `packages/events/src/contracts.ts`

## Consequences

### Positive
- **Independent deployability** — each domain Lambda can be deployed without touching others; no deployment ordering
- **Resilience** — if Billing Lambda is down, reservations still confirm; events queue in EventBridge until Billing recovers
- **Testability** — each domain is unit testable in isolation; only assert that the right events were published
- **Auditability** — EventBridge archive contains complete event history; full audit trail of all state changes
- **Loose coupling** — adding a new consumer (e.g., a notifications service) requires zero changes to the publisher

### Negative
- **Eventual consistency** — after a reservation is confirmed, the invoice appears seconds later, not instantly; UI must handle this gracefully
- **Harder debugging** — tracing a flow across multiple services requires correlation IDs and CloudWatch Logs Insights queries
- **Event schema evolution** — changing an event payload requires coordination and versioning; breaking changes affect all consumers

### Mitigations
- `correlationId` field in every event envelope — enables distributed tracing across the entire flow
- EventBridge archive enabled in all environments — events can be replayed for debugging or recovery
- TypeScript types in `packages/events/src/contracts.ts` — schema changes surface as compile errors in consuming domains
- Event versioning (`eventVersion: "1.0"`) — allows additive changes without breaking consumers; breaking changes bump the version

## Event Flow Example: Reservation Confirmation

```
User confirms reservation
        │
        ▼
Reservations Lambda
  ├─ Writes RESERVATION to DynamoDB
  └─ Publishes: reservations.reservation.confirmed
              │
              ├──► Inventory Lambda (consumer)
              │      └─ Marks StockUnits as RESERVED
              │
              ├──► Logistics Lambda (consumer)
              │      └─ Creates DispatchJob
              │
              └──► Billing Lambda (consumer)
                     └─ Creates Invoice
```

All three consumers operate independently. If any fails, EventBridge retries with exponential backoff. A DLQ captures events that exhaust retries for manual inspection.

## Alternatives Considered

| Option | Rejected Because |
|---|---|
| Synchronous HTTP calls between Lambdas | Tight coupling; cascading failures; harder testing; deployment ordering required |
| AWS Step Functions for orchestration | Good for sequential workflows, but creates a centralized orchestrator that knows about all domains — violates bounded context independence |
| SQS point-to-point queues | Less flexible than EventBridge fan-out; can't add new consumers without modifying producers; no built-in archive/replay |
| Shared DynamoDB reads across domains | Breaks bounded context ownership; tight coupling to another domain's schema |
