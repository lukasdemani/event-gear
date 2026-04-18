# SaaS Billing (Stripe) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Stripe-based SaaS subscription billing so rental companies can sign up for a 14-day trial, upgrade to a paid plan via Stripe Checkout, manage their subscription through the Stripe Customer Portal, and have their tenant status automatically updated via Stripe webhook events.

**Architecture:** Billing logic lives in `domains/billing/` following the existing domain pattern (types, service, handler, tests), with a `stripe-client.ts` singleton for the Stripe SDK. The billing domain imports `TenantRepository` from `@eventgear/auth` rather than owning its own Tenant DynamoDB access — `Tenant` has a single source of truth. The `POST /billing/webhook` route uses `express.raw()` middleware at the route level (before `express.json()` has run on that path) so Stripe signature validation receives the unparsed body.

**Tech Stack:** `stripe` (Node.js SDK v14+), AWS Secrets Manager (Stripe key storage in production), `@eventgear/auth` (TenantRepository, Tenant type), `@eventgear/events` (EventBridge publish), `@eventgear/config` (env var schema), Jest (tests).

**Spec:** `docs/specs/2026-03-23-mvp-production-readiness-design.md` (Section 3)

---

## Critical Files to Read Before Starting

- `packages/auth/src/tenant-repository.ts` — TenantRepository with `saveTenant`, `findTenantById`, `findTenantByStripeCustomerId`, `updateTenant`
- `packages/auth/src/types.ts` — `Tenant` interface (plan, status, stripeCustomerId, stripeSubscriptionId)
- `packages/config/src/index.ts` — config schema (needs `stripeSecretKey` and `stripeWebhookSecret` added)
- `apps/api/src/server.ts` — Express server wiring pattern (where billing routes are mounted)
- `apps/api/src/authorizer.ts` — Lambda authorizer (verify `/billing/webhook` is excluded)
- `domains/inventory/service.ts` — reference pattern: `Result<T>`, constructor injection, `ok()`/`err()`
- `domains/inventory/handler.ts` — reference pattern: Lambda routing, `parseBody`, zod validation
- `packages/core/src/result.ts` — `Result<T>`, `ok()`, `err()`, `AppError`
- `packages/events/src/` — `EventPublisher` interface, event envelope shape

## Plan Assumptions

- Plan 1 (auth + multi-tenancy) is complete: `packages/auth/` exists with `TenantRepository`.
- `TenantRepository.updateTenant` currently accepts `Partial<Pick<Tenant, 'status' | 'plan' | 'stripeSubscriptionId' | 'updatedAt'>>`. This plan adds `stripeCustomerId` to that union (Task 1, Step 3).
- Stripe Price IDs for STARTER/PROFESSIONAL/ENTERPRISE plans are set via environment variables (`STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PROFESSIONAL`, `STRIPE_PRICE_ENTERPRISE`) — no hardcoded price IDs.
- `/billing/webhook` is already excluded from the Lambda authorizer in `apps/api/src/authorizer.ts` per Plan 1. Verify this before Task 3.

---

## File Structure

```
domains/billing/
  SPEC.md                         — stub pointing to the MVP spec
  types.ts                        — Plan enum, PlanLimits, BillingError codes
  stripe-client.ts                — Stripe SDK singleton
  service.ts                      — createCheckoutSession, createPortalSession, getPlanLimits
  webhook-handler.ts              — Stripe event dispatch: subscription + invoice events
  handler.ts                      — Lambda entry point (routes to service + webhook-handler)
  index.ts                        — barrel exports
  __tests__/
    service.test.ts               — unit tests (mocked TenantRepository + Stripe)
    webhook-handler.test.ts       — unit tests (mocked TenantRepository + EventPublisher)
    handler.test.ts               — handler routing tests

apps/api/src/
  billing/
    route.ts                      — Express routes: POST /billing/webhook, POST /billing/checkout,
                                    POST /billing/portal, GET /billing/status
  server.ts                       — MODIFY: mount billing routes; webhook BEFORE express.json()

packages/config/src/
  index.ts                        — MODIFY: add stripeSecretKey, stripeWebhookSecret

packages/auth/src/
  tenant-repository.ts            — MODIFY: add stripeCustomerId to updateTenant params

infra/terraform/modules/secrets/
  main.tf                         — AWS Secrets Manager: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
  variables.tf
  outputs.tf

infra/terraform/environments/dev/
  main.tf                         — MODIFY: reference secrets module; Lambda env vars
```

---

## Task 1: Config + SDK install + TenantRepository update

**Files:**
- Modify: `packages/config/src/index.ts`
- Modify: `packages/auth/src/tenant-repository.ts`
- Install: `stripe` npm package

### Overview

Add Stripe config keys to the typed config schema, install the Stripe SDK, and widen `updateTenant` to accept `stripeCustomerId` — needed for the signup flow in Task 2 to replace the placeholder `local_${tenantId}` value.

---

- [ ] **Step 1.1: Install Stripe SDK**

Run from the monorepo root:

```bash
pnpm add stripe --filter @eventgear/billing
```

If `domains/billing/package.json` does not yet exist, create it first (see Step 1.6), then run install.

- [ ] **Step 1.2: Write failing config test**

```typescript
// packages/config/src/__tests__/config.test.ts
// Add to existing test file (or create if it doesn't exist)
describe('config — Stripe keys', () => {
  it('includes stripeSecretKey when env var is set', () => {
    process.env['STRIPE_SECRET_KEY'] = 'sk_test_abc';
    process.env['STRIPE_WEBHOOK_SECRET'] = 'whsec_abc';
    const { resetConfig, getConfig } = await import('../index.js');
    resetConfig();
    const config = getConfig();
    expect(config.stripeSecretKey).toBe('sk_test_abc');
    expect(config.stripeWebhookSecret).toBe('whsec_abc');
    resetConfig();
    delete process.env['STRIPE_SECRET_KEY'];
    delete process.env['STRIPE_WEBHOOK_SECRET'];
  });
});
```

Run: `pnpm --filter @eventgear/config test` — Expected: FAIL (fields don't exist on Config)

- [ ] **Step 1.3: Update `packages/config/src/index.ts` — add Stripe keys**

Locate the `configSchema` object and add after the `cognitoClientId` line:

```typescript
  // Stripe
  stripeSecretKey: z.string().optional(),         // required in prod; optional for local dev
  stripeWebhookSecret: z.string().optional(),
  stripePriceStarter: z.string().optional(),
  stripePriceProfessional: z.string().optional(),
  stripePriceEnterprise: z.string().optional(),
```

In `loadConfig()`, add the corresponding `process.env` lookups after `cognitoClientId`:

```typescript
    stripeSecretKey: process.env['STRIPE_SECRET_KEY'],
    stripeWebhookSecret: process.env['STRIPE_WEBHOOK_SECRET'],
    stripePriceStarter: process.env['STRIPE_PRICE_STARTER'],
    stripePriceProfessional: process.env['STRIPE_PRICE_PROFESSIONAL'],
    stripePriceEnterprise: process.env['STRIPE_PRICE_ENTERPRISE'],
```

Run: `pnpm --filter @eventgear/config test` — Expected: PASS

- [ ] **Step 1.4: Write failing TenantRepository test for stripeCustomerId update**

```typescript
// packages/auth/src/__tests__/tenant-repository.test.ts — add a test case
it('updates stripeCustomerId', async () => {
  await repo.updateTenant(tenantId, { stripeCustomerId: 'cus_real_xyz' });
  const found = await repo.findTenantById(tenantId);
  expect(found?.stripeCustomerId).toBe('cus_real_xyz');
});
```

Run: `pnpm --filter @eventgear/auth test` — Expected: FAIL (TypeScript error: `stripeCustomerId` not in updateTenant params union)

- [ ] **Step 1.5: Modify `packages/auth/src/tenant-repository.ts` — widen updateTenant**

In `TenantRepository`, change the `updates` parameter type from:

```typescript
updates: Partial<Pick<Tenant, 'status' | 'plan' | 'stripeSubscriptionId' | 'updatedAt'>>,
```

To:

```typescript
updates: Partial<Pick<Tenant, 'status' | 'plan' | 'stripeCustomerId' | 'stripeSubscriptionId' | 'updatedAt'>>,
```

No other changes to `tenant-repository.ts`. The DynamoDB `UpdateCommand` already uses dynamic attribute names from `Object.entries(updates)`, so `stripeCustomerId` works without further changes.

Run: `pnpm --filter @eventgear/auth test` — Expected: PASS (all 5 tests pass)

- [ ] **Step 1.6: Create `domains/billing/package.json`**

```json
{
  "name": "@eventgear/billing",
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
    "stripe": "^14.0.0",
    "@eventgear/auth": "workspace:*",
    "@eventgear/config": "workspace:*",
    "@eventgear/core": "workspace:*",
    "@eventgear/events": "workspace:*",
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

- [ ] **Step 1.7: Create `domains/billing/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "."
  },
  "include": ["src", "__tests__"]
}
```

Note: `rootDir` must be `.` (not `./src`) when `include` covers both `src/` and `__tests__/`. Setting `rootDir: "./src"` while including `__tests__/` causes TypeScript error TS6059: File is not under rootDir.

- [ ] **Step 1.8: Create `domains/billing/jest.config.ts`**

Copy the pattern from `packages/db/jest.config.ts`:

```typescript
import type { Config } from 'jest';
export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
} satisfies Config;
```

- [ ] **Step 1.9: Install packages**

```bash
pnpm install
```

Expected: `stripe` installed in `domains/billing/node_modules` (or hoisted). No errors.

- [ ] **Step 1.10: Commit**

```bash
git add packages/config/src/index.ts
git add packages/auth/src/tenant-repository.ts packages/auth/src/__tests__/
git add domains/billing/package.json domains/billing/tsconfig.json domains/billing/jest.config.ts
git commit -m "feat(billing): add Stripe config keys, widen TenantRepository.updateTenant, scaffold billing package"
```

---

## Task 2: Stripe Customer creation on signup + billing domain types

**Files:**
- Create: `domains/billing/SPEC.md`
- Create: `domains/billing/types.ts`
- Create: `domains/billing/stripe-client.ts`
- Create: `domains/billing/service.ts`
- Create: `domains/billing/index.ts`
- Modify: `apps/api/src/server.ts` — signup route to call Stripe after tenant save

### Overview

Define the `Plan` enum and plan limits. Build the `StripeClient` singleton. Wire Stripe Customer creation into the signup flow: after Cognito + DynamoDB tenant creation, call `stripe.customers.create()` and update `tenant.stripeCustomerId` with the real `cus_` ID.

---

- [ ] **Step 2.1: Create `domains/billing/SPEC.md`**

```markdown
# SPEC: SaaS Billing

