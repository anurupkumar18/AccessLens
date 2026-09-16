import { z } from 'zod';
import { ROUTES, type RouteSpec } from '../shared/api';

export interface OpenApiDocument {
  openapi: '3.1.0';
  info: { title: string; version: string; description: string };
  servers: { url: string; description: string }[];
  security: { bearerAuth: [] }[];
  paths: Record<string, Record<string, unknown>>;
  components: {
    securitySchemes: { bearerAuth: { type: 'http'; scheme: 'bearer'; bearerFormat: 'opaque deployment token' } };
    schemas: Record<string, unknown>;
  };
}

const schemaNames = new Map<string, string>();

/**
 * Render the same route table used by the handlers as an OpenAPI 3.1 document.
 * Zod 4 owns the conversion for the complete shared contract; this module only
 * removes the standalone JSON-Schema dialect marker before embedding fragments.
 */
export function renderOpenApi(routes: readonly RouteSpec[] = ROUTES): OpenApiDocument {
  schemaNames.clear();
  const schemas: Record<string, unknown> = {};
  const paths: OpenApiDocument['paths'] = {};

  for (const route of routes) {
    const pathItem = paths[route.path] ?? {};
    const operation: Record<string, unknown> = {
      operationId: route.operationId,
      summary: route.summary,
      security: [{ bearerAuth: [] }],
      responses: {
        [String(route.successStatus)]: {
          description: 'Successful response',
          content: {
            'application/json': {
              schema: schemaReference(route.response, `${route.operationId}Response`, schemas, 'output'),
            },
          },
        },
        '400': { description: 'Invalid request', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } } },
        '401': { description: 'Missing or invalid bearer token' },
        '500': { description: 'Pipeline failure', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } } },
        '501': { description: 'Milestone not implemented', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } } },
      },
    };

    const parameters = pathParameters(route.path);
    if (parameters.length > 0) {
      operation.parameters = parameters.map(name => ({ name, in: 'path', required: true, schema: { type: 'string' } }));
    }
    if (route.request) {
      operation.requestBody = {
        required: true,
        content: {
          'application/json': {
            schema: schemaReference(route.request, `${route.operationId}Request`, schemas, 'input'),
          },
        },
      };
    }
    pathItem[route.method.toLowerCase()] = operation;
    paths[route.path] = pathItem;
  }

  // Errors are used by every route and are explicitly part of the shared API.
  schemas.ApiError = cleanJsonSchema(z.toJSONSchema(
    // Imported lazily to keep this module's route walk easy to inspect.
    // eslint is not configured in this repository, so this is intentionally direct.
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    apiErrorSchema,
    { io: 'output' },
  ));

  return {
    openapi: '3.1.0',
    info: {
      title: 'AccessLens Authoring API',
      version: '1.0.0',
      description: 'HTTP API for instructor uploads, authoring jobs, review, and published Access Packs.',
    },
    servers: [{ url: 'https://{apiId}.execute-api.{region}.amazonaws.com', description: 'Deployed API Gateway HTTP API' }],
    security: [{ bearerAuth: [] }],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'opaque deployment token' },
      },
      schemas,
    },
  };
}

// Importing this separately would create a second contract source. It is
// declared here only to keep `ApiError` in the generated component set.
import { ApiErrorSchema as apiErrorSchema } from '../shared/api';

function schemaReference(schema: z.ZodTypeAny, name: string, schemas: Record<string, unknown>, io: 'input' | 'output') {
  const existing = schemaNames.get(name);
  if (!existing) {
    schemaNames.set(name, name);
    schemas[name] = cleanJsonSchema(z.toJSONSchema(schema, { io }));
  }
  return { $ref: `#/components/schemas/${name}` };
}

function cleanJsonSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(cleanJsonSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === '$schema') continue;
    output[key] = cleanJsonSchema(value);
  }
  return output;
}

function pathParameters(path: string): string[] {
  return [...path.matchAll(/\{([^}]+)\}/gu)].map(match => match[1]);
}

/** A compact YAML emitter for the JSON-compatible OpenAPI tree. */
export function renderOpenApiYaml(routes: readonly RouteSpec[] = ROUTES): string {
  return `${toYaml(renderOpenApi(routes))}\n`;
}

function toYaml(value: unknown, indent = 0): string {
  const pad = ' '.repeat(indent);
  if (value === null) return 'null';
  if (typeof value === 'string') return yamlString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return value.map(item => {
      const rendered = toYaml(item, indent + 2);
      if (isScalarYaml(rendered)) return `${pad}- ${rendered}`;
      return `${pad}-\n${rendered}`;
    }).join('\n');
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) return '{}';
    return entries.map(([key, item]) => {
      const rendered = toYaml(item, indent + 2);
      if (isScalarYaml(rendered)) return `${pad}${yamlKey(key)}: ${rendered}`;
      return `${pad}${yamlKey(key)}:\n${rendered}`;
    }).join('\n');
  }
  return 'null';
}

function isScalarYaml(value: string): boolean {
  return !value.includes('\n') && !value.startsWith(' ') && !value.startsWith('- ');
}

function yamlKey(value: string): string {
  return /^[A-Za-z_][A-Za-z0-9_.-]*$/u.test(value) ? value : yamlString(value);
}

function yamlString(value: string): string {
  if (value.length === 0) return "''";
  if (/^[A-Za-z0-9_./$:+?=@-]+$/u.test(value) && !/^(?:true|false|null|yes|no|on|off|~)$/iu.test(value) && !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(value)) {
    return value;
  }
  return `'${value.replace(/'/gu, "''")}'`;
}
