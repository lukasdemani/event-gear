/**
 * @file handler.test.ts
 * @domain inventory
 * @purpose Handler-level tests — verifies routing, validation, and HTTP response format
 *
 * @ai-notes Tests go through the real handler → real service → mocked repository.
 *   The repository is mocked at the module level with jest.mock().
 *   This validates that: routing works, Zod validation runs, errorResponse shapes are correct.
 *   createMockAPIGatewayEvent from @eventgear/core simplifies event construction.
 */

// Mock the repository module before importing the handler
jest.mock('../repository', () => {
  return {
    InventoryRepository: jest.fn().mockImplementation(() => ({
      findEquipmentById: jest.fn(),
      findEquipmentByCategory: jest.fn(),
      listAllEquipment: jest.fn().mockResolvedValue({ items: [], count: 0 }),
      listCategories: jest.fn().mockResolvedValue([]),
      findStockUnitsByEquipment: jest.fn(),
      findStockUnitById: jest.fn(),
      findAvailableUnitsByEquipment: jest.fn(),
      findMaintenanceHistory: jest.fn(),
      findMaintenanceRecordById: jest.fn(),
      saveEquipment: jest.fn().mockResolvedValue(undefined),
      saveCategory: jest.fn().mockResolvedValue(undefined),
      saveStockUnit: jest.fn().mockResolvedValue(undefined),
      saveMaintenanceRecord: jest.fn().mockResolvedValue(undefined),
    })),
  };
});

// Mock the EventPublisher to prevent real EventBridge calls
jest.mock('@eventgear/events', () => {
  return {
    EventPublisher: jest.fn().mockImplementation(() => ({
      publish: jest.fn().mockResolvedValue(undefined),
      publishBatch: jest.fn().mockResolvedValue(undefined),
    })),
    BUS_NAMES: { main: 'eventgear-test' },
  };
});

// Mock config to avoid requiring real env vars
jest.mock('@eventgear/config', () => ({
  getConfig: jest.fn().mockReturnValue({
    awsRegion: 'us-east-1',
    awsAccountId: '123456789012',
    dynamoTableName: 'eventgear-test',
    eventBridgeBusName: 'eventgear-test',
    jwtSecret: 'test-secret',
    featureAiAssistant: false,
    nodeEnv: 'test',
    logLevel: 'error',
  }),
  resetConfig: jest.fn(),
}));

import { handler } from '../handler';
import { createMockAPIGatewayEvent } from '@eventgear/core';
import { InventoryRepository } from '../repository';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getMockRepo(): jest.Mocked<InstanceType<typeof InventoryRepository>> {
  const MockClass = InventoryRepository as jest.MockedClass<typeof InventoryRepository>;
  const instance = MockClass.mock.instances[0];
  return instance as jest.Mocked<InstanceType<typeof InventoryRepository>>;
}

