"""Which AWS services can this account actually use?

`docs/AWS_FEATURE_MAP.md` plans against a list of available services. A list
that was true once and is never re-checked is how a team discovers on demo day
that a service it designed around was never enabled -- so the list is
reproducible rather than remembered.

Every probe is a cheap read-only call. A `ValidationException` or
`ResourceNotFoundException` counts as available: the call reached the service
and was rejected on its arguments, which means IAM let it through.

Usage:  python3 scripts/aws_capability_probe.py
        python3 scripts/aws_capability_probe.py --expect docs/AWS_FEATURE_MAP.md
"""

from __future__ import annotations

import sys
import warnings

warnings.filterwarnings("ignore")

# (client name, human label, probe). Ordered roughly by relevance to the product.
PROBES = [
    ("bedrock-runtime", "Bedrock (LLM inference)",
     lambda c: c.converse(modelId="us.anthropic.claude-sonnet-4-6",
                          messages=[{"role": "user", "content": [{"text": "hi"}]}],
                          inferenceConfig={"maxTokens": 5})),
    ("polly", "Polly (neural TTS)", lambda c: c.describe_voices(LanguageCode="en-US")),
    ("transcribe", "Transcribe (speech to text)", lambda c: c.list_transcription_jobs(MaxResults=1)),
    ("translate", "Translate",
     lambda c: c.translate_text(Text="hello", SourceLanguageCode="en", TargetLanguageCode="es")),
    ("comprehend", "Comprehend (NLP)", lambda c: c.detect_dominant_language(Text="hello world")),
    ("textract", "Textract (document OCR)", lambda c: c.list_adapters(MaxResults=1)),
    ("rekognition", "Rekognition (vision)", lambda c: c.list_collections(MaxResults=1)),
    ("bedrock-agent", "Bedrock Agents / Knowledge Bases", lambda c: c.list_knowledge_bases(maxResults=1)),
    ("opensearchserverless", "OpenSearch Serverless (vectors)", lambda c: c.list_collections()),
    ("kendra", "Kendra (enterprise search)", lambda c: c.list_indices(MaxResults=1)),
    ("stepfunctions", "Step Functions", lambda c: c.list_state_machines(maxResults=1)),
    ("events", "EventBridge", lambda c: c.list_event_buses(Limit=1)),
    ("sqs", "SQS", lambda c: c.list_queues(MaxResults=1)),
    ("sns", "SNS", lambda c: c.list_topics()),
    ("cognito-idp", "Cognito (user auth)", lambda c: c.list_user_pools(MaxResults=1)),
    ("appsync", "AppSync (GraphQL)", lambda c: c.list_graphql_apis(maxResults=1)),
    ("sagemaker", "SageMaker", lambda c: c.list_endpoints(MaxResults=1)),
    ("lambda", "Lambda", lambda c: c.list_functions(MaxItems=1)),
    ("dynamodb", "DynamoDB", lambda c: c.list_tables(Limit=1)),
    ("s3", "S3", lambda c: c.list_buckets()),
    ("cloudfront", "CloudFront", lambda c: c.list_distributions()),
    ("apigatewayv2", "API Gateway v2", lambda c: c.get_apis(MaxResults="1")),
]

# The call reached the service and was rejected on its arguments, so IAM allowed
# it. That is "available" for planning purposes.
REACHED_SERVICE = {"ValidationException", "ResourceNotFoundException", "InvalidParameterValue"}


def probe() -> tuple[list[str], list[tuple[str, str]]]:
    import boto3
    from botocore.exceptions import ClientError

    available: list[str] = []
    unavailable: list[tuple[str, str]] = []
    for service, label, call in PROBES:
        try:
            call(boto3.client(service))
            available.append(label)
        except ClientError as error:
            code = error.response["Error"]["Code"]
            if code in REACHED_SERVICE:
                available.append(label)
            else:
                unavailable.append((label, code))
        except Exception as error:  # noqa: BLE001 - a missing client is a real answer
            unavailable.append((label, type(error).__name__))
    return available, unavailable


def main() -> int:
    try:
        import boto3  # noqa: F401
    except ImportError:
        print("boto3 is not installed; cannot probe.")
        return 1

    try:
        import boto3
        identity = boto3.client("sts").get_caller_identity()
    except Exception as error:  # noqa: BLE001
        print(f"No usable AWS credentials ({type(error).__name__}). Export fresh ones.")
        return 1

    available, unavailable = probe()
    print(f"Account {identity['Account']}, {len(available)} of {len(PROBES)} services available.\n")
    for label in available:
        print(f"  + {label}")
    if unavailable:
        print()
        for label, code in unavailable:
            print(f"  - {label} [{code}]")

    if "--expect" in sys.argv:
        from pathlib import Path

        doc = Path(sys.argv[sys.argv.index("--expect") + 1]).read_text(encoding="utf-8")
        drifted = [
            label for label, _ in unavailable
            if f"| **{label}** | available |" in doc or f"| {label} | available |" in doc
        ]
        if drifted:
            print("\nThe feature map claims these are available, and they are not:")
            for label in drifted:
                print(f"  - {label}")
            return 1
        print("\nNo service the feature map depends on has become unavailable.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
