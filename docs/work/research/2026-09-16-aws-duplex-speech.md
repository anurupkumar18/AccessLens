# Research: duplex (two-way) speech on AWS for the study chat

**Date:** 2026-09-16 · **Account:** 087328706621 (`hackathon`), us-east-1 ·
**Status:** research only; nothing deployed, no product decision made.

Question: which AWS/Bedrock models could let a student *talk* to the study chat
and hear it answer, and how would we set that up?

## Answer in one paragraph

**Amazon Nova 2 Sonic (`amazon.nova-2-sonic-v1:0`) is the one duplex
speech-to-speech model on Bedrock, and it works end to end in this account.**
It hears the student, answers in a voice, handles interruptions (barge-in), and
can call tools such as a course-materials search. Nova Sonic v1 is explicitly
denied here. The catch: browsers cannot connect to it without AWS credentials,
so it needs a server relay (recommended: Amazon Bedrock AgentCore Runtime over
WebSocket), and **Bedrock Guardrails do not work with Nova 2 Sonic**. The
alternative is the pipeline we mostly already have: Amazon Transcribe → the
guardrailed study chat (Claude on Bedrock) → Amazon Polly: about 1 s slower to
first audio and no built-in barge-in, but it keeps the Guardrail and grounding.

## Measured in this account (n=1 each, laptop, synthetic Polly speech in real time)

| | Nova 2 Sonic | Transcribe → Claude Sonnet 4.6 → Polly |
|---|---|---|
| Student's words transcribed after they stop | 0.55-0.66 s | 0.51 s (Transcribe final) |
| **First reply audio after they stop** | **1.3 s** (2.0 s with a tool call) | **~2.3 s** (Claude 1.56 s + Polly first byte 0.24 s) |
| Barge-in (student talks over the reply) | Native: stopped 0.44 s after the student started | Must be built client-side |
| Guardrails | **Not supported** (built-in safety filters only, not configurable) | Existing `accesslens-study-chat` Guardrail runs before any audio |
| Short-turn cost (list price) | ~$0.003-0.004 | ~$0.008-0.010 |
| Browser connection | Needs a relay | Transcribe presigned URL already works without credentials |

Other observations: the tool-use path worked (the model called a
`lookup_lesson_material` tool and answered from the passage); after a barge-in a
harmless follow-up ("what is chlorophyll") got a garbled safety refusal, which is
a real risk for a classroom because those filters cannot be tuned. The
permission checked for the stream is `bedrock:InvokeModel` (the IAM simulator's
`InvokeModelWithBidirectionalStream` result is misleading).

## Nova 2 Sonic facts (official AWS docs)

