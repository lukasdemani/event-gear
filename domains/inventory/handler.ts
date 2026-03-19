/**
 * @file handler.ts
 * @domain inventory
 * @purpose Lambda entry point — routes API Gateway HTTP events to InventoryService methods
 *
 * @inputs  APIGatewayProxyEventV2 (from API Gateway HTTP API proxy integration)
 * @outputs APIGatewayProxyResultV2 with JSON body (data or error)
 *
 * @dependencies @eventgear/core, @eventgear/events, ./service, ./repository, ./validators
 * @ai-notes Route dispatch uses rawPath + requestContext.http.method.
 *   All validation is done with Zod schemas at this boundary — service receives validated inputs.
 *   Module-level singletons (repo, service) are initialized once per cold start.
 *   To unit test: mock the repository constructor with jest.mock('../repository.js').
 */
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import {
  NotFoundError,
  ValidationError,
  errorResponse,
  successResponse,
} from '@eventgear/core';
import { EventPublisher } from '@eventgear/events';
import { InventoryEventPublisher } from './events.js';
import { InventoryRepository } from './repository.js';
import { InventoryService } from './service.js';
import {
  completeMaintenanceSchema,
  createCategorySchema,
  createEquipmentSchema,
  createMaintenanceRecordSchema,
  createStockUnitSchema,
  paginationSchema,
  updateEquipmentSchema,
  updateStockUnitStatusSchema,
} from './validators.js';
import type { ZodError } from 'zod';

// ---------------------------------------------------------------------------
// Module-level singletons (one per Lambda cold start)
// ---------------------------------------------------------------------------

const repo = new InventoryRepository();
const eventPublisher = new EventPublisher();
const inventoryEvents = new InventoryEventPublisher(eventPublisher);
const service = new InventoryService(repo, inventoryEvents);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseBody(event: APIGatewayProxyEventV2): unknown {
  if (!event.body) return {};
  try {
    return JSON.parse(event.body) as unknown;
  } catch {
    return {};
  }
}

function zodValidationError(zodError: ZodError): ValidationError {
  return new ValidationError(
    'Validation failed',
    zodError.errors.map((e) => ({
      field: e.path.join('.'),
      message: e.message,
    })),
  );
}

// ---------------------------------------------------------------------------
// Lambda handler
// ---------------------------------------------------------------------------

