# Reservations Domain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the full Reservations bounded context — booking lifecycle (DRAFT → CONFIRMED → CANCELLED), synchronous conflict detection via `TransactWriteItems`, and EventBridge integration with the Inventory and Billing domains.

**Architecture:** Follows the inventory domain pattern exactly: `ReservationRepository` extends `BaseRepository` with tenant-prefixed keys (Plan 1 applied), `ReservationService` returns `Result<T>` and never throws, and `handler.ts` is the Lambda entry point that reads `tenantId` from `event.requestContext.authorizer.lambda.tenantId`. Conflict detection queries `AvailabilityBlock` records by unit PK, filters date overlaps in application code, then writes all blocks + status update atomically via `TransactWriteItems` with `attribute_not_exists` guards.

**Tech Stack:** TypeScript (strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), DynamoDB single-table (GSI1/GSI2/GSI3), `@aws-sdk/lib-dynamodb` `TransactWriteCommand`, EventBridge via `@eventgear/events`, Zod for validation, Jest for all tests.

**Spec:** docs/specs/2026-03-23-mvp-production-readiness-design.md (Section 2)

---

## Critical Files to Read Before Starting

- `packages/db/src/base-repository.ts` — BaseRepository (after Plan 1: constructor takes `tenantId: string`)
- `packages/db/src/schema.ts` — buildKey builders (after Plan 1: all take `tenantId` as first param)
- `domains/inventory/` — reference implementation (types, repository, service, handler, events, validators patterns)
- `packages/core/src/errors.ts` — AppError hierarchy (NotFoundError, ConflictError, ValidationError, InternalError)
- `packages/events/src/contracts.ts` — existing event payload interfaces to extend
- `apps/api/src/server.ts` — Express dev server pattern to replicate for reservation routes

---

## Key Conventions (MUST follow exactly)

- Every file starts with the `@file / @domain / @purpose / @inputs / @outputs / @dependencies / @ai-notes` header block
- `tenantId` flows in from `event.requestContext.authorizer.lambda.tenantId` in Lambda; from `X-Tenant-Id` header in local Express dev server
- `items[0]` has type `T | undefined` due to `noUncheckedIndexedAccess` — always use `items.at(0) ?? fallback`
- Optional fields on domain interfaces use `field?: Type | undefined` not `field?: Type` (exactOptionalPropertyTypes)
- Repositories receive `tenantId` in constructor after Plan 1; pass it to every buildKey call
- `GSI2PK` (`EntityType` attribute) stores the compound value `TENANT#{tenantId}#ENTITY#RESERVATION`
- `GSI3PK` (`Status` attribute) stores the compound value `TENANT#{tenantId}#CONFIRMED` etc.
- `TransactWriteItems` limit is 100 items — for MVP, reservations with > 49 items (each block = 1 Put + reservation update = 1 Put) are rejected at service layer
- `ReservationConfirmedPayload` MUST include `tenantId` — inventory consumer needs it to construct tenant-prefixed keys

---

## File Structure

```
domains/reservations/
  SPEC.md                          — stub pointing to design spec
  types.ts                         — all interfaces and enums
  validators.ts                    — Zod schemas for all endpoint bodies
  repository.ts                    — DynamoDB access, TransactWriteItems
  service.ts                       — business logic, conflict detection
  events.ts                        — typed EventBridge publishers
  handler.ts                       — Lambda entry point (7 endpoints)
  index.ts                         — barrel exports
  __tests__/
    service.test.ts                — unit tests (mocked repo + events)
    handler.test.ts                — handler tests (mocked repo, real service)

packages/events/src/
  contracts.ts                     — ADD tenantId to ReservationConfirmedPayload
                                     ADD StockUnitAvailabilityChangedPayload.tenantId
                                     ADD ReservationCreatedPayload, ReservationCancelledPayload,
                                         ReservationModifiedPayload fields
```

---

## Task 1: Scaffold — package.json, tsconfig, types.ts, validators.ts, SPEC.md, index.ts

**Files:**
- Create: `domains/reservations/package.json`
- Create: `domains/reservations/tsconfig.json`
- Create: `domains/reservations/jest.config.ts`
- Create: `domains/reservations/SPEC.md`
- Create: `domains/reservations/types.ts`
- Create: `domains/reservations/validators.ts`
- Create: `domains/reservations/index.ts`

### Step 1.0: Create package.json, tsconfig.json, jest.config.ts

The workspace package must exist before `pnpm --filter @eventgear/reservations test` can run.

```json
// domains/reservations/package.json
{
  "name": "@eventgear/reservations",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "test": "jest"
  },
  "dependencies": {
    "@eventgear/core": "workspace:*",
    "@eventgear/db": "workspace:*",
    "@eventgear/config": "workspace:*",
    "@eventgear/events": "workspace:*",
    "ulid": "^2.3.0",
    "zod": "^3.0.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "jest": "*",
    "@types/jest": "*",
    "ts-jest": "*"
  }
}
```

```json
// domains/reservations/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"]
}
```

```typescript
// domains/reservations/jest.config.ts
import type { Config } from 'jest';
export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  testMatch: ['**/__tests__/**/*.test.ts'],
} satisfies Config;
```

Run `pnpm install` at the monorepo root to register the new workspace package.

### Step 1.1: Write the failing test first

Create `domains/reservations/__tests__/service.test.ts` with a single import test to force the scaffold into existence:

```typescript
// domains/reservations/__tests__/service.test.ts
import { ReservationStatus } from '../index';

describe('Reservations domain scaffold', () => {
  it('exports ReservationStatus enum', () => {
    expect(ReservationStatus.DRAFT).toBe('DRAFT');
    expect(ReservationStatus.CONFIRMED).toBe('CONFIRMED');
    expect(ReservationStatus.CANCELLED).toBe('CANCELLED');
  });
});
```

Run — expected to fail (module not found):
```bash
pnpm --filter @eventgear/reservations test 2>&1 | head -20
```

### Step 1.2: Create SPEC.md

```markdown
# SPEC: Reservations Domain

## Status
APPROVED

## Reference
Full specification: docs/specs/2026-03-23-mvp-production-readiness-design.md (Section 2)

## Domain
reservations

## Summary
Full booking lifecycle from DRAFT to COMPLETED/CANCELLED. Conflict detection at confirmation
time using AvailabilityBlock records and TransactWriteItems for atomic writes.
```

### Step 1.3: Create types.ts

```typescript
/**
 * @file types.ts
 * @domain reservations
 * @purpose All domain interfaces and enums for the Reservations bounded context
 *
 * @outputs Reservation, ReservationItem, AvailabilityBlock types and all input/mutation types
 *
 * @dependencies @eventgear/core
 * @ai-notes These are DOMAIN types — not DynamoDB records. DynamoRecord<T> wrappers live in repository.ts.
 *   tenantId is a field on Reservation (root aggregate) so event payloads can include it.
 *   ReservationItem does NOT carry tenantId — it is always accessed through its parent Reservation.
 *   COMPLETED and CANCELLED are terminal states — no transitions out of them.
 *   totalAmount is computed at confirmation and never recalculated after.
 */
import type { ID, ISODateString, ISODateTimeString, Timestamps } from '@eventgear/core';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export enum ReservationStatus {
  DRAFT     = 'DRAFT',
  QUOTED    = 'QUOTED',
  CONFIRMED = 'CONFIRMED',
  ACTIVE    = 'ACTIVE',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

// ---------------------------------------------------------------------------
// Domain entities
// ---------------------------------------------------------------------------

export interface Reservation extends Timestamps {
  readonly id: ID;
  readonly tenantId: string;       // root aggregate — needed for event payloads and app-layer filtering
  readonly customerId: string;
  readonly startDate: ISODateString;  // "YYYY-MM-DD"
  readonly endDate: ISODateString;
  readonly status: ReservationStatus;
  readonly totalAmount: number;       // 0 until confirmed; locked after
  readonly notes?: string | undefined;
}

export interface ReservationItem {
  readonly id: ID;
  readonly reservationId: string;
  readonly equipmentId: string;
  readonly unitId: string;
  readonly quantity: number;
  readonly dailyRateSnapshot: number;  // rate locked at booking time
}

export interface AvailabilityBlock {
  readonly unitId: string;
  readonly startDate: ISODateString;
  readonly endDate: ISODateString;
  readonly reservationId: string;
}

// Convenience type for get-reservation-with-items response
export interface ReservationWithItems {
  readonly reservation: Reservation;
  readonly items: readonly ReservationItem[];
}

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface CreateReservationInput {
  readonly name?: string | undefined;       // for display only — not stored on entity
  readonly startDate: ISODateString;
  readonly endDate: ISODateString;
  readonly customerId: string;
  readonly notes?: string | undefined;
}

export interface AddReservationItemInput {
  readonly equipmentId: string;
  readonly unitId: string;
  readonly quantity: number;
  readonly dailyRateSnapshot: number;
}

export interface ListReservationsInput {
  readonly status?: ReservationStatus | undefined;
  readonly limit?: number | undefined;
  readonly nextToken?: string | undefined;
}
```

### Step 1.4: Create validators.ts

```typescript
/**
 * @file validators.ts
 * @domain reservations
 * @purpose Zod validation schemas for all Reservations API input types
 *
 * @inputs  Raw HTTP request bodies (unknown)
 * @outputs Validated, typed input objects or ZodError
 *
 * @dependencies zod, ./types
 * @ai-notes Only used at the Lambda boundary (handler.ts).
 *   Service functions receive already-validated types — do not re-validate inside service.
 *   Use .safeParse() in handlers — never .parse() which throws.
 *   ISO date regex: /^\d{4}-\d{2}-\d{2}$/ — matches "YYYY-MM-DD" only.
 */
import { z } from 'zod';
import { ReservationStatus } from './types.js';

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD format');

export const createReservationSchema = z.object({
  startDate:  isoDateSchema,
  endDate:    isoDateSchema,
  customerId: z.string().min(1, 'customerId is required'),
  notes:      z.string().max(1000).optional(),
});

export type CreateReservationValidated = z.infer<typeof createReservationSchema>;

export const addReservationItemSchema = z.object({
  equipmentId:       z.string().min(1, 'equipmentId is required'),
  unitId:            z.string().min(1, 'unitId is required'),
  quantity:          z.number().int().positive('quantity must be a positive integer'),
  dailyRateSnapshot: z.number().positive('dailyRateSnapshot must be positive'),
});

export type AddReservationItemValidated = z.infer<typeof addReservationItemSchema>;

export const listReservationsSchema = z.object({
  status:    z.nativeEnum(ReservationStatus).optional(),
  limit:     z.coerce.number().int().positive().max(100).optional(),
  nextToken: z.string().optional(),
});

export type ListReservationsValidated = z.infer<typeof listReservationsSchema>;

export const paginationSchema = z.object({
  limit:     z.coerce.number().int().positive().max(100).optional(),
  nextToken: z.string().optional(),
});

export type PaginationValidated = z.infer<typeof paginationSchema>;
```

### Step 1.5: Create index.ts (barrel — grows as files are added)

```typescript
/**
 * @file index.ts
 * @domain reservations
 * @purpose Public API for the Reservations domain package
 */
export { ReservationStatus } from './types.js';
export type {
  Reservation,
  ReservationItem,
  AvailabilityBlock,
  ReservationWithItems,
  CreateReservationInput,
  AddReservationItemInput,
  ListReservationsInput,
} from './types.js';
export {
  createReservationSchema,
  addReservationItemSchema,
  listReservationsSchema,
  paginationSchema,
} from './validators.js';
```

### Step 1.6: Run failing test — now passing

```bash
pnpm --filter @eventgear/reservations test
```

Expected output:
```
PASS __tests__/service.test.ts
  Reservations domain scaffold
    ✓ exports ReservationStatus enum
```

- [ ] **Step 1: Write failing import test**
- [ ] **Step 2: Create SPEC.md**
- [ ] **Step 3: Create types.ts**
- [ ] **Step 4: Create validators.ts**
- [ ] **Step 5: Create index.ts**
- [ ] **Step 6: Run test — confirm green**
- [ ] **Step 7: Commit**

```bash
git add domains/reservations/SPEC.md domains/reservations/types.ts domains/reservations/validators.ts domains/reservations/index.ts domains/reservations/__tests__/service.test.ts
git commit -m "feat(reservations): scaffold domain types, validators, and index"
```

---

## Task 2: ReservationRepository

**Files:**
- Create: `domains/reservations/repository.ts`
- Create: `domains/reservations/__tests__/repository.test.ts` (integration — skipped in CI without local DynamoDB)

### Step 2.1: Write failing integration test first

