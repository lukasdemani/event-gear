# EventGear MVP Production Readiness — Design Spec

## Status
APPROVED

## Goal
Make EventGear production-ready as a multi-tenant B2B SaaS platform for equipment rental companies. MVP scope: authentication + multi-tenancy, Reservations domain, and SaaS subscription billing via Stripe.

## Out of Scope (post-MVP)
- Logistics domain (dispatch, returns, damage)
- Equipment rental Billing domain (quotes, invoices to customers)
- Reservations consuming `billing.invoice.paid` (requires equipment Billing domain first)
- AI Assistant Bedrock migration
- Observability / APM
- RBAC beyond single admin role
- Mobile / offline support

---

## Sub-project 1: Multi-tenancy & Auth

### Overview
Cognito-based authentication with tenant isolation enforced at the DynamoDB key level. Every user belongs to a tenant; every data record is namespaced by that tenant. A Lambda authorizer validates JWTs and injects tenant context before any business logic runs.

### Cognito User Pool
- **One User Pool** for all tenants (not one pool per tenant)
- **Custom attributes** on each user:
  - `custom:tenantId` — ULID identifying the tenant
  - `custom:role` — string enum, starts as `"ADMIN"`, later expandable to `"RENTAL_MANAGER" | "WAREHOUSE_STAFF" | "FIELD_TECHNICIAN" | "FINANCE"`
- **No hosted UI** — custom login/signup pages in the React app using `amazon-cognito-identity-js`
- **Tenant provisioning on signup**: create Cognito user → write `Tenant` record to DynamoDB → create Stripe customer → assign `STARTER` trial plan

### DynamoDB Tenant Isolation Strategy

Tenant prefix is a **string-encoding concern only** — `DynamoKeys` and `KeyPair` types in `packages/db` do not change. PK and SK remain `string`. `BaseRepository` gains a required `tenantId: string` constructor parameter; all domain key-builder methods embed it when constructing PK/SK strings. No shared package type changes — migration is purely at the domain repository level.

Every primary key and GSI key prefixed with the tenant namespace:

| Entity | Old PK | New PK |
|---|---|---|
| Equipment | `EQUIP#{id}` | `TENANT#{tenantId}#EQUIP#{id}` |
| Category | `CATEGORY#{id}` | `TENANT#{tenantId}#CATEGORY#{id}` |
| StockUnit (PK) | `EQUIP#{id}` | `TENANT#{tenantId}#EQUIP#{id}` |
| Reservation | `RESERVATION#{id}` | `TENANT#{tenantId}#RESERVATION#{id}` |
| AvailabilityBlock | `UNIT#{unitId}` | `TENANT#{tenantId}#UNIT#{unitId}` |
| Tenant | — | `TENANT#{tenantId}` |

GSI1/GSI2 keys follow the same prefix pattern.

**Migration**: existing inventory repository key builders updated to accept and embed `tenantId`; all new domains built with tenant prefix from the start. Local seed data updated to include a default dev tenant.

### GSI3 Design Under Multi-tenancy

CLAUDE.md §4 defines `GSI3PK = Status`. In a multi-tenant table, `Status = "CONFIRMED"` would mix all tenants' data. Fix:

**New GSI3PK pattern**: `TENANT#{tenantId}#STATUS` (e.g., `TENANT#01J9...#CONFIRMED`)

This allows queries like "list all CONFIRMED reservations for tenant X sorted by date" without cross-tenant leakage. All domains using GSI3 must adopt this pattern — including the updated inventory domain.

### Tenant DynamoDB Key Pattern

```
PK:         TENANT#{tenantId}
SK:         METADATA
GSI1PK:     STRIPE_CUSTOMER#{stripeCustomerId}
GSI1SK:     TENANT#{tenantId}
EntityType: TENANT
```

`GSI1PK = STRIPE_CUSTOMER#...` enables the Stripe webhook handler to look up a tenant by `stripeCustomerId` — required since Stripe only provides `stripeCustomerId` in webhook events, not `tenantId`.

### Tenant TypeScript Interface

