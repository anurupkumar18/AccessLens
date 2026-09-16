import { getArtifactManifest } from './operations';
import { withInstructor } from './identity';

export const handler = withInstructor(getArtifactManifest);
