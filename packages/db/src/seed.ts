/**
 * @file seed.ts
 * @package @eventgear/db
 * @purpose Create the DynamoDB table and seed initial inventory data for local dev
 *
 * @inputs  DYNAMODB_TABLE_NAME + DYNAMODB_ENDPOINT env vars (from apps/api/.env.local)
 * @outputs Table created (if not exists) + seed categories + equipment written
 *
 * @ai-notes Run via: pnpm --filter @eventgear/db seed (called from root dev:setup)
 *   Safe to re-run — table creation is idempotent (skips if already exists).
 *   Uses CreateTableCommand directly (not BaseRepository) since it's infra setup.
 */
import {
  CreateTableCommand,
  DescribeTableCommand,
  ResourceInUseException,
} from '@aws-sdk/client-dynamodb';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { getDynamoClient, getDynamoDocumentClient } from './client.js';
import { getTableName } from './schema.js';

// ---------------------------------------------------------------------------
// Table creation
// ---------------------------------------------------------------------------

async function createTable(): Promise<void> {
  const client = getDynamoClient();
  const tableName = getTableName();

  try {
    await client.send(
      new CreateTableCommand({
        TableName: tableName,
        BillingMode: 'PAY_PER_REQUEST',
        AttributeDefinitions: [
          { AttributeName: 'PK', AttributeType: 'S' },
          { AttributeName: 'SK', AttributeType: 'S' },
          { AttributeName: 'GSI1PK', AttributeType: 'S' },
          { AttributeName: 'GSI1SK', AttributeType: 'S' },
          { AttributeName: 'EntityType', AttributeType: 'S' },
          { AttributeName: 'CreatedAt', AttributeType: 'S' },
          { AttributeName: 'Status', AttributeType: 'S' },
          { AttributeName: 'GSI3SK', AttributeType: 'S' },
        ],
        KeySchema: [
          { AttributeName: 'PK', KeyType: 'HASH' },
          { AttributeName: 'SK', KeyType: 'RANGE' },
        ],
        GlobalSecondaryIndexes: [
          {
            IndexName: 'GSI1',
            KeySchema: [
              { AttributeName: 'GSI1PK', KeyType: 'HASH' },
              { AttributeName: 'GSI1SK', KeyType: 'RANGE' },
            ],
            Projection: { ProjectionType: 'ALL' },
          },
          {
            IndexName: 'GSI2',
            KeySchema: [
              { AttributeName: 'EntityType', KeyType: 'HASH' },
              { AttributeName: 'CreatedAt', KeyType: 'RANGE' },
            ],
            Projection: { ProjectionType: 'ALL' },
          },
          {
            IndexName: 'GSI3',
            KeySchema: [
              { AttributeName: 'Status', KeyType: 'HASH' },
              { AttributeName: 'GSI3SK', KeyType: 'RANGE' },
            ],
            Projection: { ProjectionType: 'ALL' },
          },
        ],
      }),
    );
    console.log(`✓ Table "${tableName}" created`);
  } catch (err) {
    if (err instanceof ResourceInUseException) {
      console.log(`✓ Table "${tableName}" already exists — skipping creation`);
      return;
    }
    throw err;
  }

  // Wait for table to become active
  for (let i = 0; i < 20; i++) {
    const desc = await client.send(new DescribeTableCommand({ TableName: tableName }));
    if (desc.Table?.TableStatus === 'ACTIVE') break;
    await new Promise((r) => setTimeout(r, 500));
  }
}

// ---------------------------------------------------------------------------
// Seed data
// ---------------------------------------------------------------------------

const now = new Date().toISOString();

const categories = [
  { id: 'cat_01_staging', name: 'Staging', description: 'Stage decks, platforms, and risers' },
  { id: 'cat_02_audio', name: 'Audio Systems', description: 'PA systems, mixers, and microphones' },
  { id: 'cat_03_lighting', name: 'Lighting', description: 'LED fixtures, moving heads, and consoles' },
  { id: 'cat_04_power', name: 'Power Distribution', description: 'Distros, cables, and generators' },
];

async function seedCategories(): Promise<void> {
  const doc = getDynamoDocumentClient();
  const tableName = getTableName();

  for (const cat of categories) {
    await doc.send(
      new PutCommand({
        TableName: tableName,
        ConditionExpression: 'attribute_not_exists(PK)',
        Item: {
          PK: `CATEGORY#${cat.id}`,
          SK: 'METADATA',
          EntityType: 'CATEGORY',
          CreatedAt: now,
          UpdatedAt: now,
          id: cat.id,
          name: cat.name,
          description: cat.description,
        },
      }),
    ).catch((err: unknown) => {
      if ((err as { name?: string }).name === 'ConditionalCheckFailedException') return;
      throw err;
    });
  }
  console.log(`✓ Seeded ${categories.length} categories`);
}

const equipment = [
  {
    id: 'equip_01_stage_deck',
    name: '12x8 Aluminum Stage Deck',
    description: 'Heavy-duty modular stage deck, 12ft x 8ft sections',
    categoryId: 'cat_01_staging',
    dailyRate: 150,
    weeklyRate: 750,
    isActive: true,
  },
  {
    id: 'equip_02_pa_system',
    name: 'Line Array PA System (8-box)',
    description: 'Professional line array system with dual 18" sub',
    categoryId: 'cat_02_audio',
    dailyRate: 800,
    weeklyRate: 3500,
    isActive: true,
  },
  {
    id: 'equip_03_led_par',
    name: 'LED Par Can (RGBW)',
    description: '150W RGBW LED par fixture with DMX control',
    categoryId: 'cat_03_lighting',
    dailyRate: 35,
    weeklyRate: 150,
    isActive: true,
  },
];

async function seedEquipment(): Promise<void> {
  const doc = getDynamoDocumentClient();
  const tableName = getTableName();

  for (const eq of equipment) {
    await doc.send(
      new PutCommand({
        TableName: tableName,
        ConditionExpression: 'attribute_not_exists(PK)',
        Item: {
          PK: `EQUIP#${eq.id}`,
          SK: 'METADATA',
          GSI1PK: `CATEGORY#${eq.categoryId}`,
          GSI1SK: `EQUIP#${eq.id}`,
          EntityType: 'EQUIPMENT',
          CreatedAt: now,
          UpdatedAt: now,
          ...eq,
        },
      }),
    ).catch((err: unknown) => {
      if ((err as { name?: string }).name === 'ConditionalCheckFailedException') return;
      throw err;
    });
  }
  console.log(`✓ Seeded ${equipment.length} equipment items`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('EventGear — seeding local DynamoDB...');
  await createTable();
  await seedCategories();
  await seedEquipment();
  console.log('Done.');
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
