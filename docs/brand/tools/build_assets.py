#!/usr/bin/env python3
"""Write every Heron SVG asset from one set of paths.

Run from the repository root:

    python3 docs/brand/tools/build_assets.py --fonts DIR

DIR holds NunitoSans[YTLC,opsz,wdth,wght].ttf and IBMPlexMono-Regular.ttf from
github.com/google/fonts (SIL Open Font License 1.1). The social preview draws its
text as outlines from those files, so the SVG and PNG need no installed font.
Converting text needs fontTools (pip install fonttools).
Rasterise the PNGs with any SVG renderer (see docs/brand/README.md).
"""
import argparse
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "assets"

MIST = "#EEF2F1"
SLATE = "#4A5A6A"
REED = "#6E8B3D"
AMBER = "#E0A526"
INK = "#1F2A33"
NIGHT = "#151C22"
WHITE = "#FFFFFF"

# The heron, drawn in a 128 x 128 box with a 5-unit round stroke.
# HEAD: crest, crown, forehead.  BEAK: the dagger.  BODY: throat, S-neck,
# chest, belly, tail, back.  LEG: the standing leg.  TUCK: the folded leg.
HEAD = "M52 26 L66 21 C70 16 78 16 82 22"
BEAK = "M82 22 L112 30 L80 30"
BODY = "M80 30 C60 36 54 44 60 51 C66 57 72 60 70 67 C68 74 60 78 50 80 L20 91 C30 76 42 62 58 58"
LEG = "M50 80 V118"
TUCK = "M56 80 L62 89 L54 91"
EYE = (74, 23, 1.6)
WATER = "M24 110 H42 M58 110 H104"

# Wordmark "heron", monoline, same 5-unit stroke. x-height 40 (y 40..80),
# ascender at y 16, baseline at y 80. Advance width 216.
WORD = " ".join([
    "M8 16 V80 M8 58 C8 46 16 40 26 40 C36 40 42 46 42 56 V80",          # h
    "M50 60 H90 A20 20 0 1 0 85.3 72.9",                                   # e
    "M100 40 V80 M100 56 C100 46 108 40 120 40",                           # r
    "M150 40 A20 20 0 1 1 149.99 40 Z",                                    # o
    "M182 40 V80 M182 58 C182 46 190 40 200 40 C210 40 216 46 216 56 V80",  # n
])


def stroke_attrs(width=5):
    return (f'fill="none" stroke-width="{width}" '
            'stroke-linecap="round" stroke-linejoin="round"')


def heron(line, beak, water, eye=True, tuck=True, width=5):
    parts = [
        f'<path d="{HEAD}" stroke="{line}"/>',
        f'<path d="{BEAK}" stroke="{beak}" fill="{beak}"/>',
        f'<path d="{BODY}" stroke="{line}"/>',
        f'<path d="{LEG}" stroke="{line}"/>',
    ]
    if tuck:
        parts.append(f'<path d="{TUCK}" stroke="{line}"/>')
    if eye:
        x, y, r = EYE
        parts.append(f'<circle cx="{x}" cy="{y}" r="{r}" fill="{line}" stroke="none"/>')
    if water:
        parts.append(f'<path d="{WATER}" stroke="{water}" stroke-width="{width * 0.6:g}"/>')
    return f'<g {stroke_attrs(width)}>' + "".join(parts) + "</g>"


def word(color, width=5):
    return f'<path d="{WORD}" stroke="{color}" {stroke_attrs(width)}/>'


def svg(w, h, body, title, bg=None, vb=None):
    vb = vb or f"0 0 {w} {h}"
    rect = f'<rect width="100%" height="100%" fill="{bg}"/>' if bg else ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" '
            f'viewBox="{vb}" role="img" aria-label="{title}"><title>{title}</title>'
            f"{rect}{body}</svg>\n")


def lockup(line, beak, water):
    # Mark in a 128 box. The wordmark (0.95 scale) sits on the water line:
    # its baseline is y 108, just above the water stroke at y 110.
    return heron(line, beak, water) + f'<g transform="translate(132 32) scale(0.95)">{word(line)}</g>'


