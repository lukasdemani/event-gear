# CLAUDE.md — EventGear Platform Context

> **For AI assistants:** This file is the authoritative context source for all Claude Code sessions in this repository. Read it fully before making any changes. Every section is load-bearing. Do not skip the DynamoDB schema or EventBridge contracts sections.

---

## 1. Project Overview

**EventGear** is a B2B SaaS platform for equipment rental companies that serve large live events — concerts, festivals, corporate conferences, trade shows, and sporting events. It manages the full rental lifecycle:

```
Quote → Reservation → Dispatch → Active Rental → Return → Inspection → Billing
```

### Who uses it
| Role | Description |
|---|---|
| **Rental Manager** | Creates quotes, manages reservations, handles conflicts |
| **Warehouse Staff** | Picks equipment, marks units dispatched/returned, inspects condition |
| **Field Technician** | Receives dispatch assignments, logs on-site issues |
| **Finance** | Generates invoices, tracks payments, runs reports |
| **AI Assistant** | Natural language layer over all the above — answering availability queries, drafting quotes, flagging conflicts |

### Business Context
- Equipment categories: stages, LED walls, trussing, audio systems, lighting rigs, power distribution, rigging hardware, stands, cables
- Rentals span 1 day to 6 weeks; most are 3–10 days around an event build/show/strike window
- Stock units are physical assets tracked individually (serial number, condition, maintenance history)
- Pricing: daily rate × days + optional delivery, labor, and damage waiver fees
- A **Kit** is a curated bundle of equipment items rented together (e.g., "Basic Stage Package")

---

## 2. Architecture Overview

### AWS Services Map

```
┌─────────────────────────────────────────────────────────────────────┐
│                        CLIENT LAYER                                  │
│  React/Vite SPA ──► S3 + CloudFront (CDN)                           │
└────────────────────────────┬────────────────────────────────────────┘
                             │ HTTPS
┌────────────────────────────▼────────────────────────────────────────┐
│                     API GATEWAY (HTTP API)                           │
│  /api/v1/{domain}/{resource}  ──► Lambda authorizer (JWT)            │
└──────┬──────────┬───────────┬────────────┬──────────────────────────┘
       │          │           │            │
┌──────▼──┐ ┌────▼────┐ ┌───▼────┐ ┌────▼──────┐
│Inventory│ │Reserv.  │ │Billing │ │Logistics  │  Lambda Functions
│ Lambda  │ │ Lambda  │ │ Lambda │ │  Lambda   │  (Node.js 20.x)
└──────┬──┘ └────┬────┘ └───┬────┘ └────┬──────┘
       │          │           │            │
       └──────────┴─────┬─────┴────────────┘
                        │
              ┌─────────▼──────────┐
              │   DynamoDB         │
              │  (single table)    │
              │  eventgear-{env}   │
              └────────────────────┘
                        │
              ┌─────────▼──────────┐
              │   EventBridge      │  Domain events fan-out
              │  eventgear-{env}   │
              └────────────────────┘
                        │
         ┌──────────────┼──────────────┐
         │              │              │
  ┌──────▼──┐   ┌───────▼────┐ ┌─────——▼──────┐
  │Inventory│   │Reservations│ │  Logistics   │  Consumer Lambdas
  │Consumer │   │  Consumer  │ │   Consumer   │
  └─────────┘   └────────────┘ └──────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                        AI LAYER                                      │
│                                                                      │
│  User ──► AI Assistant Lambda ──► Bedrock Agent ──► Action Groups   │
│                                        │                             │
│                                        ├──► Inventory Lambda         │
│                                        ├──► Reservation Lambda       │
│                                        └──► Knowledge Base (RAG)     │
│                                               ├── equipment-catalog  │
│                                               ├── rental-policies    │
│                                               └── maintenance-docs   │
└─────────────────────────────────────────────────────────────────────┘
```

### Key Architectural Decisions
- **Single-table DynamoDB**: All entities in one table; access patterns define the design, not normalization
- **Event-driven cross-domain**: Domains never call each other directly; they emit and consume EventBridge events
- **Serverless-first**: Lambda for all compute; no ECS/EKS unless a bounded context provably cannot fit
- **Bedrock Agents for AI**: Not raw LLM calls — structured agents with action groups backed by real Lambda functions
- **Monorepo (pnpm workspaces)**: Shared `packages/` consumed by `domains/` and `apps/`; each domain is independently deployable

