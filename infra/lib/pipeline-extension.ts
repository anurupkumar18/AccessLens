import { Construct } from 'constructs';

/** Empty wiring seam for the authoring pipeline resources owned by later lanes. */
export class PipelineExtensionPoints extends Construct {
  constructor(scope: Construct, id: string) {
    super(scope, id);
    // TODO(V3 ingest lane): add the container Lambda and its least-privilege role.
    // TODO(V4 authoring lane): add the agent Lambdas and Step Functions state machine.
    // TODO(V8 harness lane): add the Chromium harness Lambda and render workflow.
    // TODO(R1 library lane): add indexing state machines and the S3 Vectors resource.
  }
}
