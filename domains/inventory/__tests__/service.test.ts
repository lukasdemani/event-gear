/**
 * @file service.test.ts
 * @domain inventory
 * @purpose Unit tests for InventoryService — repository and event publisher are mocked
 *
 * @ai-notes Mock the repository with jest.fn() stubs — never mock DynamoDB SDK directly.
 *   Mock the InventoryEventPublisher similarly.
 *   Tests verify: happy paths, NotFoundError cases, invalid status transitions.
 */
import {
  InventoryService,
  EquipmentCondition,
  MaintenanceStatus,
  MaintenanceType,
  StockUnitStatus,
} from '../index';
import type {
  Category,
  Equipment,
  MaintenanceRecord,
  StockUnit,
} from '../index';

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function makeEquipment(overrides: Partial<Equipment> = {}): Equipment {
  const now = new Date().toISOString();
  return {
    id: 'equip_TEST01',
    name: 'Test Stage Deck',
    categoryId: 'cat_STAGE',
    dailyRate: 150,
    isActive: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeStockUnit(overrides: Partial<StockUnit> = {}): StockUnit {
  const now = new Date().toISOString();
  return {
    id: 'unit_TEST01',
    equipmentId: 'equip_TEST01',
    serialNumber: 'STG-2024-001',
    condition: EquipmentCondition.EXCELLENT,
    status: StockUnitStatus.AVAILABLE,
    purchaseDate: '2024-01-01',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeCategory(overrides: Partial<Category> = {}): Category {
  const now = new Date().toISOString();
  return {
    id: 'cat_STAGE',
    name: 'Stages & Risers',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeMaintenanceRecord(
  overrides: Partial<MaintenanceRecord> = {},
): MaintenanceRecord {
  const now = new Date().toISOString();
  return {
    id: 'maint_TEST01',
    equipmentId: 'equip_TEST01',
    unitId: 'unit_TEST01',
    maintenanceType: MaintenanceType.INSPECTION,
    status: MaintenanceStatus.SCHEDULED,
    scheduledDate: '2024-08-01',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock setup
// ---------------------------------------------------------------------------

function makeMockRepo() {
  return {
    findEquipmentById: jest.fn<Promise<Equipment | null>, [string]>(),
    findEquipmentByCategory: jest.fn(),
    listAllEquipment: jest.fn(),
    listCategories: jest.fn<Promise<Category[]>, []>(),
    findStockUnitsByEquipment: jest.fn(),
    findStockUnitById: jest.fn<Promise<StockUnit | null>, [string]>(),
    findAvailableUnitsByEquipment: jest.fn(),
    findMaintenanceHistory: jest.fn(),
    findMaintenanceRecordById: jest.fn<Promise<MaintenanceRecord | null>, [string]>(),
    saveEquipment: jest.fn<Promise<void>, [Equipment]>(),
    saveCategory: jest.fn<Promise<void>, [Category]>(),
    saveStockUnit: jest.fn<Promise<void>, [StockUnit]>(),
    saveMaintenanceRecord: jest.fn<Promise<void>, [MaintenanceRecord]>(),
  };
}

function makeMockEvents() {
  return {
    equipmentCreated: jest.fn<Promise<void>, [Equipment]>(),
    equipmentUpdated: jest.fn(),
    stockUnitAvailabilityChanged: jest.fn(),
    maintenanceScheduled: jest.fn<Promise<void>, [MaintenanceRecord]>(),
    maintenanceCompleted: jest.fn(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('InventoryService', () => {
  let service: InventoryService;
  let mockRepo: ReturnType<typeof makeMockRepo>;
  let mockEvents: ReturnType<typeof makeMockEvents>;

  beforeEach(() => {
    mockRepo = makeMockRepo();
    mockEvents = makeMockEvents();
    // Cast through unknown to satisfy TypeScript — mocks satisfy the contract at runtime
    service = new InventoryService(
      mockRepo as unknown as InstanceType<typeof import('../repository').InventoryRepository>,
      mockEvents as unknown as InstanceType<typeof import('../events').InventoryEventPublisher>,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ── createEquipment ────────────────────────────────────────────────────────

  describe('createEquipment', () => {
    it('saves equipment and publishes event on happy path', async () => {
      mockRepo.saveEquipment.mockResolvedValue(undefined);
      mockEvents.equipmentCreated.mockResolvedValue(undefined);

      const result = await service.createEquipment({
        name: 'Test Stage Deck',
        categoryId: 'cat_STAGE',
        dailyRate: 150,
      });

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.data.name).toBe('Test Stage Deck');
      expect(result.data.categoryId).toBe('cat_STAGE');
      expect(result.data.dailyRate).toBe(150);
      expect(result.data.isActive).toBe(true);
      expect(result.data.id).toBeTruthy();

      expect(mockRepo.saveEquipment).toHaveBeenCalledTimes(1);
      expect(mockRepo.saveEquipment).toHaveBeenCalledWith(result.data);
      expect(mockEvents.equipmentCreated).toHaveBeenCalledTimes(1);
      expect(mockEvents.equipmentCreated).toHaveBeenCalledWith(result.data);
    });

    it('returns InternalError when repository throws', async () => {
      mockRepo.saveEquipment.mockRejectedValue(new Error('DynamoDB timeout'));

      const result = await service.createEquipment({
        name: 'Test Equipment',
        categoryId: 'cat_STAGE',
        dailyRate: 100,
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.code).toBe('INTERNAL_ERROR');
    });
  });

  // ── getEquipment ───────────────────────────────────────────────────────────

  describe('getEquipment', () => {
    it('returns equipment when found', async () => {
      const equipment = makeEquipment();
      mockRepo.findEquipmentById.mockResolvedValue(equipment);

      const result = await service.getEquipment('equip_TEST01');

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.id).toBe('equip_TEST01');
    });

    it('returns NotFoundError when equipment does not exist', async () => {
      mockRepo.findEquipmentById.mockResolvedValue(null);

      const result = await service.getEquipment('equip_MISSING');

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.code).toBe('NOT_FOUND');
      expect(result.error.message).toContain('equip_MISSING');
    });
  });

  // ── updateStockUnitStatus ─────────────────────────────────────────────────

  describe('updateStockUnitStatus', () => {
    it('updates status and publishes availability event', async () => {
      const unit = makeStockUnit({ status: StockUnitStatus.AVAILABLE });
      mockRepo.findStockUnitById.mockResolvedValue(unit);
      mockRepo.saveStockUnit.mockResolvedValue(undefined);
      mockEvents.stockUnitAvailabilityChanged.mockResolvedValue(undefined);

      const result = await service.updateStockUnitStatus('unit_TEST01', {
        status: StockUnitStatus.MAINTENANCE,
        reason: 'MAINTENANCE',
      });

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.status).toBe(StockUnitStatus.MAINTENANCE);
      expect(mockRepo.saveStockUnit).toHaveBeenCalledWith(
        expect.objectContaining({ status: StockUnitStatus.MAINTENANCE }),
      );
      expect(mockEvents.stockUnitAvailabilityChanged).toHaveBeenCalledTimes(1);
    });

    it('rejects RETIRED → AVAILABLE transition', async () => {
      const retiredUnit = makeStockUnit({ status: StockUnitStatus.RETIRED });
      mockRepo.findStockUnitById.mockResolvedValue(retiredUnit);

      const result = await service.updateStockUnitStatus('unit_TEST01', {
        status: StockUnitStatus.AVAILABLE,
        reason: 'MANUAL',
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.code).toBe('CONFLICT');
      expect(result.error.message).toContain('RETIRED');
      expect(mockRepo.saveStockUnit).not.toHaveBeenCalled();
    });

    it('rejects RETIRED → MAINTENANCE transition', async () => {
      const retiredUnit = makeStockUnit({ status: StockUnitStatus.RETIRED });
      mockRepo.findStockUnitById.mockResolvedValue(retiredUnit);

      const result = await service.updateStockUnitStatus('unit_TEST01', {
        status: StockUnitStatus.MAINTENANCE,
        reason: 'MANUAL',
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.code).toBe('CONFLICT');
    });

    it('returns NotFoundError when unit does not exist', async () => {
      mockRepo.findStockUnitById.mockResolvedValue(null);

      const result = await service.updateStockUnitStatus('unit_MISSING', {
        status: StockUnitStatus.MAINTENANCE,
        reason: 'MANUAL',
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.code).toBe('NOT_FOUND');
    });
  });

  // ── createStockUnit ────────────────────────────────────────────────────────

  describe('createStockUnit', () => {
    it('creates unit with AVAILABLE status for existing equipment', async () => {
      const equipment = makeEquipment();
      mockRepo.findEquipmentById.mockResolvedValue(equipment);
      mockRepo.saveStockUnit.mockResolvedValue(undefined);

      const result = await service.createStockUnit({
        equipmentId: 'equip_TEST01',
        serialNumber: 'STG-2024-NEW',
        condition: EquipmentCondition.EXCELLENT,
        purchaseDate: '2024-01-01',
      });

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.status).toBe(StockUnitStatus.AVAILABLE);
      expect(result.data.equipmentId).toBe('equip_TEST01');
      expect(mockRepo.saveStockUnit).toHaveBeenCalledTimes(1);
    });

    it('returns NotFoundError when equipment does not exist', async () => {
      mockRepo.findEquipmentById.mockResolvedValue(null);

      const result = await service.createStockUnit({
        equipmentId: 'equip_MISSING',
        serialNumber: 'STG-2024-NEW',
        condition: EquipmentCondition.GOOD,
        purchaseDate: '2024-01-01',
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.code).toBe('NOT_FOUND');
      expect(result.error.message).toContain('equip_MISSING');
      expect(mockRepo.saveStockUnit).not.toHaveBeenCalled();
    });
  });

  // ── createMaintenanceRecord ───────────────────────────────────────────────

  describe('createMaintenanceRecord', () => {
    it('creates record with SCHEDULED status and publishes event', async () => {
      const equipment = makeEquipment();
      const unit = makeStockUnit();
      mockRepo.findEquipmentById.mockResolvedValue(equipment);
      mockRepo.findStockUnitById.mockResolvedValue(unit);
      mockRepo.saveMaintenanceRecord.mockResolvedValue(undefined);
      mockEvents.maintenanceScheduled.mockResolvedValue(undefined);

      const result = await service.createMaintenanceRecord({
        equipmentId: 'equip_TEST01',
        unitId: 'unit_TEST01',
        maintenanceType: MaintenanceType.INSPECTION,
        scheduledDate: '2024-08-01',
      });

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.status).toBe(MaintenanceStatus.SCHEDULED);
      expect(mockRepo.saveMaintenanceRecord).toHaveBeenCalledTimes(1);
      expect(mockEvents.maintenanceScheduled).toHaveBeenCalledTimes(1);
    });
  });

  // ── completeMaintenanceRecord ─────────────────────────────────────────────

  describe('completeMaintenanceRecord', () => {
    it('completes a SCHEDULED record and updates stock unit', async () => {
      const record = makeMaintenanceRecord({ status: MaintenanceStatus.SCHEDULED });
      const unit = makeStockUnit();
      mockRepo.findMaintenanceRecordById.mockResolvedValue(record);
      mockRepo.findStockUnitById.mockResolvedValue(unit);
      mockRepo.saveMaintenanceRecord.mockResolvedValue(undefined);
      mockRepo.saveStockUnit.mockResolvedValue(undefined);
      mockEvents.maintenanceCompleted.mockResolvedValue(undefined);

      const result = await service.completeMaintenanceRecord('maint_TEST01', {
        newCondition: EquipmentCondition.GOOD,
        notes: 'Inspection complete, minor wear noted',
        completedDate: '2024-08-01T14:00:00Z',
        technicianId: 'tech_001',
      });

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.status).toBe(MaintenanceStatus.COMPLETED);
      expect(result.data.completedDate).toBe('2024-08-01T14:00:00Z');
      expect(mockRepo.saveMaintenanceRecord).toHaveBeenCalledTimes(1);
      expect(mockRepo.saveStockUnit).toHaveBeenCalledTimes(1);
      expect(mockEvents.maintenanceCompleted).toHaveBeenCalledTimes(1);
    });

    it('rejects completion when record is already COMPLETED', async () => {
      const record = makeMaintenanceRecord({ status: MaintenanceStatus.COMPLETED });
      mockRepo.findMaintenanceRecordById.mockResolvedValue(record);

      const result = await service.completeMaintenanceRecord('maint_TEST01', {
        newCondition: EquipmentCondition.GOOD,
        notes: 'Already done',
        completedDate: '2024-08-01T14:00:00Z',
        technicianId: 'tech_001',
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.code).toBe('CONFLICT');
      expect(mockRepo.saveMaintenanceRecord).not.toHaveBeenCalled();
    });

    it('returns NotFoundError when record does not exist', async () => {
      mockRepo.findMaintenanceRecordById.mockResolvedValue(null);

      const result = await service.completeMaintenanceRecord('maint_MISSING', {
        newCondition: EquipmentCondition.GOOD,
        notes: 'Notes',
        completedDate: '2024-08-01T14:00:00Z',
        technicianId: 'tech_001',
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.code).toBe('NOT_FOUND');
    });
  });

  // ── listCategories ─────────────────────────────────────────────────────────

  describe('listCategories', () => {
    it('returns empty array when no categories exist', async () => {
      mockRepo.listCategories.mockResolvedValue([]);

      const result = await service.listCategories();

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data).toEqual([]);
    });

    it('returns categories from repository', async () => {
      const categories = [makeCategory(), makeCategory({ id: 'cat_AUDIO', name: 'Audio Systems' })];
      mockRepo.listCategories.mockResolvedValue(categories);

      const result = await service.listCategories();

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data).toHaveLength(2);
    });
  });
});