---

## 3. Bounded Contexts Map

### Inventory Context
**Responsibility**: Equipment catalog, stock unit registry, condition tracking, maintenance scheduling

**Owns**: `Equipment`, `Category`, `StockUnit`, `MaintenanceRecord`, `Kit`

**Publishes**:
- `inventory.equipment.created`
- `inventory.equipment.updated`
- `inventory.stockunit.condition-changed`
- `inventory.stockunit.availability-changed`
- `inventory.maintenance.scheduled`
- `inventory.maintenance.completed`

**Consumes**:
- `reservations.reservation.confirmed` → mark units as reserved
- `reservations.reservation.cancelled` → release units
- `logistics.return.completed` → trigger inspection workflow

---

### Reservations Context
**Responsibility**: Booking lifecycle, conflict detection, calendar management, availability queries

**Owns**: `Reservation`, `ReservationItem`, `AvailabilityBlock`

**Publishes**:
- `reservations.reservation.created`
- `reservations.reservation.confirmed`
- `reservations.reservation.cancelled`
- `reservations.reservation.modified`
- `reservations.conflict.detected`

**Consumes**:
- `inventory.stockunit.availability-changed` → update availability cache
- `billing.invoice.paid` → mark reservation as payment-confirmed

---

### Logistics Context
**Responsibility**: Dispatch planning, field team assignment, delivery/pickup tracking, return workflows

**Owns**: `DispatchJob`, `ReturnRecord`, `FieldTeam`, `Vehicle`

**Publishes**:
- `logistics.dispatch.scheduled`
- `logistics.dispatch.completed`
- `logistics.return.initiated`
- `logistics.return.completed`
- `logistics.damage.reported`

**Consumes**:
- `reservations.reservation.confirmed` → auto-create dispatch job
- `reservations.reservation.cancelled` → cancel pending dispatch

---

### Billing Context
**Responsibility**: Quote generation, invoice creation, payment tracking, pricing rules

**Owns**: `Quote`, `Invoice`, `InvoiceLineItem`, `PricingRule`, `Payment`

**Publishes**:
- `billing.quote.created`
- `billing.quote.accepted`
- `billing.invoice.created`
- `billing.invoice.sent`
- `billing.invoice.paid`
- `billing.invoice.overdue`

**Consumes**:
- `reservations.reservation.confirmed` → auto-generate invoice
- `logistics.damage.reported` → add damage charges to invoice
- `logistics.return.completed` → finalize invoice

---

### AI Assistant Context
**Responsibility**: Natural language interface, Bedrock Agent routing, RAG queries, proactive alerts

**Owns**: `ConversationSession`, `AgentQuery`, `AgentResponse`

**Publishes**: (none — read-only orchestration layer)

**Consumes**: All events for building context and triggering proactive notifications

---

## 4. DynamoDB Schema

### Table
- **Name**: `eventgear-{env}` (e.g., `eventgear-dev`, `eventgear-prod`)
- **Billing**: PAY_PER_REQUEST
- **Partition Key**: `PK` (String)
- **Sort Key**: `SK` (String)

### Global Secondary Indexes

| Index | Partition Key | Sort Key | Purpose |
|---|---|---|---|
| `GSI1` | `GSI1PK` | `GSI1SK` | Reverse lookups (e.g., customer → reservations) |
| `GSI2` | `EntityType` | `CreatedAt` | List all entities of a type, sorted by creation |
| `GSI3` | `Status` | `GSI3SK` | Query by status + secondary key (date, ID) |

### Entity Key Patterns

#### Equipment (catalog item)
```
PK:      EQUIP#{equipmentId}
SK:      METADATA
GSI1PK:  CATEGORY#{categoryId}
GSI1SK:  EQUIP#{equipmentId}
EntityType: EQUIPMENT
```

#### StockUnit (physical unit of equipment)
```
PK:      EQUIP#{equipmentId}
SK:      UNIT#{unitId}
GSI1PK:  UNIT#{unitId}
GSI1SK:  METADATA
EntityType: STOCKUNIT
Status:  AVAILABLE | RESERVED | MAINTENANCE | RETIRED | DISPATCHED
GSI3SK:  EQUIP#{equipmentId}
```

#### Category
```
PK:      CATEGORY#{categoryId}
SK:      METADATA
EntityType: CATEGORY
```

