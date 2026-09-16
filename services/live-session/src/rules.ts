/**
 * Pack-aware and stream-aware validation, enforced server-side.
 *
 * This is the TypeScript counterpart of Part 5's
 * `packages/access-packs/bio-cell-demo/tools/reference_event_check.py`, which
 * says in its own docstring: "Keep the rule names stable: Part 4 has to enforce
 * the same rules server-side." That is what this file is. Every rule name below
 * is byte-identical to the Python one, and `test/rules.parity.test.ts` runs both
 * implementations over the same fixtures and fails if a single verdict differs.
 *
 * Why the relay re-checks what the client already validated (A6, A7): a client
 * is whatever the person running it says it is. Charter A9 and the negative
 * fixtures under `fixtures/invalid/` describe things a *hostile or broken*
 * client might send -- a raw frame, a student identity, a mastery estimate --
 * and the only place that can actually refuse them for everyone is the server.
 *
 * Two rules here have no Python counterpart, because they are not expressible
 * client-side:
 *
 *   - `role-not-permitted-to-publish` -- the shared LiveEvent contract carries
 *     no role, deliberately (a `publishedBy` field is itself a contract
 *     violation; see `fixtures/invalid/student-published-instructor-event.json`).
 *     Role lives in the connection's capability, which only the relay holds.
 *   - `session-not-open` -- session lifecycle is server state.
 */

/** Ordered exactly as ALLOWED_EVENT_TYPES in reference_event_check.py. */
export const ALLOWED_EVENT_TYPES = [
  'session.started',
  'asset.changed',
  'region.changed',
  'caption.appended',
  'capture.paused',
  'capture.resumed',
  'capture.stopped',
  'source.unmatched',
  'session.ended',
] as const;

export const REQUIRED_FIELDS = [
  'schemaVersion',
  'type',
  'sessionId',
  'packId',
  'packVersion',
  'sequence',
  'sentAt',
] as const;

/** Mirrors CAPTION_MAX_LENGTH in reference_event_check.py and the Zod contract. */
export const CAPTION_MAX_LENGTH = 2000;

/**
 * Mirrors KNOWN_FIELDS in reference_event_check.py, `caption` included.
 *
 * `caption` carries an instructor-authored or streamed caption on
 * `caption.appended` (T-16, closed): `{text, isFinal}` and nothing else,
 * `assetId` when there is a current match, checked below with the same rule
 * names as the Python reference.
 *
 * Anything *not* in this set is refused by name. That is what makes
 * `frameData`, `studentId`, and `masteryEstimate` bounce: not a blocklist of
 * bad fields, which would need updating every time someone invents a new one,
 * but an allowlist of the only fields that exist.
 */
export const KNOWN_FIELDS: ReadonlySet<string> = new Set([
  ...REQUIRED_FIELDS,
  'assetId',
  'regionId',
  'pointer',
  'arState',
  'caption',
]);

/**
 * Every event type is instructor-only. A student connection publishes nothing
 * at all -- mirroring INSTRUCTOR_ONLY_TYPES in the Python reference, which
 * likewise lists every allowlisted lifecycle and view event.
 */
export const INSTRUCTOR_ONLY_TYPES: ReadonlySet<string> = new Set(ALLOWED_EVENT_TYPES);

export interface PackRegion {
  regionId: string;
}

export interface PackHotspot {
  hotspotId: string;
  regionId: string;
}

export interface PackAsset {
  assetId: string;
  regions: PackRegion[];
  arScene?: { hotspots?: PackHotspot[] };
}

export interface PackIndex {
  packId: string;
  version: number;
  assets: Map<string, PackAsset>;
}

/** Build the lookup the rules need from a raw `pack.json`. */
export function indexPack(pack: {
  packId: string;
  version: number;
  assets: PackAsset[];
}): PackIndex {
  return {
    packId: pack.packId,
    version: pack.version,
    assets: new Map(pack.assets.map(asset => [asset.assetId, asset])),
  };
}

export interface CheckContext {
  /** Highest sequence already accepted for this session. 0 before the first. */
  lastSequence?: number;
  /** Role of the publishing connection. Omit for pack-only checks. */
  role?: 'instructor' | 'student';
  /** False once the session is closed or its TTL has passed. */
  sessionOpen?: boolean;
}

/**
 * Return the rule names an event breaks. An empty array means acceptable.
 *
 * The check order matches the Python reference so that an event breaking
 * several rules reports them in the same order in both implementations --
 * which is what lets the parity test compare arrays rather than sets.
 */
