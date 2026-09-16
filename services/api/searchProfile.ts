import { notImplemented } from './operations';
import { withErrors } from './http';

export const handler = withErrors(notImplemented('R2 profile retrieval'));