#### Customer
```
PK:      CUSTOMER#{customerId}
SK:      METADATA
GSI1PK:  EMAIL#{email}
GSI1SK:  CUSTOMER#{customerId}
EntityType: CUSTOMER
```

#### Reservation
```
PK:      RESERVATION#{reservationId}
SK:      METADATA
GSI1PK:  CUSTOMER#{customerId}
GSI1SK:  RESERVATION#{reservationId}
EntityType: RESERVATION
Status:  DRAFT | QUOTED | CONFIRMED | ACTIVE | COMPLETED | CANCELLED
GSI3SK:  {startDate}#{reservationId}
```

#### ReservationItem (line item within a reservation)
```
PK:      RESERVATION#{reservationId}
SK:      ITEM#{reservationItemId}
GSI1PK:  EQUIP#{equipmentId}
GSI1SK:  RESERVATION#{reservationId}#ITEM#{reservationItemId}
EntityType: RESERVATION_ITEM
```

#### MaintenanceRecord
```
PK:      EQUIP#{equipmentId}
SK:      MAINTENANCE#{isoTimestamp}#{recordId}
GSI1PK:  UNIT#{unitId}
GSI1SK:  MAINTENANCE#{isoTimestamp}
EntityType: MAINTENANCE_RECORD
Status:  SCHEDULED | IN_PROGRESS | COMPLETED | CANCELLED
GSI3SK:  {equipmentId}#{isoTimestamp}
```

#### Invoice
```
PK:      INVOICE#{invoiceId}
SK:      METADATA
GSI1PK:  CUSTOMER#{customerId}
GSI1SK:  INVOICE#{invoiceId}
GSI1(Reservation): RESERVATION#{reservationId} → SK: INVOICE#{invoiceId}
EntityType: INVOICE
Status:  DRAFT | SENT | PAID | OVERDUE | VOID
GSI3SK:  {dueDate}#{invoiceId}
```

#### DispatchJob
```
PK:      DISPATCH#{jobId}
SK:      METADATA
GSI1PK:  RESERVATION#{reservationId}
GSI1SK:  DISPATCH#{jobId}
EntityType: DISPATCH_JOB
Status:  SCHEDULED | IN_TRANSIT | COMPLETED | CANCELLED
GSI3SK:  {scheduledDate}#{jobId}
```

#### Kit (equipment bundle)
```
PK:      KIT#{kitId}
SK:      METADATA
EntityType: KIT

PK:      KIT#{kitId}
SK:      ITEM#{equipmentId}
EntityType: KIT_ITEM
```

### Access Patterns (ALL must be documented before writing code)

| # | Pattern | Key Condition | Index | Notes |
|---|---|---|---|---|
| AP-01 | Get equipment by ID | PK=EQUIP#{id}, SK=METADATA | Main | |
| AP-02 | List equipment in category | GSI1PK=CATEGORY#{id} | GSI1 | paginated |
| AP-03 | List all categories | EntityType=CATEGORY | GSI2 | |
| AP-04 | Get all stock units for equipment | PK=EQUIP#{id}, SK begins_with UNIT# | Main | |
| AP-05 | Get stock unit by unit ID | GSI1PK=UNIT#{unitId}, GSI1SK=METADATA | GSI1 | |
| AP-06 | Get available stock units | Status=AVAILABLE, GSI3SK begins_with EQUIP# | GSI3 | filter by equipment |
| AP-07 | Get reservation by ID | PK=RESERVATION#{id}, SK=METADATA | Main | |
| AP-08 | Get all items in reservation | PK=RESERVATION#{id}, SK begins_with ITEM# | Main | |
| AP-09 | List reservations for customer | GSI1PK=CUSTOMER#{id}, GSI1SK begins_with RESERVATION# | GSI1 | |
| AP-10 | List confirmed reservations by date | Status=CONFIRMED, GSI3SK between dates | GSI3 | |
| AP-11 | List active reservations | Status=ACTIVE | GSI3 | |
| AP-12 | Check equipment in reservations | GSI1PK=EQUIP#{id}, GSI1SK begins_with RESERVATION# | GSI1 | for conflict check |
| AP-13 | Get maintenance history for equipment | PK=EQUIP#{id}, SK begins_with MAINTENANCE# | Main | sorted by date |
| AP-14 | Get maintenance records for unit | GSI1PK=UNIT#{unitId}, GSI1SK begins_with MAINTENANCE# | GSI1 | |
| AP-15 | List invoices for customer | GSI1PK=CUSTOMER#{id}, GSI1SK begins_with INVOICE# | GSI1 | |
| AP-16 | Get invoice for reservation | GSI1PK=RESERVATION#{id}, GSI1SK begins_with INVOICE# | GSI1 | |
| AP-17 | List overdue invoices | Status=OVERDUE | GSI3 | filter by GSI3SK date |
| AP-18 | Get dispatch jobs for reservation | GSI1PK=RESERVATION#{id}, GSI1SK begins_with DISPATCH# | GSI1 | |
| AP-19 | List scheduled dispatches by date | Status=SCHEDULED, GSI3SK between dates | GSI3 | |
| AP-20 | Get customer by email | GSI1PK=EMAIL#{email} | GSI1 | |
| AP-21 | List all equipment (paginated) | EntityType=EQUIPMENT | GSI2 | sorted by creation |
| AP-22 | List reservations all (admin) | EntityType=RESERVATION | GSI2 | |
| AP-23 | Get kit with all items | PK=KIT#{id} | Main | SK begins_with METADATA or ITEM# |

