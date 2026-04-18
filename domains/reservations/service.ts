/**
 * @file service.ts
 * @domain reservations
 * @purpose Reservation lifecycle business logic
 *
 * @ai-notes All public methods return Result<T, AppError>. Never throws.
 *   Repo and events publisher are injected for testability.
 */
import {
  ConflictError,
  InternalError,
  NotFoundError,
  ValidationError,
  err,
  generateId,
  ok,
} from '@eventgear/core';
import type { Result } from '@eventgear/core';
import type { ReservationEventPublisher } from './events.js';
import type { ReservationRepository } from './repository.js';
import { ReservationStatus } from './types.js';
import type {
  AddItemInput,
  CreateDraftReservationInput,
  Reservation,
  ReservationItem,
} from './types.js';

export class ReservationService {
  constructor(
    private readonly repo: ReservationRepository,
    private readonly events: ReservationEventPublisher,
  ) {}

  async createDraftReservation(
    input: CreateDraftReservationInput,
  ): Promise<Result<Reservation>> {
    if (input.endDate <= input.startDate) {
      return err(
        new ValidationError('endDate must be after startDate', [
          { field: 'endDate', message: 'must be after startDate' },
        ]),
      );
    }
    try {
      const now = new Date().toISOString();
      const reservation: Reservation = {
        id: generateId(),
        customerId: input.customerId,
        status: ReservationStatus.DRAFT,
        startDate: input.startDate,
        endDate: input.endDate,
        items: [],
        createdAt: now,
        updatedAt: now,
      };

      await this.repo.saveReservation(reservation);
      await this.events.reservationCreated(reservation);
      return ok(reservation);
    } catch (e) {
      return err(
        new InternalError('Failed to create reservation', {
          cause: String(e),
        }),
      );
    }
  }

  async getReservation(id: string): Promise<Result<Reservation>> {
    const reservation = await this.repo.findReservationById(id);
    if (!reservation) return err(new NotFoundError('Reservation', id));
    return ok(reservation);
  }

  async addItem(
    reservationId: string,
    input: AddItemInput,
  ): Promise<Result<ReservationItem>> {
    const reservation = await this.repo.findReservationById(reservationId);
    if (!reservation) {
      return err(new NotFoundError('Reservation', reservationId));
    }
    if (reservation.status !== ReservationStatus.DRAFT) {
      return err(
        new ConflictError(
          `Cannot add items to a ${reservation.status} reservation — must be DRAFT`,
          { reservationId, currentStatus: reservation.status },
        ),
      );
    }
    const item: ReservationItem = {
      id: generateId(),
      reservationId,
      equipmentId: input.equipmentId,
      unitId: input.unitId,
      quantity: input.quantity,
    };
    await this.repo.saveItem(item);
    return ok(item);
  }

  async confirmReservation(id: string): Promise<Result<Reservation>> {
    const reservation = await this.repo.findReservationById(id);
    if (!reservation) return err(new NotFoundError('Reservation', id));
    if (reservation.status !== ReservationStatus.DRAFT) {
      return err(
        new ConflictError(
          `Cannot confirm a ${reservation.status} reservation — must be DRAFT`,
          { reservationId: id, currentStatus: reservation.status },
        ),
      );
    }
    if (reservation.items.length === 0) {
      return err(
        new ConflictError('Cannot confirm reservation with no items', {
          reservationId: id,
        }),
      );
    }
    const confirmed: Reservation = {
      ...reservation,
      status: ReservationStatus.CONFIRMED,
      updatedAt: new Date().toISOString(),
    };
    await this.repo.saveReservation(confirmed);
    await this.events.reservationConfirmed(confirmed);
    return ok(confirmed);
  }

  async listReservationsByCustomer(
    customerId: string,
  ): Promise<Result<Reservation[]>> {
    const reservations =
      await this.repo.findReservationsByCustomer(customerId);
    return ok(reservations);
  }

  async cancelReservation(
    id: string,
    reason: string,
  ): Promise<Result<Reservation>> {
    const reservation = await this.repo.findReservationById(id);
    if (!reservation) return err(new NotFoundError('Reservation', id));
    if (
      reservation.status === ReservationStatus.CANCELLED ||
      reservation.status === ReservationStatus.COMPLETED
    ) {
      return err(
        new ConflictError(
          `Cannot cancel a ${reservation.status} reservation — already terminal`,
          { reservationId: id, currentStatus: reservation.status },
        ),
      );
    }
    const cancelled: Reservation = {
      ...reservation,
      status: ReservationStatus.CANCELLED,
      updatedAt: new Date().toISOString(),
    };
    await this.repo.saveReservation(cancelled);
    await this.events.reservationCancelled(cancelled, reason);
    return ok(cancelled);
  }

  async removeItem(
    reservationId: string,
    itemId: string,
  ): Promise<Result<void>> {
    const reservation = await this.repo.findReservationById(reservationId);
    if (!reservation) {
      return err(new NotFoundError('Reservation', reservationId));
    }
    if (reservation.status !== ReservationStatus.DRAFT) {
      return err(
        new ConflictError(
          `Cannot remove items from a ${reservation.status} reservation — must be DRAFT`,
          { reservationId, currentStatus: reservation.status },
        ),
      );
    }
    await this.repo.deleteItem(reservationId, itemId);
    return ok(undefined);
  }
}
