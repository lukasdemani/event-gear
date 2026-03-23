# EventGear MVP Production Readiness — Design Spec

## Status
APPROVED

## Goal
Make EventGear production-ready as a multi-tenant B2B SaaS platform for equipment rental companies. MVP scope: authentication + multi-tenancy, Reservations domain, and SaaS subscription billing via Stripe.

## Out of Scope (post-MVP)
- Logistics domain (dispatch, returns, damage)
- Equipment rental Billing domain (quotes, invoices to customers)
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
- **Tenant provisioning on signup**: create Cognito user → write `TENANT#{tenantId}` record to DynamoDB → create Stripe customer → assign `STARTER` trial plan

### DynamoDB Tenant Isolation
Every primary key and GSI key prefixed with the tenant namespace:

| Entity | Old PK | New PK |
|---|---|---|
| Equipment | `EQUIP#{id}` | `TENANT#{tenantId}#EQUIP#{id}` |
| Category | `CATEGORY#{id}` | `TENANT#{tenantId}#CATEGORY#{id}` |
| StockUnit | `EQUIP#{id}` | `TENANT#{tenantId}#EQUIP#{id}` |
| Reservation | `RESERVATION#{id}` | `TENANT#{tenantId}#RESERVATION#{id}` |
| Tenant | — | `TENANT#{tenantId}` |

GSI keys follow the same pattern. `BaseRepository` gains a required `tenantId` constructor parameter — all key builder methods absorb it internally. No cross-tenant query is expressible without knowing the `tenantId`.

**Migration**: existing inventory repository key builders updated; all new domains built with tenant prefix from the start. Local seed data updated to include a default tenant.

### Lambda Authorizer
- Called by API Gateway before every request
- Validates the Cognito JWT using the User Pool JWKS endpoint
- Extracts `tenantId` + `role` from token claims
- Returns IAM `Allow` policy + authorizer context `{ tenantId, role, userId }`
- Downstream Lambdas read from `event.requestContext.authorizer` — no token parsing in business logic
- Returns `401` for missing/invalid token, `403` for expired token

### Frontend Auth
- `/login` and `/signup` pages (custom UI, no Cognito hosted redirect)
- `AuthContext` (React Context) holds decoded user, role, tenantId, and raw token
- `ProtectedRoute` wrapper — unauthenticated users redirected to `/login`
- Token refresh handled transparently by `amazon-cognito-identity-js`
- Role stored in context for future UI gating (renders nothing extra today; hook point for RBAC later)

### Role Extensibility
`custom:role` is a string in Cognito but read as a `UserRole` enum in the backend:
```typescript
export type UserRole = 'ADMIN'; // expand: | 'RENTAL_MANAGER' | 'WAREHOUSE_STAFF' | ...
```
Adding a new role = add enum value + update one RBAC middleware check. No auth, DB, or API Gateway changes required.

### New Files
- `packages/auth/` — JWT validation logic, JWKS client, UserRole enum
- `apps/api/src/authorizer.ts` — Lambda authorizer handler
- `apps/web/src/features/auth/` — LoginPage, SignupPage, AuthContext, ProtectedRoute
- `infra/terraform/modules/cognito/` — User Pool, App Client, custom attributes
- `domains/inventory/` — key builders updated throughout for tenant prefix

---

## Sub-project 2: Reservations Domain

### Overview
Full domain implementation following the inventory pattern. Handles the booking lifecycle from draft to completion, with synchronous conflict detection at confirmation time and event-driven integration with the inventory domain.

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
  totalAmount: number;      // computed from items at confirmation
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
  dailyRateSnapshot: number; // rate locked at booking time
}

interface AvailabilityBlock {
  unitId: string;
  startDate: string;
  endDate: string;
  reservationId: string;    // what caused the block
}
```

### API Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/reservations` | Create draft reservation |
| `GET` | `/reservations/:id` | Get reservation with items |
| `PATCH` | `/reservations/:id/confirm` | Conflict check + confirm |
| `PATCH` | `/reservations/:id/cancel` | Cancel + release AvailabilityBlocks |
| `PUT` | `/reservations/:id/items` | Add/remove items (DRAFT status only) |
| `GET` | `/inventory/equipment/:id/availability` | Check availability for date range (`?start=&end=`) |

### Conflict Detection
On `confirm`, for each `ReservationItem`:
1. Query all `AvailabilityBlock` records for the requested `unitId`
2. Check for date overlap with `[startDate, endDate]`
3. If overlap found → return `{ success: false, error: CONFLICT }` with conflicting `reservationId`
4. If no conflicts → write all `AvailabilityBlock` records atomically, update status to `CONFIRMED`

Conflict check is synchronous and transactional (DynamoDB `TransactWriteItems` — write blocks only if no conflicts exist at write time, preventing race conditions).

