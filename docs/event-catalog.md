# EventBridge Event Catalog

> All events published on the `eventgear-{env}` bus.
> TypeScript interfaces are the source of truth — see `packages/events/src/contracts.ts`.

## Event Envelope (all events)

```typescript
{
  source: "eventgear.{domain}",
  "detail-type": "{domain}.{entity}.{action}",
  detail: {
    eventId: string,       // ULID
    eventVersion: "1.0",
    timestamp: string,     // ISO 8601
    correlationId: string, // traces a business flow
    payload: { ... }       // domain-specific
  }
}
```

---

## Inventory Domain (`source: "eventgear.inventory"`)

| Event | Trigger | Consumers |
|---|---|---|
| `inventory.equipment.created` | New equipment added to catalog | — |
| `inventory.equipment.updated` | Equipment details changed | — |
| `inventory.stockunit.availability-changed` | Unit status changes | Reservations |
| `inventory.maintenance.scheduled` | Maintenance job created | — |
| `inventory.maintenance.completed` | Maintenance job finished | Reservations |

### `inventory.stockunit.availability-changed`
```typescript
{
  unitId: string;
  equipmentId: string;
  previousStatus: "AVAILABLE" | "RESERVED" | "MAINTENANCE" | "RETIRED" | "DISPATCHED";
  newStatus: "AVAILABLE" | "RESERVED" | "MAINTENANCE" | "RETIRED" | "DISPATCHED";
  reason: "RESERVATION" | "MAINTENANCE" | "DAMAGE" | "MANUAL";
  referenceId?: string;
}
```

---

## Reservations Domain (`source: "eventgear.reservations"`)

| Event | Trigger | Consumers |
|---|---|---|
| `reservations.reservation.created` | Reservation first saved as DRAFT | Billing |
| `reservations.reservation.confirmed` | Customer confirms reservation | Inventory, Logistics, Billing |
| `reservations.reservation.cancelled` | Reservation cancelled | Inventory, Logistics, Billing |
| `reservations.reservation.modified` | Items or dates changed | Inventory |
| `reservations.conflict.detected` | Availability conflict found | AI Assistant |

### `reservations.reservation.confirmed`
```typescript
{
  reservationId: string;
  customerId: string;
  startDate: string;  // "YYYY-MM-DD"
  endDate: string;
  items: Array<{
    reservationItemId: string;
    equipmentId: string;
    unitId: string;
    quantity: number;
  }>;
  totalAmount: number;
}
```

---

## Logistics Domain (`source: "eventgear.logistics"`)

| Event | Trigger | Consumers |
|---|---|---|
| `logistics.dispatch.scheduled` | Dispatch job created | — |
| `logistics.dispatch.completed` | Equipment delivered | — |
| `logistics.return.initiated` | Return process started | — |
| `logistics.return.completed` | Equipment back in warehouse | Inventory, Billing |
| `logistics.damage.reported` | Damage found on return | Inventory, Billing |

### `logistics.damage.reported`
```typescript
{
  reportId: string;
  unitId: string;
  equipmentId: string;
  reservationId: string;
  severity: "MINOR" | "MAJOR" | "TOTAL_LOSS";
  estimatedRepairCost: number;
  description: string;
  photos: string[];  // S3 URLs
}
```

---

## Billing Domain (`source: "eventgear.billing"`)

| Event | Trigger | Consumers |
|---|---|---|
| `billing.quote.created` | Quote generated | — |
| `billing.quote.accepted` | Customer accepts quote | Reservations |
| `billing.invoice.created` | Invoice generated | — |
| `billing.invoice.sent` | Invoice emailed to customer | — |
| `billing.invoice.paid` | Payment received | Reservations |
| `billing.invoice.overdue` | Payment past due date | — |

### `billing.invoice.paid`
```typescript
{
  invoiceId: string;
  reservationId: string;
  customerId: string;
  amount: number;
  paidAt: string;
  paymentMethod: string;
  transactionId: string;
}
```

---

## Adding a New Event

1. Define TypeScript interface in `packages/events/src/contracts.ts`
2. Export from `packages/events/src/index.ts`
3. Add row to this catalog
4. Document in the domain's `SPEC.md`
5. Implement using `EventPublisher` from `@eventgear/events`
