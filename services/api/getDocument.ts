import { notImplemented } from './operations';
import { withErrors } from './http';

export const handler = withErrors(notImplemented('R1 library indexing'));
