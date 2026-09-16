import {
  CreateProfileRequestSchema,
  RegisterDocumentRequestSchema,
  SearchRequestSchema,
} from '../../../shared/api';
import { createProfile, deleteDocument, deleteProfile, getDocument, getProfile, registerDocument, searchProfile } from './profiles';

/** Route functions stay plain; this thin boundary is where HTTP bodies are parsed. */
export const ROUTE_HANDLERS = {
  createProfile: async (body: unknown, deps: Parameters<typeof createProfile>[1]) => createProfile(CreateProfileRequestSchema.parse(body), deps),
  getProfile: async (input: Parameters<typeof getProfile>[0], deps: Parameters<typeof getProfile>[1]) => getProfile(input, deps),
  deleteProfile: async (input: Parameters<typeof deleteProfile>[0], deps: Parameters<typeof deleteProfile>[1]) => deleteProfile(input, deps),
  registerDocument: async (input: Parameters<typeof registerDocument>[0] & { body?: unknown }, deps: Parameters<typeof registerDocument>[1]) => {
    const { profileId, body } = input;
    return registerDocument({ profileId, ...RegisterDocumentRequestSchema.parse(body) }, deps);
  },
  getDocument: async (input: Parameters<typeof getDocument>[0], deps: Parameters<typeof getDocument>[1]) => getDocument(input, deps),
  deleteDocument: async (input: Parameters<typeof deleteDocument>[0], deps: Parameters<typeof deleteDocument>[1]) => deleteDocument(input, deps),
  searchProfile: async (input: Parameters<typeof searchProfile>[0] & { body?: unknown }, deps: Parameters<typeof searchProfile>[1]) => {
    const { profileId, body } = input;
    return searchProfile({ profileId, ...SearchRequestSchema.parse(body) }, deps);
  },
} as const;

export { createProfile, deleteDocument, deleteProfile, getDocument, getProfile, registerDocument, searchProfile } from './profiles';
export * from './types';
