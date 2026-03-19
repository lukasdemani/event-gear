# ADR-001: Single-Table DynamoDB Design

**Status**: Accepted
**Date**: 2024-01-15
**Deciders**: Platform Team

---

## Context

EventGear needs a database that can:
- Scale to unpredictable traffic spikes (large events trigger burst queries)
- Keep operational costs near zero during off-peak periods
- Support complex queries across entities (reservations + equipment + customers)
- Remain serverless — no connection pooling, no cluster management

The bounded context model means each domain has well-known, finite access patterns. We are not building a general-purpose query engine.

## Decision

Use a **single DynamoDB table** (`eventgear-{env}`) for all entities, with access patterns defined upfront and encoded as PK/SK patterns and GSIs.

## Consequences

### Positive
- **No cold starts from DB connections** — DynamoDB HTTP API has no connection state
- **Infinite scale, zero administration** — PAY_PER_REQUEST handles burst events
- **All related data co-located** — reservation + its items in a single partition; single-digit ms reads
- **Cost**: near-zero at low traffic, scales with usage — no reserved capacity needed in early stages

### Negative
- **Access patterns must be known upfront** — adding a new query after table design may require a new GSI (max 20 per table) or application-side filtering
- **No ad-hoc queries** — cannot do arbitrary SQL-like joins; reporting/analytics must go through a separate pipeline (S3 + Athena) or DynamoDB streams → OpenSearch
- **Learning curve** — developers coming from relational background must fully internalize the access-pattern-first design approach

### Mitigations
- All access patterns documented in `docs/access-patterns.md` — required step before writing any repository code
- CLAUDE.md section 4 documents every entity's key patterns
- 3 GSIs cover the main query dimensions: reverse lookup (GSI1), entity-type list (GSI2), status-based (GSI3)
- For analytics: DynamoDB Streams → Lambda → S3 pipeline (future ADR)

## Alternatives Considered

| Option | Rejected Because |
|---|---|
| Aurora Serverless v2 | Minimum cost ~$40/month even at zero traffic; connection limits under burst |
| Multi-table DynamoDB | Transactions across tables need TransactWrite; increases complexity with no benefit at our scale |
| MongoDB Atlas | Operational overhead, cost at scale, not serverless-native |
| RDS PostgreSQL | Connection pooling required (RDS Proxy adds cost and latency); not serverless |
