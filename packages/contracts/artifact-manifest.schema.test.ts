import {describe,it,expect,beforeAll} from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import schema from './artifact-manifest.schema.json';
import { ArtifactManifestSchema } from '../../apps/extension/src/shared/contracts';
import catalogFixture from '../../apps/viewer/fixtures/artifacts/catalog.manifest.json';
import adaptedFixture from '../../apps/viewer/fixtures/artifacts/adapted.manifest.json';
import generatedFixture from '../../apps/viewer/fixtures/artifacts/generated.manifest.json';

let validate: (data: unknown) => boolean;

beforeAll(() => {
  const ajv = new Ajv2020({ allErrors: true });
  addFormats(ajv);
  validate = ajv.compile(schema);
});

const fixtures = { catalog: catalogFixture, adapted: adaptedFixture, generated: generatedFixture };

// The JSON Schema is the interchange artifact and the Zod schema is the runtime
// authority. Every fixture goes through both, so the two cannot drift apart
// without a test going red -- the failure mode RL-005 records.
describe.each(Object.entries(fixtures))('the %s provenance fixture', (_kind, fixture) => {
  it('validates against the JSON Schema', () => {
    expect(validate(fixture)).toBe(true);
  });

  it('validates against the Zod schema', () => {
    expect(ArtifactManifestSchema.safeParse(fixture).success).toBe(true);
  });
});

describe('artifact-manifest.schema.json rejects what the critic must reject', () => {
  const base = catalogFixture as Record<string, unknown>;
  const reject = (mutate: (m: any) => void, label: string) => {
    it(label, () => {
      const m = structuredClone(base) as any;
      mutate(m);
      expect(validate(m)).toBe(false);
      expect(ArtifactManifestSchema.safeParse(m).success).toBe(false);
    });
  };

  reject(m => { delete m.accessibility.description; }, 'an artifact with no accessibility description (charter A7)');
  reject(m => { delete m.accessibility.keyboard; }, 'an artifact with no keyboard route (charter A7)');
  reject(m => { m.libraries = ['jquery@3']; }, 'a library outside the blessed list');
  reject(m => { m.render.entry = 'main.html'; }, 'a render entry other than index.html');
  reject(m => { m.artifactId = 'HNSW Stepper'; }, 'an artifactId that is not lowercase kebab-case');
  reject(m => { m.provenance = { kind: 'adapted', license: 'MIT', generatedBy: 'x', jobId: 'y' }; }, 'adapted provenance with no parent artifact');
  reject(m => { m.provenance = { kind: 'generated', generatedBy: 'x' }; }, 'generated provenance with no jobId');
  reject(m => { m.summary = 's'.repeat(601); }, 'a summary past the length cap');
  reject(m => { m.interaction = 'vibes'; }, 'an interaction kind outside the enum');
  reject(m => { m.trackStudentAttention = true; }, 'an unknown top-level field');
});

// The Zod schema carries one cross-field rule the JSON Schema cannot express.
describe('ArtifactManifestSchema parameter/default agreement', () => {
  it('rejects a default for a parameter the schema never declares', () => {
    const m = structuredClone(catalogFixture) as any;
    m.defaultParameters.undeclared = 3;
    const result = ArtifactManifestSchema.safeParse(m);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('not declared in parameters.properties');
  });

  it('rejects a declared parameter with no default, since the viewer would inject nothing', () => {
    const m = structuredClone(catalogFixture) as any;
    m.parameters.properties.depth = { type: 'integer' };
    expect(ArtifactManifestSchema.safeParse(m).success).toBe(false);
  });

  it('accepts the control case, so the rules above can actually fail', () => {
    expect(ArtifactManifestSchema.safeParse(catalogFixture).success).toBe(true);
  });
});
