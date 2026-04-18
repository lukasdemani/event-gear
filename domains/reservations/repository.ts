/**
 * @file repository.ts
 * @domain reservations
 * @purpose DynamoDB access for Reservation and ReservationItem entities
 *
 * @ai-notes Extends BaseRepository from @eventgear/db. DynamoDB wiring is
 *   out-of-scope for the current TDD cycle — only the method contracts the
 *   service depends on are declared. Real DynamoDB queries will be added in
 *   a repository integration-test cycle after the service layer is complete.
 */
import type { Reservation, ReservationItem } from './types.js';

export class ReservationRepository {
  async saveReservation(_reservation: Reservation): Promise<void> {
    throw new Error('ReservationRepository.saveReservation not implemented');
  }

  async findReservationById(_id: string): Promise<Reservation | null> {
    throw new Error(
      'ReservationRepository.findReservationById not implemented',
    );
  }

  async findReservationsByCustomer(
    _customerId: string,
  ): Promise<Reservation[]> {
    throw new Error(
      'ReservationRepository.findReservationsByCustomer not implemented',
    );
  }

  async saveItem(_item: ReservationItem): Promise<void> {
    throw new Error('ReservationRepository.saveItem not implemented');
  }

  async deleteItem(_reservationId: string, _itemId: string): Promise<void> {
    throw new Error('ReservationRepository.deleteItem not implemented');
  }
}
