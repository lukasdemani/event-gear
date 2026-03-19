/**
 * @file date.ts
 * @package @eventgear/core
 * @purpose Date formatting and parsing utilities
 *
 * @ai-notes All dates stored as ISO strings. No Date objects cross domain boundaries.
 * Use ISODateString for date-only (YYYY-MM-DD) and ISODateTimeString for timestamps.
 */
import type { ISODateString, ISODateTimeString } from './types.js';

export function formatDate(date: Date): ISODateString {
  return date.toISOString().split('T')[0] as ISODateString;
}

export function parseDate(isoDate: ISODateString): Date {
  return new Date(`${isoDate}T00:00:00Z`);
}

export function nowISO(): ISODateTimeString {
  return new Date().toISOString();
}

export function todayISO(): ISODateString {
  return formatDate(new Date());
}
