/**
 * @file api-client.ts
 * @purpose Typed fetch wrapper and all inventory API endpoint functions
 *
 * @inputs  API path + request options
 * @outputs ApiResult<T> — never throws, always returns ok/error shape
 *
 * @ai-notes __API_BASE_URL__ is injected by Vite at build time (see vite.config.ts).
 *   All responses follow { data } or { error } shape from the Express server.
 *   Network errors are caught and returned as NETWORK_ERROR result.
 */
import type {
  Category,
  Equipment,
  StockUnit,
  MaintenanceRecord,
  PaginatedResult,
  CreateCategoryInput,
  CreateEquipmentInput,
  UpdateEquipmentInput,
  CreateStockUnitInput,
  UpdateStockUnitStatusInput,
  CreateMaintenanceRecordInput,
  CompleteMaintenanceInput,
} from './types';

// ---------------------------------------------------------------------------
// Core result type
// ---------------------------------------------------------------------------

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

// ---------------------------------------------------------------------------
// Fetch wrapper
// ---------------------------------------------------------------------------

async function apiFetch<T>(path: string, options?: RequestInit): Promise<ApiResult<T>> {
  const base = __API_BASE_URL__ || 'http://localhost:3001';
  try {
    const res = await fetch(`${base}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    const json = (await res.json()) as unknown;
    if (!res.ok) {
      const errBody = json as { error?: { code?: string; message?: string } };
      return {
        ok: false,
        error: {
          code: errBody.error?.code ?? 'API_ERROR',
          message: errBody.error?.message ?? `HTTP ${res.status}`,
        },
      };
    }
    const body = json as { data: T };
    return { ok: true, data: body.data };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Network request failed';
    return { ok: false, error: { code: 'NETWORK_ERROR', message } };
  }
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export async function listCategories(): Promise<ApiResult<Category[]>> {
  return apiFetch<Category[]>('/inventory/categories');
}

export async function createCategory(input: CreateCategoryInput): Promise<ApiResult<Category>> {
  return apiFetch<Category>('/inventory/categories', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

// ---------------------------------------------------------------------------
// Equipment
// ---------------------------------------------------------------------------

export async function listEquipment(params?: {
  limit?: number;
  nextToken?: string;
}): Promise<ApiResult<PaginatedResult<Equipment>>> {
  const qs = new URLSearchParams();
  if (params?.limit !== undefined) qs.set('limit', String(params.limit));
  if (params?.nextToken !== undefined) qs.set('nextToken', params.nextToken);
  const query = qs.toString();
  return apiFetch<PaginatedResult<Equipment>>(
    `/inventory/equipment${query ? `?${query}` : ''}`,
  );
}

export async function getEquipment(id: string): Promise<ApiResult<Equipment>> {
  return apiFetch<Equipment>(`/inventory/equipment/${id}`);
}

export async function createEquipment(input: CreateEquipmentInput): Promise<ApiResult<Equipment>> {
  return apiFetch<Equipment>('/inventory/equipment', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateEquipment(
  id: string,
  input: UpdateEquipmentInput,
): Promise<ApiResult<Equipment>> {
  return apiFetch<Equipment>(`/inventory/equipment/${id}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

// ---------------------------------------------------------------------------
// Stock Units
// ---------------------------------------------------------------------------

export async function listStockUnits(equipmentId: string): Promise<ApiResult<StockUnit[]>> {
  return apiFetch<StockUnit[]>(`/inventory/equipment/${equipmentId}/units`);
}

export async function createStockUnit(
  equipmentId: string,
  input: CreateStockUnitInput,
): Promise<ApiResult<StockUnit>> {
  return apiFetch<StockUnit>(`/inventory/equipment/${equipmentId}/units`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateUnitStatus(
  equipmentId: string,
  unitId: string,
  input: UpdateStockUnitStatusInput,
): Promise<ApiResult<StockUnit>> {
  return apiFetch<StockUnit>(
    `/inventory/equipment/${equipmentId}/units/${unitId}/status`,
    {
      method: 'PATCH',
      body: JSON.stringify(input),
    },
  );
}

// ---------------------------------------------------------------------------
// Maintenance
// ---------------------------------------------------------------------------

export async function getMaintenanceHistory(
  equipmentId: string,
): Promise<ApiResult<MaintenanceRecord[]>> {
  return apiFetch<MaintenanceRecord[]>(`/inventory/equipment/${equipmentId}/maintenance`);
}

export async function createMaintenanceRecord(
  input: CreateMaintenanceRecordInput,
): Promise<ApiResult<MaintenanceRecord>> {
  return apiFetch<MaintenanceRecord>('/inventory/maintenance', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function completeMaintenance(
  recordId: string,
  input: CompleteMaintenanceInput,
): Promise<ApiResult<MaintenanceRecord>> {
  return apiFetch<MaintenanceRecord>(`/inventory/maintenance/${recordId}/complete`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}