FILES = {
    "heron-mark.svg": svg(128, 128, heron(SLATE, AMBER, REED), "Heron"),
    "heron-mark-on-dark.svg": svg(128, 128, heron(MIST, AMBER, "#9DBB67"), "Heron"),
    "heron-mark-mono-ink.svg": svg(128, 128, heron(INK, INK, INK), "Heron"),
    "heron-mark-mono-white.svg": svg(128, 128, heron(WHITE, WHITE, WHITE), "Heron"),
    "heron-lockup.svg": svg(344, 128, lockup(SLATE, AMBER, REED), "Heron"),
    "heron-lockup-on-dark.svg": svg(344, 128, lockup(MIST, AMBER, "#9DBB67"), "Heron"),
    "heron-lockup-mono-ink.svg": svg(344, 128, lockup(INK, INK, INK), "Heron"),
    "heron-lockup-mono-white.svg": svg(344, 128, lockup(WHITE, WHITE, WHITE), "Heron"),
    # Favicon: slate tile, heavier stroke, no eye, no water line.
    "favicon.svg": svg(
        32, 32,
        f'<rect width="128" height="128" rx="28" fill="{SLATE}"/>'
        f'<g transform="translate(0 2) translate(64 64) scale(0.94) translate(-66 -67)">'
        f'{heron(MIST, AMBER, None, eye=False, tuck=False, width=9)}</g>',
        "Heron", vb="0 0 128 128"),
}

SANS = ("NunitoSans[YTLC,opsz,wdth,wght].ttf", {"wght": 400, "wdth": 100, "opsz": 12, "YTLC": 500})
MONO = ("IBMPlexMono-Regular.ttf", None)


def num(v):
    return f"{v:.2f}".rstrip("0").rstrip(".")


def text(fonts, x, y, size, color, face, content):
    """One line of text as a filled path. Advances come from hmtx; no kerning."""
    from fontTools.pens.svgPathPen import SVGPathPen
    from fontTools.pens.transformPen import TransformPen
    from fontTools.ttLib import TTFont

    file, location = face
    font = TTFont(fonts / file)
    glyphs = font.getGlyphSet(location=location)
    cmap = font.getBestCmap()
    scale = size / font["head"].unitsPerEm
    pen = SVGPathPen(glyphs, ntos=num)
    advance = 0
    for ch in content:
        glyph = glyphs[cmap[ord(ch)]]
        glyph.draw(TransformPen(pen, (scale, 0, 0, -scale, x + advance * scale, y)))
        advance += glyph.width
    return f'<path fill="{color}" d="{pen.getCommands()}"/>'


def social_preview(fonts):
    return svg(1280, 640, (
        f'<rect width="1280" height="640" fill="{MIST}"/>'
        f'<path d="M0 528 H1280" stroke="#C9D3D1" stroke-width="2"/>'
        f'<g transform="translate(80 104) scale(3.2)">{heron(SLATE, AMBER, REED)}</g>'
        f'<g transform="translate(540 120) scale(1.7)">{word(SLATE)}</g>'
        + text(fonts, 544, 336, 44, INK, SANS, "Calm, exact code review")
        + text(fonts, 544, 390, 44, INK, SANS, "for GitLab merge requests.")
        + text(fonts, 544, 452, 26, SLATE, SANS, "Self-hosted. One report per head.")
        + text(fonts, 544, 488, 26, SLATE, SANS, "Never edits, approves, or merges.")
        + text(fonts, 544, 572, 24, "#4F6A26", MONO, "github.com/NickSuomi/heron")
    ), "Heron: calm, exact code review for GitLab merge requests")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--fonts", type=Path, required=True, help="directory holding the two font files")
    FILES["social-preview.svg"] = social_preview(parser.parse_args().fonts)
    OUT.mkdir(parents=True, exist_ok=True)
    for name, text in FILES.items():
        (OUT / name).write_text(text)
        print(name, len(text.encode()))