### Example DynamoDB Items

```json
// Equipment
{
  "PK": "EQUIP#equip_01J9ABC123",
  "SK": "METADATA",
  "GSI1PK": "CATEGORY#cat_staging",
  "GSI1SK": "EQUIP#equip_01J9ABC123",
  "EntityType": "EQUIPMENT",
  "CreatedAt": "2024-01-15T10:00:00Z",
  "id": "equip_01J9ABC123",
  "name": "12x8 Aluminum Stage Deck",
  "description": "Heavy-duty modular stage deck, 12ft x 8ft sections",
  "categoryId": "cat_staging",
  "dailyRate": 150.00,
  "weeklyRate": 750.00,
  "specifications": { "weight": 85, "loadCapacity": 125, "material": "aluminum" },
  "isActive": true,
  "tags": ["stage", "outdoor", "heavy-duty"]
}

// StockUnit
{
  "PK": "EQUIP#equip_01J9ABC123",
  "SK": "UNIT#unit_01J9XYZ789",
  "GSI1PK": "UNIT#unit_01J9XYZ789",
  "GSI1SK": "METADATA",
  "EntityType": "STOCKUNIT",
  "Status": "AVAILABLE",
  "GSI3SK": "EQUIP#equip_01J9ABC123",
  "CreatedAt": "2024-01-15T10:00:00Z",
  "id": "unit_01J9XYZ789",
  "equipmentId": "equip_01J9ABC123",
  "serialNumber": "STG-2024-001",
  "condition": "EXCELLENT",
  "purchaseDate": "2024-01-01",
  "lastMaintenanceDate": "2024-06-01"
}
```

---

## 5. EventBridge Contracts

**Bus name**: `eventgear-{env}` (e.g., `eventgear-dev`)

**Event envelope** — all events share this structure:
```typescript
interface EventGearEvent<T = unknown> {
  source: string;          // e.g., "eventgear.inventory"
  'detail-type': string;   // e.g., "inventory.equipment.created"
  detail: {
    eventId: string;       // ULID
    eventVersion: '1.0';
    timestamp: string;     // ISO 8601
    correlationId: string; // traces a business flow
    payload: T;
  };
}
```

### Inventory Events

```typescript
// inventory.equipment.created
interface EquipmentCreatedPayload {
  equipmentId: string;
  name: string;
  categoryId: string;
  dailyRate: number;
}

// inventory.stockunit.availability-changed
interface StockUnitAvailabilityChangedPayload {
  unitId: string;
  equipmentId: string;
  previousStatus: StockUnitStatus;
  newStatus: StockUnitStatus;
  reason: 'RESERVATION' | 'MAINTENANCE' | 'DAMAGE' | 'MANUAL';
  referenceId?: string; // reservationId or maintenanceRecordId
}

// inventory.maintenance.completed
interface MaintenanceCompletedPayload {
  maintenanceRecordId: string;
  unitId: string;
  equipmentId: string;
  newCondition: EquipmentCondition;
  technicianId: string;
  completedAt: string;
}
```

### Reservation Events