## Status
IMPLEMENTED

## Reference
This domain is fully specified in:
docs/specs/2026-03-23-mvp-production-readiness-design.md — Section 3: SaaS Billing

See that document for plans, pricing, webhook event table, enforcement rules, and security model.
```

- [ ] **Step 2.2: Write failing test for plan limits**

```typescript
// domains/billing/__tests__/service.test.ts
import { getPlanLimits } from '../service.js';

describe('getPlanLimits', () => {
  it('returns limits for STARTER', () => {
    const limits = getPlanLimits('STARTER');
    expect(limits.maxUsers).toBe(3);
    expect(limits.maxMonthlyReservations).toBe(100);
  });

  it('returns limits for PROFESSIONAL', () => {
    const limits = getPlanLimits('PROFESSIONAL');
    expect(limits.maxUsers).toBe(10);
    expect(limits.maxMonthlyReservations).toBe(null); // unlimited
  });

  it('returns limits for ENTERPRISE', () => {
    const limits = getPlanLimits('ENTERPRISE');
    expect(limits.maxUsers).toBe(null);
    expect(limits.maxMonthlyReservations).toBe(null);
  });
});
```

Run: `pnpm --filter @eventgear/billing test` — Expected: FAIL (module not found)

- [ ] **Step 2.3: Create `domains/billing/types.ts`**

```typescript
/**
 * @file types.ts
 * @domain billing
 * @purpose Plan enum, plan limits config, and billing-specific error codes.
 *
 * @outputs Plan, PlanLimits, BillingErrorCode
 *
 * @ai-notes This file defines SaaS subscription plans — how rental companies pay EventGear.
 *   It is NOT about equipment rental invoices (that is a separate future domain).
 *   null in PlanLimits means "unlimited".
 */

export type Plan = 'STARTER' | 'PROFESSIONAL' | 'ENTERPRISE';

export type TenantStatus = 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED';

export interface PlanLimits {
  readonly maxUsers: number | null;           // null = unlimited
  readonly maxMonthlyReservations: number | null;
  readonly monthlyPriceCents: number | null;  // null = custom/contact sales
}

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  STARTER: {
    maxUsers: 3,
    maxMonthlyReservations: 100,
    monthlyPriceCents: 9900,         // $99/mo
  },
  PROFESSIONAL: {
    maxUsers: 10,
    maxMonthlyReservations: null,
    monthlyPriceCents: 29900,        // $299/mo
  },
  ENTERPRISE: {
    maxUsers: null,
    maxMonthlyReservations: null,
    monthlyPriceCents: null,         // custom pricing
  },
} as const;

export type BillingErrorCode =
  | 'STRIPE_SIGNATURE_INVALID'
  | 'STRIPE_CUSTOMER_NOT_FOUND'
  | 'PLAN_LIMIT_EXCEEDED'
  | 'CHECKOUT_FAILED'
  | 'PORTAL_FAILED';
```

- [ ] **Step 2.4: Create `domains/billing/stripe-client.ts`**

```typescript
/**
 * @file stripe-client.ts
 * @domain billing
 * @purpose Stripe SDK singleton — initialized once per Lambda cold start.
 *
 * @inputs  STRIPE_SECRET_KEY from config (AWS Secrets Manager in prod, .env.local in dev)
 * @outputs Stripe instance
 *
 * @dependencies stripe, @eventgear/config
 * @ai-notes Call getStripe() lazily — not at module load time — so tests can mock
 *   process.env before the singleton is created.
 *   Never import this file in tests; mock it with jest.mock('../stripe-client.js').
 */
import Stripe from 'stripe';
import { getConfig } from '@eventgear/config';

let _stripe: Stripe | undefined;

export function getStripe(): Stripe {
  if (!_stripe) {
    const config = getConfig();
    const secretKey = config.stripeSecretKey;
    if (!secretKey) {
      throw new Error('STRIPE_SECRET_KEY is not configured');
    }
    _stripe = new Stripe(secretKey, {
      apiVersion: '2024-04-10',
      typescript: true,
    });
  }
  return _stripe;
}

/** For testing only — resets the singleton so tests can inject different keys. */
export function resetStripeClient(): void {
  _stripe = undefined;
}
```

- [ ] **Step 2.4b: Add BillingService method tests to service.test.ts (TDD red)**

Extend `domains/billing/__tests__/service.test.ts` with tests for the full `BillingService` class. These tests go BEFORE the `BillingService` implementation:

```typescript
// Append to domains/billing/__tests__/service.test.ts
import { jest } from '@jest/globals';
jest.mock('../stripe-client.js', () => ({ getStripe: jest.fn() }));

import { BillingService } from '../service.js';
import type { TenantRepository } from '@eventgear/auth';
import { getStripe } from '../stripe-client.js';

const mockRepo = {
  findTenantById: jest.fn(),
  updateTenant: jest.fn(),
} as unknown as jest.Mocked<TenantRepository>;

const mockStripe = {
  customers: { create: jest.fn() },
  checkout: { sessions: { create: jest.fn() } },
  billingPortal: { sessions: { create: jest.fn() } },
} as unknown as ReturnType<typeof getStripe>;

beforeEach(() => {
  jest.clearAllMocks();
  (getStripe as jest.Mock).mockReturnValue(mockStripe);
});

describe('BillingService.createStripeCustomer', () => {
  it('creates Stripe customer and updates tenant stripeCustomerId', async () => {
    const mockTenant = { id: 't1', name: 'Test Co', stripeCustomerId: 'local_t1' };
    mockRepo.findTenantById.mockResolvedValue(mockTenant);
    (mockStripe.customers.create as jest.Mock).mockResolvedValue({ id: 'cus_real' });
    mockRepo.updateTenant.mockResolvedValue(undefined);

    const svc = new BillingService(mockRepo);
    const result = await svc.createStripeCustomer('t1');
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe('cus_real');
    expect(mockRepo.updateTenant).toHaveBeenCalledWith('t1', { stripeCustomerId: 'cus_real' });
  });

  it('returns error when tenant not found', async () => {
    mockRepo.findTenantById.mockResolvedValue(null);
    const svc = new BillingService(mockRepo);
    const result = await svc.createStripeCustomer('missing');
    expect(result.success).toBe(false);
  });
});
```

Run: `pnpm --filter @eventgear/billing test` — Expected: FAIL (BillingService not yet implemented)

- [ ] **Step 2.5: Create `domains/billing/service.ts` (TDD green)**

```typescript
/**
 * @file service.ts
 * @domain billing
 * @purpose BillingService — Stripe Customer creation, Checkout sessions, Customer Portal sessions.
 *   Plan limit enforcement helpers are also exported here for use by other domains.
 *
 * @inputs  TenantRepository (injected), Stripe instance (from stripe-client.ts)
 * @outputs Result<T, AppError> — never throws from business logic
 *
 * @dependencies @eventgear/auth (TenantRepository, Tenant), @eventgear/core, ./stripe-client, ./types
 * @ai-notes createStripeCustomer() is called from the signup flow (apps/api/src/server.ts),
 *   not from the Lambda billing handler. It updates the tenant record with the real cus_ ID.
 *   createCheckoutSession() and createPortalSession() require the tenant to have a real
 *   stripeCustomerId (not the local_ placeholder).
 */
import { InternalError, err, ok } from '@eventgear/core';
import type { Result } from '@eventgear/core';
import type { TenantRepository } from '@eventgear/auth';
import type { Tenant } from '@eventgear/auth';
import { getStripe } from './stripe-client.js';
import { PLAN_LIMITS } from './types.js';
import type { Plan, PlanLimits } from './types.js';

export function getPlanLimits(plan: Plan): PlanLimits {
  return PLAN_LIMITS[plan];
}

export class BillingService {
  constructor(private readonly tenantRepo: TenantRepository) {}

