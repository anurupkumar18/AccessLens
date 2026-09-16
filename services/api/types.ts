import type { z } from 'zod';
import type { RouteSpec } from '../shared/api';

/** HTTP API v2 fields consumed by this service. Kept local so Lambda bundles do not need a type-only AWS package. */
export interface ApiEvent {
  readonly body?: string;
  readonly isBase64Encoded?: boolean;
  readonly pathParameters?: Record<string, string | undefined>;
  readonly headers?: Record<string, string | undefined>;
  readonly requestContext?: {
    readonly http?: { readonly method?: string; readonly path?: string };
    /** Claims the HTTP API JWT authorizer verified and forwarded (Google ID token, D12). */
    readonly authorizer?: { readonly jwt?: { readonly claims?: Record<string, unknown> } };
  };
}
export interface ApiResult {
  readonly statusCode: number;
  readonly headers?: Record<string, string>;
  readonly body?: string;
  readonly isBase64Encoded?: boolean;
}

export type OperationHandler = (event: ApiEvent) => Promise<ApiResult>;

export interface RouteDependencies {
  readonly route: RouteSpec;
  readonly handler: OperationHandler;
}

export type ParsedBody<T extends z.ZodTypeAny> = z.infer<T>;