```typescript
// domains/reservations/__tests__/repository.test.ts
/**
 * @file repository.test.ts
 * @domain reservations
 * @purpose Integration tests for ReservationRepository against local DynamoDB
 *
 * @ai-notes Requires DynamoDB Local running at DYNAMODB_ENDPOINT (docker run -p 8000:8000 amazon/dynamodb-local).
 *   Tests are skipped when DYNAMODB_ENDPOINT is not set (CI safety).
 *   Each test suite creates its own tenant prefix to avoid cross-test pollution.
 */
import { ReservationRepository } from '../repository';
import { ReservationStatus } from '../types';

const SKIP = !process.env['DYNAMODB_ENDPOINT'];
const describeFn = SKIP ? describe.skip : describe;

const TEST_TENANT = 'tenant_REPO_TEST_01';

describeFn('ReservationRepository (integration)', () => {
  let repo: ReservationRepository;

  beforeAll(() => {
    repo = new ReservationRepository(TEST_TENANT);
  });

  describe('saveReservation + findReservationById', () => {
    it('round-trips a reservation with all fields', async () => {
      const now = new Date().toISOString();
      const res = {
        id: 'res_TEST01',
        tenantId: TEST_TENANT,
        customerId: 'cust_TEST01',
        startDate: '2025-09-01',
        endDate: '2025-09-07',
        status: ReservationStatus.DRAFT,
        totalAmount: 0,
        createdAt: now,
        updatedAt: now,
      };

      await repo.saveReservation(res);
      const found = await repo.findReservationById('res_TEST01');

      expect(found).not.toBeNull();
      expect(found?.id).toBe('res_TEST01');
      expect(found?.status).toBe(ReservationStatus.DRAFT);
      expect(found?.tenantId).toBe(TEST_TENANT);
    });
  });

  describe('saveReservationItem + findItemsByReservation', () => {
    it('stores and retrieves items for a reservation', async () => {
      const item = {
        id: 'item_TEST01',
        reservationId: 'res_TEST01',
        equipmentId: 'equip_TEST01',
        unitId: 'unit_TEST01',
        quantity: 2,
        dailyRateSnapshot: 150,
      };

      await repo.saveReservationItem(item);
      const items = await repo.findItemsByReservation('res_TEST01');

      expect(items).toHaveLength(1);
      expect(items.at(0)?.unitId).toBe('unit_TEST01');
    });
  });

  describe('deleteReservationItem', () => {
    it('removes a specific item from a reservation', async () => {
      await repo.deleteReservationItem('res_TEST01', 'item_TEST01');
      const items = await repo.findItemsByReservation('res_TEST01');
      expect(items).toHaveLength(0);
    });
  });

  describe('findBlocksByUnit + writeConfirmationTransaction', () => {
    it('writes availability blocks and updates status atomically', async () => {
      const now = new Date().toISOString();
      const res = {
        id: 'res_CONFIRM01',
        tenantId: TEST_TENANT,
        customerId: 'cust_TEST01',
        startDate: '2025-10-01',
        endDate: '2025-10-05',
        status: ReservationStatus.DRAFT,
        totalAmount: 0,
        createdAt: now,
        updatedAt: now,
      };
      await repo.saveReservation(res);

      const item = {
        id: 'item_CONFIRM01',
        reservationId: 'res_CONFIRM01',
        equipmentId: 'equip_TEST01',
        unitId: 'unit_CONFIRM01',
        quantity: 1,
        dailyRateSnapshot: 150,
      };

      const blocks = [
        {
          unitId: 'unit_CONFIRM01',
          startDate: '2025-10-01',
          endDate: '2025-10-05',
          reservationId: 'res_CONFIRM01',
        },
      ];

      await repo.writeConfirmationTransaction(
        { ...res, status: ReservationStatus.CONFIRMED, totalAmount: 600 },
        blocks,
      );

      const found = await repo.findReservationById('res_CONFIRM01');
      expect(found?.status).toBe(ReservationStatus.CONFIRMED);
      expect(found?.totalAmount).toBe(600);

      const foundBlocks = await repo.findBlocksByUnit('unit_CONFIRM01');
      expect(foundBlocks).toHaveLength(1);
      expect(foundBlocks.at(0)?.reservationId).toBe('res_CONFIRM01');
    });
  });

  describe('findBlocksByReservation + writeCancellationTransaction', () => {
    it('deletes availability blocks and updates status to CANCELLED atomically', async () => {
      const blocks = await repo.findBlocksByReservation('res_CONFIRM01');
      expect(blocks.length).toBeGreaterThan(0);

      const now = new Date().toISOString();
      const confirmed = {
        id: 'res_CONFIRM01',
        tenantId: TEST_TENANT,
        customerId: 'cust_TEST01',
        startDate: '2025-10-01',
        endDate: '2025-10-05',
        status: ReservationStatus.CONFIRMED,
        totalAmount: 600,
        createdAt: now,
        updatedAt: now,
      };

      await repo.writeCancellationTransaction(
        { ...confirmed, status: ReservationStatus.CANCELLED },
        blocks,
      );

      const found = await repo.findReservationById('res_CONFIRM01');
      expect(found?.status).toBe(ReservationStatus.CANCELLED);

      const remainingBlocks = await repo.findBlocksByUnit('unit_CONFIRM01');
      expect(remainingBlocks).toHaveLength(0);
    });
  });
});
```

Run — expected to skip (no local DynamoDB in unit test environment):
```bash
pnpm --filter @eventgear/reservations test
```

Expected: `SKIP` for integration tests, 0 failures.

### Step 2.2: Create repository.ts