  /**
   * Called during signup — creates a Stripe Customer for the tenant and updates
   * the DynamoDB record with the real cus_ ID.
   */
  async createStripeCustomer(
    tenantId: string,
    tenantName: string,
    email: string,
  ): Promise<Result<{ stripeCustomerId: string }>> {
    try {
      const stripe = getStripe();
      const customer = await stripe.customers.create({
        name: tenantName,
        email,
        metadata: { tenantId },
      });

      const now = new Date().toISOString();
      await this.tenantRepo.updateTenant(tenantId, {
        stripeCustomerId: customer.id,
        updatedAt: now,
      });

      return ok({ stripeCustomerId: customer.id });
    } catch (e) {
      return err(new InternalError('Failed to create Stripe customer', { cause: String(e) }));
    }
  }

  /**
   * Creates a Stripe Checkout session for plan upgrade.
   * Returns the session URL for the client to redirect to.
   */
  async createCheckoutSession(
    tenant: Tenant,
    targetPlan: Plan,
    successUrl: string,
    cancelUrl: string,
  ): Promise<Result<{ url: string }>> {
    try {
      const stripe = getStripe();
      const config = (await import('@eventgear/config')).getConfig();

      const priceIdMap: Record<Plan, string | undefined> = {
        STARTER: config.stripePriceStarter,
        PROFESSIONAL: config.stripePriceProfessional,
        ENTERPRISE: config.stripePriceEnterprise,
      };

      const priceId = priceIdMap[targetPlan];
      if (!priceId) {
        return err(new InternalError(`No Stripe price ID configured for plan: ${targetPlan}`));
      }

      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: tenant.stripeCustomerId,
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: { tenantId: tenant.id, targetPlan },
      });

      if (!session.url) {
        return err(new InternalError('Stripe Checkout session has no URL'));
      }

      return ok({ url: session.url });
    } catch (e) {
      return err(new InternalError('Failed to create Checkout session', { cause: String(e) }));
    }
  }

  /**
   * Creates a Stripe Customer Portal session.
   * Returns the portal URL for the client to redirect to.
   */
  async createPortalSession(
    tenant: Tenant,
    returnUrl: string,
  ): Promise<Result<{ url: string }>> {
    try {
      const stripe = getStripe();
      const session = await stripe.billingPortal.sessions.create({
        customer: tenant.stripeCustomerId,
        return_url: returnUrl,
      });
      return ok({ url: session.url });
    } catch (e) {
      return err(new InternalError('Failed to create Customer Portal session', { cause: String(e) }));
    }
  }

  /** Fetch current tenant plan + status for GET /billing/status */
  async getBillingStatus(tenantId: string): Promise<Result<Pick<Tenant, 'plan' | 'status' | 'trialEndsAt' | 'stripeSubscriptionId'>>> {
    try {
      const tenant = await this.tenantRepo.findTenantById(tenantId);
      if (!tenant) {
        return err(new InternalError(`Tenant not found: ${tenantId}`));
      }
      return ok({
        plan: tenant.plan,
        status: tenant.status,
        ...(tenant.trialEndsAt ? { trialEndsAt: tenant.trialEndsAt } : {}),
        ...(tenant.stripeSubscriptionId ? { stripeSubscriptionId: tenant.stripeSubscriptionId } : {}),
      });
    } catch (e) {
      return err(new InternalError('Failed to get billing status', { cause: String(e) }));
    }
  }
}
```

- [ ] **Step 2.6: Run tests**

```bash
pnpm --filter @eventgear/billing test
```

Expected: `getPlanLimits` tests PASS (3 tests). Service tests are not yet written — that is fine.

- [ ] **Step 2.7: Wire Stripe Customer creation into signup in `apps/api/src/server.ts`**

The local Express dev server handles signup at `POST /auth/signup`. After creating the Cognito user and saving the DynamoDB tenant record, call `BillingService.createStripeCustomer()`.

Locate the signup handler in `server.ts` (it was added by Plan 1). The pattern to add after the tenant is saved:

```typescript
// After: await tenantRepo.saveTenant(tenant);
// Add:
if (process.env['STRIPE_SECRET_KEY']) {
  const billingResult = await billingService.createStripeCustomer(
    tenant.id,
    tenant.name,
    body.email as string,
  );
  if (!billingResult.success) {
    // Log but don't fail signup — trial still works with placeholder stripeCustomerId
    console.warn('[billing] Stripe customer creation failed:', billingResult.error.message);
  }
}
```

Also add the billing service wiring at the top of `server.ts` (alongside the existing inventory service wiring):

```typescript
import { TenantRepository } from '@eventgear/auth';
import { BillingService } from '@eventgear/billing';

const tenantRepo = new TenantRepository();
const billingService = new BillingService(tenantRepo);
```

Note: Do not fail the signup if Stripe is unavailable. The tenant still has a `local_${tenantId}` placeholder `stripeCustomerId` from Plan 1, which is valid for local dev. The real `cus_` ID is required for Checkout and Portal — those routes check for it explicitly.

- [ ] **Step 2.8: Create `domains/billing/index.ts`**

```typescript
/**
 * @file index.ts
 * @domain billing
 * @purpose Barrel exports for the billing domain.
 */
export { BillingService, getPlanLimits } from './service.js';
export { getStripe, resetStripeClient } from './stripe-client.js';
export type { Plan, PlanLimits, TenantStatus, BillingErrorCode } from './types.js';
export { PLAN_LIMITS } from './types.js';
```

- [ ] **Step 2.9: Build and typecheck**

```bash
pnpm --filter @eventgear/billing build
pnpm --filter @eventgear/billing typecheck
```

Expected: No errors.

- [ ] **Step 2.10: Commit**

```bash
git add domains/billing/
git add apps/api/src/server.ts
git commit -m "feat(billing): add BillingService, plan limits, Stripe client, and signup wiring"
```

---

## Task 3: Webhook handler (`POST /billing/webhook`)

**Files:**
- Create: `domains/billing/webhook-handler.ts`
- Create: `domains/billing/__tests__/webhook-handler.test.ts`
- Create: `apps/api/src/billing/route.ts` — webhook route (raw body middleware)
- Modify: `apps/api/src/server.ts` — mount webhook BEFORE `express.json()`

### Overview

The webhook handler validates the Stripe signature, looks up the tenant by `stripeCustomerId`, and dispatches each Stripe event to the correct tenant update. On `invoice.payment_succeeded`, it also publishes a `billing.invoice.paid` EventBridge event. The Express route must use `express.raw({ type: 'application/json' })` at the route level so the raw body reaches the signature validator — this route must be registered BEFORE `app.use(express.json())` in `server.ts`.

**Critical body-parsing note:** `stripe.webhooks.constructEvent(rawBody, sig, secret)` requires the raw unparsed body as a `Buffer` or `string`. If `express.json()` has already parsed it, the body is a JavaScript object and signature validation will fail with a cryptic error. The solution is to register the webhook route before `app.use(express.json())` and use `express.raw({ type: 'application/json' })` on that route only.

---

- [ ] **Step 3.1: Write failing webhook handler test**

```typescript
// domains/billing/__tests__/webhook-handler.test.ts
import { jest } from '@jest/globals';

// Mock stripe-client before importing webhook-handler
jest.mock('../stripe-client.js', () => ({
  getStripe: jest.fn(),
}));

import { WebhookHandler } from '../webhook-handler.js';
import type { TenantRepository } from '@eventgear/auth';
import type { EventPublisher } from '@eventgear/events';

const mockTenantRepo = {
  findTenantByStripeCustomerId: jest.fn(),
  updateTenant: jest.fn(),
} as unknown as jest.Mocked<TenantRepository>;

const mockEventPublisher = {
  publish: jest.fn(),
} as unknown as jest.Mocked<EventPublisher>;

