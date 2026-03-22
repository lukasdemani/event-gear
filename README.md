# EventGear — B2B Equipment Rental Platform

> **Work in progress.** The Inventory domain is fully implemented. Reservations, Logistics, Billing, and production infra are planned but not yet built.

B2B SaaS platform for equipment rental companies serving large live events.
Manages the full rental lifecycle: **Quote → Reservation → Dispatch → Return → Billing**.

## Demo

![EventGear conversational assistant — natural language inventory management](docs/agent-demo.gif)

## Quick Start

```bash
# Prerequisites: Node.js 20+, pnpm 9+, Docker

pnpm install
pnpm dev          # starts DynamoDB (Docker), seeds data, API server + web app
```

Open [http://localhost:5173](http://localhost:5173).

**Required env var** — copy the example and add your Anthropic API key to enable the in-app assistant:

```bash
cp apps/api/.env.local.example apps/api/.env.local
# edit apps/api/.env.local → set ANTHROPIC_API_KEY=sk-ant-...
```

## What's Built

| Feature | Status |
|---|---|
| Inventory — categories, equipment, stock units, maintenance | Done |
| In-app conversational assistant (Claude API + tool use) | Done |
| Reservations, Logistics, Billing domains | Planned |
| Production infra (Lambda, API Gateway, CloudFront, Terraform) | Planned |

## Documentation

- **[CLAUDE.md](./CLAUDE.md)** — Full architecture context, schema, conventions (start here)
- **[docs/access-patterns.md](./docs/access-patterns.md)** — DynamoDB access patterns
- **[docs/event-catalog.md](./docs/event-catalog.md)** — EventBridge event schemas
- **[docs/adr/](./docs/adr/)** — Architecture Decision Records

## Monorepo Structure

```
eventgear/
├── apps/
│   ├── web/          # React + Vite frontend
│   └── api/          # Express dev server (production target: Lambda)
├── packages/
│   ├── core/         # Shared domain models, DTOs, errors, test factories
│   ├── db/           # DynamoDB client, repository base, single-table schema
│   ├── events/       # EventBridge publisher, typed event contracts
│   ├── ai/           # AI utilities
│   └── config/       # Env vars, constants, feature flags
├── domains/
│   ├── inventory/    # Equipment catalog, stock units, conditions ✅
│   ├── reservations/ # Booking lifecycle, conflict detection (planned)
│   ├── logistics/    # Dispatch, field teams, returns (planned)
│   ├── billing/      # Quotes, invoices, payments (planned)
│   └── ai-assistant/ # Natural language ops (planned)
├── infra/
│   └── terraform/    # Infrastructure as code (planned)
└── docs/
    ├── adr/          # Architecture Decision Records
    ├── access-patterns.md
    └── event-catalog.md
```

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, TypeScript, Tailwind CSS |
| Backend (dev) | Express.js (Node.js 20.x) |
| Backend (prod target) | AWS Lambda + API Gateway HTTP API |
| Database | DynamoDB Local (dev) / AWS DynamoDB (prod) |
| AI Assistant | Claude API (`claude-opus-4-6`) with tool use |
| IaC | Terraform (planned) |

## Development Workflow

1. Write a `SPEC.md` in the target domain directory
2. Review with the team / get approval
3. Implement following conventions in [CLAUDE.md](./CLAUDE.md)
4. All PRs require passing tests and type checks

See [CLAUDE.md §11](./CLAUDE.md) for the full AI-assisted development workflow.