```typescript
/**
 * @file repository.ts
 * @domain reservations
 * @purpose DynamoDB access layer for the Reservations domain
 *
 * @inputs  Entity IDs, domain entities, AvailabilityBlock arrays
 * @outputs Domain entities (keys stripped), void for writes
 *
 * @dependencies @eventgear/db, @aws-sdk/lib-dynamodb
 * @ai-notes Access patterns implemented (all with TENANT#{tenantId} prefix per Plan 1):
 *   findReservationById      — PK=TENANT#{t}#RESERVATION#{id}, SK=METADATA (main table)
 *   listReservations         — EntityType=TENANT#{t}#ENTITY#RESERVATION on GSI2 (paginated)
 *   listReservationsByStatus — Status=TENANT#{t}#{status} on GSI3 (paginated)
 *   findItemsByReservation   — PK=TENANT#{t}#RESERVATION#{id}, SK begins_with ITEM# (main)
 *   findBlocksByUnit         — PK=TENANT#{t}#UNIT#{unitId}, SK begins_with BLOCK# (main)
 *   findBlocksByReservation  — GSI1PK=TENANT#{t}#RESERVATION#{id}, GSI1SK begins_with BLOCK# (GSI1)
 *
 *   writeConfirmationTransaction: TransactWriteItems — Put each AvailabilityBlock with
 *     ConditionExpression "attribute_not_exists(PK) AND attribute_not_exists(SK)" + Put updated Reservation.
 *   writeCancellationTransaction: TransactWriteItems — Delete each AvailabilityBlock + Put updated Reservation.
 *
 *   GSI2PK is stored in the 'EntityType' attribute as compound value "TENANT#{t}#ENTITY#RESERVATION".
 *   GSI3PK is stored in the 'Status' attribute as compound value "TENANT#{t}#{status}".
 *   Both are stripped by BaseRepository.stripKeys() (EntityType and Status are in DYNAMO_KEY_FIELDS).
 *   The domain entity's status field (lowercase) is stored separately and survives stripping.
 */
import {
  TransactWriteCommand,
  type TransactWriteCommandInput,
} from '@aws-sdk/lib-dynamodb';
import { BaseRepository, GSI } from '@eventgear/db';
import type { DynamoRecord } from '@eventgear/db';
import { getConfig } from '@eventgear/config';
import type { PaginatedResult, PaginationParams } from '@eventgear/core';
import { getDynamoDocumentClient } from '@eventgear/db';
import type {
  AvailabilityBlock,
  Reservation,
  ReservationItem,
} from './types.js';
import { ReservationStatus } from './types.js';

export class ReservationRepository extends BaseRepository<Reservation> {
  constructor(tenantId: string) {
    super(tenantId);
  }

  // ---------------------------------------------------------------------------
  // Key builders (private — use tenant prefix from constructor)
  // ---------------------------------------------------------------------------

  private reservationPK(reservationId: string): string {
    return `TENANT#${this.tenantId}#RESERVATION#${reservationId}`;
  }

  private unitPK(unitId: string): string {
    return `TENANT#${this.tenantId}#UNIT#${unitId}`;
  }

  private blockSK(startDate: string, endDate: string, reservationId: string): string {
    return `BLOCK#${startDate}#${endDate}#${reservationId}`;
  }

  private gsi2EntityType(): string {
    return `TENANT#${this.tenantId}#ENTITY#RESERVATION`;
  }

  private gsi3Status(status: ReservationStatus): string {
    return `TENANT#${this.tenantId}#${status}`;
  }

  // ---------------------------------------------------------------------------
  // Reservation CRUD
  // ---------------------------------------------------------------------------

  /** Main table get — PK=TENANT#{t}#RESERVATION#{id}, SK=METADATA */
  async findReservationById(id: string): Promise<Reservation | null> {
    return this.getItem<Reservation>({
      PK: this.reservationPK(id),
      SK: 'METADATA',
    });
  }

  /** GSI2 list all reservations for tenant — EntityType=TENANT#{t}#ENTITY#RESERVATION */
  async listReservations(
    pagination: PaginationParams,
  ): Promise<PaginatedResult<Reservation>> {
    return this.queryPaginated<Reservation>(
      {
        IndexName: GSI.GSI2,
        KeyConditionExpression: '#entityType = :entityType',
        ExpressionAttributeNames: { '#entityType': 'EntityType' },
        ExpressionAttributeValues: { ':entityType': this.gsi2EntityType() },
      },
      pagination,
    );
  }

  /** GSI3 list reservations by status — Status=TENANT#{t}#{status} */
  async listReservationsByStatus(
    status: ReservationStatus,
    pagination: PaginationParams,
  ): Promise<PaginatedResult<Reservation>> {
    return this.queryPaginated<Reservation>(
      {
        IndexName: GSI.GSI3,
        KeyConditionExpression: '#status = :status',
        ExpressionAttributeNames: { '#status': 'Status' },
        ExpressionAttributeValues: { ':status': this.gsi3Status(status) },
      },
      pagination,
    );
  }

  /** Put (create or replace) a reservation record */
  async saveReservation(reservation: Reservation): Promise<void> {
    const record: DynamoRecord<Reservation> = {
      ...reservation,
      PK: this.reservationPK(reservation.id),
      SK: 'METADATA',
      GSI1PK: `TENANT#${this.tenantId}#CUSTOMER#${reservation.customerId}`,
      GSI1SK: `RESERVATION#${reservation.id}`,
      EntityType: this.gsi2EntityType(),
      CreatedAt: reservation.createdAt,
      // Status (GSI3PK) stores compound tenant-prefixed value
      Status: this.gsi3Status(reservation.status),
      GSI3SK: `${reservation.startDate}#${reservation.id}`,
    };
    await this.putItem<Reservation>(record);
  }

  // ---------------------------------------------------------------------------
  // ReservationItem CRUD
  // ---------------------------------------------------------------------------

  /** SK begins_with ITEM# — all items for a reservation */
  async findItemsByReservation(reservationId: string): Promise<ReservationItem[]> {
    return this.query<ReservationItem>({
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
      ExpressionAttributeNames: { '#pk': 'PK', '#sk': 'SK' },
      ExpressionAttributeValues: {
        ':pk': this.reservationPK(reservationId),
        ':skPrefix': 'ITEM#',
      },
    });
  }

  /** Put a single ReservationItem */
  async saveReservationItem(item: ReservationItem): Promise<void> {
    const record: DynamoRecord<ReservationItem> = {
      ...item,
      PK: this.reservationPK(item.reservationId),
      SK: `ITEM#${item.id}`,
      GSI1PK: `TENANT#${this.tenantId}#EQUIP#${item.equipmentId}`,
      GSI1SK: `RESERVATION#${item.reservationId}#ITEM#${item.id}`,
      EntityType: `RESERVATION_ITEM`,
    };
    await this.putItem<ReservationItem>(record);
  }

  /** Delete a single ReservationItem by reservationId + itemId */
  async deleteReservationItem(
    reservationId: string,
    itemId: string,
  ): Promise<void> {
    await this.deleteItem({
      PK: this.reservationPK(reservationId),
      SK: `ITEM#${itemId}`,
    });
  }

  // ---------------------------------------------------------------------------
  // AvailabilityBlock queries
  // ---------------------------------------------------------------------------

  /** Main table — PK=TENANT#{t}#UNIT#{unitId}, SK begins_with BLOCK# */
  async findBlocksByUnit(unitId: string): Promise<AvailabilityBlock[]> {
    return this.query<AvailabilityBlock>({
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
      ExpressionAttributeNames: { '#pk': 'PK', '#sk': 'SK' },
      ExpressionAttributeValues: {
        ':pk': this.unitPK(unitId),
        ':skPrefix': 'BLOCK#',
      },
    });
  }

  /** GSI1 — PK=TENANT#{t}#RESERVATION#{id}, SK begins_with BLOCK# */
  async findBlocksByReservation(reservationId: string): Promise<AvailabilityBlock[]> {
    return this.query<AvailabilityBlock>({
      IndexName: GSI.GSI1,
      KeyConditionExpression: '#gsi1pk = :gsi1pk AND begins_with(#gsi1sk, :skPrefix)',
      ExpressionAttributeNames: { '#gsi1pk': 'GSI1PK', '#gsi1sk': 'GSI1SK' },
      ExpressionAttributeValues: {
        ':gsi1pk': `TENANT#${this.tenantId}#RESERVATION#${reservationId}`,
        ':skPrefix': 'BLOCK#',
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Atomic transactions
  // ---------------------------------------------------------------------------

  /**
   * Confirm a reservation atomically:
   * - Put each AvailabilityBlock with ConditionExpression: attribute_not_exists(PK) AND attribute_not_exists(SK)
   * - Put updated Reservation (status=CONFIRMED, totalAmount set)
   *
   * Throws ConditionalCheckFailedException if any block already exists (race condition guard).
   * Service layer catches this and returns { success: false, error: ConflictError }.
   *
   * TransactWriteItems limit: 100 items. Each confirm writes N blocks + 1 reservation.
   * Service must validate items.length <= 99 before calling this method.
   */
  async writeConfirmationTransaction(
    reservation: Reservation,
    blocks: readonly AvailabilityBlock[],
  ): Promise<void> {
    const client = getDynamoDocumentClient();
    const tableName = getConfig().dynamoTableName;

    const transactItems: TransactWriteCommandInput['TransactItems'] = [
      // Update reservation
      {
        Put: {
          TableName: tableName,
          Item: {
            ...reservation,
            PK: this.reservationPK(reservation.id),
            SK: 'METADATA',
            GSI1PK: `TENANT#${this.tenantId}#CUSTOMER#${reservation.customerId}`,
            GSI1SK: `RESERVATION#${reservation.id}`,
            EntityType: this.gsi2EntityType(),
            CreatedAt: reservation.createdAt,
            Status: this.gsi3Status(reservation.status),
            GSI3SK: `${reservation.startDate}#${reservation.id}`,
          },
        },
      },
      // Write each AvailabilityBlock with existence guard
      ...blocks.map((block) => ({
        Put: {
          TableName: tableName,
          Item: {
            ...block,
            PK: this.unitPK(block.unitId),
            SK: this.blockSK(block.startDate, block.endDate, block.reservationId),
            GSI1PK: `TENANT#${this.tenantId}#RESERVATION#${block.reservationId}`,
            GSI1SK: `BLOCK#${block.unitId}`,
            EntityType: 'AVAILABILITY_BLOCK',
          },
          ConditionExpression: 'attribute_not_exists(#pk) AND attribute_not_exists(#sk)',
          ExpressionAttributeNames: { '#pk': 'PK', '#sk': 'SK' },
        },
      })),
    ];

    await client.send(new TransactWriteCommand({ TransactItems: transactItems }));
  }

  /**
   * Cancel a reservation atomically:
   * - Delete each AvailabilityBlock for this reservation
   * - Put updated Reservation (status=CANCELLED)
   */
  async writeCancellationTransaction(
    reservation: Reservation,
    blocks: readonly AvailabilityBlock[],
  ): Promise<void> {
    const client = getDynamoDocumentClient();
    const tableName = getConfig().dynamoTableName;

    const transactItems: TransactWriteCommandInput['TransactItems'] = [
      // Update reservation
      {
        Put: {
          TableName: tableName,
          Item: {
            ...reservation,
            PK: this.reservationPK(reservation.id),
            SK: 'METADATA',
            GSI1PK: `TENANT#${this.tenantId}#CUSTOMER#${reservation.customerId}`,
            GSI1SK: `RESERVATION#${reservation.id}`,
            EntityType: this.gsi2EntityType(),
            CreatedAt: reservation.createdAt,
            Status: this.gsi3Status(reservation.status),
            GSI3SK: `${reservation.startDate}#${reservation.id}`,
          },
        },
      },
      // Delete each AvailabilityBlock
      ...blocks.map((block) => ({
        Delete: {
          TableName: tableName,
          Key: {
            PK: this.unitPK(block.unitId),
            SK: this.blockSK(block.startDate, block.endDate, block.reservationId),
          },
        },
      })),
    ];

    await client.send(new TransactWriteCommand({ TransactItems: transactItems }));
  }
}
```

### Step 2.3: Update index.ts to export repository

```typescript
// Add to domains/reservations/index.ts:
export { ReservationRepository } from './repository.js';
```

### Step 2.4: Run tests

```bash
pnpm --filter @eventgear/reservations test
```

Expected: integration tests skip, scaffold test still passes.

- [ ] **Step 1: Write failing integration test**
- [ ] **Step 2: Create repository.ts**
- [ ] **Step 3: Export ReservationRepository from index.ts**
- [ ] **Step 4: Run tests — confirm green**
- [ ] **Step 5: Commit**

```bash
git add domains/reservations/repository.ts domains/reservations/__tests__/repository.test.ts domains/reservations/index.ts
git commit -m "feat(reservations): add ReservationRepository with TransactWriteItems confirm/cancel"
```

---

## Task 3: ReservationService — business logic + conflict detection

**Files:**
- Create: `domains/reservations/service.ts`
- Expand: `domains/reservations/__tests__/service.test.ts` (replace scaffold test with full suite)

### Step 3.1: Write failing unit tests first

Replace the stub in `domains/reservations/__tests__/service.test.ts` with the full suite:

```typescript
/**
 * @file service.test.ts
 * @domain reservations
 * @purpose Unit tests for ReservationService — repo and events are mocked
 *
 * @ai-notes Mock the repository with jest.fn() stubs — never mock DynamoDB SDK directly.
 *   Conflict detection tests verify the date-overlap logic: block.startDate < res.endDate && block.endDate > res.startDate.
 *   The transaction mock should resolve for happy path, reject with a ConditionalCheckFailedException-like
 *   error for race condition tests.
 */
import { ReservationService } from '../service';
import { ReservationStatus } from '../types';
import type { Reservation, ReservationItem, AvailabilityBlock } from '../types';

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function makeReservation(overrides: Partial<Reservation> = {}): Reservation {
  const now = new Date().toISOString();
  return {
    id: 'res_TEST01',
    tenantId: 'tenant_TEST01',
    customerId: 'cust_TEST01',
    startDate: '2025-09-01',
    endDate: '2025-09-07',
    status: ReservationStatus.DRAFT,
    totalAmount: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeItem(overrides: Partial<ReservationItem> = {}): ReservationItem {
  return {
    id: 'item_TEST01',
    reservationId: 'res_TEST01',
    equipmentId: 'equip_TEST01',
    unitId: 'unit_TEST01',
    quantity: 1,
    dailyRateSnapshot: 150,
    ...overrides,
  };
}

function makeBlock(overrides: Partial<AvailabilityBlock> = {}): AvailabilityBlock {
  return {
    unitId: 'unit_TEST01',
    startDate: '2025-09-01',
    endDate: '2025-09-07',
    reservationId: 'res_TEST01',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock setup
// ---------------------------------------------------------------------------

function makeMockRepo() {
  return {
    findReservationById:      jest.fn<Promise<Reservation | null>, [string]>(),
    listReservations:         jest.fn(),
    listReservationsByStatus: jest.fn(),
    saveReservation:          jest.fn<Promise<void>, [Reservation]>(),
    findItemsByReservation:   jest.fn<Promise<ReservationItem[]>, [string]>(),
    saveReservationItem:      jest.fn<Promise<void>, [ReservationItem]>(),
    deleteReservationItem:    jest.fn<Promise<void>, [string, string]>(),
    findBlocksByUnit:         jest.fn<Promise<AvailabilityBlock[]>, [string]>(),
    findBlocksByReservation:  jest.fn<Promise<AvailabilityBlock[]>, [string]>(),
    writeConfirmationTransaction: jest.fn<Promise<void>, [Reservation, readonly AvailabilityBlock[]]>(),
    writeCancellationTransaction: jest.fn<Promise<void>, [Reservation, readonly AvailabilityBlock[]]>(),
  };
}

function makeMockEvents() {
  return {
    reservationCreated:   jest.fn<Promise<void>, [Reservation]>(),
    reservationConfirmed: jest.fn(),
    reservationCancelled: jest.fn(),
    reservationModified:  jest.fn(),
    conflictDetected:     jest.fn(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ReservationService', () => {
  let service: ReservationService;
  let mockRepo: ReturnType<typeof makeMockRepo>;
  let mockEvents: ReturnType<typeof makeMockEvents>;

  beforeEach(() => {
    mockRepo   = makeMockRepo();
    mockEvents = makeMockEvents();
    service = new ReservationService(
      mockRepo as unknown as InstanceType<typeof import('../repository').ReservationRepository>,
      mockEvents as unknown as InstanceType<typeof import('../events').ReservationEventPublisher>,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ── createReservation ──────────────────────────────────────────────────────

  describe('createReservation', () => {
    it('saves a DRAFT reservation and publishes reservationCreated event', async () => {
      mockRepo.saveReservation.mockResolvedValue(undefined);
      mockEvents.reservationCreated.mockResolvedValue(undefined);

      const result = await service.createReservation('tenant_TEST01', {
        startDate: '2025-09-01',
        endDate: '2025-09-07',
        customerId: 'cust_TEST01',
      });

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.data.status).toBe(ReservationStatus.DRAFT);
      expect(result.data.tenantId).toBe('tenant_TEST01');
      expect(result.data.totalAmount).toBe(0);
      expect(result.data.id).toBeTruthy();
      expect(mockRepo.saveReservation).toHaveBeenCalledTimes(1);
      expect(mockEvents.reservationCreated).toHaveBeenCalledTimes(1);
    });

    it('rejects when endDate is before startDate', async () => {
      const result = await service.createReservation('tenant_TEST01', {
        startDate: '2025-09-07',
        endDate: '2025-09-01',  // before startDate
        customerId: 'cust_TEST01',
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.code).toBe('VALIDATION_ERROR');
      expect(mockRepo.saveReservation).not.toHaveBeenCalled();
    });

    it('returns InternalError when repository throws', async () => {
      mockRepo.saveReservation.mockRejectedValue(new Error('DynamoDB timeout'));

      const result = await service.createReservation('tenant_TEST01', {
        startDate: '2025-09-01',
        endDate: '2025-09-07',
        customerId: 'cust_TEST01',
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.code).toBe('INTERNAL_ERROR');
    });
  });

  // ── getReservation ─────────────────────────────────────────────────────────

  describe('getReservation', () => {
    it('returns reservation with items when found', async () => {
      const res = makeReservation();
      const items = [makeItem()];
      mockRepo.findReservationById.mockResolvedValue(res);
      mockRepo.findItemsByReservation.mockResolvedValue(items);

      const result = await service.getReservation('res_TEST01');

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.reservation.id).toBe('res_TEST01');
      expect(result.data.items).toHaveLength(1);
    });

    it('returns NotFoundError when reservation does not exist', async () => {
      mockRepo.findReservationById.mockResolvedValue(null);

      const result = await service.getReservation('res_MISSING');

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.code).toBe('NOT_FOUND');
    });
  });

  // ── addItem ────────────────────────────────────────────────────────────────

  describe('addItem', () => {
    it('adds item to DRAFT reservation and publishes reservationModified', async () => {
      const res = makeReservation({ status: ReservationStatus.DRAFT });
      mockRepo.findReservationById.mockResolvedValue(res);
      mockRepo.saveReservationItem.mockResolvedValue(undefined);
      mockRepo.saveReservation.mockResolvedValue(undefined);
      mockEvents.reservationModified.mockResolvedValue(undefined);

      const result = await service.addItem('res_TEST01', {
        equipmentId: 'equip_TEST01',
        unitId: 'unit_TEST01',
        quantity: 2,
        dailyRateSnapshot: 150,
      });

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.id).toBeTruthy();
      expect(mockRepo.saveReservationItem).toHaveBeenCalledTimes(1);
      expect(mockEvents.reservationModified).toHaveBeenCalledTimes(1);
    });

    it('rejects adding item to CONFIRMED reservation', async () => {
      const res = makeReservation({ status: ReservationStatus.CONFIRMED });
      mockRepo.findReservationById.mockResolvedValue(res);

      const result = await service.addItem('res_TEST01', {
        equipmentId: 'equip_TEST01',
        unitId: 'unit_TEST01',
        quantity: 1,
        dailyRateSnapshot: 150,
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.code).toBe('CONFLICT');
      expect(result.error.message).toContain('DRAFT');
      expect(mockRepo.saveReservationItem).not.toHaveBeenCalled();
    });

    it('returns NotFoundError when reservation does not exist', async () => {
      mockRepo.findReservationById.mockResolvedValue(null);

      const result = await service.addItem('res_MISSING', {
        equipmentId: 'equip_TEST01',
        unitId: 'unit_TEST01',
        quantity: 1,
        dailyRateSnapshot: 150,
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.code).toBe('NOT_FOUND');
    });
  });

  // ── removeItem ─────────────────────────────────────────────────────────────

  describe('removeItem', () => {
    it('removes item from DRAFT reservation and publishes reservationModified', async () => {
      const res = makeReservation({ status: ReservationStatus.DRAFT });
      mockRepo.findReservationById.mockResolvedValue(res);
      mockRepo.deleteReservationItem.mockResolvedValue(undefined);
      mockRepo.saveReservation.mockResolvedValue(undefined);
      mockEvents.reservationModified.mockResolvedValue(undefined);

      const result = await service.removeItem('res_TEST01', 'item_TEST01');

      expect(result.success).toBe(true);
      expect(mockRepo.deleteReservationItem).toHaveBeenCalledWith('res_TEST01', 'item_TEST01');
      expect(mockEvents.reservationModified).toHaveBeenCalledTimes(1);
    });

    it('rejects removing item from CANCELLED reservation', async () => {
      const res = makeReservation({ status: ReservationStatus.CANCELLED });
      mockRepo.findReservationById.mockResolvedValue(res);

      const result = await service.removeItem('res_TEST01', 'item_TEST01');

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.code).toBe('CONFLICT');
    });
  });

  // ── confirmReservation — conflict detection ────────────────────────────────

  describe('confirmReservation', () => {
    it('confirms reservation with no conflicts', async () => {
      const res = makeReservation({ status: ReservationStatus.DRAFT });
      const items = [makeItem()];
      mockRepo.findReservationById.mockResolvedValue(res);
      mockRepo.findItemsByReservation.mockResolvedValue(items);
      // No existing blocks for this unit
      mockRepo.findBlocksByUnit.mockResolvedValue([]);
      mockRepo.writeConfirmationTransaction.mockResolvedValue(undefined);
      mockEvents.reservationConfirmed.mockResolvedValue(undefined);

      const result = await service.confirmReservation('res_TEST01');

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.status).toBe(ReservationStatus.CONFIRMED);
      expect(result.data.totalAmount).toBeGreaterThan(0);
      expect(mockRepo.writeConfirmationTransaction).toHaveBeenCalledTimes(1);
      expect(mockEvents.reservationConfirmed).toHaveBeenCalledTimes(1);
    });

    it('rejects confirmation when at least one item conflicts — overlap: existing block spans entire period', async () => {
      const res = makeReservation({
        status: ReservationStatus.DRAFT,
        startDate: '2025-09-03',
        endDate: '2025-09-05',
      });
      const items = [makeItem({ unitId: 'unit_CONFLICT' })];
      // Existing block completely overlaps: startDate < res.endDate && endDate > res.startDate
      const conflictingBlock = makeBlock({
        unitId: 'unit_CONFLICT',
        startDate: '2025-09-01',
        endDate: '2025-09-10',
        reservationId: 'res_OTHER01',
      });

      mockRepo.findReservationById.mockResolvedValue(res);
      mockRepo.findItemsByReservation.mockResolvedValue(items);
      mockRepo.findBlocksByUnit.mockResolvedValue([conflictingBlock]);

      const result = await service.confirmReservation('res_TEST01');

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.code).toBe('CONFLICT');
      expect(result.error.message).toContain('unit_CONFLICT');
      expect(mockRepo.writeConfirmationTransaction).not.toHaveBeenCalled();
    });

    it('rejects confirmation — partial overlap: block starts before res ends', async () => {
      // res: 2025-09-05 to 2025-09-10
      // block: 2025-09-08 to 2025-09-15 → overlap: block.startDate(09-08) < res.endDate(09-10) && block.endDate(09-15) > res.startDate(09-05)
      const res = makeReservation({
        status: ReservationStatus.DRAFT,
        startDate: '2025-09-05',
        endDate: '2025-09-10',
      });
      const items = [makeItem({ unitId: 'unit_PARTIAL' })];
      const conflictingBlock = makeBlock({
        unitId: 'unit_PARTIAL',
        startDate: '2025-09-08',
        endDate: '2025-09-15',
        reservationId: 'res_OTHER02',
      });

      mockRepo.findReservationById.mockResolvedValue(res);
      mockRepo.findItemsByReservation.mockResolvedValue(items);
      mockRepo.findBlocksByUnit.mockResolvedValue([conflictingBlock]);

      const result = await service.confirmReservation('res_TEST01');

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.code).toBe('CONFLICT');
    });

    it('allows confirmation when existing block is adjacent (no overlap)', async () => {
      // res: 2025-09-05 to 2025-09-10
      // block: 2025-09-10 to 2025-09-15 → NO overlap: block.startDate(09-10) is NOT < res.endDate(09-10)
      const res = makeReservation({
        status: ReservationStatus.DRAFT,
        startDate: '2025-09-05',
        endDate: '2025-09-10',
      });
      const items = [makeItem({ unitId: 'unit_ADJACENT' })];
      const adjacentBlock = makeBlock({
        unitId: 'unit_ADJACENT',
        startDate: '2025-09-10',
        endDate: '2025-09-15',
        reservationId: 'res_OTHER03',
      });

      mockRepo.findReservationById.mockResolvedValue(res);
      mockRepo.findItemsByReservation.mockResolvedValue(items);
      mockRepo.findBlocksByUnit.mockResolvedValue([adjacentBlock]);
      mockRepo.writeConfirmationTransaction.mockResolvedValue(undefined);
      mockEvents.reservationConfirmed.mockResolvedValue(undefined);

      const result = await service.confirmReservation('res_TEST01');

      expect(result.success).toBe(true);
    });

    it('rejects confirmation when reservation has no items', async () => {
      const res = makeReservation({ status: ReservationStatus.DRAFT });
      mockRepo.findReservationById.mockResolvedValue(res);
      mockRepo.findItemsByReservation.mockResolvedValue([]);

      const result = await service.confirmReservation('res_TEST01');

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.code).toBe('VALIDATION_ERROR');
      expect(result.error.message).toContain('item');
    });

    it('rejects confirmation of an already-CANCELLED reservation', async () => {
      const res = makeReservation({ status: ReservationStatus.CANCELLED });
      mockRepo.findReservationById.mockResolvedValue(res);

      const result = await service.confirmReservation('res_TEST01');

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.code).toBe('CONFLICT');
      expect(result.error.message).toContain('terminal');
    });

    it('returns ConflictError when TransactWriteItems fails (race condition on block SK)', async () => {
      const res = makeReservation({ status: ReservationStatus.DRAFT });
      const items = [makeItem()];
      mockRepo.findReservationById.mockResolvedValue(res);
      mockRepo.findItemsByReservation.mockResolvedValue(items);
      mockRepo.findBlocksByUnit.mockResolvedValue([]);
      // Simulate DynamoDB TransactionCanceledException (attribute_not_exists failed)
      mockRepo.writeConfirmationTransaction.mockRejectedValue(
        Object.assign(new Error('Transaction cancelled'), { name: 'TransactionCanceledException' }),
      );

      const result = await service.confirmReservation('res_TEST01');

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.code).toBe('CONFLICT');
    });
  });

  // ── cancelReservation ──────────────────────────────────────────────────────

  describe('cancelReservation', () => {
    it('cancels a CONFIRMED reservation and releases blocks', async () => {
      const res = makeReservation({ status: ReservationStatus.CONFIRMED });
      const blocks = [makeBlock()];
      mockRepo.findReservationById.mockResolvedValue(res);
      mockRepo.findBlocksByReservation.mockResolvedValue(blocks);
      mockRepo.writeCancellationTransaction.mockResolvedValue(undefined);
      mockEvents.reservationCancelled.mockResolvedValue(undefined);

      const result = await service.cancelReservation('res_TEST01');

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.status).toBe(ReservationStatus.CANCELLED);
      expect(mockRepo.writeCancellationTransaction).toHaveBeenCalledWith(
        expect.objectContaining({ status: ReservationStatus.CANCELLED }),
        blocks,
      );
      expect(mockEvents.reservationCancelled).toHaveBeenCalledTimes(1);
    });

    it('cancels a DRAFT reservation (no blocks to release)', async () => {
      const res = makeReservation({ status: ReservationStatus.DRAFT });
      mockRepo.findReservationById.mockResolvedValue(res);
      mockRepo.findBlocksByReservation.mockResolvedValue([]);
      mockRepo.writeCancellationTransaction.mockResolvedValue(undefined);
      mockEvents.reservationCancelled.mockResolvedValue(undefined);

      const result = await service.cancelReservation('res_TEST01');

      expect(result.success).toBe(true);
    });

    it('rejects cancelling an already-CANCELLED reservation', async () => {
      const res = makeReservation({ status: ReservationStatus.CANCELLED });
      mockRepo.findReservationById.mockResolvedValue(res);

      const result = await service.cancelReservation('res_TEST01');

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.code).toBe('CONFLICT');
      expect(result.error.message).toContain('terminal');
    });

    it('rejects cancelling a COMPLETED reservation', async () => {
      const res = makeReservation({ status: ReservationStatus.COMPLETED });
      mockRepo.findReservationById.mockResolvedValue(res);

      const result = await service.cancelReservation('res_TEST01');

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.code).toBe('CONFLICT');
    });

    it('returns NotFoundError when reservation does not exist', async () => {
      mockRepo.findReservationById.mockResolvedValue(null);

      const result = await service.cancelReservation('res_MISSING');

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.code).toBe('NOT_FOUND');
    });
  });
});
```

Run — expected to fail (service module not found):
```bash
pnpm --filter @eventgear/reservations test 2>&1 | grep -E "FAIL|Cannot find"
```

### Step 3.2: Create service.ts

```typescript
/**
 * @file service.ts
 * @domain reservations
 * @purpose Business logic for all Reservation operations — booking lifecycle and conflict detection
 *
 * @inputs  Validated input types from validators.ts, tenantId from handler
 * @outputs Result<T> — never throws; callers check result.success
 *
 * @dependencies @eventgear/core, ./repository.ts, ./events.ts, ./types.ts
 * @ai-notes NEVER throw from this file — always return Result<T>.
 *   Conflict detection: for each item, query blocks by unit, filter date overlaps in app code.
 *   Overlap condition: block.startDate < reservation.endDate && block.endDate > reservation.startDate
 *   Adjacent blocks (startDate == endDate boundary) are NOT conflicts.
 *   Terminal states: COMPLETED and CANCELLED — no transitions out of either.
 *   Items can only be added/removed when status is DRAFT.
 *   Confirmation requires at least one item.
 *   totalAmount = sum(dailyRateSnapshot × quantity × days) — days = endDate - startDate in full days.
 *   TransactionCanceledException from DynamoDB → ConflictError (race condition on block SK).
 */
