# Auth + Multi-tenancy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Cognito-based authentication and full DynamoDB tenant isolation so every user belongs to a tenant and every data record is namespaced by that tenant.

**Architecture:** One Cognito User Pool for all tenants; each user carries `custom:tenantId` and `custom:role` claims. A Lambda authorizer validates the JWT and injects `{ tenantId, role, userId }` into every request context. All DynamoDB keys are prefixed `TENANT#{tenantId}#...` — isolation is by key construction, no shared-package type changes needed.

**Tech Stack:** `aws-jwt-verify` (JWT verification with JWKS caching), `amazon-cognito-identity-js` (frontend SRP auth + token refresh), Terraform (Cognito IaC), React Context (frontend auth state).

**Spec:** `docs/specs/2026-03-23-mvp-production-readiness-design.md`

---

## Critical Files to Read Before Starting

- `packages/db/src/base-repository.ts` — BaseRepository class (needs tenantId constructor param)
- `packages/db/src/schema.ts` — buildKey builders (all need tenantId prefix)
- `domains/inventory/repository.ts` — reference implementation (needs migration)
- `packages/config/src/index.ts` — config schema (needs cognitoUserPoolId hardened)
- `apps/web/src/App.tsx` — route tree (needs ProtectedRoute wrapper)
- `apps/api/src/server.ts` — Express dev server (for local dev bypass of authorizer)

---

## File Structure

```
packages/auth/
  src/
    types.ts            — AuthContext, UserRole, Tenant interface
    jwks-client.ts      — JWKS fetch + in-memory cache (TTL 1h)
    jwt.ts              — JWT verify using aws-jwt-verify
    tenant-repository.ts — CRUD for Tenant records + GSI1 lookup by stripeCustomerId
    index.ts            — barrel exports
  package.json
  tsconfig.json

packages/db/src/
  base-repository.ts    — ADD tenantId constructor param
  schema.ts             — ADD tenantId to all buildKey builders

domains/inventory/
  repository.ts         — MIGRATE all buildKey calls to pass this.tenantId

apps/api/src/
  authorizer.ts         — Lambda authorizer handler

apps/web/src/features/auth/
  AuthContext.tsx        — React Context holding user + token
  ProtectedRoute.tsx     — Redirects unauthenticated users to /login
  LoginPage.tsx          — Custom Cognito login form
  SignupPage.tsx          — Signup form + tenant provisioning

apps/web/src/
  App.tsx               — MODIFY to wrap routes in ProtectedRoute + add /login /signup

infra/terraform/modules/cognito/
  main.tf               — User Pool, App Client, custom attributes
  variables.tf
  outputs.tf
```

---

## Task 1: packages/auth — scaffold + types

**Files:**
- Create: `packages/auth/package.json`
- Create: `packages/auth/tsconfig.json`
- Create: `packages/auth/src/types.ts`
- Create: `packages/auth/src/index.ts`

- [ ] **Step 1: Create package.json**

```json
// packages/auth/package.json
{
  "name": "@eventgear/auth",
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
    "aws-jwt-verify": "^4.0.1",
    "@aws-sdk/lib-dynamodb": "^3.0.0",
    "@eventgear/config": "workspace:*",
    "@eventgear/db": "workspace:*",
    "ulid": "^2.3.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "jest": "*",
    "@types/jest": "*",
    "ts-jest": "*"
  }
}
```

Also create a `jest.config.ts` (copy the pattern from `packages/db/jest.config.ts`):
```typescript
// packages/auth/jest.config.ts
import type { Config } from 'jest';
export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
} satisfies Config;
```

- [ ] **Step 2: Create tsconfig.json**

```json
// packages/auth/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create src/types.ts**

```typescript
// packages/auth/src/types.ts

/** Role for a user within a tenant. Single value for MVP — extend the union to add roles. */
export type UserRole = 'ADMIN';
// Future: | 'RENTAL_MANAGER' | 'WAREHOUSE_STAFF' | 'FIELD_TECHNICIAN' | 'FINANCE'

/** Auth context injected by the Lambda authorizer into every downstream Lambda. */
export interface AuthContext {
  tenantId: string;
  userId: string;
  role: UserRole;
}

