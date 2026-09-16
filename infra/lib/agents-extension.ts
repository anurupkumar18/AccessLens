import { Construct } from 'constructs';

/** Empty, deploy-safe extension point for V4/V8/V10/V11. */
export class AgentsExtension extends Construct {
  constructor(scope: Construct, id: string) {
    super(scope, id);
    // TODO(V4/V8 agent lane): add the Sonnet agent Lambdas and their stage contracts.
  }
}
