# AWS capability survey and feature map

**Probed:** 2026-09-15, account `087328706621`, role `WSParticipantRole`, `us-east-1`.
**Reproduce:** `python3 scripts/aws_capability_probe.py`

Every row below was tested with a real API call, not read off a marketing page.

## 1. What this account can actually use

| Service | Status | What it buys this product |
| --- | --- | --- |
| **Bedrock runtime** | available | `us.anthropic.claude-sonnet-4-6` only — every other listed Anthropic model returns `AccessDenied` |
| **Polly** | available | Neural TTS, many languages. Better voices than the browser's, at the cost of a network hop |
| **Transcribe** | available | Speech to text, including streaming — live captions of the instructor |
| **Translate** | available | Reviewed text into the student's language |
| **Comprehend** | available | Language detection, key phrases, entity extraction |
| **Textract** | available | OCR and layout from slide images and PDFs |
| **Rekognition** | available | Image labels and text detection |
| **Bedrock Agents / Knowledge Bases** | available | Retrieval over lecture content |
| **OpenSearch Serverless** | available | Vector store behind a knowledge base |
| **Step Functions** | available | Orchestrating the authoring pipeline |
| **EventBridge, SQS, SNS** | available | Async fan-out |
| **Cognito** | available | Real student identity, if ever wanted |
| **AppSync** | available | GraphQL subscriptions — an alternative to the WebSocket relay |
| **SageMaker** | available | Custom models; almost certainly not worth it here |
| **Lambda, DynamoDB, S3, CloudFront, API Gateway v2** | available | Already in use |
| **Kendra** | **denied** | The only service in the survey this account cannot use |

## 2. Who this is for, and what each group actually needs

The four audiences are not variations on one need. They fail differently, and a
feature that helps one can actively hurt another — which is why "turn everything
on" is the wrong design.

| Audience | The actual failure mode | What helps |
| --- | --- | --- |
| **Blind / low vision** | The slide carries meaning as pixels. A screen reader gets nothing. | Reviewed descriptions, ordered reading, speech, spatial audio cues |
| **Deaf / hard of hearing** | The instructor's *speech* carries meaning no slide contains. | Live captions, and a transcript that persists |
| **Non-native English speakers** | Comprehension lags delivery. By the time a sentence is parsed, two more have passed. | Translated reviewed text, slower speech, a transcript they can re-read |
| **ADHD / attention differences** | Attention lapses, and re-entry is expensive — "what did I miss" has no cheap answer. | Cheap catch-up, reduced clutter, checkpoints |

The common thread is **re-entry**: every one of these students loses the thread
at some point and needs a cheap way back in. That is the product idea worth
building, and it is not what the current demo shows.

## 3. Feature map

Ranked by impact per hour, honestly. Effort assumes one person who already
knows this codebase.

### Tier 1 — build these

**A. Live captions (Transcribe streaming) — deaf/HoH, non-native, ADHD.**
The instructor's microphone into streaming Transcribe, captions relayed as the
`caption.appended` event that *already exists in the contract*. Charter lists
captions as stretch scope and the event type is already allowlisted.
Blocked by **T-16**: `caption.appended` is base-only in the discriminated
union, so a caption event cannot currently carry a caption. That is a
ten-minute contract fix that unblocks a whole audience.
*Effort: medium. Impact: highest — it serves three of the four audiences.*

**B. "What did I miss" catch-up (Bedrock) — ADHD, non-native.**
The session already has an ordered event stream. Feed the last N events plus
captions to Bedrock and return three sentences. One button. This is the
re-entry problem solved directly, and it is the single most defensible
accessibility claim in this list.
*Effort: low — the relay already holds the state. Impact: high.*

**C. Translated reviewed text (Translate + Polly) — non-native.**
Region descriptions translated on demand, spoken in the target language by
Polly. Because the source is *reviewed* content, translation carries no
invention risk — this is the rare case where more AI does not weaken the A9
promise.
*Effort: low. Impact: high for a group the current build ignores entirely.*

### Tier 2 — build if Tier 1 lands

**D. Visible Bedrock authoring (Textract → Bedrock → pack draft).**
Partly exists in `scripts/build-pack.ts`. The gap is that no judge ever sees it.
`TEAM_ALIGNMENT_CHECK.md` scores "use AI meaningfully" weakest precisely
because the flagship pack is hand-authored. Putting upload → draft → DRAFT
watermark → instructor approves on stage fixes the scoring gap and demonstrates
the review gate the charter is built around.
*Effort: medium. Impact: high on scoring, low on students.*

**E. Ask the lecture (Bedrock Knowledge Base + OpenSearch Serverless).**
Retrieval over the transcript and reviewed pack, so a student can ask "what was
the cristae thing" afterwards. Genuinely useful, and the most likely to be
half-built at the deadline.
*Effort: high. Impact: medium.*

### Tier 3 — do not build

**Rekognition on student cameras.** Charter A7 forbids attention and emotion
inference, and no student needs a camera. Attractive demo, prohibited product.

**Cognito accounts.** Session codes already work. Real identity adds a data
protection surface for zero demo value.

**SageMaker.** Nothing here needs a custom model.

**AppSync replacing the relay.** Part 4's WebSocket relay is deployed and
working. Rewriting the transport two days out is how demos die.

## 4. What this costs the A9 promise

Each tier-1 feature sits differently against "never invents":

- **Captions** transcribe what a human actually said. No invention. Label as
  machine transcription, which can mishear.
- **Translation of reviewed text** transforms approved content. No invention.
- **Catch-up summaries** *are* generated. They need the same provenance
  labelling the orb uses — `orb/provenance.ts` already exists and should be
  reused rather than reinvented.
- **Authoring drafts** are generated and then *reviewed by an instructor before
  publication*, which is exactly the flow the charter describes. This is the
  one that strengthens rather than weakens the promise.

## 5. UI

`libraries.dev` ships MIT-licensed React effect libraries; `thinking-orbs` is
zero-dependency, 54KB unpacked, React peer only. It fits the orb's loading
state well.

One caution before it goes anywhere near the student view: this is an
accessibility product, and animated WebGL effects are exactly what
`prefers-reduced-motion` exists to suppress. Anything from there must be
gated on that query and must never be the only indicator of a state — the
interface rebuild's own rule, that colour and motion never carry meaning
alone, applies to borrowed components too.

## 6. The honest constraint

`docs/TEAM_ALIGNMENT_CHECK.md` is open and explicitly blocks further
implementation until every contributor has responded. Its own scorecard argues
the cheapest remaining wins are a real user test, two timed rehearsals, and a
recorded fallback — none of which are code.

So this document is a map, not a plan. Building all of section 3 is not
realistic in the time left and would contradict the document the team just
committed. If one thing is built, it should be **B** — lowest effort, highest
claim, and it solves the re-entry problem that every one of the four audiences
shares.