/** Tenant record — owns identity, plan, and Stripe subscription state. */
export interface Tenant {
  id: string;          // ULID
  name: string;
  plan: 'STARTER' | 'PROFESSIONAL' | 'ENTERPRISE';
  status: 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED';
  trialEndsAt?: string;          // ISO timestamp
  stripeCustomerId: string;
  stripeSubscriptionId?: string;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 4: Create src/index.ts (barrel — will grow as files are added)**

```typescript
// packages/auth/src/index.ts
export type { AuthContext, Tenant, UserRole } from './types.js';
```

- [ ] **Step 5: Install package dependencies**

`aws-jwt-verify` is already listed in `package.json`. Run `pnpm install` at the monorepo root to install it into the new package:

```bash
pnpm install
```

- [ ] **Step 6: Verify package builds**

```bash
pnpm --filter @eventgear/auth build
```

Expected: `packages/auth/dist/` created with no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/auth/
git commit -m "feat(auth): scaffold @eventgear/auth package with AuthContext and Tenant types"
```

---

## Task 2: packages/auth — JWKS client + JWT verification

**Files:**
- Create: `packages/auth/src/jwks-client.ts`
- Create: `packages/auth/src/jwt.ts`
- Modify: `packages/auth/src/index.ts`

- [ ] **Step 1: Write failing test**

```typescript
// packages/auth/src/__tests__/jwt.test.ts
describe('verifyToken', () => {
  it('throws on invalid token', async () => {
    const { verifyToken } = await import('../jwt.js');
    await expect(verifyToken('not-a-jwt')).rejects.toThrow();
  });
});
```

Run: `pnpm --filter @eventgear/auth test` — expected: FAIL (module not found)

- [ ] **Step 2: Create src/jwks-client.ts**

```typescript
// packages/auth/src/jwks-client.ts
/**
 * @file jwks-client.ts
 * @purpose Fetch and cache the Cognito JWKS endpoint (1h TTL).
 *   aws-jwt-verify handles JWKS caching internally — this module
 *   just exports the configured verifier instance.
 */
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { getConfig } from '@eventgear/config';

let _verifier: ReturnType<typeof CognitoJwtVerifier.create> | undefined;

export function getVerifier() {
  if (!_verifier) {
    const config = getConfig();
    _verifier = CognitoJwtVerifier.create({
      userPoolId: config.cognitoUserPoolId!,
      tokenUse: 'access',
      clientId: config.cognitoClientId!,
    });
  }
  return _verifier;
}
```

- [ ] **Step 3: Create src/jwt.ts**

```typescript
// packages/auth/src/jwt.ts
/**
 * @file jwt.ts
 * @purpose Verify a Cognito access token and extract AuthContext.
 *   Uses aws-jwt-verify which fetches and caches JWKS automatically.
 */
import type { AuthContext, UserRole } from './types.js';
import { getVerifier } from './jwks-client.js';

export async function verifyToken(token: string): Promise<AuthContext> {
  const payload = await getVerifier().verify(token);

  const tenantId = payload['custom:tenantId'];
  const role = payload['custom:role'];
  const sub = payload['sub'];

  if (typeof tenantId !== 'string' || !tenantId) {
    throw new Error('Token missing custom:tenantId claim');
  }
  if (typeof role !== 'string' || !role) {
    throw new Error('Token missing custom:role claim');
  }
  if (typeof sub !== 'string' || !sub) {
    throw new Error('Token missing sub claim');
  }

  return { tenantId, userId: sub, role: role as UserRole };
}
```

- [ ] **Step 4: Update src/index.ts**

```typescript
// packages/auth/src/index.ts
export type { AuthContext, Tenant, UserRole } from './types.js';
export { verifyToken } from './jwt.js';
export { getVerifier } from './jwks-client.js';
```

- [ ] **Step 5: Run tests**

```bash
pnpm --filter @eventgear/auth test
```

Expected: PASS (invalid token throws as expected)

- [ ] **Step 6: Commit**

```bash
git add packages/auth/src/jwks-client.ts packages/auth/src/jwt.ts packages/auth/src/index.ts
git add packages/auth/src/__tests__/
git commit -m "feat(auth): add JWT verification with aws-jwt-verify + JWKS caching"
```

---

## Task 3: packages/auth — TenantRepository

**Files:**
- Create: `packages/auth/src/tenant-repository.ts`
- Modify: `packages/auth/src/index.ts`

The Tenant DynamoDB key pattern (from spec):
```
PK:      TENANT#{tenantId}
SK:      METADATA
GSI1PK:  STRIPE_CUSTOMER#{stripeCustomerId}
GSI1SK:  TENANT#{tenantId}
EntityType: TENANT   (repurposed to TENANT#{tenantId}#ENTITY#TENANT for GSI2 — see schema.ts note)
```

Note: `TenantRepository` does NOT extend the to-be-refactored `BaseRepository` (which will require tenantId). Tenant records are self-describing — they don't belong to a tenant, they ARE a tenant. `TenantRepository` calls the DynamoDB `docClient` directly via the same `getDynamoDocumentClient()` helper.

- [ ] **Step 1: Write failing test**

```typescript
// packages/auth/src/__tests__/tenant-repository.test.ts
import { TenantRepository } from '../tenant-repository.js';
import { ulid } from 'ulid';

// Requires DynamoDB Local running at DYNAMODB_ENDPOINT
const repo = new TenantRepository();

describe('TenantRepository', () => {
  const tenantId = ulid();
  const tenant = {
    id: tenantId,
    name: 'Test Co',
    plan: 'STARTER' as const,
    status: 'TRIALING' as const,
    stripeCustomerId: `cus_${tenantId}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  it('saves and finds tenant by id', async () => {
    await repo.saveTenant(tenant);
    const found = await repo.findTenantById(tenantId);
    expect(found?.id).toBe(tenantId);
    expect(found?.name).toBe('Test Co');
  });

  it('finds tenant by stripeCustomerId', async () => {
    const found = await repo.findTenantByStripeCustomerId(tenant.stripeCustomerId);
    expect(found?.id).toBe(tenantId);
  });

  it('returns null for unknown id', async () => {
    const found = await repo.findTenantById('NONEXISTENT');
    expect(found).toBeNull();
  });

  it('updates tenant status', async () => {
    await repo.updateTenant(tenantId, { status: 'ACTIVE' });
    const found = await repo.findTenantById(tenantId);
    expect(found?.status).toBe('ACTIVE');
  });
});
```

Run: expected FAIL (TenantRepository not found)

- [ ] **Step 2: Create src/tenant-repository.ts**

```typescript
// packages/auth/src/tenant-repository.ts
/**
 * @file tenant-repository.ts
 * @purpose DynamoDB access for Tenant records.
 *   Does NOT extend BaseRepository — Tenant is not scoped to a tenant.
 *   Provides: saveTenant, findTenantById, findTenantByStripeCustomerId, updateTenant.
 */
import {
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type { NativeAttributeValue } from '@aws-sdk/lib-dynamodb';
import { getDynamoDocumentClient } from '@eventgear/db';
import { getConfig } from '@eventgear/config';
import type { Tenant } from './types.js';

const TENANT_KEY_FIELDS = new Set(['PK', 'SK', 'GSI1PK', 'GSI1SK', 'EntityType', 'CreatedAt']);

function pk(tenantId: string) { return `TENANT#${tenantId}`; }
function gsi1pk(stripeCustomerId: string) { return `STRIPE_CUSTOMER#${stripeCustomerId}`; }

function stripKeys(record: Record<string, unknown>): Tenant {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) {
    if (!TENANT_KEY_FIELDS.has(k)) result[k] = v;
  }
  return result as Tenant;
}

export class TenantRepository {
  private get tableName() { return getConfig().dynamoTableName; }
  private get client() { return getDynamoDocumentClient(); }

  async saveTenant(tenant: Tenant): Promise<void> {
    await this.client.send(new PutCommand({
      TableName: this.tableName,
      Item: {
        ...tenant,
        PK: pk(tenant.id),
        SK: 'METADATA',
        GSI1PK: gsi1pk(tenant.stripeCustomerId),
        GSI1SK: pk(tenant.id),
        EntityType: 'TENANT',
        CreatedAt: tenant.createdAt,
      },
    }));
  }

  async findTenantById(tenantId: string): Promise<Tenant | null> {
    const result = await this.client.send(new GetCommand({
      TableName: this.tableName,
      Key: { PK: pk(tenantId), SK: 'METADATA' },
    }));
    if (!result.Item) return null;
    return stripKeys(result.Item as Record<string, unknown>);
  }

  /** Used by Stripe webhook handler to look up tenant from stripeCustomerId */
  async findTenantByStripeCustomerId(stripeCustomerId: string): Promise<Tenant | null> {
    const result = await this.client.send(new QueryCommand({
      TableName: this.tableName,
      IndexName: 'GSI1',
      KeyConditionExpression: '#gsi1pk = :gsi1pk',
      ExpressionAttributeNames: { '#gsi1pk': 'GSI1PK' },
      ExpressionAttributeValues: { ':gsi1pk': gsi1pk(stripeCustomerId) },
      Limit: 1,
    }));
    const item = result.Items?.at(0);
    if (!item) return null;
    return stripKeys(item as Record<string, unknown>);
  }

  async updateTenant(
    tenantId: string,
    updates: Partial<Pick<Tenant, 'status' | 'plan' | 'stripeSubscriptionId' | 'updatedAt'>>,
  ): Promise<void> {
    const entries = Object.entries(updates).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return;

    const updateParts: string[] = [];
    const attrNames: Record<string, string> = {};
    const attrValues: Record<string, NativeAttributeValue> = {};

    entries.forEach(([field, value], i) => {
      attrNames[`#f${i}`] = field;
      attrValues[`:v${i}`] = value as NativeAttributeValue;
      updateParts.push(`#f${i} = :v${i}`);
    });

    await this.client.send(new UpdateCommand({
      TableName: this.tableName,
      Key: { PK: pk(tenantId), SK: 'METADATA' },
      UpdateExpression: `SET ${updateParts.join(', ')}`,
      ExpressionAttributeNames: attrNames,
      ExpressionAttributeValues: attrValues,
    }));
  }
}
```

- [ ] **Step 3: Update src/index.ts**

```typescript
// packages/auth/src/index.ts
export type { AuthContext, Tenant, UserRole } from './types.js';
export { verifyToken } from './jwt.js';
export { getVerifier } from './jwks-client.js';
export { TenantRepository } from './tenant-repository.js';
```

- [ ] **Step 4: Run integration tests (requires DynamoDB Local)**

```bash
pnpm --filter @eventgear/auth test
```

Expected: All 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/auth/src/tenant-repository.ts packages/auth/src/index.ts
git add packages/auth/src/__tests__/tenant-repository.test.ts
git commit -m "feat(auth): add TenantRepository with save/find/update + GSI1 Stripe lookup"
```

---

## Task 4: packages/db — tenant prefix in BaseRepository + schema.ts

**Files:**
- Modify: `packages/db/src/base-repository.ts`
- Modify: `packages/db/src/schema.ts`

Every `buildKey` builder gains `tenantId` as its **first** parameter. `BaseRepository` gains a required `tenantId` constructor param stored as `protected readonly tenantId`. All domain repositories pass `this.tenantId` to every `buildKey` call.

GSI2 `EntityType` field: repurposed to store compound value `TENANT#{tenantId}#ENTITY#{type}` — no new attribute name, no Terraform change needed.

GSI3 `Status` field: repurposed to store compound value `TENANT#{tenantId}#{status}` — e.g. `TENANT#01J9...#AVAILABLE`.

- [ ] **Step 1: Write failing test for BaseRepository tenantId (TDD red)**

```typescript
// packages/db/src/__tests__/base-repository.test.ts
import { BaseRepository } from '../base-repository.js';

// Concrete subclass for testing
class TestRepo extends BaseRepository<{ id: string }> {
  constructor(tenantId: string) { super(tenantId); }
  getTenantId() { return this.tenantId; }
}

describe('BaseRepository', () => {
  it('stores tenantId from constructor', () => {
    const repo = new TestRepo('TEST_TENANT_01');
    expect(repo.getTenantId()).toBe('TEST_TENANT_01');
  });
});
```

Run: `pnpm --filter @eventgear/db test` — Expected: FAIL (BaseRepository has no constructor accepting tenantId)

- [ ] **Step 2: Modify `packages/db/src/base-repository.ts` — add tenantId constructor (TDD green)**

Change the class from:
```typescript
export abstract class BaseRepository<T extends object> {
  private get tableName(): string {
```
To:
```typescript
export abstract class BaseRepository<T extends object> {
  constructor(protected readonly tenantId: string) {}

  private get tableName(): string {
```

No other changes to `BaseRepository` — the tenant prefix is entirely in the key builders.

Run: `pnpm --filter @eventgear/db test` — Expected: PASS

- [ ] **Step 3: Modify `packages/db/src/schema.ts` — add tenantId to all buildKey builders**

Add `AVAILABILITY_BLOCK` to `EntityType` enum (it was missing; `TENANT` is not needed in the enum — `TenantRepository` uses the string literal `'TENANT'` directly):
```typescript
export enum EntityType {
  EQUIPMENT = 'EQUIPMENT',
  STOCKUNIT = 'STOCKUNIT',
  CATEGORY = 'CATEGORY',
  RESERVATION = 'RESERVATION',
  RESERVATION_ITEM = 'RESERVATION_ITEM',
  AVAILABILITY_BLOCK = 'AVAILABILITY_BLOCK',
  MAINTENANCE_RECORD = 'MAINTENANCE_RECORD',
  INVOICE = 'INVOICE',
  DISPATCH_JOB = 'DISPATCH_JOB',
  KIT = 'KIT',
  KIT_ITEM = 'KIT_ITEM',
}
```

Then update all `buildKey` builders — `tenantId` is the first parameter of every function. The `t` prefix is shorthand:

```typescript
export const buildKey = {
  equipment: {
    main: (t: string, equipmentId: string) => ({
      PK: `TENANT#${t}#EQUIP#${equipmentId}`,
      SK: 'METADATA',
    }),
    gsi1: (t: string, categoryId: string, equipmentId: string) => ({
      GSI1PK: `TENANT#${t}#CATEGORY#${categoryId}`,
      GSI1SK: `EQUIP#${equipmentId}`,
    }),
    // GSI2 — AP-21: list all equipment for tenant
    gsi2: (t: string) => ({
      EntityType: `TENANT#${t}#ENTITY#EQUIPMENT`,
    }),
  },