const mockTenant = {
  id: 'TENANT_01',
  name: 'Test Co',
  plan: 'STARTER' as const,
  status: 'TRIALING' as const,
  stripeCustomerId: 'cus_test_123',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

describe('WebhookHandler', () => {
  let handler: WebhookHandler;

  beforeEach(() => {
    jest.clearAllMocks();
    handler = new WebhookHandler(mockTenantRepo, mockEventPublisher);
    (mockTenantRepo.findTenantByStripeCustomerId as jest.Mock).mockResolvedValue(mockTenant);
    (mockTenantRepo.updateTenant as jest.Mock).mockResolvedValue(undefined);
    (mockEventPublisher.publish as jest.Mock).mockResolvedValue(undefined);
  });

  describe('handleSubscriptionCreated', () => {
    it('sets tenant status to ACTIVE and stores stripeSubscriptionId', async () => {
      const event = {
        type: 'customer.subscription.created',
        data: {
          object: {
            id: 'sub_123',
            customer: 'cus_test_123',
            status: 'active',
            items: { data: [{ price: { id: 'price_professional' } }] },
          },
        },
      };

      const result = await handler.handleEvent(event as unknown as import('stripe').Stripe.Event);
      expect(result.success).toBe(true);
      expect(mockTenantRepo.updateTenant).toHaveBeenCalledWith('TENANT_01', expect.objectContaining({
        status: 'ACTIVE',
        stripeSubscriptionId: 'sub_123',
      }));
    });
  });

  describe('handleSubscriptionDeleted', () => {
    it('sets tenant status to CANCELLED', async () => {
      const event = {
        type: 'customer.subscription.deleted',
        data: { object: { customer: 'cus_test_123' } },
      };

      const result = await handler.handleEvent(event as unknown as import('stripe').Stripe.Event);
      expect(result.success).toBe(true);
      expect(mockTenantRepo.updateTenant).toHaveBeenCalledWith('TENANT_01', expect.objectContaining({
        status: 'CANCELLED',
      }));
    });
  });

  describe('handleInvoicePaymentFailed', () => {
    it('sets tenant status to PAST_DUE', async () => {
      const event = {
        type: 'invoice.payment_failed',
        data: { object: { customer: 'cus_test_123' } },
      };

      const result = await handler.handleEvent(event as unknown as import('stripe').Stripe.Event);
      expect(result.success).toBe(true);
      expect(mockTenantRepo.updateTenant).toHaveBeenCalledWith('TENANT_01', expect.objectContaining({
        status: 'PAST_DUE',
      }));
    });
  });

  describe('handleInvoicePaid', () => {
    it('sets tenant status to ACTIVE and publishes EventBridge event', async () => {
      const event = {
        type: 'invoice.payment_succeeded',
        data: {
          object: {
            id: 'in_123',
            customer: 'cus_test_123',
            amount_paid: 29900,
            currency: 'usd',
            payment_intent: 'pi_123',
          },
        },
      };

      const result = await handler.handleEvent(event as unknown as import('stripe').Stripe.Event);
      expect(result.success).toBe(true);
      expect(mockTenantRepo.updateTenant).toHaveBeenCalledWith('TENANT_01', expect.objectContaining({
        status: 'ACTIVE',
      }));
      expect(mockEventPublisher.publish).toHaveBeenCalledWith(
        'billing.invoice.paid',
        expect.objectContaining({ invoiceId: 'in_123' }),
      );
    });

    it('does NOT publish EventBridge event when tenant was not PAST_DUE', async () => {
      // tenant.status is TRIALING — invoice paid for first billing, not recovery
      const event = {
        type: 'invoice.payment_succeeded',
        data: {
          object: {
            id: 'in_456',
            customer: 'cus_test_123',
            amount_paid: 29900,
            currency: 'usd',
            payment_intent: 'pi_456',
          },
        },
      };

      (mockTenantRepo.findTenantByStripeCustomerId as jest.Mock).mockResolvedValue({
        ...mockTenant,
        status: 'ACTIVE',
      });

      const result = await handler.handleEvent(event as unknown as import('stripe').Stripe.Event);
      expect(result.success).toBe(true);
      // Status update still happens
      expect(mockTenantRepo.updateTenant).toHaveBeenCalled();
      // But EventBridge is NOT published (tenant was already ACTIVE, not recovering from PAST_DUE)
      expect(mockEventPublisher.publish).not.toHaveBeenCalled();
    });
  });

  describe('unknown event type', () => {
    it('returns success without any updates', async () => {
      const event = {
        type: 'payment_intent.created',
        data: { object: {} },
      };

      const result = await handler.handleEvent(event as unknown as import('stripe').Stripe.Event);
      expect(result.success).toBe(true);
      expect(mockTenantRepo.updateTenant).not.toHaveBeenCalled();
    });
  });

  describe('tenant not found', () => {
    it('returns error when tenant lookup fails', async () => {
      (mockTenantRepo.findTenantByStripeCustomerId as jest.Mock).mockResolvedValue(null);

      const event = {
        type: 'customer.subscription.deleted',
        data: { object: { customer: 'cus_unknown' } },
      };

      const result = await handler.handleEvent(event as unknown as import('stripe').Stripe.Event);
      expect(result.success).toBe(false);
    });
  });
});
```

Run: `pnpm --filter @eventgear/billing test` — Expected: FAIL (WebhookHandler not found)

- [ ] **Step 3.2: Create `domains/billing/webhook-handler.ts`**

```typescript
/**
 * @file webhook-handler.ts
 * @domain billing
 * @purpose Processes Stripe webhook events and updates tenant subscription state.
 *
 * @inputs  Stripe.Event (pre-validated by constructEvent in route.ts)
 * @outputs Result<void> — updates DynamoDB tenant record; publishes EventBridge on invoice.paid
 *
 * @dependencies @eventgear/auth (TenantRepository), @eventgear/core, @eventgear/events, stripe
 * @ai-notes Signature validation is NOT done here — it is done in route.ts before calling handleEvent.
 *   Tenant lookup uses GSI1 (STRIPE_CUSTOMER#{stripeCustomerId}) — see spec §3 DynamoDB key pattern.
 *   invoice.payment_succeeded publishes billing.invoice.paid ONLY when tenant was PAST_DUE.
 *   The EventBridge payload matches CLAUDE.md §5 billing.invoice.paid contract.
 */
import { InternalError, NotFoundError, err, ok } from '@eventgear/core';
import type { Result } from '@eventgear/core';
import type { TenantRepository } from '@eventgear/auth';
import type { EventPublisher } from '@eventgear/events';
import type Stripe from 'stripe';

export class WebhookHandler {
  constructor(
    private readonly tenantRepo: TenantRepository,
    private readonly eventPublisher: EventPublisher,
  ) {}

  async handleEvent(event: Stripe.Event): Promise<Result<void>> {
    switch (event.type) {
      case 'customer.subscription.created':
        return this.handleSubscriptionCreated(event.data.object as Stripe.Subscription);

      case 'customer.subscription.updated':
        return this.handleSubscriptionUpdated(event.data.object as Stripe.Subscription);

      case 'customer.subscription.deleted':
        return this.handleSubscriptionDeleted(event.data.object as Stripe.Subscription);

      case 'invoice.payment_failed':
        return this.handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);

      case 'invoice.payment_succeeded':
        return this.handleInvoicePaid(event.data.object as Stripe.Invoice);

      default:
        // Unhandled event types — acknowledge receipt without error
        return ok(undefined);
    }
  }

  private async handleSubscriptionCreated(sub: Stripe.Subscription): Promise<Result<void>> {
    const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
    const tenant = await this.tenantRepo.findTenantByStripeCustomerId(customerId);
    if (!tenant) {
      return err(new NotFoundError('Tenant', `stripeCustomerId=${customerId}`));
    }

    const now = new Date().toISOString();
    await this.tenantRepo.updateTenant(tenant.id, {
      status: 'ACTIVE',
      stripeSubscriptionId: sub.id,
      updatedAt: now,
    });

    return ok(undefined);
  }

  private async handleSubscriptionUpdated(sub: Stripe.Subscription): Promise<Result<void>> {
    try {
      const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
      const tenant = await this.tenantRepo.findTenantByStripeCustomerId(customerId);
      if (!tenant) {
        return err(new NotFoundError('Tenant', `stripeCustomerId=${customerId}`));
      }

      // Map Stripe subscription status to tenant status
      const statusMap: Partial<Record<Stripe.Subscription.Status, 'ACTIVE' | 'PAST_DUE' | 'CANCELLED'>> = {
        active: 'ACTIVE',
        past_due: 'PAST_DUE',
        canceled: 'CANCELLED',
        unpaid: 'PAST_DUE',
      };

      const newStatus = statusMap[sub.status];
      const now = new Date().toISOString();

      await this.tenantRepo.updateTenant(tenant.id, {
        ...(newStatus ? { status: newStatus } : {}),
        stripeSubscriptionId: sub.id,
        updatedAt: now,
      });

      return ok(undefined);
    } catch (e) {
      return err(new InternalError('Failed to handle subscription.updated', { cause: String(e) }));
    }
  }

  private async handleSubscriptionDeleted(sub: Stripe.Subscription): Promise<Result<void>> {
    try {
      const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
      const tenant = await this.tenantRepo.findTenantByStripeCustomerId(customerId);
      if (!tenant) {
        return err(new NotFoundError('Tenant', `stripeCustomerId=${customerId}`));
      }

      const now = new Date().toISOString();
      await this.tenantRepo.updateTenant(tenant.id, {
        status: 'CANCELLED',
        updatedAt: now,
      });

      return ok(undefined);
    } catch (e) {
      return err(new InternalError('Failed to handle subscription.deleted', { cause: String(e) }));
    }
  }

  private async handleInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<Result<void>> {
    try {
      const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
      if (!customerId) return err(new InternalError('Invoice missing customer ID'));

      const tenant = await this.tenantRepo.findTenantByStripeCustomerId(customerId);
      if (!tenant) {
        return err(new NotFoundError('Tenant', `stripeCustomerId=${customerId}`));
      }

      const now = new Date().toISOString();
      await this.tenantRepo.updateTenant(tenant.id, {
        status: 'PAST_DUE',
        updatedAt: now,
      });

      return ok(undefined);
    } catch (e) {
      return err(new InternalError('Failed to handle invoice.payment_failed', { cause: String(e) }));
    }
  }

  private async handleInvoicePaid(invoice: Stripe.Invoice): Promise<Result<void>> {
    try {
      const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
      if (!customerId) return err(new InternalError('Invoice missing customer ID'));

      const tenant = await this.tenantRepo.findTenantByStripeCustomerId(customerId);
      if (!tenant) {
        return err(new NotFoundError('Tenant', `stripeCustomerId=${customerId}`));
      }

      const wasPastDue = tenant.status === 'PAST_DUE';
      const now = new Date().toISOString();

      await this.tenantRepo.updateTenant(tenant.id, {
        status: 'ACTIVE',
        updatedAt: now,
      });

      // Publish EventBridge event ONLY when recovering from PAST_DUE
      // (standard subscription payments don't need to trigger downstream logic)
      if (wasPastDue) {
        const paymentIntentId = typeof invoice.payment_intent === 'string'
          ? invoice.payment_intent
          : invoice.payment_intent?.id ?? 'unknown';

        await this.eventPublisher.publish('billing.invoice.paid', {
          invoiceId: invoice.id,
          reservationId: invoice.metadata?.['reservationId'] ?? '',
          customerId: tenant.id,            // tenant ID as proxy — equipment billing domain handles real customerId
          amount: invoice.amount_paid / 100, // convert cents to dollars
          paidAt: now,
          paymentMethod: 'stripe',
          transactionId: paymentIntentId,
        });
      }

      return ok(undefined);
    } catch (e) {
      return err(new InternalError('Failed to handle invoice.payment_succeeded', { cause: String(e) }));
    }
  }
}
```

- [ ] **Step 3.3: Run webhook tests**

```bash
pnpm --filter @eventgear/billing test
```

Expected: All webhook handler tests PASS (6 tests). Plan limits tests continue to pass.

- [ ] **Step 3.4: Create `apps/api/src/billing/route.ts`**

This file defines all Express billing routes. The webhook route uses `express.raw()` as a route-level middleware — it must be mounted on `app` BEFORE `app.use(express.json())` in `server.ts`.

```typescript
/**
 * @file route.ts
 * @purpose Express route handlers for the billing domain.
 *   POST /billing/webhook — Stripe webhook (raw body, no JWT auth)
 *   POST /billing/checkout — Create Stripe Checkout session (JWT auth)
 *   POST /billing/portal — Create Customer Portal session (JWT auth)
 *   GET  /billing/status — Current plan + status (JWT auth)
 *
 * @inputs  Express Request/Response
 * @outputs JSON responses
 *
 * @dependencies domains/billing, @eventgear/auth
 * @ai-notes CRITICAL: The webhook route MUST be mounted before express.json() in server.ts.
 *   express.raw({ type: 'application/json' }) is applied at route level so only /billing/webhook
 *   receives the raw Buffer body. All other routes use the global express.json() middleware.
 *   Stripe signature validation uses stripe.webhooks.constructEvent(rawBody, sig, secret).
 *   The JWT auth routes (checkout, portal, status) read tenantId from req.locals or
 *   a decoded JWT header — see server.ts for the local dev auth bypass pattern.
 */