import {
  ConflictError,
  InternalError,
  NotFoundError,
  ValidationError,
  err,
  generateId,
  ok,
} from '@eventgear/core';
import type { PaginatedResult, PaginationParams, Result } from '@eventgear/core';
import type { ReservationEventPublisher } from './events.js';
import type { ReservationRepository } from './repository.js';
import { ReservationStatus } from './types.js';
import type {
  AddReservationItemInput,
  AvailabilityBlock,
  CreateReservationInput,
  Reservation,
  ReservationItem,
  ReservationWithItems,
} from './types.js';

const TERMINAL_STATUSES = new Set<ReservationStatus>([
  ReservationStatus.COMPLETED,
  ReservationStatus.CANCELLED,
]);

const EDITABLE_STATUSES = new Set<ReservationStatus>([
  ReservationStatus.DRAFT,
  ReservationStatus.QUOTED,
]);

/** Compute total rental days — end is exclusive (endDate - startDate in calendar days) */
function computeDays(startDate: string, endDate: string): number {
  const start = new Date(startDate).getTime();
  const end   = new Date(endDate).getTime();
  return Math.max(1, Math.round((end - start) / 86_400_000));
}

/**
 * Returns true if block overlaps with [resStart, resEnd).
 * Using half-open intervals: overlap when block.startDate < resEnd AND block.endDate > resStart.
 */
function overlaps(block: AvailabilityBlock, resStart: string, resEnd: string): boolean {
  return block.startDate < resEnd && block.endDate > resStart;
}

export class ReservationService {
  constructor(
    private readonly repo: ReservationRepository,
    private readonly events: ReservationEventPublisher,
  ) {}

  // ---------------------------------------------------------------------------
  // Reservations
  // ---------------------------------------------------------------------------

  async createReservation(
    tenantId: string,
    input: CreateReservationInput,
  ): Promise<Result<Reservation>> {
    try {
      if (input.endDate <= input.startDate) {
        return err(new ValidationError('endDate must be after startDate', [
          { field: 'endDate', message: 'endDate must be after startDate' },
        ]));
      }

      const now = new Date().toISOString();
      const reservation: Reservation = {
        id: generateId(),
        tenantId,
        customerId: input.customerId,
        startDate: input.startDate,
        endDate: input.endDate,
        status: ReservationStatus.DRAFT,
        totalAmount: 0,
        createdAt: now,
        updatedAt: now,
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      };

      await this.repo.saveReservation(reservation);
      await this.events.reservationCreated(reservation);
      return ok(reservation);
    } catch (e) {
      return err(new InternalError('Failed to create reservation', { cause: String(e) }));
    }
  }