  stockUnit: {
    main: (t: string, equipmentId: string, unitId: string) => ({
      PK: `TENANT#${t}#EQUIP#${equipmentId}`,
      SK: `UNIT#${unitId}`,
    }),
    gsi1: (t: string, unitId: string) => ({
      GSI1PK: `TENANT#${t}#UNIT#${unitId}`,
      GSI1SK: 'METADATA',
    }),
    // GSI3 — AP-06: available units. Status field holds compound value.
    gsi3: (t: string, equipmentId: string) => ({
      GSI3SK: `EQUIP#${equipmentId}`,
    }),
    // Status field for GSI3 partition key (compound tenant+status value)
    statusKey: (t: string, status: string) => ({
      Status: `TENANT#${t}#${status}`,
    }),
  },

  category: {
    main: (t: string, categoryId: string) => ({
      PK: `TENANT#${t}#CATEGORY#${categoryId}`,
      SK: 'METADATA',
    }),
    gsi2: (t: string) => ({
      EntityType: `TENANT#${t}#ENTITY#CATEGORY`,
    }),
  },

  maintenanceRecord: {
    main: (t: string, equipmentId: string, timestamp: string, recordId: string) => ({
      PK: `TENANT#${t}#EQUIP#${equipmentId}`,
      SK: `MAINTENANCE#${timestamp}#${recordId}`,
    }),
    gsi1: (t: string, unitId: string, timestamp: string) => ({
      GSI1PK: `TENANT#${t}#UNIT#${unitId}`,
      GSI1SK: `MAINTENANCE#${timestamp}`,
    }),
    gsi3: (t: string, equipmentId: string, timestamp: string) => ({
      GSI3SK: `${equipmentId}#${timestamp}`,
    }),
    statusKey: (t: string, status: string) => ({
      Status: `TENANT#${t}#${status}`,
    }),
  },

  reservation: {
    main: (t: string, reservationId: string) => ({
      PK: `TENANT#${t}#RESERVATION#${reservationId}`,
      SK: 'METADATA',
    }),
    gsi1: (t: string, customerId: string, reservationId: string) => ({
      GSI1PK: `TENANT#${t}#CUSTOMER#${customerId}`,
      GSI1SK: `RESERVATION#${reservationId}`,
    }),
    gsi2: (t: string) => ({
      EntityType: `TENANT#${t}#ENTITY#RESERVATION`,
    }),
    gsi3: (t: string, startDate: string, reservationId: string) => ({
      GSI3SK: `${startDate}#${reservationId}`,
    }),
    statusKey: (t: string, status: string) => ({
      Status: `TENANT#${t}#${status}`,
    }),
  },

