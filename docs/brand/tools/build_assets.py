#!/usr/bin/env python3
"""Write every Heron SVG asset from one drawing.

Run from the repository root, after `pnpm install` in site/:

    python3 docs/brand/tools/build_assets.py

The social preview embeds the Latin subsets of Inter and JetBrains Mono from
site/node_modules (SIL Open Font License 1.1) as data URIs, so it renders the
same on a machine with neither font installed. Rasterise the PNGs with any SVG
renderer that loads data-URI fonts, for example headless Chromium.
"""
import base64
from pathlib import Path

import build_tokens as T

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / "docs" / "brand" / "assets"
P = T.PALETTE

# The heron on the rim, in a 200 x 280 box, facing left. The feet stand on y 277.
# BODY and NECK are filled; HEAD is an ellipse; BILL is the dagger. There is no eye.
BODY = "M100 138 C104 116 126 106 148 112 C168 118 180 146 194 188 C172 183 150 182 134 180 C112 176 98 160 100 138 Z"
NECK = "M126 113 C112 96 97 96 91 80 C85 64 72 58 58 64 L51 77 C61 76 68 82 72 92 C78 107 94 117 102 136 Z"
HEAD = (51, 70, 11.5, 7.5, 52)
BILL = "M42 72 L49 79 L17 120 Z"
PLUME = "M57 63 C66 55 78 54 90 58"
WING = "M116 132 C136 124 164 142 188 182"
LEGS = "M132 178 L128 228 L131 276 M142 178 L146 228 L150 276"
FEET = "M116 277 H139 M139 277 L147 272 M140 277 H166"

# Wordmark "heron", monoline. x-height 40 (y 40..80), ascender at y 16, baseline at y 80. Advance width 216.
WORD = " ".join([
    "M8 16 V80 M8 58 C8 46 16 40 26 40 C36 40 42 46 42 56 V80",
    "M50 60 H90 A20 20 0 1 0 85.3 72.9",
    "M100 40 V80 M100 56 C100 46 108 40 120 40",
    "M150 40 A20 20 0 1 1 149.99 40 Z",
    "M182 40 V80 M182 58 C182 46 190 40 200 40 C210 40 216 46 216 56 V80",
])


def figure(style):
    """The heron drawing. style is 'duo-dark', 'duo-light', or a hex colour for one-colour versions."""
    cx, cy, rx, ry, rot = HEAD
    head = f'<ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}" transform="rotate({rot} {cx} {cy})"/>'
    if style in ("duo-dark", "duo-light"):
        fill, edge, bill, leg = ((P["night-2"], P["frost"], P["frost"], P["frost-2"]) if style == "duo-dark"
                                 else ("#E9EBF0", P["ink"], P["ink"], P["ink-2"]))
        return (f'<g fill="{fill}" stroke="{edge}" stroke-opacity="0.72" stroke-width="1.6" stroke-linejoin="round">'
                f'<path d="{BODY}"/><path d="{NECK}"/>{head}</g>'
                f'<path d="{BILL}" fill="{bill}"/>'
                f'<g fill="none" stroke-linecap="round" stroke-linejoin="round">'
                f'<path d="{WING}" stroke="{edge}" stroke-opacity="0.35" stroke-width="1.4"/>'
                f'<path d="{PLUME}" stroke="{edge}" stroke-opacity="0.6" stroke-width="1.6"/>'
                f'<path d="{LEGS} {FEET}" stroke="{leg}" stroke-width="3.2"/></g>')
    return (f'<g fill="{style}"><path d="{BODY}"/><path d="{NECK}"/>{head}<path d="{BILL}"/></g>'
            f'<g fill="none" stroke="{style}" stroke-linecap="round" stroke-linejoin="round">'
            f'<path d="{PLUME}" stroke-width="2.4"/><path d="{LEGS} {FEET}" stroke-width="4.4"/></g>')


GLOW = (f'<defs><radialGradient id="g" cx="0.5" cy="0.92" r="0.6">'
        f'<stop offset="0" stop-color="{P["plume"]}" stop-opacity="0.28"/>'
        f'<stop offset="1" stop-color="{P["plume"]}" stop-opacity="0"/></radialGradient></defs>')


def mark(style, rim, glow=False, size=128):
    """The mark faces right, toward the wordmark: the drawing mirrored, standing on the rim line."""
    g = GLOW + '<rect x="0" y="40" width="128" height="80" fill="url(#g)"/>' if glow else ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 128 128" role="img" aria-label="Heron">'
            f'<title>Heron</title>{g}<g transform="translate(104 6) scale(-0.4 0.4)">{figure(style)}</g>'
            f'<path d="M12 117.2 H116" stroke="{rim}" stroke-width="1.2" stroke-linecap="round"/></svg>\n')


