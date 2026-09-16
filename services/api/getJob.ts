import { getJob } from './operations';
import { withInstructor } from './identity';

export const handler = withInstructor(getJob);
