"""Render the pack as a single page a human reviewer can actually check.

Implementation-plan task **A15** asks for review by a biology instructor and an
accessibility or instructional-design professional. Neither can review a
`pack.json` and a folder of PNGs. What they need is every region drawn on the
slide it belongs to, next to the exact words a student will be given.

This generates that: `review/content-review-sheet.html`, standard library only,
referencing the slides by relative path rather than embedding them so the file
stays a few kilobytes. Open it in a browser from the `review/` directory.

Drawing the boxes from the same normalized `bounds` a student renderer receives
also makes the geometry checkable by eye. A region whose box does not sit on the
structure it names is a content bug no schema can catch.

Usage:  python3 packages/access-packs/bio-cell-demo/tools/generate_review_sheet.py
Verify: add --check to fail instead of writing when the page is out of date.
"""

from __future__ import annotations

import html
import json
import sys
from pathlib import Path

PACK_ROOT = Path(__file__).resolve().parents[1]
PACK_FILE = PACK_ROOT / "pack.json"
TARGET = PACK_ROOT / "review" / "content-review-sheet.html"

STYLE = """
:root {
  color-scheme: light dark;
  --bg: #fbfcfe; --panel: #ffffff; --ink: #14181f; --muted: #5b6676;
  --line: #dfe4ec; --accent: #2f5fa8; --warn-bg: #fff6e6; --warn-line: #e0a63c;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #12151a; --panel: #1a1f26; --ink: #e8ecf2; --muted: #9aa5b4;
    --line: #2b323c; --accent: #7aa7e8; --warn-bg: #2e2617; --warn-line: #c9962f;
  }
}
* { box-sizing: border-box; }
body { margin: 0; padding: 2rem 1.25rem 4rem; background: var(--bg); color: var(--ink);
  font: 16px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
main { max-width: 1040px; margin: 0 auto; }
h1 { font-size: 1.9rem; margin: 0 0 .25rem; letter-spacing: -.02em; }
h2 { font-size: 1.25rem; margin: 2.5rem 0 .75rem; letter-spacing: -.01em; }
h3 { font-size: .95rem; margin: 1.25rem 0 .5rem; color: var(--muted);
  text-transform: uppercase; letter-spacing: .07em; }
p.lede { color: var(--muted); margin: 0 0 1.5rem; }
.notice { background: var(--warn-bg); border: 1px solid var(--warn-line);
  border-radius: 10px; padding: 1rem 1.15rem; margin: 1.5rem 0; }
.notice strong { display: block; margin-bottom: .35rem; }
.slide { background: var(--panel); border: 1px solid var(--line); border-radius: 12px;
  padding: 1.25rem; margin: 1.5rem 0; }
.frame { position: relative; line-height: 0; border: 1px solid var(--line);
  border-radius: 8px; overflow: hidden; }
.frame img { width: 100%; height: auto; display: block; }
.box { position: absolute; border: 2px solid var(--accent); border-radius: 6px;
  background: rgba(47,95,168,.08); }
.box span { position: absolute; top: -1.45rem; left: -2px; background: var(--accent);
  color: #fff; font: 600 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
  padding: .12rem .4rem; border-radius: 4px; white-space: nowrap; }
table { width: 100%; border-collapse: collapse; margin-top: .75rem; font-size: .9rem; }
th, td { text-align: left; padding: .5rem .6rem; border-bottom: 1px solid var(--line);
  vertical-align: top; }
th { color: var(--muted); font-weight: 600; font-size: .78rem;
  text-transform: uppercase; letter-spacing: .05em; }
code { font: .87em ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--accent); }
.order { display: flex; flex-wrap: wrap; gap: .4rem; margin: .5rem 0 0; padding: 0; list-style: none; }
.order li { background: var(--bg); border: 1px solid var(--line); border-radius: 999px;
  padding: .2rem .7rem; font-size: .83rem; }
.order li b { color: var(--muted); font-weight: 600; }
.scroll { overflow-x: auto; }
footer { margin-top: 3rem; padding-top: 1.25rem; border-top: 1px solid var(--line);
  color: var(--muted); font-size: .85rem; }
"""


def esc(value: object) -> str:
    return html.escape(str(value), quote=True)


