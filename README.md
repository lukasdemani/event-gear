# EventGear — B2B Equipment Rental Platform

Production-grade equipment rental management for large live events.
Manages the full lifecycle: **Quote → Reservation → Dispatch → Return → Billing**.

## Quick Start

```bash
# Prerequisites: Node.js 20+, pnpm 9+, Docker (for local DynamoDB), AWS CLI

pnpm install
docker run -d -p 8000:8000 amazon/dynamodb-local
pnpm db:seed
pnpm --filter @eventgear/web dev
```

## Documentation

- **[CLAUDE.md](./CLAUDE.md)** — Full architecture context, schema, conventions (start here)
- **[docs/access-patterns.md](./docs/access-patterns.md)** — DynamoDB access patterns
- **[docs/event-catalog.md](./docs/event-catalog.md)** — EventBridge event schemas
- **[docs/adr/](./docs/adr/)** — Architecture Decision Records

## Monorepo Structure

```
eventgear/
├── apps/
│   ├── web/          # React + Vite frontend (S3/CloudFront)
│   └── api/          # Lambda handler entry points
├── packages/
│   ├── core/         # Shared domain models, DTOs, errors, test factories
│   ├── db/           # DynamoDB client, repository base, single-table schema
│   ├── events/       # EventBridge publisher, typed event contracts
│   ├── ai/           # Bedrock Agent client, RAG utilities
│   └── config/       # Env vars, constants, feature flags
├── domains/
│   ├── inventory/    # Equipment catalog, stock units, conditions
│   ├── reservations/ # Booking lifecycle, conflict detection
│   ├── logistics/    # Dispatch, field teams, returns
│   ├── billing/      # Quotes, invoices, payments
│   └── ai-assistant/ # Bedrock Agent surface, natural language ops
├── infra/
│   └── terraform/    # All infrastructure as code
└── docs/
    ├── adr/          # Architecture Decision Records
    ├── access-patterns.md
    └── event-catalog.md
```

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, TypeScript, hosted on S3+CloudFront |
| Backend | AWS Lambda (Node.js 20.x), API Gateway HTTP API |
| Database | DynamoDB (single-table design) |
| Eventing | EventBridge (event-driven bounded contexts) |
| AI | AWS Bedrock Agents + Knowledge Bases (RAG) |
| IaC | Terraform (modules pattern, S3+DynamoDB remote state) |
| Testing | Jest (unit + integration) |
| CI/CD | GitHub Actions |

## Bounded Contexts

| Domain | Responsibility |
|---|---|
| **Inventory** | Equipment catalog, stock levels, condition tracking, maintenance |
| **Reservations** | Booking lifecycle, conflict detection, availability calendar |
| **Logistics** | Dispatch planning, field teams, return workflows |
| **Billing** | Quotes, invoices, payment tracking, pricing rules |
| **AI Assistant** | Natural language interface via Bedrock Agents + RAG |

## Development Workflow

1. Write a `SPEC.md` in the target domain directory
2. Review with the team / get approval
3. Implement following conventions in [CLAUDE.md](./CLAUDE.md)
4. All PRs require passing tests and type checks

See [CLAUDE.md §11](./CLAUDE.md) for the full AI-assisted development workflow.
