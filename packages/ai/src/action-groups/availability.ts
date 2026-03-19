/**
 * @file availability.ts
 * @package @eventgear/ai
 * @purpose Bedrock action group Lambda handler — CheckAvailability action
 *
 * @inputs  Bedrock action group invocation event with startDate, endDate, optional equipmentIds/categoryId
 * @outputs Bedrock-formatted function response with available stock unit list
 *
 * @dependencies @eventgear/db, @eventgear/config
 * @ai-notes This Lambda is registered as the CheckAvailability action group handler in Bedrock.
 *   Input parameters come in as an array of { name, type, value } — must be parsed manually.
 *   Response must conform to Bedrock's function response schema (messageVersion + response wrapper).
 *   Query uses AP-06: Status=AVAILABLE + GSI3SK begins_with EQUIP#{id} for each equipment ID.
 */
import { getDynamoDocumentClient, getTableName, GSI } from '@eventgear/db';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { Handler } from 'aws-lambda';

// ---------------------------------------------------------------------------
// Bedrock action group event / response types
// ---------------------------------------------------------------------------

interface ActionGroupParameter {
  name: string;
  type: string;
  value: string;
}

interface BedrockActionGroupEvent {
  messageVersion: string;
  agent: {
    name: string;
    id: string;
    alias: string;
    version: string;
  };
  inputText: string;
  sessionId: string;
  actionGroup: string;
  function: string;
  parameters?: ActionGroupParameter[];
}

interface AvailableUnit {
  unitId: string;
  equipmentId: string;
  serialNumber: string;
  condition: string;
}

// ---------------------------------------------------------------------------
// Parameter helpers
// ---------------------------------------------------------------------------

function getParam(
  params: ActionGroupParameter[] | undefined,
  name: string,
): string | undefined {
  return params?.find((p) => p.name === name)?.value;
}

function getParamArray(
  params: ActionGroupParameter[] | undefined,
  name: string,
): string[] {
  const raw = getParam(params, name);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]) : [raw];
  } catch {
    return [raw];
  }
}

// ---------------------------------------------------------------------------
// Availability query
// ---------------------------------------------------------------------------

async function getAvailableUnits(equipmentIds: string[]): Promise<AvailableUnit[]> {
  const docClient = getDynamoDocumentClient();
  const tableName = getTableName();
  const results: AvailableUnit[] = [];

  for (const equipmentId of equipmentIds) {
    const response = await docClient.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: GSI.GSI3,
        KeyConditionExpression:
          '#status = :status AND begins_with(#gsi3sk, :prefix)',
        ExpressionAttributeNames: {
          '#status': 'Status',
          '#gsi3sk': 'GSI3SK',
        },
        ExpressionAttributeValues: {
          ':status': 'AVAILABLE',
          ':prefix': `EQUIP#${equipmentId}`,
        },
      }),
    );

    for (const item of response.Items ?? []) {
      if (
        typeof item['id'] === 'string' &&
        typeof item['equipmentId'] === 'string' &&
        typeof item['serialNumber'] === 'string' &&
        typeof item['condition'] === 'string'
      ) {
        results.push({
          unitId: item['id'],
          equipmentId: item['equipmentId'],
          serialNumber: item['serialNumber'],
          condition: item['condition'],
        });
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Lambda handler
// ---------------------------------------------------------------------------

export const handler: Handler<BedrockActionGroupEvent> = async (event) => {
  const { actionGroup, function: fnName, parameters } = event;

  let responseBody: string;

  try {
    const startDate = getParam(parameters, 'startDate') ?? '';
    const endDate = getParam(parameters, 'endDate') ?? '';
    const equipmentIds = getParamArray(parameters, 'equipmentIds');
    const categoryId = getParam(parameters, 'categoryId');
    const quantityNeeded = parseInt(getParam(parameters, 'quantityNeeded') ?? '1', 10);

    if (!startDate || !endDate) {
      responseBody = JSON.stringify({
        error: 'startDate and endDate are required parameters',
      });
    } else if (equipmentIds.length === 0 && !categoryId) {
      responseBody = JSON.stringify({
        error: 'Either equipmentIds or categoryId must be provided',
      });
    } else {
      const availableUnits = await getAvailableUnits(equipmentIds);
      const byEquipment = equipmentIds.map((id) => ({
        equipmentId: id,
        availableCount: availableUnits.filter((u) => u.equipmentId === id).length,
        units: availableUnits
          .filter((u) => u.equipmentId === id)
          .map((u) => ({ unitId: u.unitId, serialNumber: u.serialNumber, condition: u.condition })),
        meetsQuantityRequirement:
          availableUnits.filter((u) => u.equipmentId === id).length >= quantityNeeded,
      }));

      responseBody = JSON.stringify({
        startDate,
        endDate,
        quantityNeeded,
        results: byEquipment,
        summary: `Found ${availableUnits.length} available unit(s) across ${equipmentIds.length} equipment type(s).`,
      });
    }
  } catch (error) {
    responseBody = JSON.stringify({
      error: 'Failed to check availability',
      detail: error instanceof Error ? error.message : 'Unknown error',
    });
  }

  return {
    messageVersion: '1.0',
    response: {
      actionGroup,
      function: fnName,
      functionResponse: {
        responseBody: {
          TEXT: {
            body: responseBody,
          },
        },
      },
    },
  };
};