```typescript
// reservations.reservation.confirmed
interface ReservationConfirmedPayload {
  reservationId: string;
  customerId: string;
  startDate: string;   // ISO date "2024-08-15"
  endDate: string;
  items: Array<{
    reservationItemId: string;
    equipmentId: string;
    unitId: string;
    quantity: number;
  }>;
  totalAmount: number;
}

// reservations.conflict.detected
interface ConflictDetectedPayload {
  conflictId: string;
  reservationId: string;
  conflictingReservationId: string;
  equipmentId: string;
  overlapStart: string;
  overlapEnd: string;
  severity: 'WARNING' | 'BLOCKING';
}
```

### Logistics Events

```typescript
// logistics.dispatch.completed
interface DispatchCompletedPayload {
  jobId: string;
  reservationId: string;
  completedAt: string;
  deliveredItems: Array<{ unitId: string; condition: EquipmentCondition }>;
  signedOffBy: string;
}

// logistics.damage.reported
interface DamageReportedPayload {
  reportId: string;
  unitId: string;
  equipmentId: string;
  reservationId: string;
  severity: 'MINOR' | 'MAJOR' | 'TOTAL_LOSS';
  estimatedRepairCost: number;
  description: string;
  photos: string[]; // S3 presigned URLs
}
```

### Billing Events

```typescript
// billing.invoice.paid
interface InvoicePaidPayload {
  invoiceId: string;
  reservationId: string;
  customerId: string;
  amount: number;
  paidAt: string;
  paymentMethod: string;
  transactionId: string;
}
```

---

## 6. Bedrock Agent Design

### Agent Identity
- **Name**: `EventGear Assistant`
- **Model**: `amazon.titan-text-premier-v1:0` (or `anthropic.claude-3-sonnet-20240229-v1:0`)
- **Purpose**: Natural language interface for rental operations. Handles availability queries, quote drafting, conflict resolution suggestions, and policy lookups.

### Action Groups

| Action Group | Lambda Function | Operations |
|---|---|---|
| `CheckAvailability` | `eventgear-ai-availability` | Check equipment availability for date range |
| `ManageReservations` | `eventgear-ai-reservations` | Create draft reservation, get reservation details |
| `GenerateQuote` | `eventgear-ai-billing` | Generate quote from reservation, apply pricing rules |
| `QueryKnowledgeBase` | Bedrock-managed | RAG queries against knowledge base |
| `GetInventoryStatus` | `eventgear-ai-inventory` | Get equipment catalog, stock levels, condition reports |

### Action Group: CheckAvailability
```json
{
  "name": "checkEquipmentAvailability",
  "description": "Check if specific equipment or equipment categories are available for a date range",
  "parameters": {
    "startDate": { "type": "string", "description": "ISO date YYYY-MM-DD" },
    "endDate": { "type": "string", "description": "ISO date YYYY-MM-DD" },
    "equipmentIds": { "type": "array", "description": "Specific equipment IDs to check" },
    "categoryId": { "type": "string", "description": "Check all equipment in a category" },
    "quantityNeeded": { "type": "number", "description": "How many units required" }
  }
}
```

### Knowledge Base Sources
1. **Equipment Catalog** — all equipment descriptions, specifications, use cases, setup requirements
2. **Rental Policies** — pricing rules, damage waivers, cancellation policies, minimum rental durations
3. **Maintenance Documentation** — equipment manuals, service intervals, known issues
4. **Event Planning Guides** — recommended equipment packages by event type and capacity

### Prompt Engineering Notes
- Agent should always confirm dates and quantities before generating quotes
- When conflict detected, suggest alternatives from same category
- Always include policy notes on quotes (damage waiver, delivery lead time)
- If asked about equipment not in catalog, query knowledge base before saying "not available"
- System prompt is in `packages/ai/prompts/system-prompt.md`

---

## 7. RAG Pipeline

### Document Sources
| Source | Format | Update Frequency | Chunking Strategy |
|---|---|---|---|
| Equipment catalog export | JSON → Markdown | Daily sync | Per equipment item |
| Rental policy document | PDF | Manual (on policy change) | Section-based, 512 tokens |
| Maintenance manuals | PDF | Manual (on new equipment) | Page-level, 1024 tokens |
| Event planning guides | Markdown | Monthly | Heading-based |

### Chunking Strategy
- **Equipment catalog**: One chunk per equipment item with all attributes, specifications, and use cases. Template:
  ```
  ## {name}
  Category: {category}
  Daily Rate: ${dailyRate} | Weekly Rate: ${weeklyRate}
  Description: {description}
  Specifications: {specifications as key-value pairs}
  Best for: {useCases}
  Setup requirements: {setupNotes}
  ```