def lockup(style, word, rim, glow=False):
    g = GLOW + '<rect x="0" y="40" width="128" height="80" fill="url(#g)"/>' if glow else ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="344" height="128" viewBox="0 0 344 128" role="img" aria-label="Heron">'
            f'<title>Heron</title>{g}<g transform="translate(104 6) scale(-0.4 0.4)">{figure(style)}</g>'
            f'<g transform="translate(130 45) scale(0.9)"><path d="{WORD}" fill="none" stroke="{word}" stroke-width="3.8" '
            f'stroke-linecap="round" stroke-linejoin="round"/></g>'
            f'<path d="M12 117.2 H332" stroke="{rim}" stroke-width="1.2" stroke-linecap="round"/></svg>\n')


def favicon():
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64" role="img" aria-label="Heron">'
            f'<title>Heron</title><rect width="64" height="64" rx="14" fill="{P["night"]}"/>'
            f'<rect x="0.5" y="0.5" width="63" height="63" rx="13.5" fill="none" stroke="#FFFFFF" stroke-opacity="0.12"/>'
            f'<g transform="translate(49 3) scale(-0.19 0.19)">{figure(P["frost"])}</g>'
            f'<path d="M10 55.8 H54" stroke="{P["plume"]}" stroke-width="1.6" stroke-linecap="round"/></svg>\n')


def font_face(family, path):
    data = base64.b64encode(path.read_bytes()).decode()
    return f"@font-face{{font-family:'{family}';src:url(data:font/woff2;base64,{data}) format('woff2');font-weight:100 900}}"


def social():
    nm = ROOT / "site" / "node_modules" / "@fontsource-variable"
    inter = font_face("Heron Inter", nm / "inter" / "files" / "inter-latin-opsz-normal.woff2")
    mono = font_face("Heron Mono", nm / "jetbrains-mono" / "files" / "jetbrains-mono-latin-wght-normal.woff2")
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="640" viewBox="0 0 1280 640" role="img" aria-label="Heron: every line passes the heron.">
<title>Heron: every line passes the heron.</title>
<style>{inter}{mono}
.h{{font-family:'Heron Inter';font-weight:520;font-size:92px;letter-spacing:-4px;font-variation-settings:'opsz' 32}}
.s{{font-family:'Heron Inter';font-weight:400;font-size:28px;letter-spacing:-0.3px}}
.m{{font-family:'Heron Mono';font-weight:400;font-size:20px}}</style>
<defs>
<linearGradient id="t" x1="0" y1="0" x2="0" y2="1"><stop offset="0.25" stop-color="{P["frost"]}"/><stop offset="1" stop-color="{P["frost"]}" stop-opacity="0.5"/></linearGradient>
<radialGradient id="glow" cx="0.74" cy="0.62" r="0.42"><stop offset="0" stop-color="{P["plume"]}" stop-opacity="0.22"/><stop offset="1" stop-color="{P["plume"]}" stop-opacity="0"/></radialGradient>
<linearGradient id="beam" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0"/><stop offset="0.5" stop-color="#FFFFFF" stop-opacity="0.05"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/></linearGradient>
<linearGradient id="rim" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0"/><stop offset="0.7" stop-color="#FFFFFF" stop-opacity="0.45"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/></linearGradient>
<linearGradient id="face" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{P["night-1"]}"/><stop offset="1" stop-color="{P["night"]}"/></linearGradient>
</defs>
<rect width="1280" height="640" fill="{P["night"]}"/>
<rect width="1280" height="640" fill="url(#glow)"/>
<path d="M620 0 L980 0 L760 400 L520 400 Z" fill="url(#beam)"/>
<rect x="0" y="400" width="1280" height="240" fill="url(#face)"/>
<path d="M0 400.5 H1280" stroke="url(#rim)" stroke-width="1"/>
<g transform="translate(912 208) scale(0.69)">{figure("duo-dark")}</g>
<text x="80" y="486" class="h" fill="url(#t)">Every line passes the heron.</text>
<text x="80" y="546" class="s" fill="{P["frost-2"]}">Self-hosted code review for GitLab merge requests.</text>
<text x="80" y="588" class="m" fill="{P["frost-3"]}">github.com/NickSuomi/heron</text>
<text x="80" y="112" class="m" fill="{P["frost-2"]}">heron</text>
</svg>
'''


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    files = {
        "heron-mark.svg": mark("duo-light", P["ink-2"]),
        "heron-mark-on-dark.svg": mark("duo-dark", P["frost-3"], glow=True),
        "heron-mark-mono-ink.svg": mark(P["ink"], P["ink"]),
        "heron-mark-mono-white.svg": mark("#FFFFFF", "#FFFFFF"),
        "heron-lockup.svg": lockup("duo-light", P["ink"], P["ink-2"]),
        "heron-lockup-on-dark.svg": lockup("duo-dark", P["frost"], P["frost-3"], glow=True),
        "heron-lockup-mono-ink.svg": lockup(P["ink"], P["ink"], P["ink"]),
        "heron-lockup-mono-white.svg": lockup("#FFFFFF", "#FFFFFF", "#FFFFFF"),
        "favicon.svg": favicon(),
        "social-preview.svg": social(),
    }
    for name, text in files.items():
        (OUT / name).write_text(text)
        print(f"{name} {len(text.encode())}")
