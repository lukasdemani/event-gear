/**
 * @file service.ts
 * @domain inventory
 * @purpose Business logic for all Inventory operations — equipment, categories, stock units, maintenance
 *
 * @inputs  Validated input types from validators.ts
 * @outputs Result<T> — never throws; callers check result.success
 *
 * @dependencies @eventgear/core, ./repository.ts, ./events.ts
 * @ai-notes All methods return Result<T, AppError> — NEVER throw from this file.
 *   The repo and events publisher are injected via constructor for testability.
 *   RETIRED is a terminal StockUnit status — block all transitions from RETIRED.
 *   completeMaintenanceRecord also updates the stock unit's lastMaintenanceDate.
 *   Status transitions triggered by reservations/logistics arrive via EventBridge consumers (future).
 */
import {
  ConflictError,
  InternalError,
  NotFoundError,
  err,
  generateId,
  ok,
} from '@eventgear/core';
import type { PaginatedResult, PaginationParams, Result } from '@eventgear/core';
import type { InventoryEventPublisher } from './events.js';
import type { InventoryRepository } from './repository.js';
import {
  MaintenanceStatus,
  StockUnitStatus,
} from './types.js';
import type {
  Category,
  CompleteMaintenanceInput,
  CreateCategoryInput,
  CreateEquipmentInput,
  CreateMaintenanceRecordInput,
  CreateStockUnitInput,
  Equipment,
  MaintenanceRecord,
  StockUnit,
  UpdateEquipmentInput,
  UpdateStockUnitStatusInput,
} from './types.js';

/** Status transitions that are forbidden (RETIRED is terminal) */
function isValidStatusTransition(
  from: StockUnitStatus,
  _to: StockUnitStatus,
): boolean {
  if (from === StockUnitStatus.RETIRED) return false;
  return true;
}

export class InventoryService {
  constructor(
    private readonly repo: InventoryRepository,
    private readonly events: InventoryEventPublisher,
  ) {}

  // ---------------------------------------------------------------------------
  // Equipment
  // ---------------------------------------------------------------------------