- **Policy documents**: Semantic chunks at section boundaries, max 512 tokens, 10% overlap
- **Manuals**: Page-level chunks with document title + section as metadata

### Retrieval Patterns
- Similarity search (cosine) with `numberOfResults: 5`
- Metadata filters: `documentType` (catalog | policy | manual | guide)
- Queries are augmented with current date and customer context before retrieval

---

## 8. Code Conventions

### File Naming
- **Files**: `kebab-case.ts` (e.g., `base-repository.ts`, `reservation-service.ts`)
- **Types/Interfaces**: PascalCase (e.g., `Equipment`, `ReservationItem`)
- **Constants**: SCREAMING_SNAKE_CASE (e.g., `TABLE_NAME`, `BUS_NAME`)
- **Lambda handlers**: `handler.ts` in each domain root
- **Tests**: `__tests__/` directory, `*.test.ts` suffix

### Domain Folder Structure
```
domains/{domain-name}/
├── SPEC.md              # Feature spec (written BEFORE code)
├── types.ts             # All domain interfaces and enums
├── repository.ts        # DynamoDB access — extends BaseRepository
├── service.ts           # Business logic — pure functions where possible
├── handler.ts           # Lambda entry points
├── events.ts            # Events this domain publishes (typed)
├── validators.ts        # Input validation (zod schemas)
└── __tests__/
    ├── service.test.ts  # Unit tests (mocked repo)
    └── handler.test.ts  # Integration tests (real DynamoDB or test containers)
```

### TypeScript Rules
- **Strict mode always** — `strict: true`, no `any`
- Use `unknown` + type guards instead of `any` for external data
- All DynamoDB records typed with `DynamoRecord<T>` generic
- Repository methods return `Result<T, AppError>` (never throw from business logic)
- Use `zod` for all runtime validation at Lambda entry points
- Prefer `readonly` on domain objects
- ULID for all entity IDs (via `ulid` package): `ulid()` → `"01J9ABC123DEF456GHI789JKL0"`

### Error Handling Pattern
```typescript
// packages/core/src/result.ts
type Result<T, E extends AppError = AppError> =
  | { success: true; data: T }
  | { success: false; error: E };

// Usage in service
async function getEquipment(id: string): Promise<Result<Equipment>> {
  const record = await repository.findById(id);
  if (!record) return { success: false, error: new NotFoundError('Equipment', id) };
  return { success: true, data: record };
}

// Usage in handler
const result = await service.getEquipment(id);
if (!result.success) return errorResponse(result.error);
return successResponse(result.data);
```

### Export Patterns
- Each package/domain has a barrel `index.ts` exporting public API
- Internal helpers prefixed with `_` are NOT exported from index
- Types are always exported from `types.ts`, re-exported from `index.ts`

### Header Comment Block (required on every file)
```typescript
/**
 * @file {filename}
 * @domain {domain name}
 * @purpose {one sentence description}
 *
 * @inputs  {what this module receives}
 * @outputs {what this module produces}
 *
 * @dependencies {key deps}
 * @ai-notes {anything an LLM needs to know to modify this file correctly}
 */
```

---

## 9. Testing Strategy

### Test Pyramid
| Layer | Tool | What's Tested | Location |
|---|---|---|---|
| Unit | Jest | Service business logic, pure functions, validators | `__tests__/service.test.ts` |
| Integration | Jest + `@aws-sdk/client-dynamodb` | Repository methods against local DynamoDB | `__tests__/repository.test.ts` |
| Handler | Jest + mock API Gateway events | Lambda handler routing and response format | `__tests__/handler.test.ts` |
| E2E | Playwright (future) | Critical user flows via real API | `e2e/` |

### Test Fixtures & Factories
```typescript
// packages/core/src/test-factories/
// Each domain has a factory:
import { createEquipmentFactory } from '@eventgear/core/test-factories';
const equipment = createEquipmentFactory({ name: 'Custom Name' });
// Returns full valid Equipment object with sensible defaults + overrides
```

### Running Tests
```bash
# All tests
pnpm test

# Domain-specific
pnpm --filter @eventgear/inventory test

# With coverage
pnpm test:coverage

# Integration tests (requires local DynamoDB)
pnpm test:integration

# Watch mode
pnpm test:watch
```