import express, { type Request, type Response } from 'express';
import type Stripe from 'stripe';
import { getStripe } from '@eventgear/billing';
import { BillingService } from '@eventgear/billing';
import { WebhookHandler } from '@eventgear/billing';
import { TenantRepository } from '@eventgear/auth';
import { EventPublisher } from '@eventgear/events';
import { getConfig } from '@eventgear/config';

// ── Singletons ────────────────────────────────────────────────────────────────

const tenantRepo = new TenantRepository();
const eventPublisher = new EventPublisher();
const webhookHandler = new WebhookHandler(tenantRepo, eventPublisher);
const billingService = new BillingService(tenantRepo);

// ── Router ────────────────────────────────────────────────────────────────────

export const billingRouter = express.Router();

/**
 * POST /billing/webhook
 *
 * IMPORTANT: This route uses express.raw() to preserve the raw Buffer body for
 * Stripe signature validation. It is mounted in server.ts BEFORE app.use(express.json()).
 *
 * Security: No JWT auth — Stripe calls this directly. Validated by Stripe-Signature header.
 */
billingRouter.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  async (req: Request, res: Response): Promise<void> => {
    const sig = req.headers['stripe-signature'];
    const config = getConfig();
    const webhookSecret = config.stripeWebhookSecret;

    if (!sig || !webhookSecret) {
      res.status(400).json({ error: { code: 'STRIPE_SIGNATURE_INVALID', message: 'Missing signature or webhook secret' } });
      return;
    }

    let event: Stripe.Event;
    try {
      event = getStripe().webhooks.constructEvent(
        req.body as Buffer,
        sig,
        webhookSecret,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Signature validation failed';
      res.status(400).json({ error: { code: 'STRIPE_SIGNATURE_INVALID', message: msg } });
      return;
    }

    const result = await webhookHandler.handleEvent(event);
    if (!result.success) {
      // Log the error but return 200 to Stripe so it doesn't retry
      // (retrying won't help if tenant is not found — it's a data inconsistency)
      console.error('[billing/webhook] Handler error:', result.error.message, { eventType: event.type });
    }

    res.status(200).json({ received: true });
  },
);

/**
 * POST /billing/checkout
 * Auth: JWT (tenantId injected into req.locals by Lambda authorizer or local dev middleware)
 */
billingRouter.post('/checkout', async (req: Request, res: Response): Promise<void> => {
  const tenantId = (req as unknown as { locals: { tenantId?: string } }).locals?.tenantId
    ?? (req.headers['x-tenant-id'] as string | undefined);

  if (!tenantId) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Missing tenant context' } });
    return;
  }

  const { plan, successUrl, cancelUrl } = req.body as {
    plan?: unknown;
    successUrl?: unknown;
    cancelUrl?: unknown;
  };

  if (typeof plan !== 'string' || !['STARTER', 'PROFESSIONAL', 'ENTERPRISE'].includes(plan)) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'plan must be STARTER | PROFESSIONAL | ENTERPRISE' } });
    return;
  }
  if (typeof successUrl !== 'string' || typeof cancelUrl !== 'string') {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'successUrl and cancelUrl are required strings' } });
    return;
  }

  const tenant = await tenantRepo.findTenantById(tenantId);
  if (!tenant) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Tenant not found' } });
    return;
  }

  const result = await billingService.createCheckoutSession(
    tenant,
    plan as import('@eventgear/billing').Plan,
    successUrl,
    cancelUrl,
  );

  if (!result.success) {
    res.status(500).json({ error: result.error.toJSON() });
    return;
  }

  res.status(200).json({ data: { url: result.data.url } });
});

/**
 * POST /billing/portal
 * Auth: JWT
 */
billingRouter.post('/portal', async (req: Request, res: Response): Promise<void> => {
  const tenantId = (req as unknown as { locals: { tenantId?: string } }).locals?.tenantId
    ?? (req.headers['x-tenant-id'] as string | undefined);

  if (!tenantId) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Missing tenant context' } });
    return;
  }

  const { returnUrl } = req.body as { returnUrl?: unknown };
  if (typeof returnUrl !== 'string') {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'returnUrl is required' } });
    return;
  }

  const tenant = await tenantRepo.findTenantById(tenantId);
  if (!tenant) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Tenant not found' } });
    return;
  }

  const result = await billingService.createPortalSession(tenant, returnUrl);
  if (!result.success) {
    res.status(500).json({ error: result.error.toJSON() });
    return;
  }

  res.status(200).json({ data: { url: result.data.url } });
});

/**
 * GET /billing/status
 * Auth: JWT
 */
billingRouter.get('/status', async (req: Request, res: Response): Promise<void> => {
  const tenantId = (req as unknown as { locals: { tenantId?: string } }).locals?.tenantId
    ?? (req.headers['x-tenant-id'] as string | undefined);

  if (!tenantId) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Missing tenant context' } });
    return;
  }

  const result = await billingService.getBillingStatus(tenantId);
  if (!result.success) {
    res.status(500).json({ error: result.error.toJSON() });
    return;
  }

  res.status(200).json({ data: result.data });
});
```

- [ ] **Step 3.5: Mount billing routes in `apps/api/src/server.ts`**

**This ordering is critical.** The webhook route must be registered BEFORE `app.use(express.json())`.

Open `apps/api/src/server.ts`. Find the Express app construction block:

```typescript
const app = express();
app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json());
```

Change it to:

```typescript
import { billingRouter } from './billing/route.js';

const app = express();
app.use(cors({ origin: 'http://localhost:5173' }));

// ── BILLING WEBHOOK — must be before express.json() ──────────────────────────
// stripe.webhooks.constructEvent() requires the raw Buffer body.
// express.raw() is applied at route level inside billingRouter,
// but the router must be mounted before app.use(express.json()) parses the body.
app.use('/billing', billingRouter);

// ── Global JSON body parser (all other routes) ────────────────────────────────
app.use(express.json());
```

Then remove the billing router from any position below `express.json()` — it should only appear once, before the JSON middleware.

- [ ] **Step 3.5b: Export WebhookHandler from `domains/billing/index.ts`**

`apps/api/src/billing/route.ts` imports `WebhookHandler` from `@eventgear/billing`. Add it to the barrel now so the import resolves before the Task 3 commit:

```typescript
// Add to domains/billing/index.ts:
export { WebhookHandler } from './webhook-handler.js';
```

Rebuild to confirm:
```bash
pnpm --filter @eventgear/billing build
```

- [ ] **Step 3.6: Verify server starts and webhook rejects bad signatures**

```bash
# Start the dev server (requires .env.local with STRIPE_WEBHOOK_SECRET set)
pnpm --filter @eventgear/api dev &

# Send a request with a bad signature — expect 400
curl -s -X POST http://localhost:3001/billing/webhook \
  -H "Content-Type: application/json" \
  -H "Stripe-Signature: t=1,v1=badsig" \
  -d '{"type":"test"}' | jq .

