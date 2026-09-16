import { getHealth } from './operations';
import { withErrors } from './http';

export const handler = withErrors(getHealth);