- **Regions:** us-east-1, us-west-2, eu-north-1, ap-northeast-1 (in-region only). API: `InvokeModelWithBidirectionalStream`. Not supported with Guardrails, Knowledge Bases, or Agents (the model card). [Model card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-2-sonic.html)
- **Audio:** raw 16-bit mono PCM at 8, 16 or 24 kHz in and out, base64 in ~32 ms frames. Our existing 16 kHz AudioWorklet mic capture fits. [Input events](https://docs.aws.amazon.com/nova/latest/nova2-userguide/sonic-input-events.html)
- **Voices and languages:** en-US tiffany/matthew, en-GB amy, en-AU olivia, en-IN/hi-IN kiara/arjun, fr-FR ambre/florian, it-IT beatrice/lorenzo, de-DE tina/lennart, es-US lupe/carlos, pt-BR carolina/leo; automatic language detection. No pitch or rate control. [Languages](https://docs.aws.amazon.com/nova/latest/nova2-userguide/sonic-language-support.html)
- **Turn-taking:** `endpointingSensitivity` HIGH / MEDIUM / LOW; interruption notice lets the client flush queued audio. [Output events](https://docs.aws.amazon.com/nova/latest/nova2-userguide/sonic-output-events.html)
- **Tools / RAG:** tools in `promptStart.toolConfiguration`; a Knowledge Base is used by calling `Retrieve` inside the tool (our `search_course_materials` / `CourseKnowledge` seam reuses directly). [Tools](https://docs.aws.amazon.com/nova/latest/nova2-userguide/sonic-tool-configuration.html)
- **Limits:** a stream lasts at most **8 minutes** (longer needs session continuation); this account allows **20 concurrent streams, not adjustable**.
- **Pricing (per 1K tokens):** speech in $0.003, speech out $0.012, text in $0.00033, text out $0.00275; about $0.018 per minute of assistant speech.
- **Privacy (service card):** Bedrock does not store or review speech or generations; no training on customer data; generated audio is watermarked.
- **Samples:** [Node WebSocket relay](https://github.com/aws-samples/amazon-nova-samples/tree/main/speech-to-speech/amazon-nova-2-sonic/sample-codes/websocket-nodejs), [AgentCore bidirectional streaming](https://github.com/awslabs/amazon-bedrock-agentcore-samples/tree/main/01-tutorials/01-AgentCore-runtime/06-bi-directional-streaming), [Knowledge Base pattern](https://github.com/aws-samples/amazon-nova-samples/tree/main/speech-to-speech/amazon-nova-2-sonic/repeatable-patterns/bedrock-knowledge-base).

## Why a relay, and which one

A presigned URL alone does not work: the Bedrock WebSocket transport the SDK
uses in browsers requires a SigV4 signature on **every frame**, which would mean
shipping AWS credentials to the extension (and letting the client control the
system prompt and tool results). Tested: presigned handshake accepted, then
`ModelStreamErrorException`.

| Relay | Verdict |
|---|---|
| **AgentCore Runtime (WebSocket)** | **Recommended.** Permissions allowed for our role and the CDK role; CDK 2.269 has `CfnRuntime`; the gateway can presign a short-lived `wss://bedrock-agentcore…/ws` URL (max 300 s) exactly like `/transcribe-url`. Container must be ARM64 (build with CodeBuild; no Docker on this Mac). |
| ECS Fargate + ALB | Fallback: needs VPC, HTTPS certificate, always-on task, own auth |
| Lambda / API Gateway WebSocket | Not viable: cannot hold a bidirectional stream |
| App Runner | Denied in this account |

## Recommended setup (if the team chooses voice chat)

1. **Decision first.** Students sending audio is a new charter A2 exception (the captions decision says "Students never stream audio"): decision record, consent text at the Talk button, second reviewer.
2. **Flow:** Talk button (explicit click, live session only) → `POST /voice-chat-url` with the relay capability → gateway presigns the AgentCore WebSocket URL → browser streams 16 kHz PCM from the existing `micCapture` → runtime container holds the Nova 2 Sonic stream with the study chat's system prompt, lesson material and `search_course_materials` tool → 24 kHz audio back to the browser, flushed on interruption, with the transcript shown as text (A7).
3. **IAM:** gateway `bedrock-agentcore:InvokeAgentRuntimeWithWebSocketStream` on the runtime; runtime role `bedrock:InvokeModel` on `amazon.nova-2-sonic-v1:0`, `bedrock:Retrieve` on the Knowledge Base, ECR pull, logs.
4. **Safety:** Guardrails cannot screen Nova's speech. Options: `ApplyGuardrail` on the transcripts in the relay (adds latency, unverified), forcing retrieval with `toolChoice`, and not claiming reviewed-content guarantees for voice answers.
5. **Limits to design for:** 8-minute streams (continuation or cap), 20 concurrent streams account-wide ("type instead" fallback), echo from speakers triggering barge-in (untested).

**No-new-infrastructure fallback:** push-to-talk → Amazon Transcribe (presigned, as for captions) → the existing guardrailed study chat → a new route that reads the reply with Polly generative voices sentence by sentence. About 2.3 s to first audio, no native barge-in, but every word passes the Guardrail first.

## Not verified

Nothing was deployed: the presigned AgentCore WebSocket from an MV3 extension,
`CfnRuntime` property shapes, and whether a connection outlives the presign
expiry are untested. AWS docs disagree on a few details (AgentCore frame size
32 vs 64 KB; voice counts). All latency numbers are single runs. Total test
spend: under $0.05.
