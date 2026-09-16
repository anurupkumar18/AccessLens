import type { z } from 'zod';
import type { ApiEvent, ApiResult } from './types';
import type { RouteSpec } from '../shared/api';

type APIGatewayProxyEventV2 = ApiEvent;
type APIGatewayProxyResultV2 = ApiResult;

export class ApiHttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly slideId?: string,
  ) {
    super(message);
    this.name = 'ApiHttpError';
  }
}

export function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  };
}

/** Validate every success payload at the contract boundary before serializing it. */
export function respond<T extends z.ZodTypeAny>(
  route: RouteSpec,
  body: unknown,
  statusCode = route.successStatus,
): APIGatewayProxyResultV2 {
  const parsed = route.response.safeParse(body);
  if (!parsed.success) {
    console.error('response_contract_violation', {
      operationId: route.operationId,
      issues: parsed.error.issues,
    });
    return json(500, {
      error: {
        code: 'response_contract_violation',
        message: 'The service produced a response outside the API contract.',
      },
    });
  }
  return json(statusCode, parsed.data);
}

export function errorResponse(error: unknown): APIGatewayProxyResultV2 {
  if (error instanceof ApiHttpError) {
    return json(error.statusCode, {
      error: {
        code: error.code,
        message: error.message,
        ...(error.slideId ? { slideId: error.slideId } : {}),
      },
    });
  }

  if (error instanceof SyntaxError) {
    return json(400, {
      error: { code: 'invalid_json', message: 'Request body must be valid JSON.' },
    });
  }

  console.error('api_pipeline_failure', error);
  return json(500, {
    error: { code: 'pipeline_failure', message: 'The authoring service could not complete the request.' },
  });
}

export function parseJsonBody(event: APIGatewayProxyEventV2): unknown {
  if (!event.body) return undefined;
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;
  try {
    return JSON.parse(raw);
  } catch {
    throw new SyntaxError('invalid JSON');
  }
}

export function pathParameter(event: APIGatewayProxyEventV2, name: string): string {
  const value = event.pathParameters?.[name];
  if (!value) throw new ApiHttpError(400, 'missing_path_parameter', `Path parameter ${name} is required.`);
  return value;
}

export function parseRequest<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiHttpError(400, 'invalid_request', parsed.error.issues.map(issue => issue.message).join('; '));
  }
  return parsed.data;
}

export function withErrors(handler: (event: APIGatewayProxyEventV2) => Promise<APIGatewayProxyResultV2>) {
  return async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
    try {
      return await handler(event);
    } catch (error) {
      return errorResponse(error);
    }
  };
}