# Expected: { "error": { "code": "STRIPE_SIGNATURE_INVALID", ... } }
```

- [ ] **Step 3.7: Commit**

```bash
git add domains/billing/webhook-handler.ts domains/billing/index.ts
git add domains/billing/__tests__/webhook-handler.test.ts
git add apps/api/src/billing/route.ts
git add apps/api/src/server.ts
git commit -m "feat(billing): add webhook handler with Stripe signature validation and subscription event processing"
```

---

## Task 4: Handler tests + Lambda handler + domain barrel update

**Files:**
- Create: `domains/billing/handler.ts`
- Create: `domains/billing/__tests__/handler.test.ts`
- Create: `domains/billing/__tests__/service.test.ts`
- Modify: `domains/billing/index.ts` — export WebhookHandler

### Overview

Write the Lambda handler (for deployed billing Lambda) following the same pattern as `domains/inventory/handler.ts`. Write service unit tests and handler routing tests.

---

- [ ] **Step 4.1: Write failing handler test**

```typescript
// domains/billing/__tests__/handler.test.ts
import { jest } from '@jest/globals';

jest.mock('../stripe-client.js', () => ({ getStripe: jest.fn() }));
jest.mock('@eventgear/auth', () => ({
  TenantRepository: jest.fn().mockImplementation(() => ({
    findTenantById: jest.fn(),
    findTenantByStripeCustomerId: jest.fn(),
    updateTenant: jest.fn(),
  })),
}));
jest.mock('@eventgear/events', () => ({
  EventPublisher: jest.fn().mockImplementation(() => ({ publish: jest.fn() })),
}));

import { handler } from '../handler.js';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

function makeEvent(method: string, path: string, body?: unknown, headers?: Record<string, string>): APIGatewayProxyEventV2 {
  return {
    requestContext: { http: { method, path } },
    rawPath: path,
    body: body ? JSON.stringify(body) : undefined,
    headers: headers ?? {},
    isBase64Encoded: false,
    queryStringParameters: {},
    pathParameters: {},
    stageVariables: {},
    version: '2.0',
    routeKey: `${method} ${path}`,
    rawQueryString: '',
  } as unknown as APIGatewayProxyEventV2;
}

describe('billing handler', () => {
  it('returns 400 for POST /billing/webhook with missing signature', async () => {
    const event = makeEvent('POST', '/billing/webhook', { type: 'test' });
    const result = await handler(event);
    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string) as { error: { code: string } };
    expect(body.error.code).toBe('STRIPE_SIGNATURE_INVALID');
  });

  it('returns 401 for POST /billing/checkout without tenant context', async () => {
    const event = makeEvent('POST', '/billing/checkout', { plan: 'PROFESSIONAL', successUrl: 'https://example.com/success', cancelUrl: 'https://example.com/cancel' });
    const result = await handler(event);
    expect(result.statusCode).toBe(401);
  });

  it('returns 401 for POST /billing/portal without tenant context', async () => {
    const event = makeEvent('POST', '/billing/portal', { returnUrl: 'https://example.com' });
    const result = await handler(event);
    expect(result.statusCode).toBe(401);
  });

  it('returns 404 for unknown routes', async () => {
    const event = makeEvent('GET', '/billing/unknown');
    const result = await handler(event);
    expect(result.statusCode).toBe(404);
  });
});
```

Run: `pnpm --filter @eventgear/billing test` — Expected: FAIL (handler.ts not found)

- [ ] **Step 4.2: Create `domains/billing/handler.ts`**

```typescript
/**
 * @file handler.ts
 * @domain billing
 * @purpose Lambda entry point for the billing domain.
 *   Routes API Gateway events to BillingService and WebhookHandler.
 *
 * @inputs  APIGatewayProxyEventV2 (from API Gateway HTTP API proxy)
 * @outputs APIGatewayProxyResultV2 with JSON body
 *
 * @dependencies @eventgear/core, @eventgear/auth, @eventgear/events, ./service, ./webhook-handler
 * @ai-notes /billing/webhook is excluded from the Lambda authorizer in Terraform.
 *   The rawBody for signature validation is event.body (string) when isBase64Encoded=false.
 *   Authorizer context (tenantId) is at event.requestContext.authorizer.tenantId.
 *   Module-level singletons initialized once per cold start.
 */
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { NotFoundError, InternalError, errorResponse, successResponse } from '@eventgear/core';
import { TenantRepository } from '@eventgear/auth';
import { EventPublisher } from '@eventgear/events';
import { getStripe } from './stripe-client.js';
import { BillingService } from './service.js';
import { WebhookHandler } from './webhook-handler.js';
import { getConfig } from '@eventgear/config';
import type { Plan } from './types.js';
import type Stripe from 'stripe';

// ── Singletons ────────────────────────────────────────────────────────────────

const tenantRepo = new TenantRepository();
const eventPublisher = new EventPublisher();
const webhookHandler = new WebhookHandler(tenantRepo, eventPublisher);
const billingService = new BillingService(tenantRepo);

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseBody(event: APIGatewayProxyEventV2): unknown {
  if (!event.body) return {};
  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf-8')
      : event.body;
    return JSON.parse(raw) as unknown;
  } catch {
    return {};
  }
}

function getTenantId(event: APIGatewayProxyEventV2): string | undefined {
  // Lambda authorizer injects tenantId into requestContext.authorizer
  const ctx = event.requestContext as unknown as {
    authorizer?: { tenantId?: string; lambda?: { tenantId?: string } };
  };
  return ctx.authorizer?.tenantId ?? ctx.authorizer?.lambda?.tenantId;
}

// ── Lambda handler ────────────────────────────────────────────────────────────

