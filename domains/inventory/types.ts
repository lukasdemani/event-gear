/**
 * @file types.ts
 * @domain inventory
 * @purpose All domain interfaces and enums for the Inventory bounded context
 *
 * @outputs Equipment, Category, StockUnit, MaintenanceRecord, Kit, KitItem types
 *          and all input/mutation types used by service and validators
 *
 * @ai-notes These types represent the DOMAIN model — not DynamoDB records.
 *   DynamoRecord<T> wrappers are only used inside repository.ts.
 *   All entities are readonly to prevent accidental mutation.
 *   ID fields use ULID format (26 uppercase alphanum chars) via generateId().
 */
import type { ID, ISODateString, ISODateTimeString, Timestamps } from '@eventgear/core';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export enum EquipmentCondition {
  EXCELLENT = 'EXCELLENT',
  GOOD = 'GOOD',
  FAIR = 'FAIR',
  POOR = 'POOR',
  NEEDS_REPAIR = 'NEEDS_REPAIR',
  RETIRED = 'RETIRED',
}

export enum StockUnitStatus {
  AVAILABLE = 'AVAILABLE',
  RESERVED = 'RESERVED',
  MAINTENANCE = 'MAINTENANCE',
  RETIRED = 'RETIRED',
  DISPATCHED = 'DISPATCHED',
}

export enum MaintenanceType {
  PREVENTIVE = 'PREVENTIVE',
  REPAIR = 'REPAIR',
  INSPECTION = 'INSPECTION',
  CLEANING = 'CLEANING',
}

export enum MaintenanceStatus {
  SCHEDULED = 'SCHEDULED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

// ---------------------------------------------------------------------------
// Domain entities
// ---------------------------------------------------------------------------

export interface Category extends Timestamps {
  readonly id: ID;
  readonly name: string;
  readonly description?: string;
}

export interface Equipment extends Timestamps {
  readonly id: ID;
  readonly name: string;
  readonly description?: string;
  readonly categoryId: ID;
  readonly dailyRate: number;
  readonly weeklyRate?: number;
  readonly specifications?: Record<string, unknown>;
  readonly isActive: boolean;
  readonly tags?: readonly string[];
}

export interface StockUnit extends Timestamps {
  readonly id: ID;
  readonly equipmentId: ID;
  readonly serialNumber: string;
  readonly condition: EquipmentCondition;
  readonly status: StockUnitStatus;
  readonly purchaseDate: ISODateString;
  readonly lastMaintenanceDate?: ISODateString;
  readonly notes?: string;
}

export interface MaintenanceRecord extends Timestamps {
  readonly id: ID;
  readonly equipmentId: ID;
  readonly unitId: ID;
  readonly maintenanceType: MaintenanceType;
  readonly status: MaintenanceStatus;
  readonly scheduledDate: ISODateString;
  readonly completedDate?: ISODateTimeString;
  readonly notes?: string;
  readonly completionNotes?: string;
  readonly technicianId?: string;
}

export interface Kit extends Timestamps {
  readonly id: ID;
  readonly name: string;
  readonly description?: string;
  readonly isActive: boolean;
}

export interface KitItem {
  readonly kitId: ID;
  readonly equipmentId: ID;
  readonly quantity: number;
  readonly notes?: string;
}

// ---------------------------------------------------------------------------
// Input types (used by validators and service)
// ---------------------------------------------------------------------------

export interface CreateEquipmentInput {
  readonly name: string;
  readonly description?: string | undefined;
  readonly categoryId: ID;
  readonly dailyRate: number;
  readonly weeklyRate?: number | undefined;
  readonly specifications?: Record<string, unknown> | undefined;
  readonly tags?: readonly string[] | undefined;
}

export interface UpdateEquipmentInput {
  readonly name?: string | undefined;
  readonly description?: string | undefined;
  readonly categoryId?: ID | undefined;
  readonly dailyRate?: number | undefined;
  readonly weeklyRate?: number | undefined;
  readonly specifications?: Record<string, unknown> | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly isActive?: boolean | undefined;
}

export interface CreateCategoryInput {
  readonly name: string;
  readonly description?: string | undefined;
}

export interface CreateStockUnitInput {
  readonly equipmentId: ID;
  readonly serialNumber: string;
  readonly condition: EquipmentCondition;
  readonly purchaseDate: ISODateString;
  readonly notes?: string | undefined;
}

export interface UpdateStockUnitStatusInput {
  readonly status: StockUnitStatus;
  readonly reason: 'RESERVATION' | 'MAINTENANCE' | 'DAMAGE' | 'MANUAL';
  readonly referenceId?: string | undefined;
}

export interface CreateMaintenanceRecordInput {
  readonly equipmentId: ID;
  readonly unitId: ID;
  readonly maintenanceType: MaintenanceType;
  readonly scheduledDate: ISODateString;
  readonly notes?: string | undefined;
  readonly technicianId?: string | undefined;
}

export interface CompleteMaintenanceInput {
  readonly newCondition: EquipmentCondition;
  readonly notes: string;
  readonly completedDate: ISODateTimeString;
  readonly technicianId: string;
}
