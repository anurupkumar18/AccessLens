import { Construct } from 'constructs';

/** Empty, deploy-safe extension point for V4/R1. */
export class StateMachinesExtension extends Construct {
  constructor(scope: Construct, id: string) {
    super(scope, id);
    // TODO(V4/R1 pipeline lane): add the authoring and indexing Step Functions state machines.
  }
}
