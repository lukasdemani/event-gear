/**
 * @file events.ts
 * @domain reservations
 * @purpose Typed EventBridge publishers for reservation lifecycle events
 *
 * @ai-notes Wraps EventPublisher from @eventgear/events. Payload types imported
 *   from @eventgear/events contracts. Grows via TDD cycles.
 */
import type { EventPublisher } from '@eventgear/events';
import type {
  ReservationCancelledPayload,
  ReservationConfirmedPayload,
  ReservationCreatedPayload,
} from '@eventgear/events';
import type { Reservation } from './types.js';

export class ReservationEventPublisher {
  constructor(private readonly publisher: EventPublisher) {}

  async reservationCreated(
    reservation: Reservation,
    correlationId?: string,
  ): Promise<void> {
    const payload: ReservationCreatedPayload = {
      reservationId: reservation.id,
      customerId: reservation.customerId,
      startDate: reservation.startDate,
      endDate: reservation.endDate,
    };
    await this.publisher.publish(
      'reservations.reservation.created',
      payload,
      correlationId,
    );
  }

  async reservationConfirmed(
    reservation: Reservation,
    correlationId?: string,
  ): Promise<void> {
    const payload: ReservationConfirmedPayload = {
      reservationId: reservation.id,
      customerId: reservation.customerId,
      startDate: reservation.startDate,
      endDate: reservation.endDate,
      items: reservation.items.map((item) => ({
        reservationItemId: item.id,
        equipmentId: item.equipmentId,
        unitId: item.unitId,
        quantity: item.quantity,
      })),
      totalAmount: 0,
    };
    await this.publisher.publish(
      'reservations.reservation.confirmed',
      payload,
      correlationId,
    );
  }

  async reservationCancelled(
    reservation: Reservation,
    reason: string,
    correlationId?: string,
  ): Promise<void> {
    const payload: ReservationCancelledPayload = {
      reservationId: reservation.id,
      customerId: reservation.customerId,
      cancelledAt: reservation.updatedAt,
      reason,
    };
    await this.publisher.publish(
      'reservations.reservation.cancelled',
      payload,
      correlationId,
    );
  }
}
