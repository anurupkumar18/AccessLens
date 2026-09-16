import { listPackVersions } from './operations';
import { withErrors } from './http';

export const handler = withErrors(listPackVersions);
