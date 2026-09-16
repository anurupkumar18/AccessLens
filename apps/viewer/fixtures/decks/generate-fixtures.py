#!/usr/bin/env python3
"""Regenerate the deterministic ingest fixtures.

Requires LibreOffice (`soffice`) on PATH. The Flat ODP is converted once to a
PPTX and once to a PDF; the ingest tests then convert the PPTX to PDF using the
same private-profile command as scripts/build-pack.ts.
"""
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent
FODP = ROOT / "mixed-subject.fodp"
PPTX = ROOT / "generated-mixed-subject.pptx"
PDF = ROOT / "mixed-subject.pdf"

slides = [
    ("Sorting algorithm", "Compare 4, 2, 3, 1", "Scan left to right; move the smallest value to the front."),
    ("Titration curve", "pH rises as base is added", "The equivalence point is near the steep part of the curve."),
    ("Supply and demand", "Price / Quantity", "Demand slopes down while supply slopes up; their crossing is equilibrium."),
    ("Cell diagram", "Nucleus | membrane | mitochondria", "The cell membrane surrounds the organelles shown inside."),
    ("Timeline", "1900  1950  2000  2050", "Events are arranged from earlier years on the left to later years on the right."),
    ("Circuit", "Battery -> resistor -> LED", "A closed loop carries current from the battery through the resistor and LED."),
    ("Normal distribution", "Mean at center; tails at both ends", "Most values cluster near the center of the bell-shaped curve."),
    ("Map", "North | river | three towns", "A north arrow, a river, and three labeled towns appear on the map."),
]


def esc(value: str) -> str:
    return (value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


def page(index: int, title: str, line1: str, line2: str) -> str:
    # Deliberately plain text and shapes keep this fixture small and portable;
    # the subjects, not a model, are what this fixture is intended to exercise.
    return f'''<draw:page draw:name="page{index}" draw:style-name="dp{index}">
  <draw:frame svg:x="2cm" svg:y="2cm" svg:width="24cm" svg:height="2cm">
    <draw:text-box><text:p><text:span text:style-name="title">{esc(title)}</text:span></text:p></draw:text-box>
  </draw:frame>
  <draw:frame svg:x="2cm" svg:y="5cm" svg:width="24cm" svg:height="2cm">
    <draw:text-box><text:p><text:span text:style-name="body">{esc(line1)}</text:span></text:p></draw:text-box>
  </draw:frame>
  <draw:frame svg:x="2cm" svg:y="8cm" svg:width="24cm" svg:height="3cm">
    <draw:text-box><text:p><text:span text:style-name="body">{esc(line2)}</text:span></text:p></draw:text-box>
  </draw:frame>
</draw:page>'''


def write_fodp() -> None:
    styles = "".join(
        f'<style:style style:name="dp{i}" style:family="drawing-page"><style:drawing-page-properties draw:fill="solid" draw:fill-color="#{"F5F9FF" if i % 2 else "FFFFFF"}"/></style:style>'
        for i in range(1, len(slides) + 1)
    )
    content = f'''<?xml version="1.0" encoding="UTF-8"?>
<office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
 xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"
 xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
 xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"
 xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"
 xmlns:xlink="http://www.w3.org/1999/xlink"
 xmlns:svg="http://www.w3.org/2000/svg"
 xmlns:presentation="urn:oasis:names:tc:opendocument:xmlns:presentation:1.0"
 office:version="1.2" office:mimetype="application/vnd.oasis.opendocument.presentation">
 <office:font-face-decls><style:font-face style:name="Liberation Sans" svg:font-family="Liberation Sans"/></office:font-face-decls>
 <office:styles>
  <style:style style:name="title" style:family="text"><style:text-properties fo:font-size="30pt" fo:font-weight="bold" fo:color="#123A66"/></style:style>
  <style:style style:name="body" style:family="text"><style:text-properties fo:font-size="20pt" fo:color="#17212B"/></style:style>
 </office:styles>
 <office:automatic-styles>{styles}</office:automatic-styles>
 <office:master-styles><style:master-page style:name="Default"/></office:master-styles>
 <office:body><office:presentation>{''.join(page(i, *slide) for i, slide in enumerate(slides, 1))}</office:presentation></office:body>
</office:document>
'''
    FODP.write_text(content, encoding="utf-8")


def convert(target: str, out_dir: Path) -> None:
    profile = out_dir / f"profile-{target}"
    profile.mkdir(parents=True, exist_ok=True)
    subprocess.run([
        "soffice", f"-env:UserInstallation=file://{profile}", "--headless",
        "--convert-to", target, "--outdir", str(out_dir), str(FODP),
    ], check=True)


write_fodp()
with tempfile.TemporaryDirectory(prefix="accesslens-fixtures-") as temp:
    out = Path(temp)
    convert("pptx", out)
    convert("pdf", out)
    (out / "mixed-subject.pptx").replace(PPTX)
    (out / "mixed-subject.pdf").replace(PDF)
print(f"wrote {PPTX}")
print(f"wrote {PDF}")
