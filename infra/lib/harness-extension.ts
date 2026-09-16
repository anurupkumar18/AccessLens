import { Construct } from 'constructs';

/** Empty, deploy-safe extension point for V8. */
export class HarnessExtension extends Construct {
  constructor(scope: Construct, id: string) {
    super(scope, id);
    // TODO(V8 harness lane): replace with the headless Chromium render-check Lambda.
  }
}
