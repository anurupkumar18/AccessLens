import { createUpload } from './operations';
import { withInstructor } from './identity';

export const handler = withInstructor(createUpload);
