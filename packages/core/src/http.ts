/**
 * @file http.ts
 * @package @eventgear/core
 * @purpose Lambda HTTP response helpers and test utilities
 *
 * @inputs  Data or AppError + optional status code
 * @outputs API Gateway HTTP API compatible response objects
 *
 * @ai-notes All Lambda handlers should use these helpers for consistent response format.
 * Response body is always JSON. Errors include code + message, never stack traces.
 */
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import type { AppError } from './errors.js';

export function successResponse<T>(data: T, statusCode = 200): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data }),
  };
}

export function errorResponse(error: AppError): APIGatewayProxyResultV2 {
  return {
    statusCode: error.httpStatus,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: error.toJSON() }),
  };
}

export function createMockAPIGatewayEvent(
  overrides: Partial<APIGatewayProxyEventV2> & {
    body?: unknown;
    pathParameters?: Record<string, string>;
    queryStringParameters?: Record<string, string>;
  } = {}
): APIGatewayProxyEventV2 {
  const { body, pathParameters, queryStringParameters, ...rest } = overrides;
  return {
    version: '2.0',
    routeKey: '$default',
    rawPath: '/',
    rawQueryString: '',
    headers: { 'content-type': 'application/json' },
    requestContext: {
      accountId: '123456789012',
      apiId: 'test-api',
      domainName: 'test.execute-api.us-east-1.amazonaws.com',
      domainPrefix: 'test',
      http: {
        method: 'GET',
        path: '/',
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'test',
      },
      requestId: 'test-request-id',
      routeKey: '$default',
      stage: '$default',
      time: '01/Jan/2024:00:00:00 +0000',
      timeEpoch: 1704067200000,
    },
    isBase64Encoded: false,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    pathParameters,
    queryStringParameters,
    ...rest,
  } as APIGatewayProxyEventV2;
}
