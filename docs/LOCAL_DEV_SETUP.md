# Local dev setup: getting every feature working on your machine

`.env.local` is gitignored on purpose — Vite convention keeps machine-local
config out of git — but that means nobody gets a working extension (Ask this
class, Study chat, live captions, translate, course media, the orb) until
they paste in the same real values everyone else is using. This doc is that
paste target. It is **not secret**: every one of these values is an endpoint
URL or an OAuth *client* ID, both already embedded in the built extension
that ships to students, so there is nothing here an installed copy of
AccessLens doesn't already expose.

## Setup

1. `cp .env.example .env.local`
2. Replace its contents with the block below.
3. Restart your dev server (`npx vite --port 5173 --strictPort`, or the
   `accesslens-dev` launch config) — Vite only reads `.env.local` at startup,
   not on every save.

```env
# Local manual-QA configuration. This file is ignored by Git.
VITE_ACCESSLENS_WS_URL=wss://ktlrnmxq0f.execute-api.us-east-1.amazonaws.com/demo
VITE_ACCESSLENS_API_URL=https://ainrskjd05.execute-api.us-east-1.amazonaws.com/
VITE_GOOGLE_CLIENT_ID=315890002084-rrlieitls5ggiuno61sc25jdkrt4m040.apps.googleusercontent.com

VITE_ACCESSLENS_AI_URL=https://nxhrvn0odk.execute-api.us-east-1.amazonaws.com
VITE_ACCESSLENS_CHAT_URL=https://my7zbwwtpitseif4d343y656fy0tydjh.lambda-url.us-east-1.on.aws/

# Leave this EMPTY. Setting it to the CloudFront URL breaks every published
# pack load in local dev (see memory/episodic/0077). Only the deployed build
# (via GitHub Actions) sets this.
VITE_ACCESSLENS_ASSET_BASE_URL=

VITE_ACCESSLENS_COURSE_MEDIA_ENDPOINT=https://ngsucv2n7r3zsram2rxve3ppnq0mwgdt.lambda-url.us-east-1.on.aws/
VITE_ACCESSLENS_ORB_ENDPOINT=https://ax7d57zgdz6yrxumcizsorlneq0feqkt.lambda-url.us-east-1.on.aws/

VITE_ACCESSLENS_CAPTIONS_ENDPOINT=https://ndqqny75kq7t6dd4mro5atlzz40syvrd.lambda-url.us-east-1.on.aws/
VITE_ACCESSLENS_RECAP_ENDPOINT=https://us2jcawfbv6gigbyihv4ettgsi0dfgog.lambda-url.us-east-1.on.aws/
VITE_ACCESSLENS_TRANSLATE_ENDPOINT=https://6kng7tvspprq577wvr766mgm3m0setau.lambda-url.us-east-1.on.aws/
```

Without this, features silently degrade instead of erroring loudly: Ask this
class/Study chat says "not configured," live captions/translate say "this
feature is not set up yet," and only the two bundled demo packs
(`bio-cell-demo`, `introduction-to-hnsw`) load — any other published pack
fails with "Failed to fetch."

## If a stack redeploys and these stop working

These are outputs of `AccessLensLiveSession`, `AccessLensAuthoring`,
`AccessLensCourseMedia`, `AccessLensOrbExplain`, and `AccessLensAccessibility`.
If one of those stacks redeploys, its endpoint can change. Whoever has AWS CLI
access can refresh them and update this file:

```bash
aws cloudformation describe-stacks --stack-name AccessLensLiveSession --query "Stacks[0].Outputs"
aws cloudformation describe-stacks --stack-name AccessLensAuthoring --query "Stacks[0].Outputs"
aws cloudformation describe-stacks --stack-name AccessLensCourseMedia --query "Stacks[0].Outputs"
aws cloudformation describe-stacks --stack-name AccessLensOrbExplain --query "Stacks[0].Outputs"
aws cloudformation describe-stacks --stack-name AccessLensAccessibility --query "Stacks[0].Outputs"
```

Then update the block above (in this file) so the next person to copy it
gets the current values, and note the change in
[`docs/CONTEXT_RELAY.md`](CONTEXT_RELAY.md).

## Other local-only gotchas

- **Dev server dies silently.** If `localhost:5173` stops responding, the
  Vite process just isn't running anymore (nothing keeps it alive between
  reboots/terminal closes). Restart it; nothing is actually broken.
- **New AR / local-slide-preview panel is invisible.** `AuthoringPanel`'s
  "Local slide preview" section only renders when `VITE_ACCESSLENS_API_URL`
  and `VITE_GOOGLE_CLIENT_ID` are both **empty** — it's mutually exclusive
  with the real authenticated upload flow above. To test it, temporarily
  blank those two vars, restart, test, then restore them from this file.
- **Matching only works reliably on visually distinct decks.** The slide
  matcher hashes screen luminance; plain, text-heavy, single-template decks
  (a typical bullet-point lecture) can be too visually similar slide-to-slide
  for it to tell apart. The bundled/reviewed demo packs
  (`bio-cell-demo`, `water-electrolytes-real-class-material`, geography)
  all use high-contrast custom illustrations specifically so this works —
  prefer those for live demos over a plain real deck.