  async getReservation(id: string): Promise<Result<ReservationWithItems>> {
    try {
      const reservation = await this.repo.findReservationById(id);
      if (!reservation) return err(new NotFoundError('Reservation', id));

      const items = await this.repo.findItemsByReservation(id);
      return ok({ reservation, items });
    } catch (e) {
      return err(new InternalError('Failed to get reservation', { cause: String(e) }));
    }
  }

  async listReservations(
    status: ReservationStatus | undefined,
    pagination: PaginationParams,
  ): Promise<Result<PaginatedResult<Reservation>>> {
    try {
      const result = status !== undefined
        ? await this.repo.listReservationsByStatus(status, pagination)
        : await this.repo.listReservations(pagination);
      return ok(result);
    } catch (e) {
      return err(new InternalError('Failed to list reservations', { cause: String(e) }));
    }
  }

  // ---------------------------------------------------------------------------
  // Items
  // ---------------------------------------------------------------------------

  async addItem(
    reservationId: string,
    input: AddReservationItemInput,
  ): Promise<Result<ReservationItem>> {
    try {
      const reservation = await this.repo.findReservationById(reservationId);
      if (!reservation) return err(new NotFoundError('Reservation', reservationId));

      if (!EDITABLE_STATUSES.has(reservation.status)) {
        return err(new ConflictError(
          `Items can only be added to DRAFT reservations. Current status: ${reservation.status}`,
          { currentStatus: reservation.status },
        ));
      }

      const now = new Date().toISOString();
      const item: ReservationItem = {
        id: generateId(),
        reservationId,
        equipmentId: input.equipmentId,
        unitId: input.unitId,
        quantity: input.quantity,
        dailyRateSnapshot: input.dailyRateSnapshot,
      };

      await this.repo.saveReservationItem(item);
      // Update reservation updatedAt
      await this.repo.saveReservation({ ...reservation, updatedAt: now });
      await this.events.reservationModified(reservation, ['items']);
      return ok(item);
    } catch (e) {
      return err(new InternalError('Failed to add item to reservation', { cause: String(e) }));
    }
  }

  async removeItem(
    reservationId: string,
    itemId: string,
  ): Promise<Result<void>> {
    try {
      const reservation = await this.repo.findReservationById(reservationId);
      if (!reservation) return err(new NotFoundError('Reservation', reservationId));

      if (!EDITABLE_STATUSES.has(reservation.status)) {
        return err(new ConflictError(
          `Items can only be removed from DRAFT reservations. Current status: ${reservation.status}`,
          { currentStatus: reservation.status },
        ));
      }

      const now = new Date().toISOString();
      await this.repo.deleteReservationItem(reservationId, itemId);
      await this.repo.saveReservation({ ...reservation, updatedAt: now });
      await this.events.reservationModified(reservation, ['items']);
      return ok(undefined);
    } catch (e) {
      return err(new InternalError('Failed to remove item from reservation', { cause: String(e) }));
    }
  }

  // ---------------------------------------------------------------------------
  // Confirm
  // ---------------------------------------------------------------------------

  async confirmReservation(reservationId: string): Promise<Result<Reservation>> {
    try {
      const reservation = await this.repo.findReservationById(reservationId);
      if (!reservation) return err(new NotFoundError('Reservation', reservationId));

      if (TERMINAL_STATUSES.has(reservation.status)) {
        return err(new ConflictError(
          `Cannot confirm a terminal reservation. Current status: ${reservation.status}`,
          { currentStatus: reservation.status },
        ));
      }

      const items = await this.repo.findItemsByReservation(reservationId);
      if (items.length === 0) {
        return err(new ValidationError('Reservation must have at least one item before confirming', [
          { field: 'items', message: 'at least one item is required' },
        ]));
      }

      // Conflict detection: query blocks per unit, filter overlaps in app code
      for (const item of items) {
        const blocks = await this.repo.findBlocksByUnit(item.unitId);
        const conflict = blocks.find((b) =>
          b.reservationId !== reservationId && overlaps(b, reservation.startDate, reservation.endDate),
        );
        if (conflict !== undefined) {
          return err(new ConflictError(
            `Unit ${item.unitId} is unavailable for the requested dates. Conflicts with reservation ${conflict.reservationId}`,
            {
              unitId: item.unitId,
              conflictingReservationId: conflict.reservationId,
              conflictStart: conflict.startDate,
              conflictEnd: conflict.endDate,
            },
          ));
        }
      }

      // Build AvailabilityBlocks (one per item)
      const blocks: AvailabilityBlock[] = items.map((item) => ({
        unitId: item.unitId,
        startDate: reservation.startDate,
        endDate: reservation.endDate,
        reservationId,
      }));

      // Compute totalAmount
      const days = computeDays(reservation.startDate, reservation.endDate);
      const totalAmount = items.reduce(
        (sum, item) => sum + item.dailyRateSnapshot * item.quantity * days,
        0,
      );

      const now = new Date().toISOString();
      const confirmed: Reservation = {
        ...reservation,
        status: ReservationStatus.CONFIRMED,
        totalAmount,
        updatedAt: now,
      };

      // Atomic write — throws TransactionCanceledException on block SK collision
      await this.repo.writeConfirmationTransaction(confirmed, blocks);
      await this.events.reservationConfirmed(confirmed, items);
      return ok(confirmed);
    } catch (e) {
      // TransactionCanceledException indicates race condition on AvailabilityBlock write
      const errorName = e instanceof Error ? e.name : '';
      if (errorName === 'TransactionCanceledException') {
        return err(new ConflictError(
          'Reservation could not be confirmed — a concurrent booking claimed the same unit.',
          { cause: String(e) },
        ));
      }
      return err(new InternalError('Failed to confirm reservation', { cause: String(e) }));
    }
  }

  // ---------------------------------------------------------------------------
  // Cancel
  // ---------------------------------------------------------------------------

  async cancelReservation(reservationId: string): Promise<Result<Reservation>> {
    try {
      const reservation = await this.repo.findReservationById(reservationId);
      if (!reservation) return err(new NotFoundError('Reservation', reservationId));

      if (TERMINAL_STATUSES.has(reservation.status)) {
        return err(new ConflictError(
          `Cannot cancel a terminal reservation. Current status: ${reservation.status}`,
          { currentStatus: reservation.status },
        ));
      }

      // Retrieve existing blocks to delete (query via GSI1)
      const blocks = await this.repo.findBlocksByReservation(reservationId);

      const now = new Date().toISOString();
      const cancelled: Reservation = {
        ...reservation,
        status: ReservationStatus.CANCELLED,
        updatedAt: now,
      };

      await this.repo.writeCancellationTransaction(cancelled, blocks);
      await this.events.reservationCancelled(cancelled);
      return ok(cancelled);
    } catch (e) {
      return err(new InternalError('Failed to cancel reservation', { cause: String(e) }));
    }
  }
}
```

### Step 3.3: Run tests — all passing

```bash
pnpm --filter @eventgear/reservations test
```

Expected output:
```
PASS __tests__/service.test.ts
  ReservationService
    createReservation
      ✓ saves a DRAFT reservation and publishes reservationCreated event
      ✓ rejects when endDate is before startDate
      ✓ returns InternalError when repository throws
    getReservation
      ✓ returns reservation with items when found
      ✓ returns NotFoundError when reservation does not exist
    addItem
      ✓ adds item to DRAFT reservation and publishes reservationModified
      ✓ rejects adding item to CONFIRMED reservation
      ✓ returns NotFoundError when reservation does not exist
    removeItem
      ✓ removes item from DRAFT reservation and publishes reservationModified
      ✓ rejects removing item from CANCELLED reservation
    confirmReservation
      ✓ confirms reservation with no conflicts
      ✓ rejects confirmation when at least one item conflicts ...
      ✓ rejects confirmation — partial overlap ...
      ✓ allows confirmation when existing block is adjacent (no overlap)
      ✓ rejects confirmation when reservation has no items
      ✓ rejects confirmation of an already-CANCELLED reservation
      ✓ returns ConflictError when TransactWriteItems fails (race condition)
    cancelReservation
      ✓ cancels a CONFIRMED reservation and releases blocks
      ✓ cancels a DRAFT reservation (no blocks to release)
      ✓ rejects cancelling an already-CANCELLED reservation
      ✓ rejects cancelling a COMPLETED reservation
      ✓ returns NotFoundError when reservation does not exist
```

- [ ] **Step 1: Write failing unit tests**
- [ ] **Step 2: Create service.ts**
- [ ] **Step 3: Export ReservationService from index.ts**
- [ ] **Step 4: Run tests — confirm all 22 tests green**
- [ ] **Step 5: Commit**

```bash
git add domains/reservations/service.ts domains/reservations/__tests__/service.test.ts domains/reservations/index.ts
git commit -m "feat(reservations): add ReservationService with conflict detection and atomic confirm/cancel"
```

---

## Task 4: Events — typed publishers + update contracts.ts

**Files:**
- Create: `domains/reservations/events.ts`
- Modify: `packages/events/src/contracts.ts` — add `tenantId` to `ReservationConfirmedPayload` and `StockUnitAvailabilityChangedPayload`

### Step 4.1: Update packages/events/src/contracts.ts

The following changes are needed to `contracts.ts`:

**1. Add `tenantId` to `ReservationConfirmedPayload`** (supersedes CLAUDE.md §5 per spec Section 2):

```typescript
// BEFORE:
export interface ReservationConfirmedPayload {
  readonly reservationId: string;
  readonly customerId: string;
  ...
}

// AFTER — add tenantId as first field:
export interface ReservationConfirmedPayload {
  readonly tenantId: string;           // NEW — required for inventory consumer key construction
  readonly reservationId: string;
  readonly customerId: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly items: ReadonlyArray<{
    readonly reservationItemId: string;
    readonly equipmentId: string;
    readonly unitId: string;
    readonly quantity: number;
  }>;
  readonly totalAmount: number;
}
```

**2. Add `tenantId` to `StockUnitAvailabilityChangedPayload`** (also superseded):

```typescript
// AFTER — add tenantId:
export interface StockUnitAvailabilityChangedPayload {
  readonly tenantId: string;           // NEW — required for consumer key construction
  readonly unitId: string;
  readonly equipmentId: string;
  readonly previousStatus: string;
  readonly newStatus: string;
  readonly reason: 'RESERVATION' | 'MAINTENANCE' | 'DAMAGE' | 'MANUAL';
  readonly referenceId?: string;
}
```

**3. Add `tenantId` to `ReservationCreatedPayload`:**

```typescript
export interface ReservationCreatedPayload {
  readonly tenantId: string;           // NEW
  readonly reservationId: string;
  readonly customerId: string;
  readonly startDate: string;
  readonly endDate: string;
}
```

**4. Add `tenantId` and `reason` to `ReservationCancelledPayload`:**

```typescript
export interface ReservationCancelledPayload {
  readonly tenantId: string;           // NEW
  readonly reservationId: string;
  readonly customerId: string;
  readonly cancelledAt: string;
  readonly reason: string;
}
```

**5. Add `tenantId` to `ReservationModifiedPayload`:**

```typescript
export interface ReservationModifiedPayload {
  readonly tenantId: string;           // NEW
  readonly reservationId: string;
  readonly customerId: string;
  readonly modifiedAt: string;
  readonly modifiedFields: readonly string[];
}
```

After modifying `contracts.ts`, also update `domains/inventory/events.ts` in the same step — adding `tenantId` to `StockUnitAvailabilityChangedPayload` will break its call site. Find the `stockUnitAvailabilityChanged` call in `domains/inventory/events.ts` and add `tenantId` from the stock unit's `tenantId` field (which is available from the Plan 1 inventory repository migration — units now carry `tenantId` in their DynamoDB record).

```bash
pnpm --filter @eventgear/events build
pnpm --filter @eventgear/inventory build   # must still compile — fix events.ts before continuing
pnpm --filter @eventgear/reservations build
```

Expected: all three build cleanly. The inventory domain fix MUST be included in this same commit — leaving it broken between commits violates the single-commit rule.

### Step 4.2: Write failing test for ReservationEventPublisher (TDD red)

```typescript
// domains/reservations/__tests__/events.test.ts
import { ReservationEventPublisher } from '../events.js';
import type { EventPublisher } from '@eventgear/events';
import type { Reservation, ReservationItem } from '../types.js';

const mockPublish = jest.fn().mockResolvedValue(undefined);
const mockPublisher: EventPublisher = { publish: mockPublish };