### Business Rules
1. Items can only be added/removed when status is `DRAFT`
2. Confirmation requires at least one item
3. Cancellation releases all `AvailabilityBlock` records
4. `totalAmount` computed as `sum(dailyRateSnapshot × quantity × days)` at confirmation — never recalculated after
5. `COMPLETED` and `CANCELLED` are terminal states

### EventBridge

**Publishes:**
- `reservations.reservation.created`
- `reservations.reservation.confirmed` → inventory domain marks units reserved
- `reservations.reservation.cancelled` → inventory domain releases units
- `reservations.conflict.detected`

**Consumes:**
- `inventory.stockunit.availability-changed` (status → MAINTENANCE or RETIRED) → auto-cancel affected reservations

### DynamoDB Access Patterns
Implements AP-07 through AP-12 from CLAUDE.md with tenant prefix:

| Pattern | Key Condition | Index |
|---|---|---|
| Get reservation by ID | `PK=TENANT#{t}#RESERVATION#{id}` | Main |
| List items in reservation | `PK=TENANT#{t}#RESERVATION#{id}, SK begins_with ITEM#` | Main |
| List reservations for customer | `GSI1PK=TENANT#{t}#CUSTOMER#{id}` | GSI1 |
| List confirmed reservations by date | `Status=CONFIRMED, GSI3SK between dates` | GSI3 |
| List active reservations | `Status=ACTIVE` | GSI3 |
| Check equipment in reservations | `GSI1PK=TENANT#{t}#EQUIP#{id}` | GSI1 |
| Get availability blocks for unit | `GSI1PK=TENANT#{t}#UNIT#{id}` | GSI1 |

### New Files
- `domains/reservations/types.ts`
- `domains/reservations/validators.ts`
- `domains/reservations/repository.ts`
- `domains/reservations/service.ts`
- `domains/reservations/handler.ts`
- `domains/reservations/events.ts`
- `domains/reservations/__tests__/service.test.ts`
- `domains/reservations/__tests__/repository.test.ts`
- `infra/terraform/modules/lambda/` — reservations Lambda target (already scaffolded)

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

### Tenant Record (DynamoDB)
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
}
```

### Onboarding Flow
1. User fills signup form → API creates Cognito user + Tenant record (`plan: STARTER, status: TRIALING, trialEndsAt: +14 days`)
2. User lands in app — full access during trial
3. At trial expiry (or on voluntary upgrade): `POST /billing/checkout` → Stripe Checkout session → user pays → webhook activates subscription
4. No credit card required at signup

### Billing Lambda Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/billing/checkout` | Create Stripe Checkout session for plan upgrade |
| `POST` | `/billing/webhook` | Receive Stripe webhook events (unprotected, Stripe-signature verified) |
| `GET` | `/billing/portal` | Return Stripe Customer Portal URL |
| `GET` | `/billing/status` | Return current plan + status for the tenant |

### Stripe Webhook Events Handled
- `customer.subscription.created` → set `status: ACTIVE`, store `stripeSubscriptionId`
- `customer.subscription.updated` → update plan tier if changed
- `customer.subscription.deleted` → set `status: CANCELLED`
- `invoice.payment_failed` → set `status: PAST_DUE`
- `invoice.payment_succeeded` → set `status: ACTIVE` (clears PAST_DUE)

### Enforcement
**In Lambda authorizer**: reads tenant `status` from DynamoDB. If `PAST_DUE` or `CANCELLED` → returns `402 Payment Required` (blocks all API calls except `/billing/*`).

**In service layer** (meaningful error messages):
- `createUser()` checks current user count vs plan limit
- `createReservation()` checks monthly reservation count vs plan limit

### Security
- Webhook endpoint verifies `Stripe-Signature` header using `stripe.webhooks.constructEvent()`
- Stripe secret key stored in AWS Secrets Manager, not Lambda env vars
- `/billing/webhook` excluded from Lambda authorizer (Stripe cannot send a Cognito JWT)

### New Files
- `domains/billing/types.ts` — Tenant, Plan, BillingStatus
- `domains/billing/service.ts` — checkout, portal, plan enforcement
- `domains/billing/handler.ts` — Lambda handler for billing endpoints
- `domains/billing/stripe-client.ts` — Stripe SDK wrapper
- `domains/billing/webhook-handler.ts` — Stripe event processing
- `domains/billing/__tests__/service.test.ts`
- `infra/terraform/modules/secrets/` — Stripe secret in Secrets Manager

---

## Sequencing

Build in this order — each sub-project is a releasable increment:

```
1. Auth + Multi-tenancy   (blocks everything — no other sub-project works without tenant context)
2. Reservations domain    (core business value; can deploy before billing is live)
3. SaaS Billing           (monetisation; app works on trial without it)
```

## Success Criteria
- A rental company can sign up, get a 14-day trial, manage equipment + reservations
- Data is fully isolated between tenants — no cross-tenant reads possible
- On trial expiry, Stripe Checkout activates the subscription
- All existing inventory tests pass with tenant-prefixed keys
- New reservations domain has ≥ 80% test coverage including conflict detection edge cases
