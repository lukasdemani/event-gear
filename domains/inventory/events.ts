/**
 * @file events.ts
 * @domain inventory
 * @purpose Typed EventBridge event publishers for the Inventory domain
 *
 * @inputs  Domain entities (Equipment, StockUnit, MaintenanceRecord)
 * @outputs EventBridge PutEvents calls via EventPublisher
 *
 * @dependencies @eventgear/events
 * @ai-notes InventoryEventPublisher wraps EventPublisher with domain-specific typed methods.
 *   Callers (service.ts) pass domain entities; this class maps to event payload shapes.
 *   correlationId is optional — generated automatically when omitted.
 *   All 5 inventory events from CLAUDE.md §5 are covered here.
 */
import type { EventPublisher } from '@eventgear/events';
import type {
  EquipmentCreatedPayload,
  EquipmentUpdatedPayload,
  MaintenanceCompletedPayload,
  MaintenanceScheduledPayload,
  StockUnitAvailabilityChangedPayload,
} from '@eventgear/events';
import type { Equipment, MaintenanceRecord, StockUnit, StockUnitStatus } from './types.js';

export class InventoryEventPublisher {
  constructor(private readonly publisher: EventPublisher) {}

  async equipmentCreated(
    equipment: Equipment,
    correlationId?: string,
  ): Promise<void> {
    const payload: EquipmentCreatedPayload = {
      equipmentId: equipment.id,
      name: equipment.name,
      categoryId: equipment.categoryId,
      dailyRate: equipment.dailyRate,
    };
    await this.publisher.publish(
      'inventory.equipment.created',
      payload,
      correlationId,
    );
  }

  async equipmentUpdated(
    equipment: Equipment,
    updatedFields: string[],
    correlationId?: string,
  ): Promise<void> {
    const payload: EquipmentUpdatedPayload = {
      equipmentId: equipment.id,
      name: equipment.name,
      categoryId: equipment.categoryId,
      dailyRate: equipment.dailyRate,
      updatedFields,
    };
    await this.publisher.publish(
      'inventory.equipment.updated',
      payload,
      correlationId,
    );
  }

  async stockUnitAvailabilityChanged(
    unit: StockUnit,
    previousStatus: StockUnitStatus,
    reason: StockUnitAvailabilityChangedPayload['reason'],
    referenceId?: string,
    correlationId?: string,
  ): Promise<void> {
    const payload: StockUnitAvailabilityChangedPayload = {
      unitId: unit.id,
      equipmentId: unit.equipmentId,
      previousStatus,
      newStatus: unit.status,
      reason,
      ...(referenceId !== undefined ? { referenceId } : {}),
    };
    await this.publisher.publish(
      'inventory.stockunit.availability-changed',
      payload,
      correlationId,
    );
  }

  async maintenanceScheduled(
    record: MaintenanceRecord,
    correlationId?: string,
  ): Promise<void> {
    const payload: MaintenanceScheduledPayload = {
      maintenanceRecordId: record.id,
      unitId: record.unitId,
      equipmentId: record.equipmentId,
      scheduledDate: record.scheduledDate,
      maintenanceType: record.maintenanceType,
    };
    await this.publisher.publish(
      'inventory.maintenance.scheduled',
      payload,
      correlationId,
    );
  }

  async maintenanceCompleted(
    record: MaintenanceRecord,
    technicianId: string,
    newCondition: string,
    correlationId?: string,
  ): Promise<void> {
    if (!record.completedDate) {
      throw new Error(
        'maintenanceCompleted called on record without completedDate',
      );
    }
    const payload: MaintenanceCompletedPayload = {
      maintenanceRecordId: record.id,
      unitId: record.unitId,
      equipmentId: record.equipmentId,
      newCondition,
      technicianId,
      completedAt: record.completedDate,
    };
    await this.publisher.publish(
      'inventory.maintenance.completed',
      payload,
      correlationId,
    );
  }
}