describe('ReservationEventPublisher', () => {
  beforeEach(() => mockPublish.mockClear());

  it('reservationConfirmed includes tenantId in payload', async () => {
    const ep = new ReservationEventPublisher(mockPublisher);
    const reservation = {
      id: 'res_01', tenantId: 'TENANT_01', customerId: 'cust_01',
      startDate: '2024-08-01', endDate: '2024-08-05', totalAmount: 500,
    } as unknown as Reservation;
    await ep.reservationConfirmed(reservation, [], 'corr_01');
    expect(mockPublish).toHaveBeenCalledWith(
      'reservations.reservation.confirmed',
      expect.objectContaining({ tenantId: 'TENANT_01' }),
      'corr_01',
    );
  });
});
```

Run: `pnpm --filter @eventgear/reservations test` — Expected: FAIL (module not found)

### Step 4.3: Create events.ts (TDD green)

```typescript
/**
 * @file events.ts
 * @domain reservations
 * @purpose Typed EventBridge event publishers for the Reservations domain
 *
 * @inputs  Domain entities (Reservation, ReservationItem[])
 * @outputs EventBridge PutEvents calls via EventPublisher
 *
 * @dependencies @eventgear/events
 * @ai-notes ReservationEventPublisher wraps EventPublisher with domain-specific typed methods.
 *   ReservationConfirmedPayload MUST include tenantId — inventory consumer uses it to build tenant-prefixed keys.
 *   All 5 reservation events from CLAUDE.md §3 are covered: created, confirmed, cancelled, modified, conflict.detected.
 */
import type { EventPublisher } from '@eventgear/events';
import type {
  ReservationCancelledPayload,
  ReservationConfirmedPayload,
  ReservationCreatedPayload,
  ReservationModifiedPayload,
} from '@eventgear/events';
import type { Reservation, ReservationItem } from './types.js';

export class ReservationEventPublisher {
  constructor(private readonly publisher: EventPublisher) {}

  async reservationCreated(
    reservation: Reservation,
    correlationId?: string,
  ): Promise<void> {
    const payload: ReservationCreatedPayload = {
      tenantId: reservation.tenantId,
      reservationId: reservation.id,
      customerId: reservation.customerId,
      startDate: reservation.startDate,
      endDate: reservation.endDate,
    };
    await this.publisher.publish('reservations.reservation.created', payload, correlationId);
  }

  async reservationConfirmed(
    reservation: Reservation,
    items: readonly ReservationItem[],
    correlationId?: string,
  ): Promise<void> {
    const payload: ReservationConfirmedPayload = {
      tenantId: reservation.tenantId,
      reservationId: reservation.id,
      customerId: reservation.customerId,
      startDate: reservation.startDate,
      endDate: reservation.endDate,
      items: items.map((item) => ({
        reservationItemId: item.id,
        equipmentId: item.equipmentId,
        unitId: item.unitId,
        quantity: item.quantity,
      })),
      totalAmount: reservation.totalAmount,
    };
    await this.publisher.publish('reservations.reservation.confirmed', payload, correlationId);
  }

  async reservationCancelled(
    reservation: Reservation,
    reason = 'CANCELLED',
    correlationId?: string,
  ): Promise<void> {
    const payload: ReservationCancelledPayload = {
      tenantId: reservation.tenantId,
      reservationId: reservation.id,
      customerId: reservation.customerId,
      cancelledAt: new Date().toISOString(),
      reason,
    };
    await this.publisher.publish('reservations.reservation.cancelled', payload, correlationId);
  }

  async reservationModified(
    reservation: Reservation,
    modifiedFields: string[],
    correlationId?: string,
  ): Promise<void> {
    const payload: ReservationModifiedPayload = {
      tenantId: reservation.tenantId,
      reservationId: reservation.id,
      customerId: reservation.customerId,
      modifiedAt: new Date().toISOString(),
      modifiedFields,
    };
    await this.publisher.publish('reservations.reservation.modified', payload, correlationId);
  }
}
```

### Step 4.3: Export from index.ts

```typescript
// Add to domains/reservations/index.ts:
export { ReservationEventPublisher } from './events.js';
```

### Step 4.4: Run tests + build

```bash
pnpm --filter @eventgear/reservations test
pnpm --filter @eventgear/events build
pnpm --filter @eventgear/reservations build
```

Expected: all tests pass, no TypeScript errors.

- [ ] **Step 1: Update packages/events/src/contracts.ts** (add tenantId to 5 payload interfaces)
- [ ] **Step 2: Build @eventgear/events to verify**
- [ ] **Step 3: Create events.ts**
- [ ] **Step 4: Export ReservationEventPublisher from index.ts**
- [ ] **Step 5: Run tests + build**
- [ ] **Step 6: Commit**

```bash
git add packages/events/src/contracts.ts
git add domains/inventory/events.ts       # must update StockUnitAvailabilityChangedPayload call site
git add domains/reservations/events.ts domains/reservations/__tests__/events.test.ts domains/reservations/index.ts
git commit -m "feat(reservations,events): add typed event publishers, extend contracts with tenantId, fix inventory events.ts"
```

---

## Task 5: Lambda handler — all 7 endpoints

**Files:**
- Create: `domains/reservations/handler.ts`
- Create: `domains/reservations/__tests__/handler.test.ts`

### Step 5.1: Write failing handler tests first

```typescript
/**
 * @file handler.test.ts
 * @domain reservations
 * @purpose Handler-level tests — routing, Zod validation, HTTP response shapes, tenantId injection
 *
 * @ai-notes Tests go through the real handler → real service → mocked repository.
 *   The repository is mocked at module level with jest.mock().
 *   tenantId is injected via event.requestContext.authorizer.lambda.tenantId.
 *   Tests verify: routing, validation errors (400), 404, 409 conflict, auth context injection.
 */

jest.mock('../repository', () => {
  return {
    ReservationRepository: jest.fn().mockImplementation(() => ({
      findReservationById:          jest.fn(),
      listReservations:             jest.fn().mockResolvedValue({ items: [], count: 0 }),
      listReservationsByStatus:     jest.fn().mockResolvedValue({ items: [], count: 0 }),
      saveReservation:              jest.fn().mockResolvedValue(undefined),
      findItemsByReservation:       jest.fn().mockResolvedValue([]),
      saveReservationItem:          jest.fn().mockResolvedValue(undefined),
      deleteReservationItem:        jest.fn().mockResolvedValue(undefined),
      findBlocksByUnit:             jest.fn().mockResolvedValue([]),
      findBlocksByReservation:      jest.fn().mockResolvedValue([]),
      writeConfirmationTransaction: jest.fn().mockResolvedValue(undefined),
      writeCancellationTransaction: jest.fn().mockResolvedValue(undefined),
    })),
  };
});

jest.mock('@eventgear/events', () => ({
  EventPublisher: jest.fn().mockImplementation(() => ({
    publish:      jest.fn().mockResolvedValue(undefined),
    publishBatch: jest.fn().mockResolvedValue(undefined),
  })),
  BUS_NAMES: { main: 'eventgear-test' },
}));

jest.mock('@eventgear/config', () => ({
  getConfig: jest.fn().mockReturnValue({
    awsRegion:           'us-east-1',
    awsAccountId:        '123456789012',
    dynamoTableName:     'eventgear-test',
    eventBridgeBusName:  'eventgear-test',
    jwtSecret:           'test-secret',
    featureAiAssistant:  false,
    nodeEnv:             'test',
    logLevel:            'error',
  }),
  resetConfig: jest.fn(),
}));

import { handler } from '../handler';
import { createMockAPIGatewayEvent } from '@eventgear/core';
import { ReservationRepository } from '../repository';
import { ReservationStatus } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getMockRepo(): jest.Mocked<InstanceType<typeof ReservationRepository>> {
  const MockClass = ReservationRepository as jest.MockedClass<typeof ReservationRepository>;
  const instance = MockClass.mock.instances[0];
  return instance as jest.Mocked<InstanceType<typeof ReservationRepository>>;
}

function parseBody(body: string | undefined): unknown {
  if (!body) return null;
  return JSON.parse(body);
}

/** Create an event with tenantId injected in authorizer context */
function makeAuthEvent(
  overrides: Parameters<typeof createMockAPIGatewayEvent>[0],
  tenantId = 'tenant_TEST01',
) {
  return createMockAPIGatewayEvent({
    ...overrides,
    requestContext: {
      ...(overrides.requestContext ?? {}),
      authorizer: {
        lambda: { tenantId },
      },
    } as never,
  });
}

