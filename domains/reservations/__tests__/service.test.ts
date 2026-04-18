/**
 * @file service.test.ts
 * @domain reservations
 * @purpose Unit tests for ReservationService — repository and event publisher are mocked
 */
import {
  ReservationService,
  ReservationStatus,
} from '../index';
import type { Reservation, ReservationItem } from '../index';

// ---------------------------------------------------------------------------
// Mock collaborators — grow as TDD cycles demand
// ---------------------------------------------------------------------------

function makeMockRepo() {
  return {
    saveReservation: jest.fn<Promise<void>, [Reservation]>(),
    findReservationById: jest.fn<Promise<Reservation | null>, [string]>(),
    findReservationsByCustomer:
      jest.fn<Promise<Reservation[]>, [string]>(),
    saveItem: jest.fn<Promise<void>, [ReservationItem]>(),
    deleteItem: jest.fn<Promise<void>, [string, string]>(),
  };
}

function makeDraftReservation(
  overrides: Partial<Reservation> = {},
): Reservation {
  return {
    id: 'resv_ABC',
    customerId: 'cust_01',
    status: ReservationStatus.DRAFT,
    startDate: '2026-05-01',
    endDate: '2026-05-05',
    items: [],
    createdAt: '2026-04-18T10:00:00.000Z',
    updatedAt: '2026-04-18T10:00:00.000Z',
    ...overrides,
  };
}

