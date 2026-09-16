import { Construct } from 'constructs';

/** Empty, deploy-safe extension point for V3. */
export class IngestExtension extends Construct {
  constructor(scope: Construct, id: string) {
    super(scope, id);
    // TODO(V3 ingest lane): replace this construct with the LibreOffice/poppler container Lambda.
  }
}