  reservationItem: {
    main: (t: string, reservationId: string, itemId: string) => ({
      PK: `TENANT#${t}#RESERVATION#${reservationId}`,
      SK: `ITEM#${itemId}`,
    }),
    gsi1: (t: string, equipmentId: string, reservationId: string, itemId: string) => ({
      GSI1PK: `TENANT#${t}#EQUIP#${equipmentId}`,
      GSI1SK: `RESERVATION#${reservationId}#ITEM#${itemId}`,
    }),
  },

  availabilityBlock: {
    main: (t: string, unitId: string, startDate: string, endDate: string, reservationId: string) => ({
      PK: `TENANT#${t}#UNIT#${unitId}`,
      SK: `BLOCK#${startDate}#${endDate}#${reservationId}`,
    }),
    gsi1: (t: string, reservationId: string, unitId: string) => ({
      GSI1PK: `TENANT#${t}#RESERVATION#${reservationId}`,
      GSI1SK: `BLOCK#${unitId}`,
    }),
  },

  // Remaining builders (customer, invoice, dispatchJob, kit) follow the same pattern.
  // These are not yet used in active domains — add tenantId prefix but keep existing SK shape.
  customer: {
    main: (t: string, customerId: string) => ({
      PK: `TENANT#${t}#CUSTOMER#${customerId}`,
      SK: 'METADATA',
    }),
    gsi1ByEmail: (t: string, email: string, customerId: string) => ({
      GSI1PK: `TENANT#${t}#EMAIL#${email}`,
      GSI1SK: `CUSTOMER#${customerId}`,
    }),
  },

  invoice: {
    main: (t: string, invoiceId: string) => ({
      PK: `TENANT#${t}#INVOICE#${invoiceId}`,
      SK: 'METADATA',
    }),
    gsi1Customer: (t: string, customerId: string, invoiceId: string) => ({
      GSI1PK: `TENANT#${t}#CUSTOMER#${customerId}`,
      GSI1SK: `INVOICE#${invoiceId}`,
    }),
    gsi1Reservation: (t: string, reservationId: string, invoiceId: string) => ({
      GSI1PK: `TENANT#${t}#RESERVATION#${reservationId}`,
      GSI1SK: `INVOICE#${invoiceId}`,
    }),
    gsi3: (t: string, dueDate: string, invoiceId: string) => ({
      GSI3SK: `${dueDate}#${invoiceId}`,
    }),
    statusKey: (t: string, status: string) => ({
      Status: `TENANT#${t}#${status}`,
    }),
  },

  dispatchJob: {
    main: (t: string, jobId: string) => ({
      PK: `TENANT#${t}#DISPATCH#${jobId}`,
      SK: 'METADATA',
    }),
    gsi1: (t: string, reservationId: string, jobId: string) => ({
      GSI1PK: `TENANT#${t}#RESERVATION#${reservationId}`,
      GSI1SK: `DISPATCH#${jobId}`,
    }),
    gsi3: (t: string, scheduledDate: string, jobId: string) => ({
      GSI3SK: `${scheduledDate}#${jobId}`,
    }),
    statusKey: (t: string, status: string) => ({
      Status: `TENANT#${t}#${status}`,
    }),
  },

  kit: {
    main: (t: string, kitId: string) => ({
      PK: `TENANT#${t}#KIT#${kitId}`,
      SK: 'METADATA',
    }),
    item: (t: string, kitId: string, equipmentId: string) => ({
      PK: `TENANT#${t}#KIT#${kitId}`,
      SK: `ITEM#${equipmentId}`,
    }),
  },
} as const;
```

- [ ] **Step 4: Verify packages/db builds**

```bash
pnpm --filter @eventgear/db build
```

Expected: FAIL — `domains/inventory/repository.ts` will have TypeScript errors (wrong arity on buildKey calls). That is expected and will be fixed in Task 5. **Do NOT commit yet** — commit both packages/db changes and inventory repository migration together in Task 5, Step 6.

---

## Task 5: Inventory repository migration

**Files:**
- Modify: `domains/inventory/repository.ts`

`InventoryRepository` extends `BaseRepository<Equipment>`. Its constructor now must call `super(tenantId)` and pass `this.tenantId` to every `buildKey` call. The GSI2 `EntityType` field now uses the compound key from `buildKey.*.gsi2()`. The GSI3 `Status` field now uses `buildKey.*.statusKey()`.

- [ ] **Step 1: Run existing tests to confirm they currently fail (baseline)**

```bash
pnpm --filter @eventgear/inventory test 2>&1 | tail -20
```

Expected: TypeScript errors / failures due to buildKey arity mismatch.

- [ ] **Step 2: Update `domains/inventory/repository.ts`**

```typescript
export class InventoryRepository extends BaseRepository<Equipment> {
  constructor(tenantId: string) {
    super(tenantId);
  }

  // AP-01
  async findEquipmentById(id: string): Promise<Equipment | null> {
    return this.getItem<Equipment>(buildKey.equipment.main(this.tenantId, id));
  }

