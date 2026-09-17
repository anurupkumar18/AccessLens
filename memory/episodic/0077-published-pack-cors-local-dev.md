# 0077 — Published-pack CORS failure in local dev, self-inflicted and fixed

## Goal

While QA-ing the Upload-slides authoring pipeline with a real 23-slide
instructor deck, prove that a freshly published pack actually loads and
recognizes live in local dev — the same rigor as every other feature tested
this session.

## What was actually wrong

Selecting any published pack other than the two bundled demo packs
(`bio-cell-demo`, and the one pre-existing `introduction-to-hnsw`) failed with
"Could not load ... : Failed to fetch" in the instructor pack picker and would
have failed identically for a student joining a live session on that pack.

Root cause was **this session's own earlier change**: `.env.local` had
`VITE_ACCESSLENS_ASSET_BASE_URL` set to the absolute CloudFront URL
(`https://d7dxgg82mglf.cloudfront.net`), added a few hours earlier in this
same session to fix the unrelated "AI screen analysis is not configured"
message. `apps/extension/src/shared/remotePack.ts`'s `publishedPackBase()`
uses this value when set; when it built an absolute URL, `publishedPackUrl()`
produced a **cross-origin** URL instead of a relative same-origin one — which
bypasses `vite.config.ts`'s `/packs` proxy rule entirely (that rule only
matches relative paths on `localhost:5173`) and sends the browser directly to
CloudFront. CloudFront's CORS response there turned out to be unreliable
across edges — some responses carried `access-control-allow-origin: *`,
others didn't, for the identical URL and headers, confirmed by reading raw
response headers in Chrome DevTools (not just the JS-level fetch error).
`remotePack.ts`'s own code comment already documented the intended behavior:
leave this variable unset locally so `publishedPackBase()` falls back to
`window.location.origin`, letting the Vite proxy do a server-to-server fetch
with no browser CORS involved at all.

## Debugging path (worth recording so it isn't re-walked)

Chased several plausible-looking but wrong leads before landing on the real
cause: a suspected CDN propagation delay (tried a CloudFront invalidation —
temporarily seemed to fix it via `curl`, but curl and real browser fetches
gave inconsistent results even after); a red herring where the reporting
browser's DevTools showed an Android/Pixel-9 user agent (device-emulation
toolbar was open, unrelated); the Dark Reader browser extension (ruled out via
an Incognito-window retest, which failed identically). The decisive evidence
was reading the **raw response headers in Chrome DevTools' Network tab**
directly (not what JavaScript could see, which CORS filters) — that showed a
real 200 OK from CloudFront with no `access-control-allow-origin` header at
all. That, plus rereading `remotePack.ts`'s own doc comment, pointed at the
actual local misconfiguration rather than a CloudFront-side bug.

## Changed files

- `.env.local` — cleared `VITE_ACCESSLENS_ASSET_BASE_URL` back to empty.
- `.env.example` — strengthened the comment on this variable with an explicit
  warning, since `.env.local` is gitignored and invisible to anyone else; the
  example file is the only place this lesson could otherwise survive.
- `docs/CONTEXT_RELAY.md` — RL-099 (see relay log).

## Validation evidence

Verified with the exact app code path before asking for a human retest:
`import('/apps/extension/src/shared/remotePack.ts')`, called
`publishedPackUrl('water-electrolytes-real-class-material', 1)` and
`loadRemotePack(url)` directly in the browser console — returned the real
23-slide pack correctly. Then the instructor independently confirmed both a
real 23-slide class deck and a synthetic geography test deck loaded
correctly after a hard refresh.

## Blocker

None. This was local-dev-only; see Boundary.

## Boundary

**This bug did not affect the deployed/installed extension.** The deploy
workflow sets this same variable to the absolute CloudFront URL for real
builds too, but a packaged Chrome extension's `host_permissions`
(`manifest.json` already lists `https://*.cloudfront.net/*`) bypass CORS
entirely for its own fetches — a privilege a plain browser tab running
`npx vite` does not have. Not independently verified against a real installed
build this session, but the mechanism is standard, documented MV3 behavior.
No AWS infrastructure was changed to fix this (the CloudFront invalidation
run mid-investigation was harmless but ultimately not the actual fix).

## Owner

Claude, at Anurup Kumar's direction (live pairing session).

## Next action

None required. If `VITE_ACCESSLENS_ASSET_BASE_URL` is ever set locally again
for some other reason, remember this exact failure mode.
