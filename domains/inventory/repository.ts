/**
 * @file repository.ts
 * @domain inventory
 * @purpose DynamoDB access layer for the Inventory domain
 *
 * @inputs  Entity IDs, input types, pagination params
 * @outputs Domain entities (Equipment, StockUnit, Category, MaintenanceRecord) — keys stripped
 *
 * @dependencies @eventgear/db, @eventgear/core
 * @ai-notes Access patterns implemented:
 *   AP-01 findEquipmentById       — PK=EQUIP#{id}, SK=METADATA
 *   AP-02 findEquipmentByCategory — GSI1PK=CATEGORY#{id}
 *   AP-03 listCategories          — EntityType=CATEGORY on GSI2
 *   AP-04 findStockUnitsByEquip   — PK=EQUIP#{id}, SK begins_with UNIT#
 *   AP-05 findStockUnitById       — GSI1PK=UNIT#{unitId}, GSI1SK=METADATA on GSI1
 *   AP-06 findAvailableUnits      — Status=AVAILABLE, GSI3SK begins_with EQUIP#{id} on GSI3
 *   AP-13 findMaintenanceHistory  — PK=EQUIP#{id}, SK begins_with MAINTENANCE#
 *   AP-21 listAllEquipment        — EntityType=EQUIPMENT on GSI2
 *
 *   When saving StockUnit, write BOTH lowercase 'status' (domain) AND uppercase 'Status' (GSI3PK).
 *   Same for MaintenanceRecord.status → 'Status'.
 *   GSI2 requires 'EntityType' (string) AND 'CreatedAt' (ISO timestamp).
 */
import { BaseRepository, buildKey, EntityType, GSI } from '@eventgear/db';
import type { DynamoRecord } from '@eventgear/db';
import type { PaginatedResult, PaginationParams } from '@eventgear/core';
import type {
  Category,
  Equipment,
  MaintenanceRecord,
  StockUnit,
} from './types.js';

export class InventoryRepository extends BaseRepository<Equipment> {
  // ---------------------------------------------------------------------------
  // Equipment
  // ---------------------------------------------------------------------------

  /** AP-01: Get equipment by ID — main table PK=EQUIP#{id}, SK=METADATA */
  async findEquipmentById(id: string): Promise<Equipment | null> {
    return this.getItem<Equipment>(buildKey.equipment.main(id));
  }

  /** AP-02: List equipment in category — GSI1 query */
  async findEquipmentByCategory(
    categoryId: string,
    pagination: PaginationParams,
  ): Promise<PaginatedResult<Equipment>> {
    return this.queryPaginated<Equipment>(
      {
        IndexName: GSI.GSI1,
        KeyConditionExpression: '#gsi1pk = :gsi1pk',
        ExpressionAttributeNames: { '#gsi1pk': 'GSI1PK' },
        ExpressionAttributeValues: {
          ':gsi1pk': `CATEGORY#${categoryId}`,
        },
      },
      pagination,
    );
  }

  /** AP-21: List all equipment — GSI2 query by EntityType */
  async listAllEquipment(
    pagination: PaginationParams,
  ): Promise<PaginatedResult<Equipment>> {
    return this.queryPaginated<Equipment>(
      {
        IndexName: GSI.GSI2,
        KeyConditionExpression: '#entityType = :entityType',
        ExpressionAttributeNames: { '#entityType': 'EntityType' },
        ExpressionAttributeValues: { ':entityType': EntityType.EQUIPMENT },
      },
      pagination,
    );
  }

  /** Save (create or replace) an equipment record */
  async saveEquipment(equipment: Equipment): Promise<void> {
    const record: DynamoRecord<Equipment> = {
      ...equipment,
      ...buildKey.equipment.main(equipment.id),
      ...buildKey.equipment.gsi1(equipment.categoryId, equipment.id),
      EntityType: EntityType.EQUIPMENT,
      CreatedAt: equipment.createdAt,
    };
    await this.putItem<Equipment>(record);
  }

  // ---------------------------------------------------------------------------
  // Category
  // ---------------------------------------------------------------------------

  /** AP-03: List all categories — GSI2 query by EntityType */
  async listCategories(): Promise<Category[]> {
    return this.query<Category>({
      IndexName: GSI.GSI2,
      KeyConditionExpression: '#entityType = :entityType',
      ExpressionAttributeNames: { '#entityType': 'EntityType' },
      ExpressionAttributeValues: { ':entityType': EntityType.CATEGORY },
    });
  }

  /** Save (create or replace) a category record */
  async saveCategory(category: Category): Promise<void> {
    const record: DynamoRecord<Category> = {
      ...category,
      ...buildKey.category.main(category.id),
      EntityType: EntityType.CATEGORY,
      CreatedAt: category.createdAt,
    };
    await this.putItem<Category>(record);
  }