export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const method = event.requestContext.http.method;
  const path = event.rawPath;

  // ── POST /billing/webhook ──────────────────────────────────────────────────
  if (path === '/billing/webhook' && method === 'POST') {
    const sig = event.headers?.['stripe-signature'] ?? event.headers?.['Stripe-Signature'];
    const config = getConfig();
    const webhookSecret = config.stripeWebhookSecret;

    if (!sig || !webhookSecret) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: { code: 'STRIPE_SIGNATURE_INVALID', message: 'Missing signature or webhook secret' } }),
        headers: { 'Content-Type': 'application/json' },
      };
    }

    let stripeEvent: Stripe.Event;
    try {
      const rawBody = event.isBase64Encoded
        ? Buffer.from(event.body ?? '', 'base64').toString('utf-8')
        : (event.body ?? '');
      stripeEvent = getStripe().webhooks.constructEvent(rawBody, sig, webhookSecret);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Signature validation failed';
      return {
        statusCode: 400,
        body: JSON.stringify({ error: { code: 'STRIPE_SIGNATURE_INVALID', message: msg } }),
        headers: { 'Content-Type': 'application/json' },
      };
    }

    const result = await webhookHandler.handleEvent(stripeEvent);
    if (!result.success) {
      console.error('[billing/webhook] Handler error:', result.error.message);
    }
    // Always return 200 to Stripe — avoid retries for data-consistency errors
    return { statusCode: 200, body: JSON.stringify({ received: true }), headers: { 'Content-Type': 'application/json' } };
  }

  // ── POST /billing/checkout ─────────────────────────────────────────────────
  if (path === '/billing/checkout' && method === 'POST') {
    const tenantId = getTenantId(event);
    if (!tenantId) {
      return { statusCode: 401, body: JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Missing tenant context' } }), headers: { 'Content-Type': 'application/json' } };
    }

    const body = parseBody(event) as { plan?: unknown; successUrl?: unknown; cancelUrl?: unknown };
    const { plan, successUrl, cancelUrl } = body;

    if (typeof plan !== 'string' || !['STARTER', 'PROFESSIONAL', 'ENTERPRISE'].includes(plan)) {
      return errorResponse(new (await import('@eventgear/core')).ValidationError('plan must be STARTER | PROFESSIONAL | ENTERPRISE', []));
    }
    if (typeof successUrl !== 'string' || typeof cancelUrl !== 'string') {
      return errorResponse(new (await import('@eventgear/core')).ValidationError('successUrl and cancelUrl are required', []));
    }

    const tenant = await tenantRepo.findTenantById(tenantId);
    if (!tenant) return errorResponse(new NotFoundError('Tenant', tenantId));

    const result = await billingService.createCheckoutSession(tenant, plan as Plan, successUrl, cancelUrl);
    if (!result.success) return errorResponse(result.error);
    return successResponse(result.data);
  }

  // ── POST /billing/portal ───────────────────────────────────────────────────
  if (path === '/billing/portal' && method === 'POST') {
    const tenantId = getTenantId(event);
    if (!tenantId) {
      return { statusCode: 401, body: JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Missing tenant context' } }), headers: { 'Content-Type': 'application/json' } };
    }

    const body = parseBody(event) as { returnUrl?: unknown };
    if (typeof body.returnUrl !== 'string') {
      return errorResponse(new InternalError('returnUrl is required'));
    }

    const tenant = await tenantRepo.findTenantById(tenantId);
    if (!tenant) return errorResponse(new NotFoundError('Tenant', tenantId));

    const result = await billingService.createPortalSession(tenant, body.returnUrl);
    if (!result.success) return errorResponse(result.error);
    return successResponse(result.data);
  }

  // ── GET /billing/status ────────────────────────────────────────────────────
  if (path === '/billing/status' && method === 'GET') {
    const tenantId = getTenantId(event);
    if (!tenantId) {
      return { statusCode: 401, body: JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Missing tenant context' } }), headers: { 'Content-Type': 'application/json' } };
    }

    const result = await billingService.getBillingStatus(tenantId);
    if (!result.success) return errorResponse(result.error);
    return successResponse(result.data);
  }

  // ── 404 fallthrough ────────────────────────────────────────────────────────
  return errorResponse(new NotFoundError('Route', `${method} ${path}`));
};
```

- [ ] **Step 4.3: Extend service unit tests for checkout + portal methods**

The `service.test.ts` already covers `getPlanLimits` (Task 2 Step 2.2) and `createStripeCustomer` (Task 2 Step 2.4b). Add tests for `createCheckoutSession` and `createPortalSession` which were implemented in Task 2 Step 2.5:

```typescript
// domains/billing/__tests__/service.test.ts
import { jest } from '@jest/globals';

jest.mock('../stripe-client.js', () => ({
  getStripe: jest.fn(),
}));

import { BillingService, getPlanLimits } from '../service.js';
import type { TenantRepository } from '@eventgear/auth';
import { getStripe } from '../stripe-client.js';

const mockTenantRepo = {
  findTenantById: jest.fn(),
  updateTenant: jest.fn(),
} as unknown as jest.Mocked<TenantRepository>;

const mockStripe = {
  customers: { create: jest.fn() },
  checkout: { sessions: { create: jest.fn() } },
  billingPortal: { sessions: { create: jest.fn() } },
};

(getStripe as jest.Mock).mockReturnValue(mockStripe);

const mockTenant = {
  id: 'TENANT_01',
  name: 'Test Co',
  plan: 'STARTER' as const,
  status: 'ACTIVE' as const,
  stripeCustomerId: 'cus_abc123',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

describe('BillingService', () => {
  let service: BillingService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new BillingService(mockTenantRepo);
  });

  describe('createStripeCustomer', () => {
    it('creates Stripe customer and updates tenant record', async () => {
      (mockStripe.customers.create as jest.Mock).mockResolvedValue({ id: 'cus_new_xyz' });
      (mockTenantRepo.updateTenant as jest.Mock).mockResolvedValue(undefined);

      const result = await service.createStripeCustomer('TENANT_01', 'Test Co', 'admin@testco.com');

      expect(result.success).toBe(true);
      if (result.success) expect(result.data.stripeCustomerId).toBe('cus_new_xyz');

      expect(mockStripe.customers.create).toHaveBeenCalledWith(expect.objectContaining({
        name: 'Test Co',
        email: 'admin@testco.com',
        metadata: { tenantId: 'TENANT_01' },
      }));
      expect(mockTenantRepo.updateTenant).toHaveBeenCalledWith('TENANT_01', expect.objectContaining({
        stripeCustomerId: 'cus_new_xyz',
      }));
    });

    it('returns error when Stripe API fails', async () => {
      (mockStripe.customers.create as jest.Mock).mockRejectedValue(new Error('Stripe error'));
      const result = await service.createStripeCustomer('TENANT_01', 'Test Co', 'admin@testco.com');
      expect(result.success).toBe(false);
    });
  });

  describe('createCheckoutSession', () => {
    it('returns session URL', async () => {
      process.env['STRIPE_PRICE_PROFESSIONAL'] = 'price_professional_123';
      (mockStripe.checkout.sessions.create as jest.Mock).mockResolvedValue({
        url: 'https://checkout.stripe.com/pay/cs_test_123',
      });

      const result = await service.createCheckoutSession(
        mockTenant,
        'PROFESSIONAL',
        'https://app.example.com/success',
        'https://app.example.com/cancel',
      );

      expect(result.success).toBe(true);
      if (result.success) expect(result.data.url).toContain('stripe.com');
      delete process.env['STRIPE_PRICE_PROFESSIONAL'];
    });
  });

  describe('createPortalSession', () => {
    it('returns portal URL', async () => {
      (mockStripe.billingPortal.sessions.create as jest.Mock).mockResolvedValue({
        url: 'https://billing.stripe.com/session/test_123',
      });

      const result = await service.createPortalSession(mockTenant, 'https://app.example.com/settings');

      expect(result.success).toBe(true);
      if (result.success) expect(result.data.url).toContain('stripe.com');
    });
  });

  describe('getBillingStatus', () => {
    it('returns plan and status for known tenant', async () => {
      (mockTenantRepo.findTenantById as jest.Mock).mockResolvedValue(mockTenant);
      const result = await service.getBillingStatus('TENANT_01');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.plan).toBe('STARTER');
        expect(result.data.status).toBe('ACTIVE');
      }
    });

    it('returns error for unknown tenant', async () => {
      (mockTenantRepo.findTenantById as jest.Mock).mockResolvedValue(null);
      const result = await service.getBillingStatus('UNKNOWN');
      expect(result.success).toBe(false);
    });
  });
});
```

- [ ] **Step 4.4: Update `domains/billing/index.ts`**

Add `WebhookHandler` to the barrel exports:

```typescript
export { BillingService, getPlanLimits } from './service.js';
export { WebhookHandler } from './webhook-handler.js';
export { getStripe, resetStripeClient } from './stripe-client.js';
export type { Plan, PlanLimits, TenantStatus, BillingErrorCode } from './types.js';
export { PLAN_LIMITS } from './types.js';
```

Then update the import in `apps/api/src/billing/route.ts` to use the barrel:

```typescript
// Change:
import { WebhookHandler } from '../../billing/webhook-handler.js';
// To:
import { WebhookHandler } from '@eventgear/billing';
```

- [ ] **Step 4.5: Run all billing tests**

```bash
pnpm --filter @eventgear/billing test
```

Expected: All tests PASS. Verify coverage includes:
- `service.test.ts` — 5+ tests
- `webhook-handler.test.ts` — 6+ tests
- `handler.test.ts` — 4+ tests

```bash
pnpm --filter @eventgear/billing test -- --coverage
```

Expected: ≥ 80% line coverage.

- [ ] **Step 4.6: Build**

```bash
pnpm --filter @eventgear/billing build
pnpm typecheck
```

Expected: No TypeScript errors.

- [ ] **Step 4.7: Commit**

```bash
git add domains/billing/handler.ts
git add domains/billing/index.ts
git add domains/billing/__tests__/
git commit -m "feat(billing): add billing Lambda handler, service tests, handler tests"
```

---

## Task 5: Terraform — Secrets Manager + Lambda billing function + authorizer exclusion

**Files:**
- Create: `infra/terraform/modules/secrets/main.tf`
- Create: `infra/terraform/modules/secrets/variables.tf`
- Create: `infra/terraform/modules/secrets/outputs.tf`
- Modify: `infra/terraform/environments/dev/main.tf` — add billing Lambda + secrets
- Verify: `infra/terraform/modules/api-gateway/main.tf` or equivalent — webhook route excluded from authorizer

### Overview

Store Stripe secrets in AWS Secrets Manager. Wire the billing Lambda with environment variables that reference the secrets. Confirm `POST /billing/webhook` is excluded from the Lambda authorizer (Stripe cannot send a Cognito JWT).

---

- [ ] **Step 5.1: Create `infra/terraform/modules/secrets/variables.tf`**

```hcl
variable "environment" {
  description = "Deployment environment (dev, staging, prod)"
  type        = string
  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "Environment must be dev, staging, or prod."
  }
}

variable "stripe_secret_key" {
  description = "Stripe secret key (sk_live_... or sk_test_...)"
  type        = string
  sensitive   = true
}

variable "stripe_webhook_secret" {
  description = "Stripe webhook signing secret (whsec_...)"
  type        = string
  sensitive   = true
}

variable "stripe_price_starter" {
  description = "Stripe Price ID for STARTER plan"
  type        = string
  default     = ""
}

variable "stripe_price_professional" {
  description = "Stripe Price ID for PROFESSIONAL plan"
  type        = string
  default     = ""
}

variable "stripe_price_enterprise" {
  description = "Stripe Price ID for ENTERPRISE plan (optional)"
  type        = string
  default     = ""
}
```

- [ ] **Step 5.2: Create `infra/terraform/modules/secrets/main.tf`**

```hcl
# Store Stripe secrets in AWS Secrets Manager
# Lambdas read these at cold start via the AWS SDK

resource "aws_secretsmanager_secret" "stripe_secret_key" {
  name                    = "eventgear/${var.environment}/stripe/secret-key"
  description             = "Stripe API secret key for EventGear ${var.environment}"
  recovery_window_in_days = 7

  tags = {
    Environment = var.environment
    Domain      = "billing"
  }
}

resource "aws_secretsmanager_secret_version" "stripe_secret_key" {
  secret_id     = aws_secretsmanager_secret.stripe_secret_key.id
  secret_string = var.stripe_secret_key
}

resource "aws_secretsmanager_secret" "stripe_webhook_secret" {
  name                    = "eventgear/${var.environment}/stripe/webhook-secret"
  description             = "Stripe webhook signing secret for EventGear ${var.environment}"
  recovery_window_in_days = 7

  tags = {
    Environment = var.environment
    Domain      = "billing"
  }
}

resource "aws_secretsmanager_secret_version" "stripe_webhook_secret" {
  secret_id     = aws_secretsmanager_secret.stripe_webhook_secret.id
  secret_string = var.stripe_webhook_secret
}

