/**
 * @file server.ts
 * @purpose Local Express dev server — routes HTTP requests directly to domain services
 *
 * @inputs  Express HTTP requests
 * @outputs JSON responses matching the Lambda handler contract
 *
 * @ai-notes LOCAL DEV ONLY — not deployed. Run with: pnpm dev (from apps/api)
 *   Uses LocalEventPublisher so EventBridge calls are no-ops (logged to console).
 *   Requires DynamoDB Local at DYNAMODB_ENDPOINT (see .env.local).
 */
import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import {
  InventoryRepository,
  InventoryService,
  InventoryEventPublisher,
  createCategorySchema,
  createEquipmentSchema,
  updateEquipmentSchema,
  createStockUnitSchema,
  updateStockUnitStatusSchema,
  createMaintenanceRecordSchema,
  completeMaintenanceSchema,
  paginationSchema,
} from '@eventgear/inventory';
import type { Result } from '@eventgear/core';
import type { AppError } from '@eventgear/core';
import type { EventPublisher } from '@eventgear/events';
import type { EventName } from '@eventgear/events';
import { createAssistantRoute } from './assistant/route.js';

// ---------------------------------------------------------------------------
// Local EventPublisher — logs instead of calling AWS EventBridge
// ---------------------------------------------------------------------------

class LocalEventPublisher {
  async publish<T>(eventName: EventName, payload: T): Promise<void> {
    console.log(`\x1b[36m[event]\x1b[0m ${eventName}`, JSON.stringify(payload, null, 2));
  }

  async publishBatch<T>(
    events: ReadonlyArray<{ eventName: EventName; payload: T; correlationId?: string | undefined }>,
  ): Promise<void> {
    for (const e of events) {
      await this.publish(e.eventName, e.payload);
    }
  }
}

// ---------------------------------------------------------------------------
// Service stack (wired once at startup)
// ---------------------------------------------------------------------------

const repo = new InventoryRepository();
const domainEvents = new InventoryEventPublisher(
  new LocalEventPublisher() as unknown as EventPublisher,
);
const service = new InventoryService(repo, domainEvents);

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

function sendOk<T>(res: Response, data: T, status = 200): void {
  res.status(status).json({ data });
}

function sendFail(res: Response, error: AppError): void {
  res.status(error.httpStatus).json({ error: error.toJSON() });
}

function send<T>(res: Response, result: Result<T>, status = 200): void {
  if (result.success) sendOk(res, result.data, status);
  else sendFail(res, result.error);
}

/** Extract a route param — guaranteed present by Express routing */
function param(req: Request, key: string): string {
  const value = req.params[key];
  if (value === undefined) throw new Error(`Missing route param: ${key}`);
  return value;
}

type AsyncHandler = (req: Request, res: Response) => Promise<void>;

function wrap(fn: AsyncHandler): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res).catch(next);
  };
}

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------

const app = express();
app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json());

// ── Assistant ────────────────────────────────────────────────────────────────
app.post('/assistant/chat', createAssistantRoute(service));

// ── Categories ───────────────────────────────────────────────────────────────

app.get('/inventory/categories', wrap(async (_req, res) => {
  send(res, await service.listCategories());
}));

app.post('/inventory/categories', wrap(async (req, res) => {
  const parsed = createCategorySchema.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: parsed.error.flatten() });
  send(res, await service.createCategory(parsed.data), 201);
}));

// ── Equipment ────────────────────────────────────────────────────────────────

app.get('/inventory/equipment', wrap(async (req, res) => {
  const parsed = paginationSchema.safeParse(req.query);
  if (!parsed.success) return void res.status(400).json({ error: parsed.error.flatten() });
  send(res, await service.listEquipment(parsed.data));
}));

app.post('/inventory/equipment', wrap(async (req, res) => {
  const parsed = createEquipmentSchema.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: parsed.error.flatten() });
  send(res, await service.createEquipment(parsed.data), 201);
}));

app.get('/inventory/equipment/:id', wrap(async (req, res) => {
  send(res, await service.getEquipment(param(req, 'id')));
}));

app.put('/inventory/equipment/:id', wrap(async (req, res) => {
  const parsed = updateEquipmentSchema.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: parsed.error.flatten() });
  send(res, await service.updateEquipment(param(req, 'id'), parsed.data));
}));

// ── Stock Units ───────────────────────────────────────────────────────────────

app.get('/inventory/equipment/:id/units', wrap(async (req, res) => {
  send(res, await service.listStockUnits(param(req, 'id')));
}));

app.post('/inventory/equipment/:id/units', wrap(async (req, res) => {
  const parsed = createStockUnitSchema.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: parsed.error.flatten() });
  send(res, await service.createStockUnit({ ...parsed.data, equipmentId: param(req, 'id') }), 201);
}));

app.patch('/inventory/equipment/:equipmentId/units/:unitId/status', wrap(async (req, res) => {
  const parsed = updateStockUnitStatusSchema.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: parsed.error.flatten() });
  send(res, await service.updateStockUnitStatus(param(req, 'unitId'), parsed.data));
}));

// ── Maintenance ───────────────────────────────────────────────────────────────

app.post('/inventory/maintenance', wrap(async (req, res) => {
  const parsed = createMaintenanceRecordSchema.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: parsed.error.flatten() });
  send(res, await service.createMaintenanceRecord(parsed.data), 201);
}));

app.patch('/inventory/maintenance/:id/complete', wrap(async (req, res) => {
  const parsed = completeMaintenanceSchema.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: parsed.error.flatten() });
  send(res, await service.completeMaintenanceRecord(param(req, 'id'), parsed.data));
}));

app.get('/inventory/equipment/:id/maintenance', wrap(async (req, res) => {
  send(res, await service.getMaintenanceHistory(param(req, 'id')));
}));

// ── Error handler ─────────────────────────────────────────────────────────────

app.use((_err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(_err);
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error' } });
});

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = process.env['PORT'] ?? '3001';

app.listen(PORT, () => {
  console.log(`\x1b[32mEventGear API\x1b[0m → http://localhost:${PORT}`);
  console.log(`DynamoDB       → ${process.env['DYNAMODB_ENDPOINT'] ?? '\x1b[33mAWS (real)\x1b[0m'}`);
  console.log(`EventBridge    → \x1b[33mlocal (console only)\x1b[0m`);
});