  // ---------------------------------------------------------------------------
  // Stock Units
  // ---------------------------------------------------------------------------

  /** AP-04: Get all stock units for equipment — main table SK begins_with UNIT# */
  async findStockUnitsByEquipment(equipmentId: string): Promise<StockUnit[]> {
    return this.query<StockUnit>({
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
      ExpressionAttributeNames: { '#pk': 'PK', '#sk': 'SK' },
      ExpressionAttributeValues: {
        ':pk': `EQUIP#${equipmentId}`,
        ':skPrefix': 'UNIT#',
      },
    });
  }

  /** AP-05: Get stock unit by unit ID — GSI1 reverse lookup */
  async findStockUnitById(unitId: string): Promise<StockUnit | null> {
    const results = await this.query<StockUnit>({
      IndexName: GSI.GSI1,
      KeyConditionExpression: '#gsi1pk = :gsi1pk AND #gsi1sk = :gsi1sk',
      ExpressionAttributeNames: { '#gsi1pk': 'GSI1PK', '#gsi1sk': 'GSI1SK' },
      ExpressionAttributeValues: {
        ':gsi1pk': `UNIT#${unitId}`,
        ':gsi1sk': 'METADATA',
      },
      Limit: 1,
    });
    return results[0] ?? null;
  }

  /** AP-06: Get available stock units for equipment — GSI3 Status=AVAILABLE */
  async findAvailableUnitsByEquipment(equipmentId: string): Promise<StockUnit[]> {
    return this.query<StockUnit>({
      IndexName: GSI.GSI3,
      KeyConditionExpression:
        '#status = :status AND begins_with(#gsi3sk, :prefix)',
      ExpressionAttributeNames: { '#status': 'Status', '#gsi3sk': 'GSI3SK' },
      ExpressionAttributeValues: {
        ':status': 'AVAILABLE',
        ':prefix': `EQUIP#${equipmentId}`,
      },
    });
  }

  /** Save (create or replace) a stock unit record */
  async saveStockUnit(unit: StockUnit): Promise<void> {
    const record: DynamoRecord<StockUnit> = {
      ...unit,
      ...buildKey.stockUnit.main(unit.equipmentId, unit.id),
      ...buildKey.stockUnit.gsi1(unit.id),
      ...buildKey.stockUnit.gsi3(unit.equipmentId),
      EntityType: EntityType.STOCKUNIT,
      // Status (uppercase) = GSI3 partition key, mirrors domain 'status'
      Status: unit.status,
      CreatedAt: unit.createdAt,
    };
    await this.putItem<StockUnit>(record);
  }

  // ---------------------------------------------------------------------------
  // Maintenance Records
  // ---------------------------------------------------------------------------

  /** AP-13: Get maintenance history for equipment — SK begins_with MAINTENANCE# */
  async findMaintenanceHistory(equipmentId: string): Promise<MaintenanceRecord[]> {
    return this.query<MaintenanceRecord>({
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
      ExpressionAttributeNames: { '#pk': 'PK', '#sk': 'SK' },
      ExpressionAttributeValues: {
        ':pk': `EQUIP#${equipmentId}`,
        ':skPrefix': 'MAINTENANCE#',
      },
      ScanIndexForward: false, // newest first
    });
  }

  /**
   * Find a single maintenance record by its ID.
   * Uses GSI2 (EntityType=MAINTENANCE_RECORD) with a filter on id.
   * Note: this does a query + filter — acceptable for MVP, consider a dedicated GSI for prod.
   */
  async findMaintenanceRecordById(
    recordId: string,
  ): Promise<MaintenanceRecord | null> {
    const results = await this.query<MaintenanceRecord>({
      IndexName: GSI.GSI2,
      KeyConditionExpression: '#entityType = :entityType',
      FilterExpression: '#id = :id',
      ExpressionAttributeNames: { '#entityType': 'EntityType', '#id': 'id' },
      ExpressionAttributeValues: {
        ':entityType': EntityType.MAINTENANCE_RECORD,
        ':id': recordId,
      },
      Limit: 1,
    });
    return results[0] ?? null;
  }

  /** Save (create or replace) a maintenance record */
  async saveMaintenanceRecord(record: MaintenanceRecord): Promise<void> {
    const dynRecord: DynamoRecord<MaintenanceRecord> = {
      ...record,
      ...buildKey.maintenanceRecord.main(
        record.equipmentId,
        record.scheduledDate,
        record.id,
      ),
      ...buildKey.maintenanceRecord.gsi1(record.unitId, record.scheduledDate),
      ...buildKey.maintenanceRecord.gsi3(record.equipmentId, record.scheduledDate),
      EntityType: EntityType.MAINTENANCE_RECORD,
      Status: record.status,
      CreatedAt: record.createdAt,
    };
    await this.putItem<MaintenanceRecord>(dynRecord);
  }
}