```typescript
interface Tenant {
  id: string;                    // ULID
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

### Lambda Authorizer

- Called by API Gateway before every request
- Validates the Cognito JWT using the User Pool JWKS endpoint
- Extracts `tenantId` + `role` from token claims
- Reads tenant record from DynamoDB to check `status` (for billing enforcement)
- Returns IAM `Allow` policy + authorizer context `{ tenantId, role, userId }`
- Downstream Lambdas read from `event.requestContext.authorizer` — no token parsing in business logic
- Returns `401` for missing, invalid, or expired token
- Returns `403` if tenant `status` is `PAST_DUE` or `CANCELLED`

**Authorizer result caching**: API Gateway `authorizerResultTtlInSeconds: 300` (5 minutes). Caches the IAM policy per token, eliminating per-request DynamoDB reads in steady state. Implication: a `PAST_DUE` tenant that resolves payment may wait up to 5 minutes for access to restore. Acceptable for MVP.

**`/billing/webhook` is excluded from the authorizer** — Stripe cannot send a Cognito JWT. Webhook security uses Stripe-signature verification instead.

### packages/auth/ Structure

```
packages/auth/
├── src/
│   ├── jwks-client.ts   — JWKS endpoint fetch + in-memory cache (TTL 1h)
│   ├── jwt.ts           — JWT decode + signature verification
│   ├── types.ts         — AuthContext interface, UserRole enum
│   └── index.ts         — barrel exports
├── package.json
└── tsconfig.json
```

```typescript
// types.ts
export type UserRole = 'ADMIN'; // expandable: | 'RENTAL_MANAGER' | 'WAREHOUSE_STAFF' | ...

export interface AuthContext {
  tenantId: string;
  userId: string;
  role: UserRole;
}
```

### Frontend Auth
- `/login` and `/signup` pages (custom UI, no Cognito hosted redirect)
- `AuthContext` (React Context) holds decoded user, role, tenantId, and raw token
- `ProtectedRoute` wrapper — unauthenticated users redirected to `/login`
- Token refresh handled transparently by `amazon-cognito-identity-js`
- Role stored in context as a hook point for future RBAC (renders nothing different today)

### New Files

```
packages/auth/src/jwks-client.ts
packages/auth/src/jwt.ts
packages/auth/src/types.ts
packages/auth/src/index.ts
packages/auth/package.json
packages/auth/tsconfig.json
apps/api/src/authorizer.ts
apps/web/src/features/auth/LoginPage.tsx
apps/web/src/features/auth/SignupPage.tsx
apps/web/src/features/auth/AuthContext.tsx
apps/web/src/features/auth/ProtectedRoute.tsx
infra/terraform/modules/cognito/main.tf
infra/terraform/modules/cognito/variables.tf
infra/terraform/modules/cognito/outputs.tf
domains/inventory/                          — key builders updated (no new files)
```

---

## Sub-project 2: Reservations Domain

### Overview
Full domain implementation following the inventory pattern. Handles the booking lifecycle from draft to completion, with synchronous conflict detection at confirmation time and event-driven integration with the inventory domain.

> **Note on SPEC.md convention**: CLAUDE.md §8 requires a `SPEC.md` per domain. Add `domains/reservations/SPEC.md` and `domains/billing/SPEC.md` as stubs pointing to this document.

### Entities

```typescript
type ReservationStatus = 'DRAFT' | 'QUOTED' | 'CONFIRMED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';

