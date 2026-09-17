import { z } from 'zod';

// Zod probes for eval with `new Function('')` when an object schema is created.
// Manifest V3's default extension CSP forbids eval, so the probe fails
// harmlessly but reports a CSP violation on every load. Import this before any
// module that defines a schema: jitless must be set before the schemas exist,
// not before they parse.
z.config({ jitless: true });