  // AP-02
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
          ':gsi1pk': `TENANT#${this.tenantId}#CATEGORY#${categoryId}`,
        },
      },
      pagination,
    );
  }

  // AP-21 — uses compound EntityType value for tenant isolation
  async listAllEquipment(
    pagination: PaginationParams,
  ): Promise<PaginatedResult<Equipment>> {
    return this.queryPaginated<Equipment>(
      {
        IndexName: GSI.GSI2,
        KeyConditionExpression: '#entityType = :entityType',
        ExpressionAttributeNames: { '#entityType': 'EntityType' },
        ExpressionAttributeValues: {
          ':entityType': `TENANT#${this.tenantId}#ENTITY#EQUIPMENT`,
        },
      },
      pagination,
    );
  }

  async saveEquipment(equipment: Equipment): Promise<void> {
    const record: DynamoRecord<Equipment> = {
      ...equipment,
      ...buildKey.equipment.main(this.tenantId, equipment.id),
      ...buildKey.equipment.gsi1(this.tenantId, equipment.categoryId, equipment.id),
      ...buildKey.equipment.gsi2(this.tenantId),
      CreatedAt: equipment.createdAt,
    };
    await this.putItem<Equipment>(record);
  }

  // AP-03 — categories for this tenant
  async listCategories(): Promise<Category[]> {
    return this.query<Category>({
      IndexName: GSI.GSI2,
      KeyConditionExpression: '#entityType = :entityType',
      ExpressionAttributeNames: { '#entityType': 'EntityType' },
      ExpressionAttributeValues: {
        ':entityType': `TENANT#${this.tenantId}#ENTITY#CATEGORY`,
      },
    });
  }

  async saveCategory(category: Category): Promise<void> {
    const record: DynamoRecord<Category> = {
      ...category,
      ...buildKey.category.main(this.tenantId, category.id),
      ...buildKey.category.gsi2(this.tenantId),
      CreatedAt: category.createdAt,
    };
    await this.putItem<Category>(record);
  }

  // AP-04
  async findStockUnitsByEquipment(equipmentId: string): Promise<StockUnit[]> {
    return this.query<StockUnit>({
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
      ExpressionAttributeNames: { '#pk': 'PK', '#sk': 'SK' },
      ExpressionAttributeValues: {
        ':pk': `TENANT#${this.tenantId}#EQUIP#${equipmentId}`,
        ':skPrefix': 'UNIT#',
      },
    });
  }

  // AP-05
  async findStockUnitById(unitId: string): Promise<StockUnit | null> {
    const results = await this.query<StockUnit>({
      IndexName: GSI.GSI1,
      KeyConditionExpression: '#gsi1pk = :gsi1pk AND #gsi1sk = :gsi1sk',
      ExpressionAttributeNames: { '#gsi1pk': 'GSI1PK', '#gsi1sk': 'GSI1SK' },
      ExpressionAttributeValues: {
        ':gsi1pk': `TENANT#${this.tenantId}#UNIT#${unitId}`,
        ':gsi1sk': 'METADATA',
      },
      Limit: 1,
    });
    return results.at(0) ?? null;
  }

  // AP-06 — compound Status key: TENANT#{t}#AVAILABLE
  async findAvailableUnitsByEquipment(equipmentId: string): Promise<StockUnit[]> {
    return this.query<StockUnit>({
      IndexName: GSI.GSI3,
      KeyConditionExpression: '#status = :status AND begins_with(#gsi3sk, :prefix)',
      ExpressionAttributeNames: { '#status': 'Status', '#gsi3sk': 'GSI3SK' },
      ExpressionAttributeValues: {
        ':status': `TENANT#${this.tenantId}#AVAILABLE`,
        ':prefix': `EQUIP#${equipmentId}`,
      },
    });
  }

  async saveStockUnit(unit: StockUnit): Promise<void> {
    const record: DynamoRecord<StockUnit> = {
      ...unit,
      ...buildKey.stockUnit.main(this.tenantId, unit.equipmentId, unit.id),
      ...buildKey.stockUnit.gsi1(this.tenantId, unit.id),
      ...buildKey.stockUnit.gsi3(this.tenantId, unit.equipmentId),
      ...buildKey.stockUnit.statusKey(this.tenantId, unit.status),
      EntityType: `TENANT#${this.tenantId}#ENTITY#STOCKUNIT`,
      CreatedAt: unit.createdAt,
    };
    await this.putItem<StockUnit>(record);
  }

  // AP-13
  async findMaintenanceHistory(equipmentId: string): Promise<MaintenanceRecord[]> {
    return this.query<MaintenanceRecord>({
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
      ExpressionAttributeNames: { '#pk': 'PK', '#sk': 'SK' },
      ExpressionAttributeValues: {
        ':pk': `TENANT#${this.tenantId}#EQUIP#${equipmentId}`,
        ':skPrefix': 'MAINTENANCE#',
      },
      ScanIndexForward: false,
    });
  }

  async findMaintenanceRecordById(recordId: string): Promise<MaintenanceRecord | null> {
    const results = await this.query<MaintenanceRecord>({
      IndexName: GSI.GSI2,
      KeyConditionExpression: '#entityType = :entityType',
      FilterExpression: '#id = :id',
      ExpressionAttributeNames: { '#entityType': 'EntityType', '#id': 'id' },
      ExpressionAttributeValues: {
        ':entityType': `TENANT#${this.tenantId}#ENTITY#MAINTENANCE_RECORD`,
        ':id': recordId,
      },
      Limit: 1,
    });
    return results.at(0) ?? null;
  }

  async saveMaintenanceRecord(record: MaintenanceRecord): Promise<void> {
    const dynRecord: DynamoRecord<MaintenanceRecord> = {
      ...record,
      ...buildKey.maintenanceRecord.main(this.tenantId, record.equipmentId, record.scheduledDate, record.id),
      ...buildKey.maintenanceRecord.gsi1(this.tenantId, record.unitId, record.scheduledDate),
      ...buildKey.maintenanceRecord.gsi3(this.tenantId, record.equipmentId, record.scheduledDate),
      ...buildKey.maintenanceRecord.statusKey(this.tenantId, record.status),
      EntityType: `TENANT#${this.tenantId}#ENTITY#MAINTENANCE_RECORD`,
      CreatedAt: record.createdAt,
    };
    await this.putItem<MaintenanceRecord>(dynRecord);
  }
}
```

- [ ] **Step 3: Update `InventoryService` instantiation in `apps/api/src/server.ts`**

In `server.ts`, the `InventoryRepository` is created with no arguments. It now needs a `tenantId`. For the local dev server, use a hardcoded dev tenant ID (the authorizer is bypassed in local dev):

```typescript
// At the top of server.ts, add:
const DEV_TENANT_ID = 'DEV_TENANT';

// Change:
const repo = new InventoryRepository();
// To:
const repo = new InventoryRepository(DEV_TENANT_ID);
```

- [ ] **Step 4: Update seed script**

Read `packages/db/src/seed.ts` and update all `PK`/`SK`/`GSI` key values to include `TENANT#DEV_TENANT#` prefix. The seed script writes items directly via raw DynamoDB — update the raw item objects (e.g. `PK: 'EQUIP#...'` → `PK: 'TENANT#DEV_TENANT#EQUIP#...'`). Use the same compound `EntityType` and `Status` values that the repository now writes.

- [ ] **Step 5: Run tests**

```bash
pnpm --filter @eventgear/db test
pnpm --filter @eventgear/inventory test
```

Expected: `packages/db` BaseRepository test PASSES. `@eventgear/inventory` unit tests PASS (mocked repo). Integration tests PASS with the new tenant-prefixed key format.

- [ ] **Step 6: Commit packages/db + inventory together**

These two changes must land in one commit — packages/db builds with TypeScript errors until inventory is updated:

```bash
git add packages/db/src/base-repository.ts packages/db/src/schema.ts packages/db/src/__tests__/
git add domains/inventory/repository.ts apps/api/src/server.ts packages/db/src/seed.ts
git commit -m "feat(db,inventory): add tenantId to BaseRepository + migrate inventory to tenant-prefixed keys"
```

---

## Task 6: Config updates for Cognito

**Files:**
- Modify: `packages/config/src/index.ts`
- Modify: `apps/api/.env.local.example`

`cognitoUserPoolId` and `cognitoClientId` already exist in the config schema but are `.optional()`. Make them required when `nodeEnv === 'production'`. For local dev, they can remain optional (the authorizer Lambda is not invoked by the Express dev server).

- [ ] **Step 1: Update config schema**

The existing schema has:
```typescript
cognitoUserPoolId: z.string().optional(),
cognitoClientId: z.string().optional(),
```

Add `cognitoUserPoolRegion` (for JWKS URL construction):
```typescript
cognitoUserPoolId: z.string().optional(),
cognitoClientId: z.string().optional(),
cognitoUserPoolRegion: z.string().default('us-east-1'),
```

