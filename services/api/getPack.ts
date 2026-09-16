import { getPack } from './operations';
import { withInstructor } from './identity';

export const handler = withInstructor(getPack);