interface Reservation {
  id: string;               // ULID
  tenantId: string;
  customerId: string;
  startDate: string;        // ISO date "YYYY-MM-DD"
  endDate: string;
  status: ReservationStatus;
  totalAmount: number;      // computed at confirmation; locked after
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

interface ReservationItem {
  id: string;               // ULID
  reservationId: string;
  equipmentId: string;
  unitId: string;
  quantity: number;
  dailyRateSnapshot: number; // rate locked at booking time, not live
  // tenantId encoded in DynamoDB keys, not stored as a domain field
}

interface AvailabilityBlock {
  unitId: string;
  startDate: string;        // ISO date
  endDate: string;          // ISO date
  reservationId: string;    // what created the block
}
```

### DynamoDB Key Patterns

#### Reservation
```
PK:         TENANT#{tenantId}#RESERVATION#{id}
SK:         METADATA
GSI1PK:     TENANT#{tenantId}#CUSTOMER#{customerId}
GSI1SK:     RESERVATION#{id}
GSI2PK:     TENANT#{tenantId}#ENTITY#RESERVATION
GSI2SK:     {createdAt}
GSI3PK:     TENANT#{tenantId}#{status}   (e.g. TENANT#...#CONFIRMED)
GSI3SK:     {startDate}#{id}
EntityType: RESERVATION
```

#### ReservationItem
```
PK:         TENANT#{tenantId}#RESERVATION#{reservationId}
SK:         ITEM#{itemId}
GSI1PK:     TENANT#{tenantId}#EQUIP#{equipmentId}
GSI1SK:     RESERVATION#{reservationId}#ITEM#{itemId}
EntityType: RESERVATION_ITEM
```

#### AvailabilityBlock
```
PK:         TENANT#{tenantId}#UNIT#{unitId}
SK:         BLOCK#{startDate}#{endDate}#{reservationId}
GSI1PK:     TENANT#{tenantId}#RESERVATION#{reservationId}
GSI1SK:     BLOCK#{unitId}
EntityType: AVAILABILITY_BLOCK
```

Querying all blocks for a unit: `PK = TENANT#{t}#UNIT#{unitId}`, `SK begins_with BLOCK#`. Date-range overlap filtering done in application code after fetching.

### API Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/reservations` | Create draft reservation |
| `GET` | `/reservations/:id` | Get reservation with items |
| `PATCH` | `/reservations/:id/confirm` | Conflict check + confirm |
| `PATCH` | `/reservations/:id/cancel` | Cancel + release AvailabilityBlocks |
| `PUT` | `/reservations/:id/items` | Add/remove items (DRAFT status only) |
| `GET` | `/inventory/equipment/:id/availability` | Check unit availability (`?start=&end=`) |

### Conflict Detection

On `confirm`, for each `ReservationItem`:
1. Query all `AvailabilityBlock` records for the unit — `PK=TENANT#{t}#UNIT#{unitId}`, `SK begins_with BLOCK#`
2. Filter in application code: `block.startDate < reservation.endDate && block.endDate > reservation.startDate`
3. If overlap found → return `{ success: false, error: CONFLICT }` with conflicting `reservationId`
4. If no conflicts → write all `AvailabilityBlock` items + update reservation status via `TransactWriteItems`, each block with `ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)"` to guard against exact duplicate writes

**Race condition acknowledgement**: Two concurrent confirmations for the same unit may both pass the overlap check before either writes. `attribute_not_exists` only prevents exact SK collision — it does not prevent a range-overlap race. For MVP this is acceptable (B2B rental context; simultaneous double-booking of the same unit in milliseconds is rare). Future hardening: add a per-unit version counter as a `ConditionCheck` item in the transaction.

### Business Rules
1. Items can only be added/removed when status is `DRAFT`
2. Confirmation requires at least one item
3. `PATCH /cancel` releases all `AvailabilityBlock` records atomically (`TransactWriteItems` deletes)
4. `totalAmount` = `sum(dailyRateSnapshot × quantity × days)` computed at confirmation — never recalculated after
5. `COMPLETED` and `CANCELLED` are terminal states

### EventBridge

**Publishes:**
- `reservations.reservation.created`
- `reservations.reservation.confirmed` → inventory domain marks units reserved
- `reservations.reservation.cancelled` → inventory domain releases units
- `reservations.reservation.modified` — fires on `PUT /reservations/:id/items`
- `reservations.conflict.detected`

**Consumes:**
- `inventory.stockunit.availability-changed` (status → MAINTENANCE or RETIRED) → auto-cancel affected DRAFT/CONFIRMED reservations for that unit

### DynamoDB Access Patterns

| Pattern | Key Condition | Index |
|---|---|---|
| Get reservation by ID | `PK=TENANT#{t}#RESERVATION#{id}, SK=METADATA` | Main |
| List items in reservation | `PK=TENANT#{t}#RESERVATION#{id}, SK begins_with ITEM#` | Main |
| List reservations for customer | `GSI1PK=TENANT#{t}#CUSTOMER#{id}` | GSI1 |
| List confirmed reservations by date | `GSI3PK=TENANT#{t}#CONFIRMED, GSI3SK between dates` | GSI3 |
| List active reservations | `GSI3PK=TENANT#{t}#ACTIVE` | GSI3 |
| Check equipment in reservations | `GSI1PK=TENANT#{t}#EQUIP#{id}` | GSI1 |
| Get all blocks for a unit | `PK=TENANT#{t}#UNIT#{id}, SK begins_with BLOCK#` | Main |
| Get all blocks for a reservation | `GSI1PK=TENANT#{t}#RESERVATION#{id}, GSI1SK begins_with BLOCK#` | GSI1 |

### New Files

```
domains/reservations/SPEC.md
domains/reservations/types.ts
domains/reservations/validators.ts
domains/reservations/repository.ts
domains/reservations/service.ts
domains/reservations/events.ts
domains/reservations/handler.ts
domains/reservations/__tests__/service.test.ts
domains/reservations/__tests__/repository.test.ts
domains/reservations/__tests__/handler.test.ts
domains/reservations/index.ts
```

---

## Sub-project 3: SaaS Billing (Stripe)

### Overview
Stripe-based subscription management for rental companies paying EventGear. Handles plan tiers, trial periods, and usage enforcement. No custom billing UI — Stripe's Customer Portal handles payment method management and invoice history.

### Plans

| Plan | Price | User Limit | Reservation Limit |
|---|---|---|---|
| `STARTER` | $99/mo | 3 users | 100/month |
| `PROFESSIONAL` | $299/mo | 10 users | Unlimited |
| `ENTERPRISE` | Custom | Unlimited | Unlimited |

### Tenant Onboarding Flow

1. Signup form → API creates Cognito user + Tenant record (`plan: STARTER, status: TRIALING, trialEndsAt: now + 14 days`) + Stripe customer
2. User lands in app — full `STARTER` access during trial
3. At trial expiry or voluntary upgrade: `POST /billing/checkout` → Stripe Checkout URL → user pays → webhook activates
4. No credit card required at signup

### Billing Lambda Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/billing/checkout` | Cognito JWT | Create Stripe Checkout session |
| `POST` | `/billing/webhook` | Stripe-signature only | Receive Stripe webhook events |
| `GET` | `/billing/portal` | Cognito JWT | Return Stripe Customer Portal URL |
| `GET` | `/billing/status` | Cognito JWT | Return current plan + status |

### Stripe Webhook Events

Webhook handler looks up tenant by `stripeCustomerId` using `GSI1PK = STRIPE_CUSTOMER#{stripeCustomerId}`.

| Stripe Event | Action |
|---|---|
| `customer.subscription.created` | Set `status: ACTIVE`, store `stripeSubscriptionId`, set `plan` from price lookup |
| `customer.subscription.updated` | Update `plan` if price changed |
| `customer.subscription.deleted` | Set `status: CANCELLED` |
| `invoice.payment_failed` | Set `status: PAST_DUE` |
| `invoice.payment_succeeded` | Set `status: ACTIVE` (clears PAST_DUE) |

### Enforcement

**In Lambda authorizer**: reads tenant `status` (cached 5 min via API Gateway TTL). `PAST_DUE` or `CANCELLED` → `403`. `/billing/*` excluded so tenant can resolve payment.

**In service layer** (meaningful errors):
- `createUser()` checks user count vs plan limit → `PLAN_LIMIT_EXCEEDED`
- `createReservation()` checks monthly reservation count vs plan limit → `PLAN_LIMIT_EXCEEDED`

### Security

- `/billing/webhook` excluded from Lambda authorizer
- Webhook verifies `Stripe-Signature` header using `stripe.webhooks.constructEvent()` — rejects invalid signatures with `400`
- Stripe secret key and webhook signing secret stored in **AWS Secrets Manager**; Lambda reads at cold start

### New Files

```
domains/billing/SPEC.md
domains/billing/types.ts
domains/billing/stripe-client.ts
domains/billing/service.ts
domains/billing/webhook-handler.ts
domains/billing/handler.ts
domains/billing/__tests__/service.test.ts
domains/billing/__tests__/handler.test.ts
domains/billing/index.ts
infra/terraform/modules/secrets/main.tf
infra/terraform/modules/secrets/variables.tf
infra/terraform/modules/secrets/outputs.tf
```

---

## Sequencing

```
1. Auth + Multi-tenancy    (blocks everything — no tenantId = no data isolation)
2. Reservations domain     (core business value; ships before billing is live)
3. SaaS Billing            (monetisation; app runs on 14-day trial without it)
```

## Error Cases

| Code | Condition | HTTP Status |
|---|---|---|
| `UNAUTHORIZED` | Missing, invalid, or expired JWT | 401 |
| `FORBIDDEN` | Tenant status is PAST_DUE or CANCELLED | 403 |
| `CONFLICT` | Unit unavailable for requested dates | 409 |
| `PLAN_LIMIT_EXCEEDED` | User or reservation count exceeds plan | 402 |
| `INVALID_STATUS_TRANSITION` | e.g. confirming a CANCELLED reservation | 422 |
| `RESERVATION_NOT_FOUND` | reservationId doesn't exist for tenant | 404 |
| `STRIPE_SIGNATURE_INVALID` | Webhook signature check failed | 400 |

## Success Criteria

- A rental company can sign up, get a 14-day trial, manage equipment + reservations
- Data is fully isolated between tenants — no cross-tenant reads possible by construction
- On trial expiry, Stripe Checkout activates the subscription; `PAST_DUE` blocks API within 5 minutes
- All existing inventory tests pass with tenant-prefixed keys
- Reservations domain has ≥ 80% test coverage including conflict detection edge cases
- Webhook handler correctly routes all 5 Stripe events to tenant record updates
- `handler.test.ts` exists for both Reservations and Billing covering routing, auth context injection, and 4xx/5xx shapes
