import { getJob } from './operations';
import { withErrors } from './http';

export const handler = withErrors(getJob);
