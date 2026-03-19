/**
 * @file schema.ts
 * @package @eventgear/db
 * @purpose Table name constant, entity type enum, GSI names, and typed DynamoDB key builders
 *
 * @inputs  Entity IDs (equipmentId, categoryId, unitId, etc.)
 * @outputs DynamoDB key objects (PK/SK/GSI fields) for all entity types
 *
 * @dependencies @eventgear/config
 * @ai-notes buildKey builders produce ONLY the key fields.
 *   Repositories combine these with domain entity fields when writing.
 *   Always use buildKey — never hardcode key prefixes elsewhere.
 *   TABLE_NAME is read lazily from config — do not cache at import time in tests.
 */
import { getConfig } from '@eventgear/config';

export function getTableName(): string {
  return getConfig().dynamoTableName;
}

/** Re-exported as TABLE_NAME for convenience; calls getConfig() at usage time */
export const TABLE_NAME: string = getTableName();

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export enum EntityType {
  EQUIPMENT = 'EQUIPMENT',
  STOCKUNIT = 'STOCKUNIT',
  CATEGORY = 'CATEGORY',
  RESERVATION = 'RESERVATION',
  RESERVATION_ITEM = 'RESERVATION_ITEM',
  MAINTENANCE_RECORD = 'MAINTENANCE_RECORD',
  INVOICE = 'INVOICE',
  DISPATCH_JOB = 'DISPATCH_JOB',
  KIT = 'KIT',
  KIT_ITEM = 'KIT_ITEM',
}

export enum GSI {
  GSI1 = 'GSI1',
  GSI2 = 'GSI2',
  GSI3 = 'GSI3',
}

// ---------------------------------------------------------------------------
// Key builders — one sub-object per entity type
// ---------------------------------------------------------------------------

export const buildKey = {
  equipment: {
    /** Main table key — PK=EQUIP#{id}, SK=METADATA */
    main: (equipmentId: string) => ({
      PK: `EQUIP#${equipmentId}`,
      SK: 'METADATA',
    }),
    /** GSI1 — enables AP-02: list equipment in category */
    gsi1: (categoryId: string, equipmentId: string) => ({
      GSI1PK: `CATEGORY#${categoryId}`,
      GSI1SK: `EQUIP#${equipmentId}`,
    }),
  },

  stockUnit: {
    /** Main table key — PK=EQUIP#{equipmentId}, SK=UNIT#{unitId} */
    main: (equipmentId: string, unitId: string) => ({
      PK: `EQUIP#${equipmentId}`,
      SK: `UNIT#${unitId}`,
    }),
    /** GSI1 — enables AP-05: get stock unit by unit ID */
    gsi1: (unitId: string) => ({
      GSI1PK: `UNIT#${unitId}`,
      GSI1SK: 'METADATA',
    }),
    /** GSI3 sort key — used with Status=AVAILABLE for AP-06 */
    gsi3: (equipmentId: string) => ({
      GSI3SK: `EQUIP#${equipmentId}`,
    }),
  },

  category: {
    /** Main table key — PK=CATEGORY#{id}, SK=METADATA */
    main: (categoryId: string) => ({
      PK: `CATEGORY#${categoryId}`,
      SK: 'METADATA',
    }),
  },

  maintenanceRecord: {
    /** Main table key — PK=EQUIP#{id}, SK=MAINTENANCE#{ts}#{recordId} */
    main: (equipmentId: string, timestamp: string, recordId: string) => ({
      PK: `EQUIP#${equipmentId}`,
      SK: `MAINTENANCE#${timestamp}#${recordId}`,
    }),
    /** GSI1 — enables AP-14: get maintenance records for a stock unit */
    gsi1: (unitId: string, timestamp: string) => ({
      GSI1PK: `UNIT#${unitId}`,
      GSI1SK: `MAINTENANCE#${timestamp}`,
    }),
    /** GSI3 sort key — enables status + date queries */
    gsi3: (equipmentId: string, timestamp: string) => ({
      GSI3SK: `${equipmentId}#${timestamp}`,
    }),
  },

  reservation: {
    /** Main table key */
    main: (reservationId: string) => ({
      PK: `RESERVATION#${reservationId}`,
      SK: 'METADATA',
    }),
    /** GSI1 — enables AP-09: list reservations for customer */
    gsi1: (customerId: string, reservationId: string) => ({
      GSI1PK: `CUSTOMER#${customerId}`,
      GSI1SK: `RESERVATION#${reservationId}`,
    }),
    /** GSI3 sort key — enables AP-10: list confirmed reservations by date */
    gsi3: (startDate: string, reservationId: string) => ({
      GSI3SK: `${startDate}#${reservationId}`,
    }),
  },

  reservationItem: {
    /** Main table key — PK=RESERVATION#{id}, SK=ITEM#{itemId} */
    main: (reservationId: string, itemId: string) => ({
      PK: `RESERVATION#${reservationId}`,
      SK: `ITEM#${itemId}`,
    }),
    /** GSI1 — enables AP-12: check equipment across reservations */
    gsi1: (equipmentId: string, reservationId: string, itemId: string) => ({
      GSI1PK: `EQUIP#${equipmentId}`,
      GSI1SK: `RESERVATION#${reservationId}#ITEM#${itemId}`,
    }),
  },

  customer: {
    /** Main table key */
    main: (customerId: string) => ({
      PK: `CUSTOMER#${customerId}`,
      SK: 'METADATA',
    }),
    /** GSI1 — enables AP-20: get customer by email */
    gsi1ByEmail: (email: string, customerId: string) => ({
      GSI1PK: `EMAIL#${email}`,
      GSI1SK: `CUSTOMER#${customerId}`,
    }),
  },

  invoice: {
    /** Main table key */
    main: (invoiceId: string) => ({
      PK: `INVOICE#${invoiceId}`,
      SK: 'METADATA',
    }),
    /** GSI1 — enables AP-15: list invoices for customer */
    gsi1Customer: (customerId: string, invoiceId: string) => ({
      GSI1PK: `CUSTOMER#${customerId}`,
      GSI1SK: `INVOICE#${invoiceId}`,
    }),
    /** GSI1 — enables AP-16: get invoice for reservation */
    gsi1Reservation: (reservationId: string, invoiceId: string) => ({
      GSI1PK: `RESERVATION#${reservationId}`,
      GSI1SK: `INVOICE#${invoiceId}`,
    }),
    /** GSI3 sort key — enables AP-17: list overdue invoices by due date */
    gsi3: (dueDate: string, invoiceId: string) => ({
      GSI3SK: `${dueDate}#${invoiceId}`,
    }),
  },

  dispatchJob: {
    /** Main table key */
    main: (jobId: string) => ({
      PK: `DISPATCH#${jobId}`,
      SK: 'METADATA',
    }),
    /** GSI1 — enables AP-18: get dispatch jobs for reservation */
    gsi1: (reservationId: string, jobId: string) => ({
      GSI1PK: `RESERVATION#${reservationId}`,
      GSI1SK: `DISPATCH#${jobId}`,
    }),
    /** GSI3 sort key — enables AP-19: list scheduled dispatches by date */
    gsi3: (scheduledDate: string, jobId: string) => ({
      GSI3SK: `${scheduledDate}#${jobId}`,
    }),
  },

  kit: {
    /** Main table key for Kit metadata */
    main: (kitId: string) => ({
      PK: `KIT#${kitId}`,
      SK: 'METADATA',
    }),
    /** SK for a KitItem within a Kit */
    item: (kitId: string, equipmentId: string) => ({
      PK: `KIT#${kitId}`,
      SK: `ITEM#${equipmentId}`,
    }),
  },
} as const;
