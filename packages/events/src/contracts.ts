/**
 * @file contracts.ts
 * @package @eventgear/events
 * @purpose Typed EventBridge event contracts for all EventGear domains
 *
 * @inputs  n/a — pure type definitions
 * @outputs Event envelope type, payload interfaces, EventName union
 *
 * @ai-notes ALL events published on the EventGear bus must be defined here.
 *   The EventGearEvent<T> envelope wraps every event — never send raw payloads.
 *   EventName is the union of all valid detail-type strings — use it to constrain publish().
 *   Payload types must be kept in sync with CLAUDE.md §5.
 */

// ---------------------------------------------------------------------------
// Event Envelope
// ---------------------------------------------------------------------------

export interface EventDetail<T> {
  readonly eventId: string;        // ULID
  readonly eventVersion: '1.0';
  readonly timestamp: string;      // ISO 8601
  readonly correlationId: string;  // traces a business flow across domains
  readonly payload: T;
}

export interface EventGearEvent<T = unknown> {
  readonly source: string;         // e.g. "eventgear.inventory"
  readonly 'detail-type': string;  // e.g. "inventory.equipment.created"
  readonly detail: EventDetail<T>;
}

// ---------------------------------------------------------------------------
// Inventory Events
// ---------------------------------------------------------------------------

export interface EquipmentCreatedPayload {
  readonly equipmentId: string;
  readonly name: string;
  readonly categoryId: string;
  readonly dailyRate: number;
}

export interface EquipmentUpdatedPayload {
  readonly equipmentId: string;
  readonly name: string;
  readonly categoryId: string;
  readonly dailyRate: number;
  readonly updatedFields: readonly string[];
}

export interface StockUnitAvailabilityChangedPayload {
  readonly unitId: string;
  readonly equipmentId: string;
  readonly previousStatus: string;
  readonly newStatus: string;
  readonly reason: 'RESERVATION' | 'MAINTENANCE' | 'DAMAGE' | 'MANUAL';
  readonly referenceId?: string; // reservationId or maintenanceRecordId
}

export interface MaintenanceScheduledPayload {
  readonly maintenanceRecordId: string;
  readonly unitId: string;
  readonly equipmentId: string;
  readonly scheduledDate: string;
  readonly maintenanceType: string;
}

export interface MaintenanceCompletedPayload {
  readonly maintenanceRecordId: string;
  readonly unitId: string;
  readonly equipmentId: string;
  readonly newCondition: string;
  readonly technicianId: string;
  readonly completedAt: string;
}

// ---------------------------------------------------------------------------
// Reservation Events
// ---------------------------------------------------------------------------

export interface ReservationCreatedPayload {
  readonly reservationId: string;
  readonly customerId: string;
  readonly startDate: string;
  readonly endDate: string;
}

export interface ReservationConfirmedPayload {
  readonly reservationId: string;
  readonly customerId: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly items: ReadonlyArray<{
    readonly reservationItemId: string;
    readonly equipmentId: string;
    readonly unitId: string;
    readonly quantity: number;
  }>;
  readonly totalAmount: number;
}

export interface ReservationCancelledPayload {
  readonly reservationId: string;
  readonly customerId: string;
  readonly cancelledAt: string;
  readonly reason: string;
}

export interface ReservationModifiedPayload {
  readonly reservationId: string;
  readonly customerId: string;
  readonly modifiedAt: string;
  readonly modifiedFields: readonly string[];
}

export interface ConflictDetectedPayload {
  readonly conflictId: string;
  readonly reservationId: string;
  readonly conflictingReservationId: string;
  readonly equipmentId: string;
  readonly overlapStart: string;
  readonly overlapEnd: string;
  readonly severity: 'WARNING' | 'BLOCKING';
}

// ---------------------------------------------------------------------------
// Logistics Events
// ---------------------------------------------------------------------------

export interface DispatchScheduledPayload {
  readonly jobId: string;
  readonly reservationId: string;
  readonly scheduledDate: string;
  readonly items: ReadonlyArray<{ readonly unitId: string }>;
}

export interface DispatchCompletedPayload {
  readonly jobId: string;
  readonly reservationId: string;
  readonly completedAt: string;
  readonly deliveredItems: ReadonlyArray<{
    readonly unitId: string;
    readonly condition: string;
  }>;
  readonly signedOffBy: string;
}

export interface ReturnInitiatedPayload {
  readonly jobId: string;
  readonly reservationId: string;
  readonly initiatedAt: string;
}

export interface ReturnCompletedPayload {
  readonly jobId: string;
  readonly reservationId: string;
  readonly completedAt: string;
  readonly returnedItems: ReadonlyArray<{
    readonly unitId: string;
    readonly condition: string;
  }>;
}

export interface DamageReportedPayload {
  readonly reportId: string;
  readonly unitId: string;
  readonly equipmentId: string;
  readonly reservationId: string;
  readonly severity: 'MINOR' | 'MAJOR' | 'TOTAL_LOSS';
  readonly estimatedRepairCost: number;
  readonly description: string;
  readonly photos: readonly string[]; // S3 presigned URLs
}

// ---------------------------------------------------------------------------
// Billing Events
// ---------------------------------------------------------------------------

export interface QuoteCreatedPayload {
  readonly quoteId: string;
  readonly reservationId: string;
  readonly customerId: string;
  readonly totalAmount: number;
  readonly validUntil: string;
}

export interface QuoteAcceptedPayload {
  readonly quoteId: string;
  readonly reservationId: string;
  readonly customerId: string;
  readonly acceptedAt: string;
}

export interface InvoiceCreatedPayload {
  readonly invoiceId: string;
  readonly reservationId: string;
  readonly customerId: string;
  readonly totalAmount: number;
  readonly dueDate: string;
}

export interface InvoicePaidPayload {
  readonly invoiceId: string;
  readonly reservationId: string;
  readonly customerId: string;
  readonly amount: number;
  readonly paidAt: string;
  readonly paymentMethod: string;
  readonly transactionId: string;
}

export interface InvoiceOverduePayload {
  readonly invoiceId: string;
  readonly reservationId: string;
  readonly customerId: string;
  readonly amount: number;
  readonly dueDate: string;
  readonly daysOverdue: number;
}

// ---------------------------------------------------------------------------
// EventName union — all valid detail-type strings
// ---------------------------------------------------------------------------

export type EventName =
  // Inventory
  | 'inventory.equipment.created'
  | 'inventory.equipment.updated'
  | 'inventory.stockunit.condition-changed'
  | 'inventory.stockunit.availability-changed'
  | 'inventory.maintenance.scheduled'
  | 'inventory.maintenance.completed'
  // Reservations
  | 'reservations.reservation.created'
  | 'reservations.reservation.confirmed'
  | 'reservations.reservation.cancelled'
  | 'reservations.reservation.modified'
  | 'reservations.conflict.detected'
  // Logistics
  | 'logistics.dispatch.scheduled'
  | 'logistics.dispatch.completed'
  | 'logistics.return.initiated'
  | 'logistics.return.completed'
  | 'logistics.damage.reported'
  // Billing
  | 'billing.quote.created'
  | 'billing.quote.accepted'
  | 'billing.invoice.created'
  | 'billing.invoice.sent'
  | 'billing.invoice.paid'
  | 'billing.invoice.overdue';
