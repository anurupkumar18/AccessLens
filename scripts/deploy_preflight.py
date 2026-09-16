"""Is this repository ready to deploy the demo?

Five people are building five parts against one three-minute demo, on an AWS
account that expires when the event does. The failure mode this exists to stop
is discovering at hour 46 that something nobody owned was never done.

It answers one question per part -- is the thing that part must contribute to a
deploy actually present and green? -- plus the environment and account checks
that belong to nobody in particular and are therefore the easiest to skip.

It is deliberately shallow about other people's code. It checks that a part's
deployable artifact exists and that its own checks pass; it does not judge how
the part is written. That is what review is for.

Usage:
  python3 scripts/deploy_preflight.py           # local checks only
  python3 scripts/deploy_preflight.py --aws     # also probe the AWS account
Exit 0 when a deploy could proceed, 1 when something required is missing.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

READY, MISSING, WARN, SKIPPED = "READY", "MISSING", "WARN", "SKIPPED"
BLOCKING = {MISSING}


@dataclass
class Check:
    part: str
    name: str
    status: str
    detail: str


def _has_source(*relative: str) -> bool:
    """True when at least one path exists and contains real source files."""
    for candidate in relative:
        path = ROOT / candidate
        if path.is_dir() and any(
            child.suffix in {".ts", ".tsx", ".js", ".py"} for child in path.rglob("*")
        ):
            return True
        if path.is_file():
            return True
    return False


def _run(command: list[str]) -> tuple[bool, str]:
    try:
        done = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, timeout=600)
    except Exception as error:  # noqa: BLE001 - report, never crash the preflight
        return False, f"{type(error).__name__}"
    tail = (done.stdout + done.stderr).strip().splitlines()
    return done.returncode == 0, tail[-1][:120] if tail else ""


def check_part1() -> list[Check]:
    checks = []
    manifest = ROOT / "dist" / "manifest.json"
    if not manifest.exists():
        checks.append(Check("1", "built extension in dist/", MISSING, "run `npm run build`"))
    else:
        data = json.loads(manifest.read_text(encoding="utf-8"))
        problems = []
        if data.get("manifest_version") != 3:
            problems.append("not Manifest V3")
        for field, relative in (
            ("background.service_worker", data.get("background", {}).get("service_worker")),
            ("side_panel.default_path", data.get("side_panel", {}).get("default_path")),
        ):
            if relative and not (ROOT / "dist" / relative).exists():
                problems.append(f"{field} -> {relative} missing")
        index = ROOT / "dist" / "index.html"
        if index.exists():
            for asset in re.findall(r'(?:src|href)="\./?(assets/[^"]+)"', index.read_text(encoding="utf-8")):
                if not (ROOT / "dist" / asset).exists():
                    problems.append(f"{asset} referenced but absent")
        checks.append(
            Check("1", "built extension in dist/", MISSING if problems else READY,
                  "; ".join(problems) or f"MV3, {len(data.get('permissions', []))} permissions")
        )
    contracts = sorted((ROOT / "packages" / "contracts").glob("*.schema.json"))
    checks.append(
        Check("1", "shared contracts", READY if contracts else MISSING,
              ", ".join(p.stem for p in contracts) or "packages/contracts/ is empty")
    )
    return checks


def check_part2() -> list[Check]:
    present = _has_source("apps/extension/src/instructor", "apps/extension/src/sources/screen")
    return [Check("2", "instructor capture + matcher", READY if present else MISSING,
                  "present" if present else "no source under src/instructor/ or src/sources/screen/")]


def check_part3() -> list[Check]:
    checks = []
    for label, paths in (
        ("student view", ("apps/extension/src/student",)),
        ("accessible renderers", ("apps/extension/src/renderers",)),
        ("AR scene (required renderer)", ("apps/extension/src/ar",)),
    ):
        present = _has_source(*paths)
        checks.append(Check("3", label, READY if present else MISSING,
                            "present" if present else f"no source under {paths[0]}/"))
    return checks


def check_part4() -> list[Check]:
    present = _has_source("infra", "services/live-session")
    return [Check("4", "session service + infrastructure", READY if present else MISSING,
                  "present" if present else "no source under infra/ or services/live-session/")]


def check_part5() -> list[Check]:
    pack = ROOT / "packages" / "access-packs" / "bio-cell-demo"
    if not (pack / "pack.json").exists():
        return [Check("5", "reviewed Access Pack", MISSING, "pack.json absent")]
    ok, detail = _run([sys.executable, str(pack / "tools" / "validate_pack.py")])
    checks = [Check("5", "reviewed Access Pack", READY if ok else MISSING, detail)]
    ok, detail = _run([sys.executable, str(pack / "tools" / "simulate_events.py"), "--list"])
    checks.append(
        Check("5", "fallback event replay", READY if ok else MISSING,
              "simulator runs" if ok else detail)
    )
    return checks


def check_environment() -> list[Check]:
    example = ROOT / ".env.example"
    if not example.exists():
        return [Check("-", "environment contract", MISSING, ".env.example absent")]
    names = re.findall(r"^([A-Z][A-Z0-9_]+)=", example.read_text(encoding="utf-8"), re.M)
    local = ROOT / ".env.local"
    filled = {}
    if local.exists():
        filled = dict(
            re.findall(r"^([A-Z][A-Z0-9_]+)=(.*)$", local.read_text(encoding="utf-8"), re.M)
        )
    unset = [n for n in names if not (filled.get(n) or os.environ.get(n))]
    # Not blocking: the extension runs network-free for local development, and
    # these only need real values once Part 4 has something deployed to point at.
    return [
        Check("-", "frozen env vars have values", WARN if unset else READY,
              f"unset: {', '.join(unset)}" if unset else f"all {len(names)} set")
    ]


def check_aws() -> list[Check]:
    try:
        import boto3  # noqa: PLC0415 - optional dependency
        from botocore.exceptions import BotoCoreError, ClientError
    except ImportError:
        return [Check("4", "AWS account", SKIPPED, "boto3 not installed")]

    checks = []
    try:
        identity = boto3.client("sts").get_caller_identity()
    except (ClientError, BotoCoreError) as error:
        return [Check("4", "AWS credentials", MISSING, f"{type(error).__name__} — export fresh credentials")]
    checks.append(Check("4", "AWS credentials", READY, f"account {identity['Account']}"))

    try:
        version = boto3.client("ssm").get_parameter(Name="/cdk-bootstrap/hnb659fds/version")
        checks.append(Check("4", "CDK bootstrap", READY, f"version {version['Parameter']['Value']}"))
    except Exception:  # noqa: BLE001 - any failure means "not bootstrapped"
        checks.append(
            Check("4", "CDK bootstrap", WARN,
                  "not bootstrapped — run `npx cdk bootstrap` once before the first deploy")
        )

    try:
        stacks = boto3.client("cloudformation").describe_stacks()["Stacks"]
        names = {s["StackName"] for s in stacks}
        for label, stack in (
            ("live session stack", "AccessLensLiveSession"),
            ("orb explain stack", "AccessLensOrbExplain"),
            ("distribution stack", "AccessLensDistribution"),
        ):
            checks.append(
                Check("4", label, READY if stack in names else WARN,
                      "deployed" if stack in names else f"{stack} not deployed")
            )
    except (ClientError, BotoCoreError) as error:
        checks.append(Check("4", "deployed stacks", WARN, type(error).__name__))

    try:
        apis = boto3.client("apigatewayv2").get_apis().get("Items", [])
        live = [a["Name"] for a in apis if a.get("ProtocolType") == "WEBSOCKET"]
        checks.append(
            Check("4", "deployed WebSocket API", READY if live else WARN,
                  ", ".join(live) if live else "none deployed yet")
        )
    except (ClientError, BotoCoreError) as error:
        checks.append(Check("4", "deployed WebSocket API", WARN, type(error).__name__))
    return checks


def main() -> int:
    checks: list[Check] = []
    checks += check_part1()
    checks += check_part2()
    checks += check_part3()
    checks += check_part4()
    checks += check_part5()
    checks += check_environment()
    if "--aws" in sys.argv[1:]:
        checks += check_aws()
    else:
        checks.append(Check("4", "AWS account", SKIPPED, "pass --aws to probe"))

    width = max(len(c.name) for c in checks)
    mark = {READY: "✓", MISSING: "✗", WARN: "!", SKIPPED: "·"}
    print("AccessLens deploy preflight\n")
    for check in checks:
        print(f"  {mark[check.status]} part {check.part:1s}  {check.name:{width}s}  {check.detail}")

    blocking = [c for c in checks if c.status in BLOCKING]
    print()
    if blocking:
        print(f"NOT ready to deploy — {len(blocking)} required item(s) missing:")
        for check in blocking:
            print(f"  - part {check.part}: {check.name} — {check.detail}")
        print("\nThis is expected while parts are still being built. It becomes a")
        print("problem only if it is still true near feature freeze.")
        return 1
    print("Ready to deploy: every part has contributed its deployable artifact.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