### Mocking Strategy
- **Unit tests**: Mock the repository with `jest.mock()` — never mock DynamoDB SDK directly
- **Integration tests**: Use `aws-sdk-client-mock` or local DynamoDB via Docker
- **Handler tests**: Use `createMockAPIGatewayEvent()` helper from `@eventgear/core`
- **EventBridge**: Mock the publisher; assert emitted events by inspecting mock calls
- **Never** mock the service in handler tests — test them together with a mocked repo

---

## 10. Terraform Conventions

### Module Interface Pattern
Every Terraform module must have:
- `variables.tf` — all inputs with descriptions and types
- `outputs.tf` — all outputs a consuming module might need
- `main.tf` — resources
- `README.md` (auto-generated via `terraform-docs`)

```hcl
# variables.tf pattern
variable "environment" {
  description = "Deployment environment (dev, staging, prod)"
  type        = string
  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "Environment must be dev, staging, or prod."
  }
}
```

### Remote State
```hcl
# Backend config in each environment
terraform {
  backend "s3" {
    bucket         = "eventgear-terraform-state"
    key            = "{env}/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "eventgear-terraform-locks"
    encrypt        = true
  }
}
```

### Adding a New Lambda
1. Add a `module "lambda_{name}"` block in `environments/{env}/main.tf`
2. Reference the `modules/lambda` module
3. Pass: `function_name`, `handler`, `environment_vars`, `iam_policy_statements`
4. The module handles: IAM role, CloudWatch log group, function resource

### Naming Convention
All resources: `eventgear-{resource}-{env}` (e.g., `eventgear-dynamodb-dev`, `eventgear-api-gw-prod`)

---

## 11. AI Development Workflow

### How to Use Claude Code in This Repo

**Before asking Claude to write code:**
1. Write a SPEC.md in the domain directory (see Section 12)
2. Provide the spec file path: `Read domains/inventory/SPEC.md`
3. Reference this CLAUDE.md: "Follow conventions in CLAUDE.md"

**Effective prompts for this codebase:**
```
"Implement the service layer for the Inventory domain per domains/inventory/SPEC.md.
Follow the Result<T> error pattern from CLAUDE.md Section 8.
Use the DynamoDB access patterns from CLAUDE.md Section 4.
Mock the repository in tests."
```

**Context to always provide:**
- The SPEC.md for the feature being built
- The relevant section of CLAUDE.md (DynamoDB schema for data work, EventBridge contracts for eventing)
- Existing types from `types.ts` if extending a domain

**Slash commands useful in this repo:**
- `/review` — review changed code for convention violations
- `/test` — generate Jest tests for a service or handler file
- `/spec` — generate a SPEC.md from a feature description

**What Claude should NOT do:**
- Add new DynamoDB access patterns without documenting them in `docs/access-patterns.md` first
- Emit EventBridge events not defined in `packages/events/contracts.ts`
- Use `any` type — use `unknown` + type guard or proper interface
- Create new AWS resources in Lambda code — all infra via Terraform

---

## 12. Spec-Driven Development Guide

### Rule: Write SPEC.md BEFORE writing code.

Every feature, endpoint, or significant change starts with a spec. Claude Code should refuse to write implementation code if no spec exists.

### SPEC.md Template

```markdown
# SPEC: {Feature Name}

## Status
DRAFT | IN_REVIEW | APPROVED | IMPLEMENTED

## Problem Statement
What problem are we solving? Who is affected?

## Solution Overview
High-level description of the solution.

## Domain
{inventory | reservations | logistics | billing | ai-assistant}

## Entities Affected
- List entities being created, read, updated, or deleted

## API Endpoints
| Method | Path | Description | Auth |
|---|---|---|---|
| POST | /api/v1/inventory/equipment | Create equipment | ADMIN |

## Request/Response Shapes
```typescript
// POST /api/v1/inventory/equipment
interface CreateEquipmentRequest { ... }
interface CreateEquipmentResponse { ... }
```

## Business Rules
1. Rule 1 (e.g., "Equipment cannot be deleted if active reservations exist")
2. Rule 2

## DynamoDB Access Patterns Used
- AP-01: Get equipment by ID
- AP-XX: New pattern (document in access-patterns.md)

## Events Published
- `inventory.equipment.created` — on successful creation

## Events Consumed
- none

## Error Cases
| Code | Condition | HTTP Status |
|---|---|---|
| EQUIPMENT_NOT_FOUND | equipment ID doesn't exist | 404 |
| DUPLICATE_SERIAL | serial number already registered | 409 |

## Test Cases
- [ ] Happy path: create equipment, verify in DynamoDB
- [ ] Duplicate serial number rejected
- [ ] Missing required fields return 400
- [ ] Unauthorized access returns 401
```

