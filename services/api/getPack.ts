import { getPack } from './operations';
import { withErrors } from './http';

export const handler = withErrors(getPack);
