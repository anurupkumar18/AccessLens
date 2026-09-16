import { createJob } from './operations';
import { withErrors } from './http';

export const handler = withErrors(createJob);
