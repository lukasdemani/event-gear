/**
 * @file types.ts
 * @purpose Client-side domain types mirroring domains/inventory/types.ts
 *
 * @ai-notes No `readonly` modifiers — these are used in React state and forms.
 *   Field names and enum values must stay in sync with the server types.
 */

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

export interface Category {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Equipment {
  id: string;
  name: string;
  description?: string;
  categoryId: string;
  dailyRate: number;
  weeklyRate?: number;
  specifications?: Record<string, unknown>;
  isActive: boolean;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface StockUnit {
  id: string;
  equipmentId: string;
  serialNumber: string;
  condition: EquipmentCondition;
  status: StockUnitStatus;
  purchaseDate: string;
  lastMaintenanceDate?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MaintenanceRecord {
  id: string;
  equipmentId: string;
  unitId: string;
  maintenanceType: MaintenanceType;
  status: MaintenanceStatus;
  scheduledDate: string;
  completedDate?: string;
  notes?: string;
  completionNotes?: string;
  technicianId?: string;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface CreateCategoryInput {
  name: string;
  description?: string;
}

export interface CreateEquipmentInput {
  name: string;
  description?: string;
  categoryId: string;
  dailyRate: number;
  weeklyRate?: number;
  tags?: string[];
}

export interface UpdateEquipmentInput {
  name?: string;
  description?: string;
  categoryId?: string;
  dailyRate?: number;
  weeklyRate?: number;
  isActive?: boolean;
  tags?: string[];
}

export interface CreateStockUnitInput {
  serialNumber: string;
  condition: EquipmentCondition;
  purchaseDate: string;
  notes?: string;
}

export interface UpdateStockUnitStatusInput {
  status: StockUnitStatus;
  reason: 'RESERVATION' | 'MAINTENANCE' | 'DAMAGE' | 'MANUAL';
  referenceId?: string;
}

export interface CreateMaintenanceRecordInput {
  equipmentId: string;
  unitId: string;
  maintenanceType: MaintenanceType;
  scheduledDate: string;
  notes?: string;
  technicianId?: string;
}

export interface CompleteMaintenanceInput {
  newCondition: EquipmentCondition;
  notes: string;
  completedDate: string;
  technicianId: string;
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

export interface PaginatedResult<T> {
  items: T[];
  nextToken?: string;
}