function parseBody(body: string | undefined): unknown {
  if (!body) return null;
  return JSON.parse(body);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Inventory handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── POST /inventory/equipment ──────────────────────────────────────────────

  describe('POST /inventory/equipment', () => {
    it('returns 201 with valid body', async () => {
      const repo = getMockRepo();
      repo.saveEquipment.mockResolvedValue(undefined);

      const event = createMockAPIGatewayEvent({
        requestContext: {
          http: { method: 'POST', path: '/inventory/equipment' },
        } as never,
        rawPath: '/inventory/equipment',
        body: {
          name: '12x8 Stage Deck',
          categoryId: 'cat_STAGE',
          dailyRate: 150,
        },
      });

      const response = await handler(event);

      expect(response).toMatchObject({ statusCode: 201 });
      const body = parseBody((response as { body: string }).body) as {
        data: { name: string };
      };
      expect(body.data.name).toBe('12x8 Stage Deck');
    });

    it('returns 400 when name is missing', async () => {
      const event = createMockAPIGatewayEvent({
        requestContext: {
          http: { method: 'POST', path: '/inventory/equipment' },
        } as never,
        rawPath: '/inventory/equipment',
        body: {
          categoryId: 'cat_STAGE',
          dailyRate: 150,
          // name is missing
        },
      });

      const response = await handler(event);

      expect(response).toMatchObject({ statusCode: 400 });
      const body = parseBody((response as { body: string }).body) as {
        error: { code: string; context: { validationErrors: unknown[] } };
      };
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.context.validationErrors.length).toBeGreaterThan(0);
    });

    it('returns 400 when dailyRate is negative', async () => {
      const event = createMockAPIGatewayEvent({
        requestContext: {
          http: { method: 'POST', path: '/inventory/equipment' },
        } as never,
        rawPath: '/inventory/equipment',
        body: {
          name: 'Test Equipment',
          categoryId: 'cat_STAGE',
          dailyRate: -50,
        },
      });

      const response = await handler(event);

      expect(response).toMatchObject({ statusCode: 400 });
    });
  });

  // ── GET /inventory/equipment/:id ───────────────────────────────────────────

  describe('GET /inventory/equipment/:id', () => {
    it('returns 200 with equipment when found', async () => {
      const repo = getMockRepo();
      const now = new Date().toISOString();
      repo.findEquipmentById.mockResolvedValue({
        id: 'equip_123',
        name: 'Stage Deck',
        categoryId: 'cat_STAGE',
        dailyRate: 150,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });

      const event = createMockAPIGatewayEvent({
        requestContext: {
          http: { method: 'GET', path: '/inventory/equipment/equip_123' },
        } as never,
        rawPath: '/inventory/equipment/equip_123',
      });

      const response = await handler(event);

      expect(response).toMatchObject({ statusCode: 200 });
      const body = parseBody((response as { body: string }).body) as {
        data: { id: string };
      };
      expect(body.data.id).toBe('equip_123');
    });

    it('returns 404 when equipment is not found', async () => {
      const repo = getMockRepo();
      repo.findEquipmentById.mockResolvedValue(null);

      const event = createMockAPIGatewayEvent({
        requestContext: {
          http: { method: 'GET', path: '/inventory/equipment/equip_MISSING' },
        } as never,
        rawPath: '/inventory/equipment/equip_MISSING',
      });

      const response = await handler(event);

      expect(response).toMatchObject({ statusCode: 404 });
      const body = parseBody((response as { body: string }).body) as {
        error: { code: string };
      };
      expect(body.error.code).toBe('NOT_FOUND');
    });
  });

  // ── PATCH /inventory/equipment/:id/units/:unitId/status ───────────────────

  describe('PATCH /inventory/equipment/:id/units/:unitId/status', () => {
    it('returns 400 when status value is invalid', async () => {
      const event = createMockAPIGatewayEvent({
        requestContext: {
          http: {
            method: 'PATCH',
            path: '/inventory/equipment/equip_123/units/unit_456/status',
          },
        } as never,
        rawPath: '/inventory/equipment/equip_123/units/unit_456/status',
        body: {
          status: 'INVALID_STATUS',
          reason: 'MANUAL',
        },
      });

      const response = await handler(event);

      expect(response).toMatchObject({ statusCode: 400 });
      const body = parseBody((response as { body: string }).body) as {
        error: { code: string };
      };
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when reason is missing', async () => {
      const event = createMockAPIGatewayEvent({
        requestContext: {
          http: {
            method: 'PATCH',
            path: '/inventory/equipment/equip_123/units/unit_456/status',
          },
        } as never,
        rawPath: '/inventory/equipment/equip_123/units/unit_456/status',
        body: {
          status: 'MAINTENANCE',
          // reason is missing
        },
      });

      const response = await handler(event);

      expect(response).toMatchObject({ statusCode: 400 });
    });
  });

  // ── GET /inventory/categories ─────────────────────────────────────────────

  describe('GET /inventory/categories', () => {
    it('returns 200 with categories list', async () => {
      const repo = getMockRepo();
      const now = new Date().toISOString();
      repo.listCategories.mockResolvedValue([
        { id: 'cat_STAGE', name: 'Stages & Risers', createdAt: now, updatedAt: now },
      ]);

      const event = createMockAPIGatewayEvent({
        requestContext: {
          http: { method: 'GET', path: '/inventory/categories' },
        } as never,
        rawPath: '/inventory/categories',
      });

      const response = await handler(event);

      expect(response).toMatchObject({ statusCode: 200 });
      const body = parseBody((response as { body: string }).body) as {
        data: unknown[];
      };
      expect(Array.isArray(body.data)).toBe(true);
    });
  });

  // ── 404 fallthrough ────────────────────────────────────────────────────────

  describe('unknown routes', () => {
    it('returns 404 for unknown paths', async () => {
      const event = createMockAPIGatewayEvent({
        requestContext: {
          http: { method: 'GET', path: '/inventory/unknown-route' },
        } as never,
        rawPath: '/inventory/unknown-route',
      });

      const response = await handler(event);

      expect(response).toMatchObject({ statusCode: 404 });
    });
  });
});
