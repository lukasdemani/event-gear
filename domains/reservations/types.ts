/**
 * @file types.ts
 * @domain reservations
 * @purpose Domain entity types, enums, and service input shapes
 *
 * @ai-notes Grows via TDD cycles. Entities are readonly. ULIDs via generateId().
 */
import type { ID, ISODateString, Timestamps } from '@eventgear/core';

export enum ReservationStatus {
  DRAFT = 'DRAFT',
  QUOTED = 'QUOTED',
  CONFIRMED = 'CONFIRMED',
  ACTIVE = 'ACTIVE',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export interface ReservationItem {
  readonly id: ID;
  readonly reservationId: ID;
  readonly equipmentId: ID;
  readonly unitId: ID;
  readonly quantity: number;
}

export interface AddItemInput {
  readonly equipmentId: string;
  readonly unitId: string;
  readonly quantity: number;
}

export interface Reservation extends Timestamps {
  readonly id: ID;
  readonly customerId: ID;
  readonly status: ReservationStatus;
  readonly startDate: ISODateString;
  readonly endDate: ISODateString;
  readonly items: readonly ReservationItem[];
}

export interface CreateDraftReservationInput {
  readonly customerId: string;
  readonly startDate: string;
  readonly endDate: string;
}