export function checkEvent(
  event: Record<string, unknown>,
  pack: PackIndex,
  context: CheckContext = {},
): string[] {
  const broken: string[] = [];
  const { lastSequence = 0, role, sessionOpen } = context;

  for (const field of REQUIRED_FIELDS) {
    if (!(field in event)) broken.push(`missing-required-field:${field}`);
  }

  const type = event.type;
  if (typeof type !== 'string' || !(ALLOWED_EVENT_TYPES as readonly string[]).includes(type)) {
    broken.push('event-type-not-allowlisted');
  }

  // Sorted, so two events with the same unknown fields report them in the same
  // order regardless of key insertion order -- `sorted(set(...))` in Python.
  const unknown = Object.keys(event)
    .filter(field => !KNOWN_FIELDS.has(field))
    .sort();
  for (const field of unknown) broken.push(`field-not-on-contract:${field}`);

  if (event.packId !== pack.packId) broken.push('pack-id-mismatch');

  // T-19: schema validation cannot catch a stale pack version, because Zod
  // types it as any positive integer. The relay holds the session's expected
  // version and compares, so a student on an old pack is refused here rather
  // than silently rendering the wrong content.
  if (event.packVersion !== pack.version) broken.push('pack-version-mismatch');

  // T-15: the first usable sequence is 1, not 0. Part 5's simulator starts at
  // 1 and the Python reference rejects anything below it; the shared Zod
  // contract still permits 0, so the relay is where that gets settled.
  const sequence = event.sequence;
  if (!Number.isInteger(sequence) || (sequence as number) < 1) {
    broken.push('sequence-not-a-positive-integer');
  } else if ((sequence as number) <= lastSequence) {
    broken.push('sequence-not-monotonic');
  }

  const pointer = event.pointer as Record<string, unknown> | undefined | null;
  if (pointer !== undefined && pointer !== null) {
    for (const axis of ['x', 'y'] as const) {
      const value = pointer[axis];
      if (typeof value !== 'number' || Number.isNaN(value) || value < 0 || value > 1) {
        broken.push(`pointer-out-of-range:${axis}`);
      }
    }
  }

  const assetId = event.assetId as string | undefined | null;
  if (assetId !== undefined && assetId !== null && !pack.assets.has(assetId)) {
    broken.push('asset-not-in-pack');
  }

  const regionId = event.regionId as string | undefined | null;
  if (regionId !== undefined && regionId !== null) {
    const asset = assetId == null ? undefined : pack.assets.get(assetId);
    if (!asset || !asset.regions.some(region => region.regionId === regionId)) {
      broken.push('region-not-in-pack');
    }
  }

  const arState = event.arState as Record<string, unknown> | undefined | null;
  if (arState && typeof arState === 'object' && arState.hotspotId != null) {
    const asset = assetId == null ? undefined : pack.assets.get(assetId);
    const hotspot = asset?.arScene?.hotspots?.find(h => h.hotspotId === arState.hotspotId);
    if (!hotspot) {
      broken.push('hotspot-not-in-pack');
    } else if (regionId != null && hotspot.regionId !== regionId) {
      broken.push('hotspot-region-mismatch');
    }
  }

  // T-16's caption payload has no pack-membership fact to check against, but
  // its shape is not covered by the generic REQUIRED_FIELDS/KNOWN_FIELDS
  // checks above (those only ask whether the field name is known, not what
  // it contains) -- and this relay-side layer is the only one a hostile or
  // non-conforming client cannot bypass. Charter A2/A9: never forward an
  // unbounded or malformed value to every student in the session.
  const caption = event.caption as Record<string, unknown> | undefined | null;
  if (type !== 'caption.appended') {
    if (caption !== undefined && caption !== null) broken.push('caption-on-wrong-event-type');
  } else if (caption !== undefined && caption !== null) {
    if (typeof caption !== 'object' || Array.isArray(caption)) {
      broken.push('caption-not-an-object');
    } else {
      const text = caption.text;
      if (typeof text !== 'string' || text.length < 1) broken.push('caption-text-missing');
      else if (text.length > CAPTION_MAX_LENGTH) broken.push('caption-text-too-long');
      if (typeof caption.isFinal !== 'boolean') broken.push('caption-isfinal-not-boolean');
      const lang = caption.lang;
      const langInvalid = lang !== undefined && (typeof lang !== 'string' || lang.length < 2 || lang.length > 16);
      if (langInvalid || Object.keys(caption).some(key => key !== 'text' && key !== 'isFinal' && key !== 'lang')) broken.push('caption-invalid');
    }
  }

  // Charter A9. `source.unmatched` is base-only in the discriminated union, so
  // a conforming client cannot express this -- but the relay does not get to
  // assume the client is conforming.
  if (type === 'source.unmatched') {
    for (const field of ['assetId', 'regionId'] as const) {
      if (event[field] != null) broken.push(`unmatched-event-names-content:${field}`);
    }
    if (arState && typeof arState === 'object' && arState.hotspotId != null) {
      broken.push('unmatched-event-names-content:arState.hotspotId');
    }
  }

  // Server-only rules, after the shared ones so that parity comparisons can
  // simply omit a role and an open session to get the Python behaviour back.
  if (role !== undefined && typeof type === 'string' && INSTRUCTOR_ONLY_TYPES.has(type)) {
    if (role !== 'instructor') broken.push('role-not-permitted-to-publish');
  }
  if (sessionOpen === false) broken.push('session-not-open');

  return broken;
}
