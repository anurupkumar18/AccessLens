import { createJob } from './operations';
import { withInstructor } from './identity';

export const handler = withInstructor(createJob);