# IAM policy — allows billing Lambda to read Stripe secrets
resource "aws_iam_policy" "billing_secrets_read" {
  name        = "eventgear-billing-secrets-read-${var.environment}"
  description = "Allow billing Lambda to read Stripe secrets from Secrets Manager"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue",
          "secretsmanager:DescribeSecret"
        ]
        Resource = [
          aws_secretsmanager_secret.stripe_secret_key.arn,
          aws_secretsmanager_secret.stripe_webhook_secret.arn,
        ]
      }
    ]
  })
}
```

- [ ] **Step 5.3: Create `infra/terraform/modules/secrets/outputs.tf`**

```hcl
output "stripe_secret_key_arn" {
  description = "ARN of the Stripe secret key secret"
  value       = aws_secretsmanager_secret.stripe_secret_key.arn
}

output "stripe_webhook_secret_arn" {
  description = "ARN of the Stripe webhook secret"
  value       = aws_secretsmanager_secret.stripe_webhook_secret.arn
}

output "billing_secrets_read_policy_arn" {
  description = "IAM policy ARN for billing Lambda to read Stripe secrets"
  value       = aws_iam_policy.billing_secrets_read.arn
}
```

- [ ] **Step 5.4: Add billing Lambda + secrets to `infra/terraform/environments/dev/main.tf`**

Read the existing `dev/main.tf` first to understand the module pattern. Then add:

```hcl
# Stripe secrets
module "secrets" {
  source = "../../modules/secrets"

  environment           = var.environment
  stripe_secret_key     = var.stripe_secret_key
  stripe_webhook_secret = var.stripe_webhook_secret
  stripe_price_starter        = var.stripe_price_starter
  stripe_price_professional   = var.stripe_price_professional
  stripe_price_enterprise     = var.stripe_price_enterprise
}

# Billing Lambda
module "lambda_billing" {
  source = "../../modules/lambda"

  function_name = "eventgear-billing-${var.environment}"
  handler       = "handler.handler"
  runtime       = "nodejs20.x"

  environment_vars = {
    NODE_ENV              = var.environment
    DYNAMODB_TABLE_NAME   = module.dynamodb.table_name
    EVENTBRIDGE_BUS_NAME  = module.eventbridge.bus_name
    AWS_ACCOUNT_ID        = var.aws_account_id
    # Stripe secrets are fetched from Secrets Manager at Lambda init
    # Lambda reads STRIPE_SECRET_KEY from Secrets Manager via the Lambda extension or SDK call
    # For simplicity in dev, pass the ARNs so the Lambda SDK can fetch them:
    STRIPE_SECRET_KEY_ARN     = module.secrets.stripe_secret_key_arn
    STRIPE_WEBHOOK_SECRET_ARN = module.secrets.stripe_webhook_secret_arn
    # Price IDs are non-sensitive — pass directly
    STRIPE_PRICE_STARTER        = var.stripe_price_starter
    STRIPE_PRICE_PROFESSIONAL   = var.stripe_price_professional
    STRIPE_PRICE_ENTERPRISE     = var.stripe_price_enterprise
  }

  iam_policy_statements = [
    # DynamoDB access
    {
      Effect   = "Allow"
      Action   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:Query"]
      Resource = [module.dynamodb.table_arn, "${module.dynamodb.table_arn}/index/*"]
    },
    # EventBridge publish
    {
      Effect   = "Allow"
      Action   = ["events:PutEvents"]
      Resource = module.eventbridge.bus_arn
    },
    # Secrets Manager read
    {
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = [
        module.secrets.stripe_secret_key_arn,
        module.secrets.stripe_webhook_secret_arn,
      ]
    }
  ]
}
```

Also add to `dev/variables.tf`:

```hcl
variable "stripe_secret_key" {
  description = "Stripe API secret key"
  type        = string
  sensitive   = true
  default     = ""
}

variable "stripe_webhook_secret" {
  description = "Stripe webhook signing secret"
  type        = string
  sensitive   = true
  default     = ""
}

variable "stripe_price_starter" {
  type    = string
  default = ""
}

variable "stripe_price_professional" {
  type    = string
  default = ""
}

variable "stripe_price_enterprise" {
  type    = string
  default = ""
}
```

- [ ] **Step 5.5: Verify webhook route is excluded from the Lambda authorizer**

Open `apps/api/src/authorizer.ts` (created in Plan 1). Confirm the authorizer returns `Allow` unconditionally for `/billing/webhook`:

The authorizer should have logic similar to:
```typescript
// Bypass authorizer for Stripe webhook — Stripe cannot send a Cognito JWT
if (event.rawPath === '/billing/webhook' || event.routeKey?.includes('/billing/webhook')) {
  return generatePolicy('stripe', 'Allow', event.routeArn);
}
```

If this exclusion is missing, add it. In Terraform (API Gateway configuration), `POST /billing/webhook` should have `authorizationType: 'NONE'` — verify in `infra/terraform/modules/api-gateway/main.tf` or equivalent:

```hcl
# In the API Gateway route for the billing webhook:
resource "aws_apigatewayv2_route" "billing_webhook" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "POST /billing/webhook"

  # No authorizer — Stripe signature validation handles security
  authorization_type = "NONE"
}
```

All other `/billing/*` routes keep `authorization_type = "JWT"` or `"CUSTOM"` (Lambda authorizer).

- [ ] **Step 5.6: Terraform validate**

```bash
cd infra/terraform/environments/dev
terraform init
terraform validate
terraform fmt -recursive
```

Expected: `Success! The configuration is valid.`

- [ ] **Step 5.7: Terraform plan (dry run)**

```bash
terraform plan \
  -var="stripe_secret_key=sk_test_placeholder" \
  -var="stripe_webhook_secret=whsec_placeholder" \
  -var-file="dev.tfvars"
```

Expected: Plan shows new resources — Secrets Manager secrets, IAM policy, billing Lambda. No unexpected destroys.

- [ ] **Step 5.8: Add `.env.local` instructions for local dev**

Add to `apps/api/.env.local` (or document in the repo's dev setup README if one exists):

```bash
# Stripe (for local dev — use Stripe test keys + Stripe CLI for webhook forwarding)
STRIPE_SECRET_KEY=sk_test_your_test_key_here
STRIPE_WEBHOOK_SECRET=whsec_from_stripe_cli_listen

# Stripe Price IDs (from your Stripe test dashboard)
STRIPE_PRICE_STARTER=price_test_starter_id
STRIPE_PRICE_PROFESSIONAL=price_test_professional_id
STRIPE_PRICE_ENTERPRISE=price_test_enterprise_id
```

To test webhooks locally with the Stripe CLI:
```bash
stripe listen --forward-to localhost:3001/billing/webhook
```

- [ ] **Step 5.9: Commit**

```bash
git add infra/terraform/modules/secrets/
git add infra/terraform/environments/dev/main.tf
git add infra/terraform/environments/dev/variables.tf
git add apps/api/src/authorizer.ts  # if modified
git commit -m "feat(billing): add Secrets Manager for Stripe keys, billing Lambda Terraform, webhook authorizer exclusion"
```

---

## End-to-End Verification Checklist

Before declaring this sub-project complete, verify:

- [ ] `pnpm --filter @eventgear/billing test -- --coverage` reports ≥ 80% line coverage
- [ ] `pnpm --filter @eventgear/auth test` passes (TenantRepository with stripeCustomerId update)
- [ ] `pnpm --filter @eventgear/config test` passes (new Stripe config keys)
- [ ] `pnpm typecheck` reports no errors across the full monorepo
- [ ] `pnpm build` succeeds for `@eventgear/billing`
- [ ] Local dev: `POST /billing/webhook` with bad signature returns `400 STRIPE_SIGNATURE_INVALID`
- [ ] Local dev: `POST /billing/webhook` with valid Stripe CLI signature returns `200 { received: true }`
- [ ] Local dev: `POST /billing/checkout` without `X-Tenant-ID` header returns `401`
- [ ] Local dev: `POST /billing/portal` with valid tenant returns Stripe portal URL
- [ ] Local dev: `GET /billing/status` returns `{ plan, status }` for existing tenant
- [ ] Terraform `validate` passes with no errors
- [ ] After signup, DynamoDB tenant record shows `stripeCustomerId: cus_...` (not `local_...`)

---

## Key Design Decisions (for future reference)

**Webhook always returns 200:** Even when the handler encounters an error (e.g., tenant not found), the webhook route returns `200 { received: true }`. Returning a 4xx/5xx would cause Stripe to retry, which won't help data-consistency errors. The error is logged for manual investigation.

**Stripe Customer created non-blocking at signup:** If Stripe is unavailable at signup time, the tenant still gets created with a `local_${tenantId}` placeholder `stripeCustomerId`. The real `cus_` ID is required for Checkout and Portal — those routes fail gracefully if the placeholder is still present. Operators can manually trigger customer creation if needed.

**`invoice.payment_succeeded` EventBridge publish gated on PAST_DUE:** The spec's `billing.invoice.paid` EventBridge event is designed for the equipment billing domain (future) to mark reservations as payment-confirmed. Publishing on every invoice payment is noisy — only the PAST_DUE recovery case needs this signal for MVP. Standard subscription renewals do not publish the event.

**No `domains/billing/repository.ts`:** Tenant DynamoDB access is entirely through `TenantRepository` imported from `@eventgear/auth`. This maintains `Tenant` as a single source of truth and avoids duplicating DynamoDB key-building logic.

**`/billing/*` routes excluded from authorizer for tenant access:** The spec requires that `PAST_DUE` tenants still have access to `/billing/*` so they can resolve their payment. The Lambda authorizer (Plan 1) returns `403` for `PAST_DUE` tenants, but excludes all `/billing/*` routes from this check — not just `/billing/webhook`.
