# SPEC: Inventory Domain

## Status
IMPLEMENTED

## Problem Statement
Rental managers and warehouse staff need a central catalog of equipment and individual stock units. Without it, there is no source of truth for what equipment exists, how many units are available, what condition they're in, or when maintenance is due. This blocks availability checking, dispatch planning, and accurate quoting.

## Solution Overview
The Inventory domain manages the equipment catalog (types of equipment) and the stock unit registry (physical instances). It tracks condition, availability status, and maintenance history per unit. All other domains query or subscribe to inventory events rather than owning any equipment data.

## Domain
inventory

## Entities Affected
| Entity | Operation |
|---|---|
| Equipment | Create, Read, Update, List |
| Category | Create, Read, List |
| StockUnit | Create, Read, UpdateStatus, List |
| MaintenanceRecord | Create, Complete, Read (history) |

## API Endpoints

| Method | Path | Description | Auth |
|---|---|---|---|
| GET | /inventory/categories | List all categories | STAFF |
| POST | /inventory/categories | Create a category | ADMIN |
| GET | /inventory/equipment | List all equipment (paginated) | STAFF |
| POST | /inventory/equipment | Create equipment | ADMIN |
| GET | /inventory/equipment/:id | Get equipment by ID | STAFF |
| PUT | /inventory/equipment/:id | Update equipment | ADMIN |
| GET | /inventory/equipment/:id/units | List stock units for equipment | STAFF |
| POST | /inventory/equipment/:id/units | Create a stock unit | ADMIN |
| PATCH | /inventory/equipment/:id/units/:unitId/status | Update stock unit status | ADMIN |
| POST | /inventory/maintenance | Create maintenance record | ADMIN |
| PATCH | /inventory/maintenance/:id/complete | Complete a maintenance record | ADMIN |
| GET | /inventory/equipment/:id/maintenance | Get maintenance history for equipment | STAFF |

## Request/Response Shapes

```typescript
// POST /inventory/equipment
interface CreateEquipmentRequest {
  name: string;
  description?: string;
  categoryId: string;
  dailyRate: number;
  weeklyRate?: number;
  specifications?: Record<string, unknown>;
  tags?: string[];
}

// PUT /inventory/equipment/:id
interface UpdateEquipmentRequest {
  name?: string;
  description?: string;
  categoryId?: string;
  dailyRate?: number;
  weeklyRate?: number;
  specifications?: Record<string, unknown>;
  tags?: string[];
  isActive?: boolean;
}

// POST /inventory/categories
interface CreateCategoryRequest {
  name: string;
  description?: string;
}

// POST /inventory/equipment/:id/units
interface CreateStockUnitRequest {
  serialNumber: string;
  condition: EquipmentCondition;
  purchaseDate: string; // ISO date
  notes?: string;
}

// PATCH /inventory/equipment/:id/units/:unitId/status
interface UpdateStockUnitStatusRequest {
  status: StockUnitStatus;
  reason: 'RESERVATION' | 'MAINTENANCE' | 'DAMAGE' | 'MANUAL';
  referenceId?: string; // reservationId or maintenanceRecordId
}

// POST /inventory/maintenance
interface CreateMaintenanceRecordRequest {
  equipmentId: string;
  unitId: string;
  maintenanceType: MaintenanceType;
  scheduledDate: string; // ISO date
  notes?: string;
  technicianId?: string;
}

// PATCH /inventory/maintenance/:id/complete
interface CompleteMaintenanceRequest {
  newCondition: EquipmentCondition;
  notes: string;
  completedDate: string; // ISO datetime
  technicianId: string;
}
```

## Business Rules

1. Equipment cannot be deleted — it can only be deactivated (`isActive: false`)
2. A StockUnit's status can only be changed manually via the UpdateStockUnitStatus endpoint (no automatic transitions from API calls)
3. RETIRED is a terminal status — a RETIRED unit cannot transition to any other status
4. A MaintenanceRecord can only be completed if its current status is IN_PROGRESS or SCHEDULED
5. Completing a maintenance record updates the StockUnit's `lastMaintenanceDate`
6. Creating a maintenance record does NOT automatically change the StockUnit status — warehouse staff must update status separately
7. Equipment names must be unique within a category
8. Serial numbers must be globally unique across all StockUnits
9. Daily rate must be positive; weekly rate, if provided, must be positive

## DynamoDB Access Patterns Used

- AP-01: Get equipment by ID — `PK=EQUIP#{id}, SK=METADATA`
- AP-02: List equipment in category — `GSI1PK=CATEGORY#{id}` on GSI1
- AP-03: List all categories — `EntityType=CATEGORY` on GSI2
- AP-04: Get all stock units for equipment — `PK=EQUIP#{id}, SK begins_with UNIT#`
- AP-05: Get stock unit by unit ID — `GSI1PK=UNIT#{unitId}, GSI1SK=METADATA` on GSI1
- AP-06: Get available stock units — `Status=AVAILABLE, GSI3SK begins_with EQUIP#{id}` on GSI3
- AP-13: Get maintenance history for equipment — `PK=EQUIP#{id}, SK begins_with MAINTENANCE#`
- AP-21: List all equipment — `EntityType=EQUIPMENT` on GSI2

## Events Published

| Event | Trigger |
|---|---|
| `inventory.equipment.created` | New equipment created |
| `inventory.equipment.updated` | Equipment fields updated |
| `inventory.stockunit.availability-changed` | StockUnit status updated |
| `inventory.maintenance.scheduled` | MaintenanceRecord created |
| `inventory.maintenance.completed` | MaintenanceRecord marked complete |

## Events Consumed
- `reservations.reservation.confirmed` → mark stock units as RESERVED (future work)
- `reservations.reservation.cancelled` → release stock units back to AVAILABLE (future work)
- `logistics.return.completed` → trigger inspection workflow (future work)

## Error Cases

| Code | Condition | HTTP Status |
|---|---|---|
| NOT_FOUND | Equipment/StockUnit/Category/MaintenanceRecord not found | 404 |
| CONFLICT | Serial number already exists | 409 |
| VALIDATION_ERROR | Missing required fields, invalid enum values, negative rate | 400 |
| INVALID_STATUS_TRANSITION | Attempting to transition from RETIRED | 409 |
| INVALID_MAINTENANCE_COMPLETION | MaintenanceRecord not in SCHEDULED or IN_PROGRESS state | 409 |

## Test Cases

- [x] Happy path: create equipment, verify saved, event published
- [x] getEquipment not found → NotFoundError
- [x] updateStockUnitStatus RETIRED → AVAILABLE → rejected (invalid transition)
- [x] createStockUnit for non-existent equipment → NotFoundError
- [x] POST /inventory/equipment with valid body → 201
- [x] POST /inventory/equipment with missing name → 400 with validation errors
- [x] GET /inventory/equipment/:id not found → 404
- [x] PATCH status with invalid status value → 400