function makeMockEvents() {
  return {
    reservationCreated: jest.fn<Promise<void>, [Reservation]>(),
    reservationConfirmed: jest.fn<Promise<void>, [Reservation]>(),
    reservationCancelled: jest.fn<Promise<void>, [Reservation, string]>(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ReservationService', () => {
  let repo: ReturnType<typeof makeMockRepo>;
  let events: ReturnType<typeof makeMockEvents>;
  let service: ReservationService;

  beforeEach(() => {
    repo = makeMockRepo();
    events = makeMockEvents();
    service = new ReservationService(repo as never, events as never);
  });

  describe('createDraftReservation', () => {
    it('creates a DRAFT reservation, persists it, and publishes created event', async () => {
      const result = await service.createDraftReservation({
        customerId: 'cust_01',
        startDate: '2026-05-01',
        endDate: '2026-05-05',
      });

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.data.id).toMatch(/^[0-9A-HJ-NP-TV-Z]{26}$/);
      expect(result.data.status).toBe(ReservationStatus.DRAFT);
      expect(result.data.customerId).toBe('cust_01');
      expect(result.data.startDate).toBe('2026-05-01');
      expect(result.data.endDate).toBe('2026-05-05');
      expect(result.data.items).toEqual([]);
      expect(result.data.createdAt).toBeDefined();
      expect(result.data.updatedAt).toBeDefined();

      expect(repo.saveReservation).toHaveBeenCalledWith(result.data);
      expect(events.reservationCreated).toHaveBeenCalledWith(result.data);
    });

    it('rejects when endDate is not after startDate', async () => {
      const result = await service.createDraftReservation({
        customerId: 'cust_01',
        startDate: '2026-05-05',
        endDate: '2026-05-05',
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.code).toBe('VALIDATION_ERROR');
      expect(result.error.message).toMatch(/date/i);
      expect(repo.saveReservation).not.toHaveBeenCalled();
      expect(events.reservationCreated).not.toHaveBeenCalled();
    });
  });

  describe('getReservation', () => {
    it('returns NotFoundError when reservation does not exist', async () => {
      repo.findReservationById.mockResolvedValue(null);

      const result = await service.getReservation('resv_UNKNOWN');

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.code).toBe('NOT_FOUND');
      expect(repo.findReservationById).toHaveBeenCalledWith('resv_UNKNOWN');
    });

    it('returns the reservation when it exists', async () => {
      const existing = makeDraftReservation();
      repo.findReservationById.mockResolvedValue(existing);

      const result = await service.getReservation('resv_ABC');

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data).toEqual(existing);
    });
  });

  describe('addItem', () => {
    it('appends a new ReservationItem to a DRAFT reservation', async () => {
      repo.findReservationById.mockResolvedValue(makeDraftReservation());

      const result = await service.addItem('resv_ABC', {
        equipmentId: 'equip_01',
        unitId: 'unit_01',
        quantity: 1,
      });

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.id).toMatch(/^[0-9A-HJ-NP-TV-Z]{26}$/);
      expect(result.data.reservationId).toBe('resv_ABC');
      expect(result.data.equipmentId).toBe('equip_01');
      expect(result.data.unitId).toBe('unit_01');
      expect(result.data.quantity).toBe(1);
      expect(repo.saveItem).toHaveBeenCalledWith(result.data);
    });

    it('rejects when reservation is not DRAFT', async () => {
      repo.findReservationById.mockResolvedValue(
        makeDraftReservation({ status: ReservationStatus.CONFIRMED }),
      );

      const result = await service.addItem('resv_ABC', {
        equipmentId: 'equip_01',
        unitId: 'unit_01',
        quantity: 1,
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.code).toBe('CONFLICT');
      expect(result.error.message).toMatch(/draft/i);
      expect(repo.saveItem).not.toHaveBeenCalled();
    });

    it('returns NotFoundError when reservation does not exist', async () => {
      repo.findReservationById.mockResolvedValue(null);

      const result = await service.addItem('resv_UNKNOWN', {
        equipmentId: 'equip_01',
        unitId: 'unit_01',
        quantity: 1,
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.code).toBe('NOT_FOUND');
    });
  });

  describe('removeItem', () => {
    it('removes an item from a DRAFT reservation', async () => {
      repo.findReservationById.mockResolvedValue(makeDraftReservation());

      const result = await service.removeItem('resv_ABC', 'item_01');

      expect(result.success).toBe(true);
      expect(repo.deleteItem).toHaveBeenCalledWith('resv_ABC', 'item_01');
    });

    it('rejects when reservation is not DRAFT', async () => {
      repo.findReservationById.mockResolvedValue(
        makeDraftReservation({ status: ReservationStatus.CONFIRMED }),
      );

      const result = await service.removeItem('resv_ABC', 'item_01');

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.code).toBe('CONFLICT');
      expect(repo.deleteItem).not.toHaveBeenCalled();
    });
  });

  describe('confirmReservation', () => {
    it('rejects confirmation when reservation has no items', async () => {
      repo.findReservationById.mockResolvedValue(
        makeDraftReservation({ items: [] }),
      );

      const result = await service.confirmReservation('resv_ABC');

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.code).toBe('CONFLICT');
      expect(result.error.message).toMatch(/item/i);
      expect(repo.saveReservation).not.toHaveBeenCalled();
      expect(events.reservationConfirmed).not.toHaveBeenCalled();
    });

    it('transitions DRAFT to CONFIRMED and publishes confirmed event', async () => {
      const item: ReservationItem = {
        id: 'item_01',
        reservationId: 'resv_ABC',
        equipmentId: 'equip_01',
        unitId: 'unit_01',
        quantity: 1,
      };
      repo.findReservationById.mockResolvedValue(
        makeDraftReservation({ items: [item] }),
      );

      const result = await service.confirmReservation('resv_ABC');

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.id).toBe('resv_ABC');
      expect(result.data.status).toBe(ReservationStatus.CONFIRMED);
      expect(result.data.items).toEqual([item]);
      expect(repo.saveReservation).toHaveBeenCalledWith(result.data);
      expect(events.reservationConfirmed).toHaveBeenCalledWith(result.data);
    });

    it('rejects confirmation when reservation is not DRAFT', async () => {
      const item: ReservationItem = {
        id: 'item_01',
        reservationId: 'resv_ABC',
        equipmentId: 'equip_01',
        unitId: 'unit_01',
        quantity: 1,
      };
      repo.findReservationById.mockResolvedValue(
        makeDraftReservation({
          status: ReservationStatus.CONFIRMED,
          items: [item],
        }),
      );

      const result = await service.confirmReservation('resv_ABC');

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.code).toBe('CONFLICT');
      expect(result.error.message).toMatch(/draft/i);
      expect(repo.saveReservation).not.toHaveBeenCalled();
      expect(events.reservationConfirmed).not.toHaveBeenCalled();
    });
  });

  describe('cancelReservation', () => {
    it('transitions a CONFIRMED reservation to CANCELLED and publishes event', async () => {
      repo.findReservationById.mockResolvedValue(
        makeDraftReservation({ status: ReservationStatus.CONFIRMED }),
      );

      const result = await service.cancelReservation(
        'resv_ABC',
        'customer changed their mind',
      );

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.status).toBe(ReservationStatus.CANCELLED);
      expect(repo.saveReservation).toHaveBeenCalledWith(result.data);
      expect(events.reservationCancelled).toHaveBeenCalledWith(
        result.data,
        'customer changed their mind',
      );
    });

    it('rejects cancellation of an already-CANCELLED reservation', async () => {
      repo.findReservationById.mockResolvedValue(
        makeDraftReservation({ status: ReservationStatus.CANCELLED }),
      );

      const result = await service.cancelReservation('resv_ABC', 'anything');

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.code).toBe('CONFLICT');
      expect(repo.saveReservation).not.toHaveBeenCalled();
      expect(events.reservationCancelled).not.toHaveBeenCalled();
    });

    it('rejects cancellation of a COMPLETED reservation', async () => {
      repo.findReservationById.mockResolvedValue(
        makeDraftReservation({ status: ReservationStatus.COMPLETED }),
      );

      const result = await service.cancelReservation('resv_ABC', 'anything');

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.code).toBe('CONFLICT');
      expect(repo.saveReservation).not.toHaveBeenCalled();
      expect(events.reservationCancelled).not.toHaveBeenCalled();
    });
  });

  describe('listReservationsByCustomer', () => {
    it('returns reservations for the given customer', async () => {
      const reservations = [
        makeDraftReservation({ id: 'resv_01' }),
        makeDraftReservation({
          id: 'resv_02',
          status: ReservationStatus.CONFIRMED,
        }),
      ];
      repo.findReservationsByCustomer.mockResolvedValue(reservations);

      const result = await service.listReservationsByCustomer('cust_01');

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data).toEqual(reservations);
      expect(repo.findReservationsByCustomer).toHaveBeenCalledWith('cust_01');
    });
  });
});