function makeReservation(overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  return {
    id: 'res_TEST01',
    tenantId: 'tenant_TEST01',
    customerId: 'cust_TEST01',
    startDate: '2025-09-01',
    endDate: '2025-09-07',
    status: ReservationStatus.DRAFT,
    totalAmount: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Reservations handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── POST /reservations ─────────────────────────────────────────────────────

  describe('POST /reservations', () => {
    it('returns 201 with DRAFT reservation on valid body', async () => {
      const repo = getMockRepo();
      repo.saveReservation.mockResolvedValue(undefined);

      const event = makeAuthEvent({
        requestContext: {
          http: { method: 'POST', path: '/reservations' },
        } as never,
        rawPath: '/reservations',
        body: {
          startDate:  '2025-09-01',
          endDate:    '2025-09-07',
          customerId: 'cust_TEST01',
        },
      });

      const response = await handler(event);

      expect(response).toMatchObject({ statusCode: 201 });
      const body = parseBody((response as { body: string }).body) as {
        data: { status: string; tenantId: string };
      };
      expect(body.data.status).toBe('DRAFT');
      expect(body.data.tenantId).toBe('tenant_TEST01');
    });

    it('returns 400 when startDate is missing', async () => {
      const event = makeAuthEvent({
        requestContext: {
          http: { method: 'POST', path: '/reservations' },
        } as never,
        rawPath: '/reservations',
        body: {
          endDate:    '2025-09-07',
          customerId: 'cust_TEST01',
        },
      });

      const response = await handler(event);

      expect(response).toMatchObject({ statusCode: 400 });
      const body = parseBody((response as { body: string }).body) as {
        error: { code: string };
      };
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when date format is invalid', async () => {
      const event = makeAuthEvent({
        requestContext: {
          http: { method: 'POST', path: '/reservations' },
        } as never,
        rawPath: '/reservations',
        body: {
          startDate:  '09/01/2025',  // wrong format
          endDate:    '2025-09-07',
          customerId: 'cust_TEST01',
        },
      });

      const response = await handler(event);

      expect(response).toMatchObject({ statusCode: 400 });
    });
  });

  // ── GET /reservations ──────────────────────────────────────────────────────

  describe('GET /reservations', () => {
    it('returns 200 with paginated list', async () => {
      const repo = getMockRepo();
      repo.listReservations.mockResolvedValue({
        items: [makeReservation()],
        count: 1,
      });

      const event = makeAuthEvent({
        requestContext: {
          http: { method: 'GET', path: '/reservations' },
        } as never,
        rawPath: '/reservations',
      });

      const response = await handler(event);

      expect(response).toMatchObject({ statusCode: 200 });
      const body = parseBody((response as { body: string }).body) as {
        data: { items: unknown[]; count: number };
      };
      expect(Array.isArray(body.data.items)).toBe(true);
    });

    it('returns 200 with status-filtered list when ?status=CONFIRMED', async () => {
      const repo = getMockRepo();
      repo.listReservationsByStatus.mockResolvedValue({ items: [], count: 0 });

      const event = makeAuthEvent({
        requestContext: {
          http: { method: 'GET', path: '/reservations' },
        } as never,
        rawPath: '/reservations',
        queryStringParameters: { status: 'CONFIRMED' },
      });

      const response = await handler(event);

      expect(response).toMatchObject({ statusCode: 200 });
      expect(repo.listReservationsByStatus).toHaveBeenCalledTimes(1);
    });

    it('returns 400 when status query param is invalid', async () => {
      const event = makeAuthEvent({
        requestContext: {
          http: { method: 'GET', path: '/reservations' },
        } as never,
        rawPath: '/reservations',
        queryStringParameters: { status: 'INVALID_STATUS' },
      });

      const response = await handler(event);

      expect(response).toMatchObject({ statusCode: 400 });
    });
  });

  // ── GET /reservations/:id ──────────────────────────────────────────────────

  describe('GET /reservations/:id', () => {
    it('returns 200 with reservation + items when found', async () => {
      const repo = getMockRepo();
      repo.findReservationById.mockResolvedValue(makeReservation());
      repo.findItemsByReservation.mockResolvedValue([]);

      const event = makeAuthEvent({
        requestContext: {
          http: { method: 'GET', path: '/reservations/res_TEST01' },
        } as never,
        rawPath: '/reservations/res_TEST01',
      });

      const response = await handler(event);

      expect(response).toMatchObject({ statusCode: 200 });
      const body = parseBody((response as { body: string }).body) as {
        data: { reservation: { id: string }; items: unknown[] };
      };
      expect(body.data.reservation.id).toBe('res_TEST01');
    });

    it('returns 404 when reservation does not exist', async () => {
      const repo = getMockRepo();
      repo.findReservationById.mockResolvedValue(null);

      const event = makeAuthEvent({
        requestContext: {
          http: { method: 'GET', path: '/reservations/res_MISSING' },
        } as never,
        rawPath: '/reservations/res_MISSING',
      });

      const response = await handler(event);

      expect(response).toMatchObject({ statusCode: 404 });
      const body = parseBody((response as { body: string }).body) as {
        error: { code: string };
      };
      expect(body.error.code).toBe('NOT_FOUND');
    });
  });

  // ── POST /reservations/:id/items ───────────────────────────────────────────

  describe('POST /reservations/:id/items', () => {
    it('returns 201 when item is added to DRAFT reservation', async () => {
      const repo = getMockRepo();
      repo.findReservationById.mockResolvedValue(makeReservation());
      repo.saveReservationItem.mockResolvedValue(undefined);
      repo.saveReservation.mockResolvedValue(undefined);

      const event = makeAuthEvent({
        requestContext: {
          http: { method: 'POST', path: '/reservations/res_TEST01/items' },
        } as never,
        rawPath: '/reservations/res_TEST01/items',
        body: {
          equipmentId:       'equip_TEST01',
          unitId:            'unit_TEST01',
          quantity:          2,
          dailyRateSnapshot: 150,
        },
      });

      const response = await handler(event);

      expect(response).toMatchObject({ statusCode: 201 });
    });

    it('returns 409 when adding item to CONFIRMED reservation', async () => {
      const repo = getMockRepo();
      repo.findReservationById.mockResolvedValue(
        makeReservation({ status: ReservationStatus.CONFIRMED }),
      );

      const event = makeAuthEvent({
        requestContext: {
          http: { method: 'POST', path: '/reservations/res_TEST01/items' },
        } as never,
        rawPath: '/reservations/res_TEST01/items',
        body: {
          equipmentId:       'equip_TEST01',
          unitId:            'unit_TEST01',
          quantity:          1,
          dailyRateSnapshot: 150,
        },
      });

      const response = await handler(event);

      expect(response).toMatchObject({ statusCode: 409 });
    });

    it('returns 400 when quantity is not a positive integer', async () => {
      const event = makeAuthEvent({
        requestContext: {
          http: { method: 'POST', path: '/reservations/res_TEST01/items' },
        } as never,
        rawPath: '/reservations/res_TEST01/items',
        body: {
          equipmentId:       'equip_TEST01',
          unitId:            'unit_TEST01',
          quantity:          -1,
          dailyRateSnapshot: 150,
        },
      });

      const response = await handler(event);

      expect(response).toMatchObject({ statusCode: 400 });
    });
  });

  // ── DELETE /reservations/:id/items/:itemId ─────────────────────────────────

  describe('DELETE /reservations/:id/items/:itemId', () => {
    it('returns 204 when item is removed from DRAFT reservation', async () => {
      const repo = getMockRepo();
      repo.findReservationById.mockResolvedValue(makeReservation());
      repo.deleteReservationItem.mockResolvedValue(undefined);
      repo.saveReservation.mockResolvedValue(undefined);

      const event = makeAuthEvent({
        requestContext: {
          http: {
            method: 'DELETE',
            path: '/reservations/res_TEST01/items/item_TEST01',
          },
        } as never,
        rawPath: '/reservations/res_TEST01/items/item_TEST01',
      });

      const response = await handler(event);

      expect(response).toMatchObject({ statusCode: 204 });
    });
  });

  // ── POST /reservations/:id/confirm ────────────────────────────────────────

  describe('POST /reservations/:id/confirm', () => {
    it('returns 200 with CONFIRMED reservation on happy path', async () => {
      const repo = getMockRepo();
      repo.findReservationById.mockResolvedValue(makeReservation());
      repo.findItemsByReservation.mockResolvedValue([{
        id: 'item_TEST01',
        reservationId: 'res_TEST01',
        equipmentId: 'equip_TEST01',
        unitId: 'unit_TEST01',
        quantity: 1,
        dailyRateSnapshot: 150,
      }]);
      repo.findBlocksByUnit.mockResolvedValue([]);
      repo.writeConfirmationTransaction.mockResolvedValue(undefined);

      const event = makeAuthEvent({
        requestContext: {
          http: { method: 'POST', path: '/reservations/res_TEST01/confirm' },
        } as never,
        rawPath: '/reservations/res_TEST01/confirm',
      });

      const response = await handler(event);

      expect(response).toMatchObject({ statusCode: 200 });
      const body = parseBody((response as { body: string }).body) as {
        data: { status: string };
      };
      expect(body.data.status).toBe('CONFIRMED');
    });

    it('returns 409 when unit has a conflicting block', async () => {
      const repo = getMockRepo();
      repo.findReservationById.mockResolvedValue(makeReservation({
        startDate: '2025-09-03',
        endDate:   '2025-09-06',
      }));
      repo.findItemsByReservation.mockResolvedValue([{
        id: 'item_TEST01',
        reservationId: 'res_TEST01',
        equipmentId: 'equip_TEST01',
        unitId: 'unit_CONFLICT',
        quantity: 1,
        dailyRateSnapshot: 150,
      }]);
      repo.findBlocksByUnit.mockResolvedValue([{
        unitId: 'unit_CONFLICT',
        startDate: '2025-09-01',
        endDate: '2025-09-10',
        reservationId: 'res_OTHER01',
      }]);

      const event = makeAuthEvent({
        requestContext: {
          http: { method: 'POST', path: '/reservations/res_TEST01/confirm' },
        } as never,
        rawPath: '/reservations/res_TEST01/confirm',
      });

      const response = await handler(event);

      expect(response).toMatchObject({ statusCode: 409 });
      const body = parseBody((response as { body: string }).body) as {
        error: { code: string };
      };
      expect(body.error.code).toBe('CONFLICT');
    });
  });

  // ── POST /reservations/:id/cancel ─────────────────────────────────────────

  describe('POST /reservations/:id/cancel', () => {
    it('returns 200 with CANCELLED reservation', async () => {
      const repo = getMockRepo();
      repo.findReservationById.mockResolvedValue(
        makeReservation({ status: ReservationStatus.CONFIRMED }),
      );
      repo.findBlocksByReservation.mockResolvedValue([]);
      repo.writeCancellationTransaction.mockResolvedValue(undefined);

      const event = makeAuthEvent({
        requestContext: {
          http: { method: 'POST', path: '/reservations/res_TEST01/cancel' },
        } as never,
        rawPath: '/reservations/res_TEST01/cancel',
      });

      const response = await handler(event);

      expect(response).toMatchObject({ statusCode: 200 });
      const body = parseBody((response as { body: string }).body) as {
        data: { status: string };
      };
      expect(body.data.status).toBe('CANCELLED');
    });

    it('returns 409 when trying to cancel an already-CANCELLED reservation', async () => {
      const repo = getMockRepo();
      repo.findReservationById.mockResolvedValue(
        makeReservation({ status: ReservationStatus.CANCELLED }),
      );

      const event = makeAuthEvent({
        requestContext: {
          http: { method: 'POST', path: '/reservations/res_TEST01/cancel' },
        } as never,
        rawPath: '/reservations/res_TEST01/cancel',
      });

      const response = await handler(event);

      expect(response).toMatchObject({ statusCode: 409 });
    });
  });

  // ── 404 fallthrough ────────────────────────────────────────────────────────

  describe('unknown routes', () => {
    it('returns 404 for unknown path', async () => {
      const event = makeAuthEvent({
        requestContext: {
          http: { method: 'GET', path: '/reservations/res_TEST01/unknown' },
        } as never,
        rawPath: '/reservations/res_TEST01/unknown',
      });

      const response = await handler(event);

      expect(response).toMatchObject({ statusCode: 404 });
    });
  });
});
```

Run — expected to fail (handler module not found):
```bash
pnpm --filter @eventgear/reservations test __tests__/handler.test.ts 2>&1 | head -10
```

### Step 5.2: Create handler.ts

```typescript
/**
 * @file handler.ts
 * @domain reservations
 * @purpose Lambda entry point — routes API Gateway HTTP events to ReservationService methods
 *
 * @inputs  APIGatewayProxyEventV2 with tenantId in requestContext.authorizer.lambda.tenantId
 * @outputs APIGatewayProxyResultV2 with JSON body (data or error)
 *
 * @dependencies @eventgear/core, @eventgear/events, ./service, ./repository, ./validators
 * @ai-notes Route dispatch uses rawPath + requestContext.http.method.
 *   tenantId is extracted from event.requestContext.authorizer.lambda.tenantId — set by Lambda authorizer.
 *   ReservationRepository receives tenantId in constructor — a new instance per request is NOT needed;
 *   module-level singleton is keyed to a fixed tenantId which won't work for multi-tenant.
 *   Instead, create repository inside the handler function using the per-request tenantId.
 *   Module-level singletons: EventPublisher and ReservationEventPublisher only.
 *   To unit test: mock the repository constructor with jest.mock('../repository.js').
 */
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import {
  NotFoundError,
  ValidationError,
  UnauthorizedError,
  errorResponse,
  successResponse,
} from '@eventgear/core';
import { EventPublisher } from '@eventgear/events';
import { ReservationEventPublisher } from './events.js';
import { ReservationRepository } from './repository.js';
import { ReservationService } from './service.js';
import {
  addReservationItemSchema,
  createReservationSchema,
  listReservationsSchema,
} from './validators.js';
import type { ZodError } from 'zod';

// ---------------------------------------------------------------------------
// Module-level singletons (shared across requests — tenantId-independent)
// ---------------------------------------------------------------------------

const eventPublisher      = new EventPublisher();
const reservationEvents   = new ReservationEventPublisher(eventPublisher);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseBody(event: APIGatewayProxyEventV2): unknown {
  if (!event.body) return {};
  try {
    return JSON.parse(event.body) as unknown;
  } catch {
    return {};
  }
}

function zodValidationError(zodError: ZodError): ValidationError {
  return new ValidationError(
    'Validation failed',
    zodError.errors.map((e) => ({
      field: e.path.join('.'),
      message: e.message,
    })),
  );
}

function getTenantId(event: APIGatewayProxyEventV2): string | null {
  const ctx = (event.requestContext as Record<string, unknown>).authorizer as
    | { lambda?: { tenantId?: string } }
    | undefined;
  return ctx?.lambda?.tenantId ?? null;
}

// ---------------------------------------------------------------------------
// Lambda handler
// ---------------------------------------------------------------------------

export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const tenantId = getTenantId(event);
  if (tenantId === null) {
    return errorResponse(new UnauthorizedError('Missing tenant context'));
  }

  // Instantiate per-request — tenantId determines key prefix
  const repo    = new ReservationRepository(tenantId);
  const service = new ReservationService(repo, reservationEvents);

  const method = event.requestContext.http.method;
  const path   = event.rawPath;

  // ── POST /reservations ──────────────────────────────────────────────────────
  if (path === '/reservations' && method === 'POST') {
    const parsed = createReservationSchema.safeParse(parseBody(event));
    if (!parsed.success) return errorResponse(zodValidationError(parsed.error));
    const result = await service.createReservation(tenantId, parsed.data);
    if (!result.success) return errorResponse(result.error);
    return successResponse(result.data, 201);
  }

  // ── GET /reservations ───────────────────────────────────────────────────────
  if (path === '/reservations' && method === 'GET') {
    const parsed = listReservationsSchema.safeParse(event.queryStringParameters ?? {});
    if (!parsed.success) return errorResponse(zodValidationError(parsed.error));
    const { status, limit, nextToken } = parsed.data;
    const result = await service.listReservations(status, { limit, nextToken });
    if (!result.success) return errorResponse(result.error);
    return successResponse(result.data);
  }

  // ── Routes with reservation ID ─────────────────────────────────────────────
  const resIdMatch = path.match(/^\/reservations\/([^/]+)$/);
  if (resIdMatch) {
    const reservationId = resIdMatch[1] as string;

    if (method === 'GET') {
      const result = await service.getReservation(reservationId);
      if (!result.success) return errorResponse(result.error);
      return successResponse(result.data);
    }
  }

  // ── POST /reservations/:id/items ───────────────────────────────────────────
  const itemsMatch = path.match(/^\/reservations\/([^/]+)\/items$/);
  if (itemsMatch && method === 'POST') {
    const reservationId = itemsMatch[1] as string;
    const parsed = addReservationItemSchema.safeParse(parseBody(event));
    if (!parsed.success) return errorResponse(zodValidationError(parsed.error));
    const result = await service.addItem(reservationId, parsed.data);
    if (!result.success) return errorResponse(result.error);
    return successResponse(result.data, 201);
  }

  // ── DELETE /reservations/:id/items/:itemId ─────────────────────────────────
  const itemDeleteMatch = path.match(/^\/reservations\/([^/]+)\/items\/([^/]+)$/);
  if (itemDeleteMatch && method === 'DELETE') {
    const reservationId = itemDeleteMatch[1] as string;
    const itemId        = itemDeleteMatch[2] as string;
    const result = await service.removeItem(reservationId, itemId);
    if (!result.success) return errorResponse(result.error);
    return successResponse(null, 204);
  }

  // ── POST /reservations/:id/confirm ─────────────────────────────────────────
  const confirmMatch = path.match(/^\/reservations\/([^/]+)\/confirm$/);
  if (confirmMatch && method === 'POST') {
    const reservationId = confirmMatch[1] as string;
    const result = await service.confirmReservation(reservationId);
    if (!result.success) return errorResponse(result.error);
    return successResponse(result.data);
  }

  // ── POST /reservations/:id/cancel ──────────────────────────────────────────
  const cancelMatch = path.match(/^\/reservations\/([^/]+)\/cancel$/);
  if (cancelMatch && method === 'POST') {
    const reservationId = cancelMatch[1] as string;
    const result = await service.cancelReservation(reservationId);
    if (!result.success) return errorResponse(result.error);
    return successResponse(result.data);
  }

  // ── 404 fallthrough ────────────────────────────────────────────────────────
  return errorResponse(new NotFoundError('Route', `${method} ${path}`));
};
```

### Step 5.3: Export handler from index.ts

```typescript
// Add to domains/reservations/index.ts:
export { handler } from './handler.js';
export { ReservationService } from './service.js';
```

### Step 5.4: Run all tests

```bash
pnpm --filter @eventgear/reservations test
```

Expected:
```
PASS __tests__/service.test.ts  (22 tests)
PASS __tests__/handler.test.ts  (14 tests)
SKIP __tests__/repository.test.ts (integration — no local DynamoDB)
```

- [ ] **Step 1: Write failing handler tests**
- [ ] **Step 2: Create handler.ts**
- [ ] **Step 3: Export handler and ReservationService from index.ts**
- [ ] **Step 4: Run all tests — 36 tests green (22 service + 14 handler)**
- [ ] **Step 5: Commit**

```bash
git add domains/reservations/handler.ts domains/reservations/__tests__/handler.test.ts domains/reservations/index.ts
git commit -m "feat(reservations): add Lambda handler with all 7 endpoints"
```

---

## Task 6: Wire into dev Express server

**Files:**
- Modify: `apps/api/src/server.ts`

### Step 6.1: Add reservation routes to server.ts

The Express dev server reads `tenantId` from the `X-Tenant-Id` header instead of a JWT authorizer context (same pattern as inventory will use after Plan 1 migration).

Add the following imports at the top of `server.ts`:

```typescript
import {
  ReservationRepository,
  ReservationService,
  ReservationEventPublisher,
  createReservationSchema,
  addReservationItemSchema,
  listReservationsSchema,
} from '@eventgear/reservations';
```

Add a `DEV_TENANT_ID` constant and a helper to extract it from the header:

```typescript
// Dev-only tenant fallback — matches the seed data default tenant
const DEV_TENANT_ID = process.env['DEV_TENANT_ID'] ?? 'tenant_LOCAL_DEV';