---

## 13. Common Commands

### Development
```bash
# Install all dependencies
pnpm install

# Build all packages
pnpm build

# Build specific package
pnpm --filter @eventgear/core build

# Type check everything
pnpm typecheck

# Lint
pnpm lint

# Format
pnpm format
```

### Testing
```bash
pnpm test                          # all unit tests
pnpm test:watch                    # watch mode
pnpm test:coverage                 # with coverage report
pnpm test:integration              # integration tests (needs local dynamodb)
pnpm --filter @eventgear/inventory test  # single domain
```

### Local Development
```bash
# Start local DynamoDB
docker run -p 8000:8000 amazon/dynamodb-local

# Seed local DynamoDB
pnpm db:seed

# Start frontend dev server
pnpm --filter @eventgear/web dev

# Invoke Lambda locally (via SAM or direct)
pnpm --filter @eventgear/api invoke --function inventory-handler
```

### Terraform
```bash
# Init (first time or new module)
cd infra/terraform/environments/dev && terraform init

# Plan
terraform plan -var-file="dev.tfvars"

# Apply
terraform apply -var-file="dev.tfvars"

# Destroy (dev only)
terraform destroy -var-file="dev.tfvars"

# Format
terraform fmt -recursive

# Validate
terraform validate
```

### Deployment
```bash
# Deploy to dev (via CI or manual)
pnpm deploy:dev

# Deploy specific Lambda
pnpm --filter @eventgear/inventory deploy:dev

# Deploy frontend
pnpm --filter @eventgear/web deploy:dev
```

---

## 14. Glossary

| Term | Definition |
|---|---|
| **Equipment** | A catalog item — a type of equipment available to rent (e.g., "12x8 Stage Deck"). Has a daily rate. |
| **StockUnit** | A physical instance of equipment, tracked by serial number. Has a condition and status. |
| **Kit** | A curated bundle of multiple Equipment items rented together as a package (e.g., "Basic PA System"). |
| **Reservation** | A booking of one or more Equipment items for a date range. Goes through a lifecycle: DRAFT → CONFIRMED → ACTIVE → COMPLETED. |
| **ReservationItem** | A line item within a Reservation, linking a specific StockUnit to the booking. |
| **DispatchJob** | An assignment to deliver or pick up equipment. Created from a confirmed Reservation. Type: DELIVERY or PICKUP. |
| **Quote** | A pricing document generated from a draft Reservation, before confirmation. |
| **Invoice** | The billing document sent to the customer after reservation confirmation. Finalized on return. |
| **Availability Block** | A date range during which a StockUnit is unavailable (reserved, in maintenance, etc.). |
| **Condition** | Physical state of a StockUnit: EXCELLENT, GOOD, FAIR, POOR, NEEDS_REPAIR, RETIRED. |
| **Event Window** | The date range from equipment delivery to equipment return, which is wider than the actual event dates. |
| **Kit** | See above — also called a "Package" in customer-facing UI. |
| **Field Team** | A crew assigned to execute DispatchJobs (delivery/pickup/installation). |
| **Knowledge Base** | The Bedrock-managed vector store containing equipment catalog, policies, and manuals for RAG queries. |
| **Action Group** | A set of Lambda-backed functions that the Bedrock Agent can invoke to take actions (check availability, create reservations). |
| **Access Pattern** | A specific query need that the DynamoDB schema must support. Must be documented before schema design. |
| **Bounded Context** | A DDD concept — a domain with clear ownership of its data and events. In this codebase: Inventory, Reservations, Logistics, Billing, AI Assistant. |
| **ULID** | Universally Unique Lexicographically Sortable Identifier — used for all entity IDs. Sortable, URL-safe, 26 characters. |
| **Result<T>** | The error-handling pattern used throughout: `{ success: true, data: T } \| { success: false, error: AppError }`. Never throw from business logic. |
| **GSI** | Global Secondary Index — DynamoDB indexes that enable additional access patterns beyond the main PK/SK. |
| **Event Envelope** | The standard wrapper around all EventBridge events, containing eventId, timestamp, correlationId, and typed payload. |