And in `loadConfig()`:
```typescript
cognitoUserPoolRegion: process.env['COGNITO_USER_POOL_REGION'],
```

- [ ] **Step 2: Update `.env.local.example`**

Add commented-out Cognito vars:
```bash
# Cognito (required in production, optional for local dev — authorizer not invoked by Express)
# COGNITO_USER_POOL_ID=us-east-1_XXXXXXXX
# COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
# COGNITO_USER_POOL_REGION=us-east-1
```

- [ ] **Step 3: Commit**

```bash
git add packages/config/src/index.ts apps/api/.env.local.example
git commit -m "feat(config): add cognitoUserPoolRegion config field"
```

---

## Task 7: Lambda authorizer

**Files:**
- Create: `apps/api/src/authorizer.ts`

The authorizer receives an API Gateway request, extracts the `Authorization: Bearer <token>` header, verifies it via `verifyToken()`, reads the tenant `status` from DynamoDB, and returns an IAM policy.

- [ ] **Step 1: Create `apps/api/src/authorizer.ts`**

```typescript
/**
 * @file authorizer.ts
 * @purpose API Gateway Lambda authorizer — validates Cognito JWT, checks tenant status,
 *   injects { tenantId, role, userId } into request context.
 *
 * @ai-notes /billing/webhook is excluded from this authorizer in API Gateway config.
 *   authorizerResultTtlInSeconds=300 in Terraform caches the policy for 5 min per token.
 *   DynamoDB tenant read only happens on cache miss (i.e. cold start or new token).
 */
import type { APIGatewayTokenAuthorizerEvent, APIGatewayAuthorizerResult } from 'aws-lambda';
import { verifyToken, TenantRepository } from '@eventgear/auth';

const tenantRepo = new TenantRepository();

export async function handler(
  event: APIGatewayTokenAuthorizerEvent,
): Promise<APIGatewayAuthorizerResult> {
  const token = event.authorizationToken?.replace(/^Bearer\s+/i, '');

  if (!token) {
    throw new Error('Unauthorized'); // API GW returns 401
  }

  let context: { tenantId: string; role: string; userId: string };
  try {
    context = await verifyToken(token);
  } catch {
    throw new Error('Unauthorized'); // invalid or expired token → 401
  }

  // Check tenant billing status
  const tenant = await tenantRepo.findTenantById(context.tenantId);
  if (!tenant) {
    throw new Error('Unauthorized'); // tenant provisioning incomplete
  }

  if (tenant.status === 'PAST_DUE' || tenant.status === 'CANCELLED') {
    // Return Deny policy — API GW translates to 403
    return generatePolicy(context.userId, 'Deny', event.methodArn, context);
  }

  return generatePolicy(context.userId, 'Allow', event.methodArn, context);
}

function generatePolicy(
  principalId: string,
  effect: 'Allow' | 'Deny',
  resource: string,
  context: { tenantId: string; role: string; userId: string },
): APIGatewayAuthorizerResult {
  return {
    principalId,
    policyDocument: {
      Version: '2012-10-17',
      Statement: [{ Action: 'execute-api:Invoke', Effect: effect, Resource: resource }],
    },
    context: {
      tenantId: context.tenantId,
      role: context.role,
      userId: context.userId,
    },
  };
}
```

- [ ] **Step 2: Verify `@types/aws-lambda` is installed**

`@types/aws-lambda` is already listed in `apps/api/package.json` devDependencies. No install needed — verify with:

```bash
grep '@types/aws-lambda' apps/api/package.json
```

If it's missing for some reason: `pnpm --filter @eventgear/api add -D @types/aws-lambda`

- [ ] **Step 3: Build api**

```bash
pnpm --filter @eventgear/api build
```

