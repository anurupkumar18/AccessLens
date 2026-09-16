import { Construct } from 'constructs';

/** Empty, deploy-safe extension point for R1. */
export class VectorsExtension extends Construct {
  constructor(scope: Construct, id: string) {
    super(scope, id);
    // TODO(R1 library lane): add the S3 Vectors bucket/index custom resource with delete handling.
  }
}
