import { getArtifactManifest } from './operations';
import { withErrors } from './http';

export const handler = withErrors(getArtifactManifest);
