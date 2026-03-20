/**
 * @file tools.ts
 * @purpose Claude tool definitions (JSON Schema) + executor that calls InventoryService
 *
 * @inputs  Tool name + input from Claude, InventoryService instance
 * @outputs Tool result as a plain object for Claude's tool_result block
 */
import type Anthropic from '@anthropic-ai/sdk';
import type { InventoryService } from '@eventgear/inventory';

export const TOOL_DEFINITIONS: Anthropic.Tool[] = [
  {
    name: 'list_categories',
    description: 'List all equipment categories.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'create_category',
    description: 'Create a new equipment category.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Category name' },
        description: { type: 'string', description: 'Optional description' },
      },
      required: ['name'],
    },
  },
  {
    name: 'list_equipment',
    description: 'List equipment items, optionally paginated.',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max items to return' },
        nextToken: { type: 'string', description: 'Pagination cursor' },
      },
      required: [],
    },
  },
  {
    name: 'get_equipment',
    description: 'Get a single equipment item by ID.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Equipment ID' } },
      required: ['id'],
    },
  },
  {
    name: 'create_equipment',
    description: 'Create a new equipment item in the catalog.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        categoryId: { type: 'string' },
        dailyRate: { type: 'number' },
        description: { type: 'string' },
        weeklyRate: { type: 'number' },
      },
      required: ['name', 'categoryId', 'dailyRate'],
    },
  },
  {
    name: 'update_equipment',
    description: 'Update an existing equipment item.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        dailyRate: { type: 'number' },
        weeklyRate: { type: 'number' },
        isActive: { type: 'boolean' },
        description: { type: 'string' },
      },
      required: ['id'],
    },
  },
  {
    name: 'list_stock_units',
    description: 'List all physical stock units for a given equipment item.',
    input_schema: {
      type: 'object',
      properties: { equipmentId: { type: 'string' } },
      required: ['equipmentId'],
    },
  },
  {
    name: 'create_stock_unit',
    description: 'Add a new physical stock unit to an equipment item.',
    input_schema: {
      type: 'object',
      properties: {
        equipmentId: { type: 'string' },
        serialNumber: { type: 'string' },
        condition: { type: 'string', enum: ['EXCELLENT', 'GOOD', 'FAIR', 'POOR', 'NEEDS_REPAIR', 'RETIRED'] },
        purchaseDate: { type: 'string', description: 'ISO date YYYY-MM-DD' },
        notes: { type: 'string' },
      },
      required: ['equipmentId', 'serialNumber', 'condition', 'purchaseDate'],
    },
  },
  {
    name: 'update_unit_status',
    description: 'Update the status of a stock unit.',
    input_schema: {
      type: 'object',
      properties: {
        equipmentId: { type: 'string' },
        unitId: { type: 'string' },
        status: { type: 'string', enum: ['AVAILABLE', 'RESERVED', 'MAINTENANCE', 'RETIRED', 'DISPATCHED'] },
        reason: { type: 'string', enum: ['RESERVATION', 'MAINTENANCE', 'DAMAGE', 'MANUAL'] },
        referenceId: { type: 'string' },
      },
      required: ['equipmentId', 'unitId', 'status', 'reason'],
    },
  },
  {
    name: 'get_maintenance_history',
    description: 'Get the maintenance history for an equipment item.',
    input_schema: {
      type: 'object',
      properties: { equipmentId: { type: 'string' } },
      required: ['equipmentId'],
    },
  },
  {
    name: 'create_maintenance_record',
    description: 'Schedule a maintenance record for a stock unit.',
    input_schema: {
      type: 'object',
      properties: {
        equipmentId: { type: 'string' },
        unitId: { type: 'string' },
        maintenanceType: { type: 'string', enum: ['PREVENTIVE', 'REPAIR', 'INSPECTION', 'CLEANING'] },
        scheduledDate: { type: 'string', description: 'ISO date YYYY-MM-DD' },
        notes: { type: 'string' },
        technicianId: { type: 'string' },
      },
      required: ['equipmentId', 'unitId', 'maintenanceType', 'scheduledDate'],
    },
  },
  {
    name: 'complete_maintenance',
    description: 'Mark a maintenance record as completed.',
    input_schema: {
      type: 'object',
      properties: {
        recordId: { type: 'string' },
        newCondition: { type: 'string', enum: ['EXCELLENT', 'GOOD', 'FAIR', 'POOR', 'NEEDS_REPAIR', 'RETIRED'] },
        notes: { type: 'string' },
        completedDate: { type: 'string', description: 'ISO datetime string' },
        technicianId: { type: 'string' },
      },
      required: ['recordId', 'newCondition', 'notes', 'completedDate', 'technicianId'],
    },
  },
];

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  service: InventoryService,
): Promise<unknown> {
  switch (name) {
    case 'list_categories':
      return service.listCategories();
    case 'create_category':
      return service.createCategory(input as Parameters<typeof service.createCategory>[0]);
    case 'list_equipment':
      return service.listEquipment(input as Parameters<typeof service.listEquipment>[0]);
    case 'get_equipment':
      return service.getEquipment(input['id'] as string);
    case 'create_equipment':
      return service.createEquipment(input as Parameters<typeof service.createEquipment>[0]);
    case 'update_equipment': {
      const { id, ...rest } = input as { id: string } & Record<string, unknown>;
      return service.updateEquipment(id, rest as Parameters<typeof service.updateEquipment>[1]);
    }
    case 'list_stock_units':
      return service.listStockUnits(input['equipmentId'] as string);
    case 'create_stock_unit': {
      const { equipmentId, ...rest } = input as { equipmentId: string } & Record<string, unknown>;
      return service.createStockUnit({ equipmentId, ...rest } as Parameters<typeof service.createStockUnit>[0]);
    }
    case 'update_unit_status': {
      const { unitId, ...rest } = input as { unitId: string } & Record<string, unknown>;
      return service.updateStockUnitStatus(unitId, rest as Parameters<typeof service.updateStockUnitStatus>[1]);
    }
    case 'get_maintenance_history':
      return service.getMaintenanceHistory(input['equipmentId'] as string);
    case 'create_maintenance_record':
      return service.createMaintenanceRecord(input as Parameters<typeof service.createMaintenanceRecord>[0]);
    case 'complete_maintenance': {
      const { recordId, ...rest } = input as { recordId: string } & Record<string, unknown>;
      return service.completeMaintenanceRecord(recordId, rest as Parameters<typeof service.completeMaintenanceRecord>[1]);
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
