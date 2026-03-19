/**
 * @file index.ts
 * @domain inventory
 * @purpose Public API for the Inventory domain package
 */
export { handler } from './handler.js';
export { InventoryService } from './service.js';
export { InventoryRepository } from './repository.js';
export { InventoryEventPublisher } from './events.js';
export type {
  Equipment,
  Category,
  StockUnit,
  MaintenanceRecord,
  Kit,
  KitItem,
  CreateEquipmentInput,
  UpdateEquipmentInput,
  CreateCategoryInput,
  CreateStockUnitInput,
  UpdateStockUnitStatusInput,
  CreateMaintenanceRecordInput,
  CompleteMaintenanceInput,
} from './types.js';
export {
  EquipmentCondition,
  StockUnitStatus,
  MaintenanceType,
  MaintenanceStatus,
} from './types.js';
export {
  createCategorySchema,
  createEquipmentSchema,
  updateEquipmentSchema,
  createStockUnitSchema,
  updateStockUnitStatusSchema,
  createMaintenanceRecordSchema,
  completeMaintenanceSchema,
  paginationSchema,
} from './validators.js';