export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const method = event.requestContext.http.method;
  const path = event.rawPath;

  // ── GET /inventory/categories ──────────────────────────────────────────────
  if (path === '/inventory/categories' && method === 'GET') {
    const result = await service.listCategories();
    if (!result.success) return errorResponse(result.error);
    return successResponse(result.data);
  }

  // ── POST /inventory/categories ─────────────────────────────────────────────
  if (path === '/inventory/categories' && method === 'POST') {
    const parsed = createCategorySchema.safeParse(parseBody(event));
    if (!parsed.success) return errorResponse(zodValidationError(parsed.error));
    const result = await service.createCategory(parsed.data);
    if (!result.success) return errorResponse(result.error);
    return successResponse(result.data, 201);
  }

  // ── GET /inventory/equipment ───────────────────────────────────────────────
  if (path === '/inventory/equipment' && method === 'GET') {
    const pagination = paginationSchema.safeParse(
      event.queryStringParameters ?? {},
    );
    if (!pagination.success)
      return errorResponse(zodValidationError(pagination.error));
    const result = await service.listEquipment(pagination.data);
    if (!result.success) return errorResponse(result.error);
    return successResponse(result.data);
  }

  // ── POST /inventory/equipment ──────────────────────────────────────────────
  if (path === '/inventory/equipment' && method === 'POST') {
    const parsed = createEquipmentSchema.safeParse(parseBody(event));
    if (!parsed.success) return errorResponse(zodValidationError(parsed.error));
    const result = await service.createEquipment(parsed.data);
    if (!result.success) return errorResponse(result.error);
    return successResponse(result.data, 201);
  }

  // ── POST /inventory/maintenance ────────────────────────────────────────────
  if (path === '/inventory/maintenance' && method === 'POST') {
    const parsed = createMaintenanceRecordSchema.safeParse(parseBody(event));
    if (!parsed.success) return errorResponse(zodValidationError(parsed.error));
    const result = await service.createMaintenanceRecord(parsed.data);
    if (!result.success) return errorResponse(result.error);
    return successResponse(result.data, 201);
  }

  // ── Routes with equipment ID ───────────────────────────────────────────────
  const equipIdMatch = path.match(/^\/inventory\/equipment\/([^/]+)$/);
  if (equipIdMatch) {
    const equipmentId = equipIdMatch[1] as string;

    if (method === 'GET') {
      const result = await service.getEquipment(equipmentId);
      if (!result.success) return errorResponse(result.error);
      return successResponse(result.data);
    }

    if (method === 'PUT') {
      const parsed = updateEquipmentSchema.safeParse(parseBody(event));
      if (!parsed.success) return errorResponse(zodValidationError(parsed.error));
      const result = await service.updateEquipment(equipmentId, parsed.data);
      if (!result.success) return errorResponse(result.error);
      return successResponse(result.data);
    }
  }

  // ── /inventory/equipment/:id/units ────────────────────────────────────────
  const unitsMatch = path.match(/^\/inventory\/equipment\/([^/]+)\/units$/);
  if (unitsMatch) {
    const equipmentId = unitsMatch[1] as string;

    if (method === 'GET') {
      const result = await service.listStockUnits(equipmentId);
      if (!result.success) return errorResponse(result.error);
      return successResponse(result.data);
    }

    if (method === 'POST') {
      const parsed = createStockUnitSchema.safeParse(parseBody(event));
      if (!parsed.success) return errorResponse(zodValidationError(parsed.error));
      const result = await service.createStockUnit({
        ...parsed.data,
        equipmentId,
      });
      if (!result.success) return errorResponse(result.error);
      return successResponse(result.data, 201);
    }
  }

  // ── PATCH /inventory/equipment/:id/units/:unitId/status ───────────────────
  const statusMatch = path.match(
    /^\/inventory\/equipment\/([^/]+)\/units\/([^/]+)\/status$/,
  );
  if (statusMatch && method === 'PATCH') {
    const unitId = statusMatch[2] as string;
    const parsed = updateStockUnitStatusSchema.safeParse(parseBody(event));
    if (!parsed.success) return errorResponse(zodValidationError(parsed.error));
    const result = await service.updateStockUnitStatus(unitId, parsed.data);
    if (!result.success) return errorResponse(result.error);
    return successResponse(result.data);
  }

  // ── PATCH /inventory/maintenance/:id/complete ─────────────────────────────
  const maintCompleteMatch = path.match(
    /^\/inventory\/maintenance\/([^/]+)\/complete$/,
  );
  if (maintCompleteMatch && method === 'PATCH') {
    const recordId = maintCompleteMatch[1] as string;
    const parsed = completeMaintenanceSchema.safeParse(parseBody(event));
    if (!parsed.success) return errorResponse(zodValidationError(parsed.error));
    const result = await service.completeMaintenanceRecord(recordId, parsed.data);
    if (!result.success) return errorResponse(result.error);
    return successResponse(result.data);
  }

  // ── GET /inventory/equipment/:id/maintenance ──────────────────────────────
  const maintHistMatch = path.match(
    /^\/inventory\/equipment\/([^/]+)\/maintenance$/,
  );
  if (maintHistMatch && method === 'GET') {
    const equipmentId = maintHistMatch[1] as string;
    const result = await service.getMaintenanceHistory(equipmentId);
    if (!result.success) return errorResponse(result.error);
    return successResponse(result.data);
  }

  // ── 404 fallthrough ────────────────────────────────────────────────────────
  return errorResponse(new NotFoundError('Route', `${method} ${path}`));
};
