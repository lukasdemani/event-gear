# SPEC: Reservations Domain — Core Lifecycle

## Status
DRAFT

## Problem Statement
Rental managers need to book equipment for customers over date ranges. Without a reservation system, there is no source of truth for what equipment is committed to whom, from when to when, or at what stage of the booking lifecycle. Every downstream step — dispatch planning, invoicing, availability queries, conflict detection — depends on reservations existing as first-class, lifecycle-aware records.

## Solution Overview
The Reservations domain owns the full booking lifecycle from DRAFT through CONFIRMED/CANCELLED/COMPLETED. This first iteration covers **core lifecycle only**: creating draft reservations, managing line items, and confirming or cancelling. Conflict detection, availability queries, and inventory-event consumption are deferred to subsequent iterations.

## Domain
reservations

## Entities Affected
| Entity | Operation |
|---|---|
| Reservation | Create (DRAFT), Read, Confirm, Cancel, List by customer |
| ReservationItem | Add, Remove, Read (implicit via parent) |

## API Endpoints
Handler wiring is **deferred** to the next iteration. Service methods below are the interfaces that handlers will call.

| Service Method | Description |
|---|---|
| `createDraftReservation(input)` | Create a reservation in DRAFT status |
| `getReservation(id)` | Get a reservation with its items |
| `addItem(reservationId, input)` | Add a ReservationItem (only while DRAFT) |
| `removeItem(reservationId, itemId)` | Remove a ReservationItem (only while DRAFT) |
| `confirmReservation(id)` | Transition DRAFT → CONFIRMED and publish event |
| `cancelReservation(id, reason)` | Transition any non-terminal → CANCELLED and publish event |
| `listReservationsByCustomer(customerId)` | List reservations for a customer |

## Request/Response Shapes

```typescript
interface CreateDraftReservationInput {
  customerId: string;
  startDate: string; // ISO date "YYYY-MM-DD"
  endDate: string;   // ISO date "YYYY-MM-DD"
  notes?: string;
}

interface AddItemInput {
  equipmentId: string;
  unitId: string;
  quantity: number;
}

interface CancelReservationInput {
  reason: string;
}
```

## Business Rules

1. New reservations start in `DRAFT` status
2. Items can only be added or removed while the reservation is `DRAFT`
3. Only `DRAFT` reservations can transition to `CONFIRMED`
4. A reservation cannot be confirmed with zero items
5. Any non-terminal status (`DRAFT`, `QUOTED`, `CONFIRMED`, `ACTIVE`) can transition to `CANCELLED`
6. `CANCELLED` and `COMPLETED` are terminal — no transitions out
7. Confirming a reservation publishes `reservations.reservation.confirmed` with the items snapshot
8. `startDate` must precede `endDate`
9. Each `ReservationItem` binds a specific `unitId` to the reservation (matches existing `ReservationConfirmedPayload` contract)
10. `totalAmount` on the confirmed-event payload is `0` for this iteration (pricing lives in Billing domain, wired in a later iteration)

## DynamoDB Access Patterns Used

- **AP-07**: Get reservation by ID — `PK=RESERVATION#{id}, SK=METADATA`
- **AP-08**: Get all items in reservation — `PK=RESERVATION#{id}, SK begins_with ITEM#`
- **AP-09**: List reservations for customer — `GSI1PK=CUSTOMER#{id}, GSI1SK begins_with RESERVATION#` on GSI1

No new access patterns this iteration. All required `buildKey.reservation.*` and `buildKey.reservationItem.*` helpers already exist in `packages/db/src/schema.ts`.

## Events Published

| Event | Trigger |
|---|---|
| `reservations.reservation.created` | Draft reservation created |
| `reservations.reservation.confirmed` | DRAFT → CONFIRMED transition |
| `reservations.reservation.cancelled` | Transition to CANCELLED |

Payload types are already defined in `packages/events/src/contracts.ts` and are reused unchanged.

## Events Consumed
- `inventory.stockunit.availability-changed` → update availability cache (**deferred**)
- `billing.invoice.paid` → mark reservation as payment-confirmed (**deferred**)

## Error Cases

| Code | Condition | HTTP Status |
|---|---|---|
| NOT_FOUND | Reservation or item not found | 404 |
| INVALID_DATE_RANGE | `endDate` is not strictly after `startDate` | 400 |
| EMPTY_RESERVATION | Attempt to confirm a reservation with no items | 409 |
| INVALID_STATUS_TRANSITION | Add/remove item when not DRAFT, confirm when not DRAFT, cancel when terminal | 409 |
| VALIDATION_ERROR | Missing or malformed input | 400 |

## Test Cases

### createDraftReservation
- [ ] Creates reservation with generated ULID, DRAFT status, empty items, timestamps
- [ ] Publishes `reservations.reservation.created` event
- [ ] Rejects when `endDate <= startDate` with `INVALID_DATE_RANGE`

### getReservation
- [ ] Returns `NotFoundError` for unknown id
- [ ] Returns the reservation with its items

### addItem / removeItem
- [ ] `addItem` appends a new ReservationItem with generated ULID
- [ ] `addItem` rejects when reservation is not DRAFT (`INVALID_STATUS_TRANSITION`)
- [ ] `removeItem` removes the item
- [ ] `removeItem` returns `NotFoundError` when item doesn't exist on that reservation

### confirmReservation
- [ ] Rejects empty reservation with `EMPTY_RESERVATION`
- [ ] DRAFT → CONFIRMED, publishes `reservations.reservation.confirmed` with items snapshot
- [ ] Rejects non-DRAFT with `INVALID_STATUS_TRANSITION`

### cancelReservation
- [ ] Any non-terminal → CANCELLED, publishes `reservations.reservation.cancelled`
- [ ] Rejects terminal statuses (CANCELLED, COMPLETED)

### listReservationsByCustomer
- [ ] Returns reservations for the given customer (via AP-09)

## Out of Scope (Next Iteration)
- Conflict detection + `reservations.conflict.detected` event
- Availability queries across date ranges
- Consumption of `inventory.stockunit.availability-changed`
- `modifyReservation` flow for post-confirmation edits
- `handler.ts` + API Gateway routing
- Pricing integration (`totalAmount` on confirmed event)
- Repository integration tests against DynamoDB Local
