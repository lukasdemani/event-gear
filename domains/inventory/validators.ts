/**
 * @file validators.ts
 * @domain inventory
 * @purpose Zod validation schemas for all Inventory API input types
 *
 * @inputs  Raw HTTP request bodies (unknown)
 * @outputs Validated, typed input objects or ZodError
 *
 * @dependencies zod
 * @ai-notes Validators are only used at the Lambda boundary (handler.ts).
 *   Service functions accept already-validated input types — do not re-validate inside service.
 *   Use .safeParse() in handlers to get structured errors, not .parse() which throws.
 */
import { z } from 'zod';
import { EquipmentCondition, MaintenanceType, StockUnitStatus } from './types.js';

// ---------------------------------------------------------------------------
// Enum schemas
// ---------------------------------------------------------------------------

const equipmentConditionSchema = z.nativeEnum(EquipmentCondition);
const stockUnitStatusSchema = z.nativeEnum(StockUnitStatus);
const maintenanceTypeSchema = z.nativeEnum(MaintenanceType);

// ---------------------------------------------------------------------------
// Category
// ---------------------------------------------------------------------------

export const createCategorySchema = z.object({
  name: z.string().min(1, 'name is required').max(100),
  description: z.string().max(500).optional(),
});

export type CreateCategoryValidated = z.infer<typeof createCategorySchema>;

// ---------------------------------------------------------------------------
// Equipment
// ---------------------------------------------------------------------------

export const createEquipmentSchema = z.object({
  name: z.string().min(1, 'name is required').max(200),
  description: z.string().max(1000).optional(),
  categoryId: z.string().min(1, 'categoryId is required'),
  dailyRate: z.number().positive('dailyRate must be positive'),
  weeklyRate: z.number().positive('weeklyRate must be positive').optional(),
  specifications: z.record(z.unknown()).optional(),
  tags: z.array(z.string()).optional(),
});

export type CreateEquipmentValidated = z.infer<typeof createEquipmentSchema>;

export const updateEquipmentSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  categoryId: z.string().min(1).optional(),
  dailyRate: z.number().positive().optional(),
  weeklyRate: z.number().positive().optional(),
  specifications: z.record(z.unknown()).optional(),
  tags: z.array(z.string()).optional(),
  isActive: z.boolean().optional(),
});

export type UpdateEquipmentValidated = z.infer<typeof updateEquipmentSchema>;

// ---------------------------------------------------------------------------
// Stock Units
// ---------------------------------------------------------------------------

export const createStockUnitSchema = z.object({
  serialNumber: z.string().min(1, 'serialNumber is required').max(100),
  condition: equipmentConditionSchema,
  purchaseDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'purchaseDate must be YYYY-MM-DD'),
  notes: z.string().max(500).optional(),
});

export type CreateStockUnitValidated = z.infer<typeof createStockUnitSchema>;

export const updateStockUnitStatusSchema = z.object({
  status: stockUnitStatusSchema,
  reason: z.enum(['RESERVATION', 'MAINTENANCE', 'DAMAGE', 'MANUAL']),
  referenceId: z.string().optional(),
});

export type UpdateStockUnitStatusValidated = z.infer<typeof updateStockUnitStatusSchema>;

// ---------------------------------------------------------------------------
// Maintenance Records
// ---------------------------------------------------------------------------

export const createMaintenanceRecordSchema = z.object({
  equipmentId: z.string().min(1, 'equipmentId is required'),
  unitId: z.string().min(1, 'unitId is required'),
  maintenanceType: maintenanceTypeSchema,
  scheduledDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'scheduledDate must be YYYY-MM-DD'),
  notes: z.string().max(1000).optional(),
  technicianId: z.string().optional(),
});

export type CreateMaintenanceRecordValidated = z.infer<typeof createMaintenanceRecordSchema>;

export const completeMaintenanceSchema = z.object({
  newCondition: equipmentConditionSchema,
  notes: z.string().min(1, 'notes are required').max(1000),
  completedDate: z.string().datetime({ message: 'completedDate must be ISO 8601' }),
  technicianId: z.string().min(1, 'technicianId is required'),
});

export type CompleteMaintenanceValidated = z.infer<typeof completeMaintenanceSchema>;

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

export const paginationSchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
  nextToken: z.string().optional(),
});

export type PaginationValidated = z.infer<typeof paginationSchema>;