def render(pack: dict) -> str:
    review = pack.get("review", {})
    parts: list[str] = []
    add = parts.append

    # A standalone file opened from disk or a plain static server, so it needs
    # its own document shell. Without the charset declaration the em dashes in
    # the reviewed copy render as mojibake, which is a poor first impression on
    # a page whose entire job is careful reading of text.
    add("<!doctype html>")
    add('<html lang="en">')
    add("<head>")
    add('<meta charset="utf-8">')
    add('<meta name="viewport" content="width=device-width, initial-scale=1">')
    add(f"<title>{esc(pack['title'])} — content review</title>")
    add(f"<style>{STYLE}</style>")
    add("</head>")
    add("<body>")
    add("<main>")
    add(f"<h1>{esc(pack['title'])} — content review sheet</h1>")
    add(
        f"<p class='lede'>Access Pack <code>{esc(pack['packId'])}</code> version "
        f"{esc(pack['version'])}. Every region is drawn from the same normalized "
        "bounds a student renderer receives, so what you see here is what a student "
        "gets.</p>"
    )

    if not review.get("externalSubjectMatterReview", False):
        add(
            "<div class='notice'><strong>This content has not been reviewed by a "
            "subject-matter expert.</strong>"
            "That review is implementation-plan task A15, and it is what this page "
            "exists to support. Until it is done, the pack must not be described as "
            "expert-reviewed or accessibility-audited anywhere in the demo or the "
            "pitch.</div>"
        )

    add("<h2>What to check</h2>")
    add(
        "<ol>"
        "<li>Does each box sit on the structure it names? A box in the wrong place "
        "sends every student to the wrong part of the diagram, and no automated "
        "check can catch it.</li>"
        "<li>Is each <b>description</b> accurate for an introductory course?</li>"
        "<li>Does each <b>plain language</b> line say the same thing more simply, "
        "rather than saying something different or less true?</li>"
        "<li>Does the reading order match how you would teach the slide?</li>"
        "<li>Does each AR node name the structure the region names?</li>"
        "</ol>"
    )

    for index, asset in enumerate(pack["assets"], start=1):
        add("<div class='slide'>")
        add(f"<h2>{index}. {esc(asset['title'])}</h2>")
        if asset.get("subtitle"):
            add(f"<p class='lede'>{esc(asset['subtitle'])}</p>")

        add("<div class='frame'>")
        add(f"<img src='../{esc(asset['mediaUri'])}' alt='{esc(asset['title'])}'>")
        for region in asset["regions"]:
            bounds = region["bounds"]
            add(
                "<div class='box' style='left:{:.4%};top:{:.4%};width:{:.4%};height:{:.4%}'>"
                "<span>{}</span></div>".format(
                    bounds["x"], bounds["y"], bounds["width"], bounds["height"],
                    esc(region.get("label", region["regionId"])),
                )
            )
        add("</div>")

        add("<h3>Reading order</h3>")
        add("<ul class='order'>")
        for position, entry in enumerate(asset["readingOrder"], start=1):
            add(f"<li><b>{position}</b> &nbsp;{esc(entry)}</li>")
        add("</ul>")

        hotspots = {h["regionId"]: h for h in asset["arScene"]["hotspots"]}
        add("<h3>Regions and the words a student is given</h3>")
        add("<div class='scroll'><table>")
        add(
            "<tr><th>Region</th><th>Description</th><th>Plain language</th>"
            "<th>AR node</th><th>Camera</th></tr>"
        )
        for region in asset["regions"]:
            hotspot = hotspots.get(region["regionId"], {})
            add(
                "<tr>"
                f"<td><b>{esc(region.get('label', ''))}</b><br><code>{esc(region['regionId'])}</code></td>"
                f"<td>{esc(region['shortDescription'])}</td>"
                f"<td>{esc(region['plainLanguage'])}</td>"
                f"<td><code>{esc(hotspot.get('nodeName', '—'))}</code></td>"
                f"<td><code>{esc(hotspot.get('cameraTarget', '—'))}</code></td>"
                "</tr>"
            )
        add("</table></div>")
        add("</div>")

    statements = [
        (asset["assetId"], region["regionId"], text)
        for asset in pack["assets"]
        for region in asset["regions"]
        for text in (region["shortDescription"], region["plainLanguage"])
    ]
    add("<h2>Every student-facing sentence, in one list</h2>")
    add(
        "<p class='lede'>The same text as above, without the pictures, for reading "
        f"straight through. {len(statements)} statements.</p>"
    )
    add("<div class='scroll'><table>")
    add("<tr><th>Slide</th><th>Region</th><th>Statement</th></tr>")
    for asset_id, region_id, text in statements:
        add(
            f"<tr><td><code>{esc(asset_id)}</code></td>"
            f"<td><code>{esc(region_id)}</code></td><td>{esc(text)}</td></tr>"
        )
    add("</table></div>")

    add(
        "<footer>Generated by <code>tools/generate_review_sheet.py</code> from "
        "<code>pack.json</code>. Do not edit this file; change the content in "
        "<code>tools/deck.py</code> and regenerate. Asset sources and licences are "
        "in <code>PROVENANCE.md</code>.</footer>"
    )
    add("</main>")
    add("</body>")
    add("</html>")
    return "\n".join(parts) + "\n"


def main() -> int:
    pack = json.loads(PACK_FILE.read_text(encoding="utf-8"))
    page = render(pack)

    if "--check" in sys.argv[1:]:
        if not TARGET.exists():
            print(f"{TARGET.relative_to(PACK_ROOT)} does not exist; run without --check")
            return 1
        if TARGET.read_text(encoding="utf-8") != page:
            print(
                f"{TARGET.relative_to(PACK_ROOT)} is out of date with pack.json. "
                "Rerun generate_review_sheet.py."
            )
            return 1
        print(f"{TARGET.relative_to(PACK_ROOT)} is up to date.")
        return 0

    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text(page, encoding="utf-8")
    regions = sum(len(asset["regions"]) for asset in pack["assets"])
    print(f"wrote {TARGET.relative_to(PACK_ROOT)} ({len(pack['assets'])} slides, {regions} regions)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