  async createEquipment(input: CreateEquipmentInput): Promise<Result<Equipment>> {
    try {
      const now = new Date().toISOString();
      const equipment: Equipment = {
        id: generateId(),
        name: input.name,
        categoryId: input.categoryId,
        dailyRate: input.dailyRate,
        isActive: true,
        createdAt: now,
        updatedAt: now,
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.weeklyRate !== undefined ? { weeklyRate: input.weeklyRate } : {}),
        ...(input.specifications !== undefined
          ? { specifications: input.specifications }
          : {}),
        ...(input.tags !== undefined ? { tags: input.tags } : {}),
      };

      await this.repo.saveEquipment(equipment);
      await this.events.equipmentCreated(equipment);
      return ok(equipment);
    } catch (e) {
      return err(
        new InternalError('Failed to create equipment', { cause: String(e) }),
      );
    }
  }

  async getEquipment(id: string): Promise<Result<Equipment>> {
    try {
      const equipment = await this.repo.findEquipmentById(id);
      if (!equipment) return err(new NotFoundError('Equipment', id));
      return ok(equipment);
    } catch (e) {
      return err(
        new InternalError('Failed to get equipment', { cause: String(e) }),
      );
    }
  }

  async updateEquipment(
    id: string,
    input: UpdateEquipmentInput,
  ): Promise<Result<Equipment>> {
    try {
      const existing = await this.repo.findEquipmentById(id);
      if (!existing) return err(new NotFoundError('Equipment', id));

      const updatedFields = Object.keys(input).filter(
        (k) => input[k as keyof UpdateEquipmentInput] !== undefined,
      );

      const now = new Date().toISOString();
      const updated: Equipment = {
        ...existing,
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
        ...(input.categoryId !== undefined
          ? { categoryId: input.categoryId }
          : {}),
        ...(input.dailyRate !== undefined ? { dailyRate: input.dailyRate } : {}),
        ...(input.weeklyRate !== undefined
          ? { weeklyRate: input.weeklyRate }
          : {}),
        ...(input.specifications !== undefined
          ? { specifications: input.specifications }
          : {}),
        ...(input.tags !== undefined ? { tags: input.tags } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        updatedAt: now,
      };

      await this.repo.saveEquipment(updated);
      await this.events.equipmentUpdated(updated, updatedFields);
      return ok(updated);
    } catch (e) {
      return err(
        new InternalError('Failed to update equipment', { cause: String(e) }),
      );
    }
  }

  async listEquipment(
    pagination: PaginationParams,
  ): Promise<Result<PaginatedResult<Equipment>>> {
    try {
      const result = await this.repo.listAllEquipment(pagination);
      return ok(result);
    } catch (e) {
      return err(
        new InternalError('Failed to list equipment', { cause: String(e) }),
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Categories
  // ---------------------------------------------------------------------------

  async createCategory(input: CreateCategoryInput): Promise<Result<Category>> {
    try {
      const now = new Date().toISOString();
      const category: Category = {
        id: generateId(),
        name: input.name,
        createdAt: now,
        updatedAt: now,
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
      };

      await this.repo.saveCategory(category);
      return ok(category);
    } catch (e) {
      return err(
        new InternalError('Failed to create category', { cause: String(e) }),
      );
    }
  }

  async listCategories(): Promise<Result<Category[]>> {
    try {
      const categories = await this.repo.listCategories();
      return ok(categories);
    } catch (e) {
      return err(
        new InternalError('Failed to list categories', { cause: String(e) }),
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Stock Units
  // ---------------------------------------------------------------------------

  async createStockUnit(
    input: CreateStockUnitInput,
  ): Promise<Result<StockUnit>> {
    try {
      // Verify the parent equipment exists
      const equipment = await this.repo.findEquipmentById(input.equipmentId);
      if (!equipment) {
        return err(new NotFoundError('Equipment', input.equipmentId));
      }

      const now = new Date().toISOString();
      const unit: StockUnit = {
        id: generateId(),
        equipmentId: input.equipmentId,
        serialNumber: input.serialNumber,
        condition: input.condition,
        status: StockUnitStatus.AVAILABLE,
        purchaseDate: input.purchaseDate,
        createdAt: now,
        updatedAt: now,
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      };

      await this.repo.saveStockUnit(unit);
      return ok(unit);
    } catch (e) {
      return err(
        new InternalError('Failed to create stock unit', { cause: String(e) }),
      );
    }
  }

  async getStockUnit(unitId: string): Promise<Result<StockUnit>> {
    try {
      const unit = await this.repo.findStockUnitById(unitId);
      if (!unit) return err(new NotFoundError('StockUnit', unitId));
      return ok(unit);
    } catch (e) {
      return err(
        new InternalError('Failed to get stock unit', { cause: String(e) }),
      );
    }
  }

  async updateStockUnitStatus(
    unitId: string,
    input: UpdateStockUnitStatusInput,
  ): Promise<Result<StockUnit>> {
    try {
      const unit = await this.repo.findStockUnitById(unitId);
      if (!unit) return err(new NotFoundError('StockUnit', unitId));

      if (!isValidStatusTransition(unit.status, input.status)) {
        return err(
          new ConflictError(
            `Invalid status transition: ${unit.status} → ${input.status}. RETIRED is a terminal status.`,
            { currentStatus: unit.status, requestedStatus: input.status },
          ),
        );
      }

      const previousStatus = unit.status;
      const now = new Date().toISOString();
      const updated: StockUnit = {
        ...unit,
        status: input.status,
        updatedAt: now,
      };

      await this.repo.saveStockUnit(updated);
      await this.events.stockUnitAvailabilityChanged(
        updated,
        previousStatus,
        input.reason,
        input.referenceId,
      );
      return ok(updated);
    } catch (e) {
      return err(
        new InternalError('Failed to update stock unit status', {
          cause: String(e),
        }),
      );
    }
  }

  async getAvailableUnits(equipmentId: string): Promise<Result<StockUnit[]>> {
    try {
      const units = await this.repo.findAvailableUnitsByEquipment(equipmentId);
      return ok(units);
    } catch (e) {
      return err(
        new InternalError('Failed to get available units', { cause: String(e) }),
      );
    }
  }

  async listStockUnits(equipmentId: string): Promise<Result<StockUnit[]>> {
    try {
      const equipment = await this.repo.findEquipmentById(equipmentId);
      if (!equipment) return err(new NotFoundError('Equipment', equipmentId));

      const units = await this.repo.findStockUnitsByEquipment(equipmentId);
      return ok(units);
    } catch (e) {
      return err(
        new InternalError('Failed to list stock units', { cause: String(e) }),
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Maintenance Records
  // ---------------------------------------------------------------------------

  async createMaintenanceRecord(
    input: CreateMaintenanceRecordInput,
  ): Promise<Result<MaintenanceRecord>> {
    try {
      const equipment = await this.repo.findEquipmentById(input.equipmentId);
      if (!equipment) {
        return err(new NotFoundError('Equipment', input.equipmentId));
      }

      const unit = await this.repo.findStockUnitById(input.unitId);
      if (!unit) {
        return err(new NotFoundError('StockUnit', input.unitId));
      }

      const now = new Date().toISOString();
      const record: MaintenanceRecord = {
        id: generateId(),
        equipmentId: input.equipmentId,
        unitId: input.unitId,
        maintenanceType: input.maintenanceType,
        status: MaintenanceStatus.SCHEDULED,
        scheduledDate: input.scheduledDate,
        createdAt: now,
        updatedAt: now,
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.technicianId !== undefined
          ? { technicianId: input.technicianId }
          : {}),
      };

      await this.repo.saveMaintenanceRecord(record);
      await this.events.maintenanceScheduled(record);
      return ok(record);
    } catch (e) {
      return err(
        new InternalError('Failed to create maintenance record', {
          cause: String(e),
        }),
      );
    }
  }

  async completeMaintenanceRecord(
    recordId: string,
    input: CompleteMaintenanceInput,
  ): Promise<Result<MaintenanceRecord>> {
    try {
      const record = await this.repo.findMaintenanceRecordById(recordId);
      if (!record) return err(new NotFoundError('MaintenanceRecord', recordId));

      if (
        record.status !== MaintenanceStatus.SCHEDULED &&
        record.status !== MaintenanceStatus.IN_PROGRESS
      ) {
        return err(
          new ConflictError(
            `Cannot complete maintenance record with status: ${record.status}`,
            { currentStatus: record.status },
          ),
        );
      }

      const now = new Date().toISOString();
      const completed: MaintenanceRecord = {
        ...record,
        status: MaintenanceStatus.COMPLETED,
        completedDate: input.completedDate,
        completionNotes: input.notes,
        technicianId: input.technicianId,
        updatedAt: now,
      };

      await this.repo.saveMaintenanceRecord(completed);

      // Update the stock unit's lastMaintenanceDate
      const unit = await this.repo.findStockUnitById(record.unitId);
      if (unit) {
        const updatedUnit: StockUnit = {
          ...unit,
          condition: input.newCondition,
          lastMaintenanceDate: input.completedDate.substring(0, 10), // ISO date
          updatedAt: now,
        };
        await this.repo.saveStockUnit(updatedUnit);
      }

      await this.events.maintenanceCompleted(completed, input.technicianId, input.newCondition);
      return ok(completed);
    } catch (e) {
      return err(
        new InternalError('Failed to complete maintenance record', {
          cause: String(e),
        }),
      );
    }
  }

  async getMaintenanceHistory(
    equipmentId: string,
  ): Promise<Result<MaintenanceRecord[]>> {
    try {
      const records = await this.repo.findMaintenanceHistory(equipmentId);
      return ok(records);
    } catch (e) {
      return err(
        new InternalError('Failed to get maintenance history', {
          cause: String(e),
        }),
      );
    }
  }
}
