# AWS access verification

**Verified:** September 15, 2026, against the University of Utah AWS Generative AI
Hackathon account. **Read the expiry warning in §1 before trusting any of this.**

This file records what the hackathon AWS account will and will not actually do,
measured by calling it rather than by reading a service list. It exists because
`bedrock list-foundation-models` advertises thirteen Anthropic models in this
account and **exactly one of them can be invoked**. Anyone who picks a model from
that listing without calling it first will lose an hour to a misleading error.

This is reconnaissance for Part 4 (`docs/PARALLEL_WORKSTREAMS.md`) and for the
authoring stretch in `SYSTEM_DESIGN.md` §7. It does not claim Part 4, and no
infrastructure has been deployed.

---

## 1. The account is temporary, and so are its credentials

| | |
| --- | --- |
| Account | `087328706621` |
| Role | `WSParticipantRole/Participant` |
| Region | `us-east-1` (the only accessible region) |
| Event window | 72 hours from 2026-09-15 15:00 |

Credentials come from the Workshop Studio dashboard's **"Get AWS CLI credentials"**
button and are **short-lived session tokens**. They expire well inside the event
window. When calls start failing with `ExpiredToken`, re-fetch them — nothing is
broken.

Two consequences Part 4 should design around rather than discover late:

- **Nothing deployed here outlives the event.** The account is reclaimed
  afterwards. Treat any deployed relay as demo infrastructure, not as something
  the project keeps.
- **Long-lived credentials are not available.** Anything that needs to run
  unattended across a credential refresh needs a human to re-paste, or needs to
  run somewhere else.

## 2. Local setup

This was set up on a Mac with no Homebrew, no Node, and no `uv`, so the CLI came
from `pip`:

```sh
python3 -m pip install --user awscli boto3
export PATH="$HOME/Library/Python/3.11/bin:$PATH"
```

Credentials go in a named profile so they do not leak into unrelated shells:

```sh
# ~/.aws/credentials
[hackathon]
aws_access_key_id = ...
aws_secret_access_key = ...
aws_session_token = ...
```

```sh
# ~/.aws/config
[profile hackathon]
region = us-east-1
output = json
```

Then `export AWS_PROFILE=hackathon`. Confirm with:

```sh
aws sts get-caller-identity
```

**Do not commit credentials, and do not paste them into chat tools or issues.**
The three values above are the whole key to the account.

## 3. Bedrock: listed is not the same as usable

One model responds. This is the only Claude model available in this account:

```
us.anthropic.claude-sonnet-4-6
```

It must be the **`us.` inference profile**. The bare `anthropic.claude-sonnet-4-6`
fails with `Invocation of model ID ... with on-demand throughput isn't supported`.

Verified end to end:

```sh
aws bedrock-runtime converse \
  --model-id us.anthropic.claude-sonnet-4-6 \
  --messages '[{"role":"user","content":[{"text":"In one sentence: what is a cell membrane?"}]}]' \
  --inference-config '{"maxTokens":120}'
```

Everything else fails, and **the two failure modes look alike but are not**:

| Models | Error | Cause |
| --- | --- | --- |
| Haiku 4.5, Opus 4.7, Opus 4.5, Opus 4.1, Sonnet 4.5, Sonnet 4 | `AccessDeniedException` | IAM policy `ws-deny-bedrock-models-policy-1` explicitly denies `bedrock:InvokeModel` on these model ARNs |
| Opus 5, Sonnet 5, Opus 4.8, Fable 5, Fable 5.1 | `AccessDeniedException: ... is not available for this account` | Account entitlement, not IAM. The policy does not mention them; the account simply is not enabled for them |
| Opus 4.6 | `on-demand throughput isn't supported` | No `us.` inference profile exists for it in this account |

The practical rule: **call `converse` before designing around a model.** The deny
policy is readable if you want the full list:

```sh
aws iam get-policy-version \
  --policy-arn arn:aws:iam::087328706621:policy/ws-deny-bedrock-models-policy-1 \
  --version-id "$(aws iam get-policy \
      --policy-arn arn:aws:iam::087328706621:policy/ws-deny-bedrock-models-policy-1 \
      --query 'Policy.DefaultVersionId' --output text)" \
  --query 'PolicyVersion.Document'
```

Non-Anthropic fallbacks that do respond: `us.amazon.nova-pro-v1:0`,
`us.amazon.nova-lite-v1:0`, `us.amazon.nova-micro-v1:0`.

## 4. Services relevant to AccessLens

Verified by calling each one:

| Service | State | Relevance |
| --- | --- | --- |
| Polly | Works — `describe-voices` returns the en-US set | Hear mode audio description, `SYSTEM_DESIGN.md` §7 authoring stretch |
| Translate | Works — round-tripped `hello` → `hola` | Read mode approved language support |
| Lambda | List access confirmed | Part 4 relay handlers |
| DynamoDB | List access confirmed | Part 4 session/connection state with TTL |
| API Gateway v2 | List access confirmed | Part 4 WebSocket transport |
| S3 | List access confirmed | Versioned Access Pack assets |
| CloudFormation | List access confirmed | CDK deployment |
| IAM | Read-only, plus `PassRole` limited to `WSParticipantRole` | Constrains what CDK can create |

**What is not verified:** every entry above except Bedrock, Polly, and Translate
was checked with a **read-only list call**. Nobody has created a Lambda, a table,
a WebSocket API, or run `cdk deploy` in this account. Read access does not prove
write access, which is precisely the mistake §3 documents. Whoever takes Part 4
should deploy a throwaway stack early rather than assume — and should expect the
`PassRole` restriction to matter, because CDK wants to create execution roles.

The charter's data rules are unchanged by any of this: `docs/PROJECT_CHARTER.md`
still governs what may be sent to a third-party service, and nothing here
authorizes sending student data or unreviewed course content to Bedrock, Polly,
or Translate.