Expected: PASS (no TypeScript errors)

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/authorizer.ts
git commit -m "feat(api): add Lambda authorizer with JWT verification and tenant status check"
```

---

## Task 8: Frontend — AuthContext + ProtectedRoute

**Files:**
- Create: `apps/web/src/features/auth/AuthContext.tsx`
- Create: `apps/web/src/features/auth/ProtectedRoute.tsx`

Install `amazon-cognito-identity-js` for SRP authentication and token management.

- [ ] **Step 1: Install cognito SDK**

```bash
pnpm --filter @eventgear/web add amazon-cognito-identity-js
```

- [ ] **Step 2: Create AuthContext.tsx**

```typescript
// apps/web/src/features/auth/AuthContext.tsx
/**
 * @file AuthContext.tsx
 * @purpose React Context providing authenticated user state to the entire app.
 *   Reads the Cognito access token from localStorage on mount (persisted by cognito-identity-js).
 *   Exposes: user (or null), login(), logout(), isLoading.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  type CognitoUserSession,
} from 'amazon-cognito-identity-js';

const userPool = new CognitoUserPool({
  UserPoolId: __COGNITO_USER_POOL_ID__,
  ClientId: __COGNITO_CLIENT_ID__,
});

export interface AuthUser {
  userId: string;
  tenantId: string;
  role: string;
  email: string;
  accessToken: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function parseUser(session: CognitoUserSession, email: string): AuthUser {
  const payload = session.getAccessToken().decodePayload();
  return {
    userId: payload['sub'] as string,
    tenantId: payload['custom:tenantId'] as string,
    role: payload['custom:role'] as string,
    email,
    accessToken: session.getAccessToken().getJwtToken(),
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // On mount: restore session from localStorage if valid
  useEffect(() => {
    const cognitoUser = userPool.getCurrentUser();
    if (!cognitoUser) { setIsLoading(false); return; }

    cognitoUser.getSession((err: Error | null, session: CognitoUserSession | null) => {
      if (err || !session?.isValid()) {
        setIsLoading(false);
        return;
      }
      const email = cognitoUser.getUsername();
      setUser(parseUser(session, email));
      setIsLoading(false);
    });
  }, []);

  const login = (email: string, password: string) =>
    new Promise<void>((resolve, reject) => {
      const cognitoUser = new CognitoUser({ Username: email, Pool: userPool });
      const authDetails = new AuthenticationDetails({ Username: email, Password: password });

      cognitoUser.authenticateUser(authDetails, {
        onSuccess: (session) => {
          setUser(parseUser(session, email));
          resolve();
        },
        onFailure: reject,
      });
    });

  const logout = () => {
    userPool.getCurrentUser()?.signOut();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
```

- [ ] **Step 3: Update `define` block in `apps/web/vite.config.ts`**

**Read `apps/web/vite.config.ts` first**, then replace the entire existing `define` block (do NOT just add to it — duplicate keys silently overwrite each other in Vite). The replacement must include all previously-defined constants plus the new Cognito ones:

```typescript
define: {
  __API_BASE_URL__: JSON.stringify(process.env['VITE_API_BASE_URL'] ?? 'http://localhost:3001'),
  __COGNITO_USER_POOL_ID__: JSON.stringify(process.env['VITE_COGNITO_USER_POOL_ID'] ?? ''),
  __COGNITO_CLIENT_ID__: JSON.stringify(process.env['VITE_COGNITO_CLIENT_ID'] ?? ''),
},
```

Verify the final file has exactly one `define:` key in `defineConfig({...})`.

Also add `VITE_COGNITO_USER_POOL_ID=` and `VITE_COGNITO_CLIENT_ID=` (blank) to `apps/web/.env.local.example` if that file exists.

- [ ] **Step 4: Add type declarations to `apps/web/src/vite-env.d.ts`**

```typescript
declare const __API_BASE_URL__: string;
declare const __COGNITO_USER_POOL_ID__: string;
declare const __COGNITO_CLIENT_ID__: string;
```

- [ ] **Step 5: Create ProtectedRoute.tsx**

Use `<Outlet />` (not `{children}`) — React Router v6 layout routes render their matched child routes via `<Outlet />`. Passing `children` prevents child routes from rendering.

```typescript
// apps/web/src/features/auth/ProtectedRoute.tsx
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './AuthContext';
import Spinner from '@/components/ui/Spinner';

export default function ProtectedRoute() {
  const { user, isLoading } = useAuth();
  if (isLoading) return <div className="flex h-screen items-center justify-center"><Spinner /></div>;
  if (!user) return <Navigate to="/login" replace />;
  return <Outlet />;
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/auth/AuthContext.tsx
git add apps/web/src/features/auth/ProtectedRoute.tsx
git add apps/web/src/vite-env.d.ts apps/web/vite.config.ts
git commit -m "feat(web): add AuthContext with Cognito SRP login and ProtectedRoute"
```

---

## Task 9: Frontend — LoginPage + SignupPage

**Files:**
- Create: `apps/web/src/features/auth/LoginPage.tsx`
- Create: `apps/web/src/features/auth/SignupPage.tsx`

- [ ] **Step 1: Install Cognito Identity Provider SDK and supertest on api**

```bash
pnpm --filter @eventgear/api add @aws-sdk/client-cognito-identity-provider ulid
pnpm --filter @eventgear/api add -D supertest @types/supertest
```

- [ ] **Step 2: Prepare `apps/api/src/server.ts` for testing**

Read `apps/api/src/server.ts`. Make two changes:
1. Export `app` so tests can import it: change `const app = express()` to `export const app = express()`
2. Guard `app.listen()` so it doesn't bind a port during tests: wrap the `listen` call:
```typescript
if (process.env['NODE_ENV'] !== 'test') {
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}
```

- [ ] **Step 3: Write failing test for signup endpoint**

```typescript
// apps/api/src/__tests__/auth-signup.test.ts
import request from 'supertest';
import { app } from '../server.js';

describe('POST /auth/signup', () => {
  it('returns 400 when name is missing', async () => {
    const res = await request(app)
      .post('/auth/signup')
      .send({ email: 'test@example.com', password: 'Password1' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
  });

  it('returns 201 and tenantId on valid signup (local dev — no Cognito)', async () => {
    const res = await request(app)
      .post('/auth/signup')
      .send({ name: 'Test Co', email: `test+${Date.now()}@example.com`, password: 'Password1' });
    expect(res.status).toBe(201);
    expect(res.body.data.tenantId).toBeTruthy();
  });
});
```

Run: `pnpm --filter @eventgear/api test` — Expected: FAIL (route does not exist yet, but supertest and `app` export work)

- [ ] **Step 4: Create LoginPage.tsx**

```typescript
// apps/web/src/features/auth/LoginPage.tsx
import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from './AuthContext';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await login(email, password);
      navigate('/inventory/equipment', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950">
      <div className="w-full max-w-sm bg-gray-900 rounded-lg p-8">
        <h1 className="text-xl font-semibold text-white mb-6">Sign in to EventGear</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Email</label>
            <input
              type="email" required value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Password</label>
            <input
              type="password" required value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
            />
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button
            type="submit" disabled={isSubmitting}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded px-4 py-2 text-sm font-medium"
          >
            {isSubmitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <p className="text-gray-500 text-sm mt-4 text-center">
          No account? <Link to="/signup" className="text-blue-400 hover:underline">Sign up</Link>
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Create SignupPage.tsx**

SignupPage calls `POST /auth/signup` — a new backend endpoint that creates the Cognito user and DynamoDB Tenant record. Keep the frontend simple: collect company name + email + password, POST to API, redirect to login on success.

```typescript
// apps/web/src/features/auth/SignupPage.tsx
import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';

export default function SignupPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const base = __API_BASE_URL__ || 'http://localhost:3001';
      const res = await fetch(`${base}/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: { message?: string } };
        throw new Error(body.error?.message ?? `Error ${res.status}`);
      }
      navigate('/login', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Signup failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950">
      <div className="w-full max-w-sm bg-gray-900 rounded-lg p-8">
        <h1 className="text-xl font-semibold text-white mb-6">Create your account</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          {(['name', 'email', 'password'] as const).map(field => (
            <div key={field}>
              <label className="block text-sm text-gray-400 mb-1 capitalize">
                {field === 'name' ? 'Company name' : field}
              </label>
              <input
                type={field === 'password' ? 'password' : field === 'email' ? 'email' : 'text'}
                required value={form[field]}
                onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
              />
            </div>
          ))}
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button
            type="submit" disabled={isSubmitting}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded px-4 py-2 text-sm font-medium"
          >
            {isSubmitting ? 'Creating account…' : 'Create account'}
          </button>
        </form>
        <p className="text-gray-500 text-sm mt-4 text-center">
          Already have an account? <Link to="/login" className="text-blue-400 hover:underline">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Add `POST /auth/signup` to `apps/api/src/server.ts`**

This endpoint creates the Cognito user and DynamoDB Tenant record:

```typescript
// In server.ts, import at top:
import { CognitoIdentityProviderClient, AdminCreateUserCommand, AdminSetUserPasswordCommand } from '@aws-sdk/client-cognito-identity-provider';
import { TenantRepository } from '@eventgear/auth';
import type { Tenant } from '@eventgear/auth';
import { ulid } from 'ulid';

// Before the error handler:
const tenantRepo = new TenantRepository();

app.post('/auth/signup', wrap(async (req, res) => {
  const { name, email, password } = req.body as { name?: string; email?: string; password?: string };
  if (!name || !email || !password) {
    return void res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'name, email, and password required' } });
  }

  const tenantId = ulid();
  const userId = ulid();

  // In local dev (no Cognito configured), skip Cognito and just create the tenant record
  const userPoolId = process.env['COGNITO_USER_POOL_ID'];
  if (userPoolId) {
    const cognito = new CognitoIdentityProviderClient({});
    await cognito.send(new AdminCreateUserCommand({
      UserPoolId: userPoolId,
      Username: email,
      MessageAction: 'SUPPRESS',
      UserAttributes: [
        { Name: 'email', Value: email },
        { Name: 'email_verified', Value: 'true' },
        { Name: 'custom:tenantId', Value: tenantId },
        { Name: 'custom:role', Value: 'ADMIN' },
      ],
    }));
    await cognito.send(new AdminSetUserPasswordCommand({
      UserPoolId: userPoolId,
      Username: email,
      Password: password,
      Permanent: true,
    }));
  }

  const now = new Date().toISOString();
  const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  const tenant: Tenant = {
    id: tenantId,
    name,
    plan: 'STARTER',
    status: 'TRIALING',
    trialEndsAt,
    stripeCustomerId: `local_${tenantId}`, // replaced by real Stripe cus_ in production
    createdAt: now,
    updatedAt: now,
  };
  await tenantRepo.saveTenant(tenant);

  res.status(201).json({ data: { tenantId, message: 'Account created. Please sign in.' } });
}));
```

- [ ] **Step 7: Run signup endpoint tests**

```bash
pnpm --filter @eventgear/api test
```

Expected: Both signup tests PASS (400 on missing fields, 201 with tenantId on valid signup in local dev mode).

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/features/auth/LoginPage.tsx apps/web/src/features/auth/SignupPage.tsx
git add apps/api/src/server.ts apps/api/src/__tests__/auth-signup.test.ts
git commit -m "feat(web,api): add LoginPage, SignupPage, and POST /auth/signup endpoint"
```

**Note on Stripe:** The `stripeCustomerId` is set to `local_${tenantId}` — a placeholder. Real Stripe customer creation (Sub-project 3) will replace this with an actual `cus_` ID via Stripe API at signup time. Do NOT add Stripe SDK or API calls in this task.

---

## Task 10: Wire auth into App.tsx

**Files:**
- Modify: `apps/web/src/App.tsx`

- [ ] **Step 1: Update App.tsx**

```typescript
// apps/web/src/App.tsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from '@/features/auth/AuthContext';
import ProtectedRoute from '@/features/auth/ProtectedRoute';
import LoginPage from '@/features/auth/LoginPage';
import SignupPage from '@/features/auth/SignupPage';
import AppShell from '@/components/layout/AppShell';
import CategoriesPage from '@/features/inventory/categories/CategoriesPage';
import EquipmentListPage from '@/features/inventory/equipment/EquipmentListPage';
import EquipmentDetailPage from '@/features/inventory/equipment/EquipmentDetailPage';
import NotFoundPage from '@/pages/NotFoundPage';
import AssistantButton from '@/features/assistant/AssistantButton';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Public routes */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />

          {/* Auth gate — ProtectedRoute renders <Outlet /> on success */}
          <Route element={<ProtectedRoute />}>
            {/* Layout shell — AppShell renders <Outlet /> for page content */}
            <Route element={<AppShell />}>
              <Route index element={<Navigate to="/inventory/equipment" replace />} />
              <Route path="/inventory/categories" element={<CategoriesPage />} />
              <Route path="/inventory/equipment" element={<EquipmentListPage />} />
              <Route path="/inventory/equipment/:id" element={<EquipmentDetailPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Route>
        </Routes>
        <AssistantButton />
      </BrowserRouter>
    </AuthProvider>
  );
}
```

Note: Two nested layout routes — `ProtectedRoute` (auth check, no UI) wraps `AppShell` (sidebar/layout, renders `<Outlet />`). Auth check runs once for all protected routes.

- [ ] **Step 2: Start the dev server and verify**

```bash
pnpm --filter @eventgear/web dev
```

Navigate to `http://localhost:5173` — expected: redirects to `/login`.
Navigate to `/login` — expected: login form renders.
Navigate to `/signup` — expected: signup form renders.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/App.tsx
git commit -m "feat(web): wire AuthProvider and ProtectedRoute into route tree"
```

---

## Task 11: Terraform — Cognito User Pool

**Files:**
- Create: `infra/terraform/modules/cognito/main.tf`
- Create: `infra/terraform/modules/cognito/variables.tf`
- Create: `infra/terraform/modules/cognito/outputs.tf`

- [ ] **Step 1: Create `variables.tf`**

```hcl
# infra/terraform/modules/cognito/variables.tf
variable "environment" {
  description = "Deployment environment (dev, staging, prod)"
  type        = string
}

