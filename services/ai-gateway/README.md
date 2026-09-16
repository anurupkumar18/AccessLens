# AccessLens AI gateway

The AWS model routes behind three extension features. One Lambda behind an API
Gateway HTTP API, deployed by `infra/` in the same stack as the relay.

| Route | Who | What | AWS |
| --- | --- | --- | --- |
| `POST /ask` | instructor or student in a live session | "Ask this class": a cited answer from the class's **reviewed** Access Pack, or a decline | Bedrock, `us.anthropic.claude-sonnet-4-6` |
| `POST /speak` | instructor or student in a live session | Hear mode: one field of one reviewed region as mp3 | Polly (neural) |
| `POST /transcribe-url` | instructor only | A 5-minute presigned URL the instructor's browser uses to stream its microphone to Transcribe | Transcribe streaming |
| `POST /transcribe-chunk` | instructor only | One spoken clip (16 kHz mono WAV, at most 12 s) to caption text | Whisper large-v3-turbo on a SageMaker endpoint (`infra/lib/whisper-stack.ts`) |

Sonnet 4.6 because it is the only Claude model this hackathon account can invoke
(`docs/AWS_ACCESS_VERIFICATION.md` §3).

## Who can call it

Every request carries the role capability the relay issued on `create`/`join`,
HMAC-signed with the relay's secret. The gateway verifies it the same way the
relay does (`services/live-session/src/capability.ts`), so only a client in a
live AccessLens session can spend a model call, and only an instructor can open
a caption stream. The capability carries no identity (charter A4). There is a
per-session, per-route rate limit in each warm container as a cost guard.

## What each route will and will not do

**Ask** answers only from reviewed packs (`src/packs.ts`; draft packs are not in
the list, charter A3). BM25 retrieval picks at most four reviewed regions; a
question that matches none is declined **without a model call**. The model is
forced to reply through one strict tool (`status`, `answer`, `sourceIds`), and
the reply is checked afterwards, not trusted: an answer that cites nothing, or
cites a source it was not shown, becomes a decline. The system prompt tells it
to decline rather than guess and to refuse answer keys and graded work. Neither
the question nor the answer is stored or logged (`src/log.ts` allowlists only
route, status, reason, role, pack id, counts, and timing).

**Speak** never takes free text. The request names a pack, asset, region, and
field; the text is looked up server-side in the reviewed pack. Audio is cached
in memory in a warm container and nowhere else.

**Transcribe URL** issues a presigned WebSocket URL signed with the function's
role. The browser connects to Transcribe directly: microphone audio never
passes through the relay or this Lambda, and no AWS credential reaches the
extension. Only caption **text** travels on the live contract
(`caption.appended`, text only, at most 500 characters, checked by Zod, the
JSON schema, and the relay).

**Transcribe chunk** takes a WAV clip the extension cut at a pause, checks it is
16 kHz mono 16-bit and 0.25-12 s long, and never calls Whisper for a silent clip
(Whisper invents text from silence). The clip goes to the endpoint in memory;
only the text comes back, and neither is logged. It answers 503
`whisper-unavailable` when the endpoint (`infra/lib/whisper-stack.ts`, deployed
and destroyed independently of this stack) is not deployed. This is the
default captioning engine in the instructor panel; Transcribe streaming is
offered alongside it as a fallback.

## Charter A2 decision: remote audio for live captions

Charter A2 keeps raw audio on the originating device by default and says remote
media processing "requires a separate reviewed decision and visible consent."
Live captions through Amazon Transcribe are that exception. Recorded in
`docs/work/decisions/2026-09-16-transcribe-live-captions.md`; the short form:

- **Off by default, instructor-initiated.** Nothing opens the microphone until
  the instructor clicks *Start captions* (A1).
- **Visible consent at the control.** The instructor panel states, next to the
  button, that microphone audio is sent to Amazon Transcribe (AWS), that
  students receive only text, and that AccessLens does not record or keep it.
- **Only the instructor's audio, only to Transcribe.** Students never stream
  audio. AccessLens stores no audio anywhere.
- **Captions are labelled as speech,** never as reviewed lesson text, and never
  replace reviewed descriptions.
- **Voice-driven sync stays inside reviewed content.** A final caption naming a
  region of the slide already matched on screen (`sources/voice/spokenRegion.ts`)
  moves students to that region; speech cannot introduce a slide or a region
  (A9). The instructor can turn this off.

The charter's human review gate applies (remote media): this needs a second
human reviewer before it merges to the integration branch.

## Develop

```sh
cd services/ai-gateway
npm ci
npm run check          # typecheck, tests (fakes for Bedrock, Polly, signer), bundle to dist/
```

To try the routes from `npx vite` before deploying them, run the Lambda's own
handler locally against real Bedrock, Polly, and Transcribe with your AWS
credentials. It needs the deployed relay's signing secret so the relay's
capabilities verify; keep it in your shell, not in a file:

```sh
CAPABILITY_SECRET=$(aws secretsmanager get-secret-value --secret-id <CapabilitySecret ARN> --query SecretString --output text) \
AWS_PROFILE=hackathon npx tsx services/ai-gateway/scripts/local-server.ts   # http://localhost:8787
```

Then set `VITE_ACCESSLENS_AI_URL=http://localhost:8787` in `.env.local`. Live
captions also need a relay deployed from this branch: older relays refuse
`caption.appended` events that carry text.

## Deploy

Built by the same `cdk deploy` as the relay (see `docs/DEPLOYMENT.md`), after
`npm run build` here and in `services/live-session`. The stack prints
`AiApiUrl`; put it in `.env.local` as `VITE_ACCESSLENS_AI_URL` and rebuild the
extension. With it unset, the extension hides Ask and caption controls behind an
explanation and Hear mode uses the browser voice.
