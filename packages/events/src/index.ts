/**
 * @file index.ts
 * @package @eventgear/events
 * @purpose Public API for the EventBridge eventing package
 *
 * @exports EventBridge publisher, typed event contracts, bus name constants
 *
 * @ai-notes ALL EventBridge events must be defined in contracts.ts before publishing.
 * Never call EventBridge SDK directly from domain code — always use EventPublisher.
 * Event payload types must match the contracts defined in CLAUDE.md §5.
 */

export { EventPublisher } from './publisher.js';
export { BUS_NAMES } from './bus-names.js';
export type {
  EventGearEvent,
  EventDetail,
  EventName,
  // Inventory events
  EquipmentCreatedPayload,
  EquipmentUpdatedPayload,
  StockUnitAvailabilityChangedPayload,
  MaintenanceScheduledPayload,
  MaintenanceCompletedPayload,
  // Reservation events
  ReservationCreatedPayload,
  ReservationConfirmedPayload,
  ReservationCancelledPayload,
  ReservationModifiedPayload,
  ConflictDetectedPayload,
  // Logistics events
  DispatchScheduledPayload,
  DispatchCompletedPayload,
  ReturnInitiatedPayload,
  ReturnCompletedPayload,
  DamageReportedPayload,
  // Billing events
  QuoteCreatedPayload,
  QuoteAcceptedPayload,
  InvoiceCreatedPayload,
  InvoicePaidPayload,
  InvoiceOverduePayload,
} from './contracts.js';