variable "app_name" {
  description = "Application name prefix for all resources"
  type        = string
  default     = "eventgear"
}
```

- [ ] **Step 2: Create `main.tf`**

```hcl
# infra/terraform/modules/cognito/main.tf

resource "aws_cognito_user_pool" "main" {
  name = "${var.app_name}-${var.environment}"

  # Password policy
  password_policy {
    minimum_length    = 8
    require_lowercase = true
    require_numbers   = true
    require_symbols   = false
    require_uppercase = true
  }

  # Email is the username
  username_attributes = ["email"]
  auto_verified_attributes = ["email"]

  # Custom attributes for multi-tenancy and RBAC
  schema {
    name                = "tenantId"
    attribute_data_type = "String"
    mutable             = false
    required            = false
    string_attribute_constraints {
      min_length = 1
      max_length = 26  # ULID length
    }
  }

  schema {
    name                = "role"
    attribute_data_type = "String"
    mutable             = true
    required            = false
    string_attribute_constraints {
      min_length = 1
      max_length = 50
    }
  }

  # Token validity
  user_token_validity_units {
    access_token  = "hours"
    id_token      = "hours"
    refresh_token = "days"
  }
}

resource "aws_cognito_user_pool_client" "app" {
  name         = "${var.app_name}-web-${var.environment}"
  user_pool_id = aws_cognito_user_pool.main.id

  # SRP auth (no secret — browser client)
  explicit_auth_flows = [
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
  ]
  generate_secret = false

  access_token_validity  = 1   # 1 hour
  id_token_validity      = 1   # 1 hour
  refresh_token_validity = 30  # 30 days

  read_attributes  = ["email", "custom:tenantId", "custom:role"]
  write_attributes = ["email"]
}
```

- [ ] **Step 3: Create `outputs.tf`**

```hcl
# infra/terraform/modules/cognito/outputs.tf
output "user_pool_id" {
  value = aws_cognito_user_pool.main.id
}

output "user_pool_arn" {
  value = aws_cognito_user_pool.main.arn
}

output "client_id" {
  value = aws_cognito_user_pool_client.app.id
}
```

- [ ] **Step 4: Validate Terraform**

```bash
cd infra/terraform/modules/cognito && terraform init && terraform validate
```

Expected: `Success! The configuration is valid.`

- [ ] **Step 5: Commit**

```bash
git add infra/terraform/modules/cognito/
git commit -m "feat(infra): add Cognito User Pool module with custom tenantId and role attributes"
```

---

## Final Verification

- [ ] **Run all tests**

```bash
pnpm test
```

Expected: All passing. `@eventgear/auth` unit + integration tests, `@eventgear/inventory` tests with tenant-prefixed keys.

- [ ] **Run typecheck across monorepo**

```bash
pnpm typecheck
```

Expected: No errors.

- [ ] **Manual smoke test (local dev)**

```bash
pnpm dev
```

1. Open `http://localhost:5173` → redirects to `/login` ✓
2. Navigate to `/signup` → fill form → POST creates tenant in DynamoDB ✓
3. Navigate to `/login` → in local dev (no Cognito), auth is bypassed for the Express server, but the UI form renders correctly ✓
4. Inventory endpoints still work via `pnpm --filter @eventgear/api dev` with `DEV_TENANT_ID` ✓