function getDevTenantId(req: Request): string {
  return (req.headers['x-tenant-id'] as string | undefined) ?? DEV_TENANT_ID;
}
```

Add a factory function that creates the reservation service stack per-request:

```typescript
function makeReservationService(tenantId: string): ReservationService {
  const resRepo   = new ReservationRepository(tenantId);
  const resEvents = new ReservationEventPublisher(
    new LocalEventPublisher() as unknown as EventPublisher,
  );
  return new ReservationService(resRepo, resEvents);
}
```

Add the reservation routes (add after the maintenance routes, before the error handler):

```typescript
// ── Reservations ──────────────────────────────────────────────────────────────

app.post('/reservations', wrap(async (req, res) => {
  const tenantId = getDevTenantId(req);
  const parsed = createReservationSchema.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: parsed.error.flatten() });
  send(res, await makeReservationService(tenantId).createReservation(tenantId, parsed.data), 201);
}));

app.get('/reservations', wrap(async (req, res) => {
  const tenantId = getDevTenantId(req);
  const parsed = listReservationsSchema.safeParse(req.query);
  if (!parsed.success) return void res.status(400).json({ error: parsed.error.flatten() });
  const { status, limit, nextToken } = parsed.data;
  send(res, await makeReservationService(tenantId).listReservations(status, { limit, nextToken }));
}));

app.get('/reservations/:id', wrap(async (req, res) => {
  const tenantId = getDevTenantId(req);
  send(res, await makeReservationService(tenantId).getReservation(param(req, 'id')));
}));

app.post('/reservations/:id/items', wrap(async (req, res) => {
  const tenantId = getDevTenantId(req);
  const parsed = addReservationItemSchema.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: parsed.error.flatten() });
  send(res, await makeReservationService(tenantId).addItem(param(req, 'id'), parsed.data), 201);
}));

app.delete('/reservations/:id/items/:itemId', wrap(async (req, res) => {
  const tenantId = getDevTenantId(req);
  const result = await makeReservationService(tenantId).removeItem(param(req, 'id'), param(req, 'itemId'));
  if (result.success) res.status(204).send();
  else sendFail(res, result.error);
}));

app.post('/reservations/:id/confirm', wrap(async (req, res) => {
  const tenantId = getDevTenantId(req);
  send(res, await makeReservationService(tenantId).confirmReservation(param(req, 'id')));
}));

app.post('/reservations/:id/cancel', wrap(async (req, res) => {
  const tenantId = getDevTenantId(req);
  send(res, await makeReservationService(tenantId).cancelReservation(param(req, 'id')));
}));
```

### Step 6.2: Build and verify

```bash
pnpm --filter @eventgear/reservations build
pnpm --filter @eventgear/api typecheck
```

Expected: no TypeScript errors.

### Step 6.3: Manual smoke test (with local DynamoDB running)

```bash
# Start local DynamoDB + API server
docker run -p 8000:8000 amazon/dynamodb-local &
pnpm db:seed
pnpm --filter @eventgear/api dev &

# Create a reservation
curl -s -X POST http://localhost:3001/reservations \
  -H 'Content-Type: application/json' \
  -H 'X-Tenant-Id: tenant_LOCAL_DEV' \
  -d '{"startDate":"2025-10-01","endDate":"2025-10-05","customerId":"cust_LOCAL_DEV_01"}' | jq .

# Expected: {"data":{"id":"...","status":"DRAFT","tenantId":"tenant_LOCAL_DEV",...}}
```

- [ ] **Step 1: Import reservation types in server.ts**
- [ ] **Step 2: Add getDevTenantId helper + makeReservationService factory**
- [ ] **Step 3: Add all 7 reservation routes**
- [ ] **Step 4: Build + typecheck**
- [ ] **Step 5: Manual smoke test**
- [ ] **Step 6: Commit**

```bash
git add apps/api/src/server.ts
git commit -m "feat(api): wire reservation routes into local dev Express server"
```

---

## Task 7: billing.invoice.paid EventBridge consumer

**Files:**
- Create: `domains/reservations/consumer.ts` — EventBridge consumer Lambda for `billing.invoice.paid`

### Step 7.1: Write failing consumer test

```typescript
// domains/reservations/__tests__/consumer.test.ts
/**
 * @file consumer.test.ts
 * @domain reservations
 * @purpose Unit tests for the billing.invoice.paid EventBridge consumer
 *
 * @ai-notes The consumer receives an EventBridge event (not an APIGateway event).
 *   It finds the reservation by reservationId from the payload and updates status to PAYMENT_CONFIRMED.
 *   PAYMENT_CONFIRMED is not a status in the spec — the spec says "mark as PAYMENT_CONFIRMED" which
 *   maps to a note field or a separate flag. For MVP, this is a no-op logged warning since
 *   PAYMENT_CONFIRMED is out of scope per spec Section 2 "Out of Scope".
 *   The consumer must be resilient — it should log and return without throwing on unknown events.
 */
import { consumeInvoicePaid } from '../consumer';

describe('billing.invoice.paid consumer', () => {
  it('logs receipt of invoice paid event without throwing', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    const event = {
      source: 'eventgear.billing',
      'detail-type': 'billing.invoice.paid',
      detail: {
        eventId: 'evt_TEST01',
        eventVersion: '1.0',
        timestamp: new Date().toISOString(),
        correlationId: 'corr_TEST01',
        payload: {
          invoiceId:     'inv_TEST01',
          reservationId: 'res_TEST01',
          customerId:    'cust_TEST01',
          amount:        1200,
          paidAt:        new Date().toISOString(),
          paymentMethod: 'card',
          transactionId: 'txn_TEST01',
        },
      },
    };

    await expect(consumeInvoicePaid(event)).resolves.not.toThrow();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('billing.invoice.paid'),
      expect.any(String),
    );

    consoleSpy.mockRestore();
  });

  it('handles malformed event detail gracefully', async () => {
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const badEvent = {
      source: 'eventgear.billing',
      'detail-type': 'billing.invoice.paid',
      detail: null,
    };

    await expect(consumeInvoicePaid(badEvent as never)).resolves.not.toThrow();

    consoleSpy.mockRestore();
  });
});
```

### Step 7.2: Create consumer.ts

```typescript
/**
 * @file consumer.ts
 * @domain reservations
 * @purpose EventBridge consumer Lambda for billing.invoice.paid events
 *
 * @inputs  EventBridge event with detail-type "billing.invoice.paid"
 * @outputs void — side effects only (future: update reservation status)
 *
 * @dependencies @eventgear/events
 * @ai-notes Per spec Section 2 "Out of Scope": consuming billing.invoice.paid to mark reservations
 *   as PAYMENT_CONFIRMED requires the equipment Billing domain first. This consumer is a stub
 *   that logs the event and is wired to EventBridge — ready to implement when Billing domain ships.
 *
 *   The Lambda is triggered by an EventBridge rule:
 *     Source:     "eventgear.billing"
 *     DetailType: "billing.invoice.paid"
 *
 *   To extend: import ReservationRepository, look up reservation by reservationId,
 *   update status to a new PAYMENT_CONFIRMED status (requires adding to ReservationStatus enum).
 */
import type { EventBridgeEvent } from 'aws-lambda';
import type { InvoicePaidPayload } from '@eventgear/events';

export type InvoicePaidEvent = EventBridgeEvent<'billing.invoice.paid', InvoicePaidPayload>;

/**
 * Exported for direct testing without Lambda wrapper.
 * The Lambda handler calls this function.
 */
export async function consumeInvoicePaid(event: unknown): Promise<void> {
  try {
    const detail = (event as { detail?: unknown }).detail;
    if (detail === null || detail === undefined) {
      console.warn('[reservations/consumer] Received billing.invoice.paid with null/undefined detail — skipping');
      return;
    }

    const payload = (detail as { payload?: InvoicePaidPayload }).payload;
    console.log(
      '[reservations/consumer] billing.invoice.paid received — reservationId:',
      payload?.reservationId ?? '(unknown)',
    );

    // TODO (Post-MVP): When Billing domain is live, update reservation status to PAYMENT_CONFIRMED:
    // const repo = new ReservationRepository(tenantId); // tenantId from payload once billing passes it
    // const reservation = await repo.findReservationById(payload.reservationId);
    // if (reservation) { await repo.saveReservation({ ...reservation, status: ReservationStatus.PAYMENT_CONFIRMED }); }
  } catch (e) {
    // Consumer must not throw — EventBridge will retry on Lambda errors
    console.error('[reservations/consumer] Unexpected error processing billing.invoice.paid:', String(e));
  }
}

/** Lambda handler entrypoint */
export const handler = async (event: InvoicePaidEvent): Promise<void> => {
  await consumeInvoicePaid(event);
};
```

### Step 7.3: Run all tests

```bash
pnpm --filter @eventgear/reservations test
```

Expected:
```
PASS __tests__/service.test.ts  (22 tests)
PASS __tests__/handler.test.ts  (14 tests)
PASS __tests__/consumer.test.ts (2 tests)
SKIP __tests__/repository.test.ts (integration)

Test Suites: 4 passed (3 run, 1 skipped)
Tests:       38 passed
```

### Step 7.4: Final build verification

```bash
pnpm --filter @eventgear/reservations build
pnpm typecheck
```

Expected: no TypeScript errors across the monorepo.

- [ ] **Step 1: Write failing consumer test**
- [ ] **Step 2: Create consumer.ts**
- [ ] **Step 3: Run all tests — confirm 38 tests green**
- [ ] **Step 4: Full monorepo typecheck**
- [ ] **Step 5: Commit**

```bash
git add domains/reservations/consumer.ts domains/reservations/__tests__/consumer.test.ts
git commit -m "feat(reservations): add billing.invoice.paid consumer stub"
```

---

## Completion Checklist

- [ ] All 7 endpoints implemented and handler-tested
- [ ] Conflict detection edge cases covered (complete overlap, partial overlap, adjacent = no conflict)
- [ ] `TransactWriteItems` used for both confirm and cancel
- [ ] `ReservationConfirmedPayload.tenantId` present in contracts.ts
- [ ] `domains/reservations/SPEC.md` exists (stub)
- [ ] `pnpm test` passes with ≥ 38 tests
- [ ] `pnpm typecheck` passes with no errors
- [ ] Reservation routes working in local Express dev server (`X-Tenant-Id` header)
- [ ] `billing.invoice.paid` consumer wired as Lambda stub

## Post-completion

Update `CLAUDE.md §5` to note that `ReservationConfirmedPayload` and `StockUnitAvailabilityChangedPayload` now include `tenantId` (both interfaces updated in `packages/events/src/contracts.ts` during Task 4).
