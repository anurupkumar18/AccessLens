import { listPackVersions } from './operations';
import { withInstructor } from './identity';

export const handler = withInstructor(listPackVersions);
