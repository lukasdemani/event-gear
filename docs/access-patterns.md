# DynamoDB Access Patterns

> **Rule**: Document the access pattern here BEFORE writing any DynamoDB query code.
> Pattern IDs are referenced in SPEC.md files and in repository method docblocks.

Table: `eventgear-{env}` | Keys: PK (String), SK (String)

## Defined Patterns

| ID | Description | Key Condition | Index | Sort | Notes |
|---|---|---|---|---|---|
| AP-01 | Get equipment by ID | PK=`EQUIP#{id}`, SK=`METADATA` | Main | — | Single item |
| AP-02 | List equipment in category | GSI1PK=`CATEGORY#{id}` | GSI1 | GSI1SK asc | Paginated |
| AP-03 | List all categories | EntityType=`CATEGORY` | GSI2 | CreatedAt asc | |
| AP-04 | Get all stock units for equipment | PK=`EQUIP#{id}`, SK begins_with `UNIT#` | Main | SK asc | |
| AP-05 | Get stock unit by unit ID | GSI1PK=`UNIT#{unitId}`, GSI1SK=`METADATA` | GSI1 | — | Single item |
| AP-06 | Get available stock units by equipment | Status=`AVAILABLE`, GSI3SK begins_with `EQUIP#{id}` | GSI3 | — | Filter by equipment |
| AP-07 | Get reservation by ID | PK=`RESERVATION#{id}`, SK=`METADATA` | Main | — | Single item |
| AP-08 | Get all items in reservation | PK=`RESERVATION#{id}`, SK begins_with `ITEM#` | Main | SK asc | |
| AP-09 | List reservations for customer | GSI1PK=`CUSTOMER#{id}`, GSI1SK begins_with `RESERVATION#` | GSI1 | GSI1SK asc | Paginated |
| AP-10 | List confirmed reservations by start date | Status=`CONFIRMED`, GSI3SK between dates | GSI3 | GSI3SK asc | Date format: `YYYY-MM-DD#{id}` |
| AP-11 | List active reservations | Status=`ACTIVE` | GSI3 | GSI3SK asc | |
| AP-12 | Check equipment bookings (conflict detection) | GSI1PK=`EQUIP#{id}`, GSI1SK begins_with `RESERVATION#` | GSI1 | — | Filter on dates in app layer |
| AP-13 | Get maintenance history for equipment | PK=`EQUIP#{id}`, SK begins_with `MAINTENANCE#` | Main | SK desc | Newest first |
| AP-14 | Get maintenance records for a unit | GSI1PK=`UNIT#{unitId}`, GSI1SK begins_with `MAINTENANCE#` | GSI1 | GSI1SK desc | |
| AP-15 | List invoices for customer | GSI1PK=`CUSTOMER#{id}`, GSI1SK begins_with `INVOICE#` | GSI1 | GSI1SK asc | |
| AP-16 | Get invoice for reservation | GSI1PK=`RESERVATION#{id}`, GSI1SK begins_with `INVOICE#` | GSI1 | — | |
| AP-17 | List overdue invoices | Status=`OVERDUE` | GSI3 | GSI3SK asc | GSI3SK = `{dueDate}#{id}` |
| AP-18 | Get dispatch jobs for reservation | GSI1PK=`RESERVATION#{id}`, GSI1SK begins_with `DISPATCH#` | GSI1 | — | |
| AP-19 | List scheduled dispatches by date | Status=`SCHEDULED`, GSI3SK between dates | GSI3 | GSI3SK asc | |
| AP-20 | Get customer by email | GSI1PK=`EMAIL#{email}`, GSI1SK begins_with `CUSTOMER#` | GSI1 | — | |
| AP-21 | List all equipment paginated | EntityType=`EQUIPMENT` | GSI2 | CreatedAt asc | Admin list |
| AP-22 | List all reservations paginated | EntityType=`RESERVATION` | GSI2 | CreatedAt desc | Admin list |
| AP-23 | Get kit with all items | PK=`KIT#{id}` | Main | SK (all) | Returns METADATA + all ITEM# records |

## Adding a New Pattern

1. Assign the next AP-XX ID
2. Add a row to the table above
3. Document in the relevant domain SPEC.md
4. Implement in the domain's `repository.ts`
5. Reference the AP-ID in the method's JSDoc `@accessPattern` tag

## Sort Key Composite Values

For GSI3SK (Status-based queries), sort keys use the format:
```
Reservations: {startDate}#{reservationId}        e.g., "2024-08-15#01J9ABC..."
Invoices:     {dueDate}#{invoiceId}               e.g., "2024-09-01#01J9XYZ..."
Dispatches:   {scheduledDate}#{jobId}             e.g., "2024-08-14#01J9DEF..."
```

Date format is always ISO `YYYY-MM-DD` to ensure correct lexicographic sort order.
