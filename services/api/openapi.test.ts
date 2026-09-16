import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ROUTES } from '../shared/api';
import { renderOpenApi, renderOpenApiYaml } from './openapi';

describe('authoring OpenAPI document', () => {
  it('renders valid block YAML and is byte-identical to the committed contract', () => {
    const yaml = renderOpenApiYaml();
    expect(yaml).toContain('security:\n  -\n    bearerAuth: []');
    expect(yaml).toContain("$ref: '#/components/schemas/ApiError'");
    const committed = readFileSync(new URL('../../packages/contracts/authoring-api.openapi.yaml', import.meta.url), 'utf8');
    expect(yaml).toBe(committed);
  });

  it('contains every route in both directions', () => {
    const document = renderOpenApi();
    const documentedPaths = new Set(Object.keys(document.paths));
    const routePaths = new Set(ROUTES.map(route => route.path));
    expect(documentedPaths).toEqual(routePaths);
    for (const route of ROUTES) {
      const operation = document.paths[route.path]?.[route.method.toLowerCase()];
      expect(operation).toBeDefined();
      expect((operation as { operationId: string }).operationId).toBe(route.operationId);
    }
  });
});
