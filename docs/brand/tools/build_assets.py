#!/usr/bin/env python3
"""Write every Heron SVG asset from one drawing, in the Heron OS colours of build_tokens.py.

Run from the repository root:

    python3 docs/brand/tools/build_assets.py

It writes docs/brand/assets/ and the copy the site serves at /brand/assets/ (site/public/brand/assets/).
The social preview embeds Heron Sans (a renamed Selawik subset) from site/public/fonts (SIL Open Font License 1.1) as data URIs and the
Heron OS wallpaper from site/src/assets, so it renders the same on a machine without either. Render the PNGs
with headless Chromium: the mark at 512 by 512 and the social preview at 1280 by 640.
"""
import base64
import re
from pathlib import Path

import build_tokens as T

ROOT = Path(__file__).resolve().parents[3]
OUTS = [ROOT / "docs" / "brand" / "assets", ROOT / "site" / "public" / "brand" / "assets"]
C = T.COLOR

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
        fill, edge, bill, leg = ((C["frame-dark"], C["surface"], C["surface"], C["surface-pane"]) if style == "duo-dark"
                                 else (C["surface-pane"], C["ink-heading"], C["ink-heading"], C["ink-heading"]))
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
        f'<stop offset="0" stop-color="{C["orb-light"]}" stop-opacity="0.3"/>'
        f'<stop offset="1" stop-color="{C["orb-light"]}" stop-opacity="0"/></radialGradient></defs>')


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
    """The Start orb's glass bead in a rounded square, with the heron in white."""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64" role="img" aria-label="Heron">'
            f'<title>Heron</title><defs><radialGradient id="o" cx="0.4" cy="0.28" r="0.85">'
            f'<stop offset="0" stop-color="{C["orb-light"]}"/><stop offset="0.55" stop-color="{C["orb"]}"/>'
            f'<stop offset="1" stop-color="{C["orb-deep"]}"/></radialGradient></defs>'
            f'<rect x="0.5" y="0.5" width="63" height="63" rx="14" fill="url(#o)" stroke="{C["orb-edge"]}"/>'
            f'<path d="M4 26 C4 10 12 4 32 4 C52 4 60 10 60 26 C46 20 18 20 4 26 Z" fill="#FFFFFF" fill-opacity="0.35"/>'
            f'<g transform="translate(49 3) scale(-0.19 0.19)">{figure(C["surface"])}</g>'
            f'<path d="M10 55.8 H54" stroke="#FFFFFF" stroke-opacity="0.8" stroke-width="1.6" stroke-linecap="round"/></svg>\n')


def font_face(family, weight, path):
    data = base64.b64encode(path.read_bytes()).decode()
    return f"@font-face{{font-family:'{family}';src:url(data:font/woff2;base64,{data}) format('woff2');font-weight:{weight}}}"


def wallpaper():
    """The Aurora wallpaper as a nested SVG filling the preview, its ids prefixed so they stay its own."""
    text = (ROOT / "site" / "src" / "assets" / "wallpaper.svg").read_text()
    text = re.sub(r'id="([^"]+)"', r'id="wp-\1"', text)
    text = re.sub(r'url\(#([^)]+)\)', r'url(#wp-\1)', text)
    return text.replace("<svg ", '<svg x="0" y="0" width="1280" height="640" ', 1)


# What the Command Prompt in the preview shows: the start of a dry run of the fictional !42, as Heron OS prints it.
PROMPT_LINES = [
    "C:\\Users\\Visitor>heron review --mr 42 --dry-run",
    "config    loaded, digest 90980f470d74",
    "snapshot  acme/storefront !42 at 9abe74a0, 3 changed files",
    "lane      standard (gated), no rule matched; 4 sessions",
    "start     gate.design       <fast model id>, effort low",
    "start     gate.correctness  <fast model id>, effort low",
    "done      gate.design       2 findings, 61.3 s",
    "start     gate.security     <fast model id>, effort low",
    "done      gate.correctness  2 findings, 88.7 s",
    "done      gate.security     1 finding, 52.4 s",
    "start     supervisor        <strong model id>, effort high",
    "verdict   CHANGES REQUESTED",
]


def esc(text):
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def social():
    fonts = ROOT / "site" / "public" / "fonts"
    faces = "".join(font_face("Heron UI", w, fonts / f"heron-sans-{n}.woff2") for n, w in (("regular", 400), ("semibold", 600), ("bold", 700)))
    x, y, w, h = 712, 124, 528, 376
    lines = "".join(f'<text x="{x + 20}" y="{y + 64 + i * 22}" class="m" xml:space="preserve">{esc(line)}</text>' for i, line in enumerate(PROMPT_LINES))
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="640" viewBox="0 0 1280 640" role="img" aria-label="Heron OS: learn Heron by opening files on a desktop.">
<title>Heron OS: learn Heron by opening files on a desktop.</title>
<style>{faces}
.h{{font-family:'Heron UI';font-weight:400;font-size:96px}}
.s{{font-family:'Heron UI';font-weight:400;font-size:26px}}
.u{{font-family:'Heron UI';font-weight:400;font-size:22px}}
.c{{font-family:'Heron UI';font-weight:400;font-size:13px}}
.m{{font-family:'Lucida Console',Consolas,'DejaVu Sans Mono',monospace;font-size:13.5px;fill:#C0C0C0;white-space:pre}}</style>
<defs>
<linearGradient id="gloss" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0.5"/><stop offset="0.35" stop-color="#FFFFFF" stop-opacity="0.14"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0.06"/></linearGradient>
<linearGradient id="sheen" x1="0" y1="0" x2="1" y2="0.55"><stop offset="0.06" stop-color="#FFFFFF" stop-opacity="0"/><stop offset="0.1" stop-color="#FFFFFF" stop-opacity="0.28"/><stop offset="0.15" stop-color="#FFFFFF" stop-opacity="0.08"/><stop offset="0.19" stop-color="#FFFFFF" stop-opacity="0"/><stop offset="0.52" stop-color="#FFFFFF" stop-opacity="0"/><stop offset="0.57" stop-color="#FFFFFF" stop-opacity="0.18"/><stop offset="0.67" stop-color="#FFFFFF" stop-opacity="0"/></linearGradient>
<radialGradient id="shade" cx="0.3" cy="0.55" r="0.6"><stop offset="0" stop-color="#000000" stop-opacity="0.45"/><stop offset="1" stop-color="#000000" stop-opacity="0"/></radialGradient>
<filter id="drop" x="-10%" y="-10%" width="120%" height="130%"><feGaussianBlur in="SourceAlpha" stdDeviation="12"/><feOffset dy="8"/><feComponentTransfer><feFuncA type="linear" slope="0.55"/></feComponentTransfer><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="halo" x="-10%" y="-60%" width="120%" height="220%"><feMorphology in="SourceAlpha" operator="dilate" radius="1.5" result="d"/><feGaussianBlur in="d" stdDeviation="3.5" result="b"/><feFlood flood-color="#FFFFFF" flood-opacity="0.95" result="f"/><feComposite in="f" in2="b" operator="in" result="h"/><feMerge><feMergeNode in="h"/><feMergeNode in="h"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="lift" x="-10%" y="-10%" width="120%" height="140%"><feGaussianBlur in="SourceAlpha" stdDeviation="4"/><feOffset dy="2"/><feComponentTransfer><feFuncA type="linear" slope="0.6"/></feComponentTransfer><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>
</defs>
{wallpaper()}
<rect width="1280" height="640" fill="url(#shade)"/>
<g filter="url(#lift)">
<g transform="translate(70 96) scale(1.35)"><g transform="translate(104 6) scale(-0.4 0.4)">{figure(C["surface"])}</g></g>
<text x="80" y="376" class="h" fill="#FFFFFF">Heron OS</text>
<text x="86" y="424" class="s" fill="#FFFFFF">Self-hosted code review for GitLab merge requests.</text>
<text x="86" y="462" class="s" fill="#FFFFFF" fill-opacity="0.85">Learn it by opening files on a desktop.</text>
<text x="84" y="560" class="u" fill="#FFFFFF" fill-opacity="0.8">nicksuomi.github.io/heron</text>
</g>
<g filter="url(#drop)">
<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="7" fill="{T.GLASS["active"]}" stroke="#000000" stroke-opacity="0.72"/>
<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="7" fill="url(#gloss)"/>
<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="7" fill="url(#sheen)"/>
<rect x="{x + 1}" y="{y + 1}" width="{w - 2}" height="{h - 2}" rx="6" fill="none" stroke="#FFFFFF" stroke-opacity="0.5"/>
<text x="{x + 12}" y="{y + 20}" class="c" fill="#000000" filter="url(#halo)">Command Prompt - heron review --mr 42 --dry-run</text>
<rect x="{x + w - 50}" y="{y + 1}" width="43" height="18" rx="3" fill="#C75050" stroke="#3A0F0F" stroke-opacity="0.8"/>
<path d="M{x + w - 33} {y + 6} l8 8 m0 -8 l-8 8" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round"/>
<rect x="{x + 8}" y="{y + 30}" width="{w - 16}" height="{h - 38}" fill="#000000" stroke="#000000" stroke-opacity="0.6"/>
{lines}
<text x="{x + 20}" y="{y + 64 + len(PROMPT_LINES) * 22}" class="m">_</text>
</g>
</svg>
'''


if __name__ == "__main__":
    files = {
        "heron-mark.svg": mark("duo-light", C["select-border"]),
        "heron-mark-on-dark.svg": mark("duo-dark", C["orb-light"], glow=True),
        "heron-mark-mono-ink.svg": mark(C["ink-heading"], C["ink-heading"]),
        "heron-mark-mono-white.svg": mark("#FFFFFF", "#FFFFFF"),
        "heron-lockup.svg": lockup("duo-light", C["ink-heading"], C["select-border"]),
        "heron-lockup-on-dark.svg": lockup("duo-dark", C["surface"], C["orb-light"], glow=True),
        "heron-lockup-mono-ink.svg": lockup(C["ink-heading"], C["ink-heading"], C["ink-heading"]),
        "heron-lockup-mono-white.svg": lockup("#FFFFFF", "#FFFFFF", "#FFFFFF"),
        "favicon.svg": favicon(),
        "social-preview.svg": social(),
    }
    for out in OUTS:
        out.mkdir(parents=True, exist_ok=True)
        for name, text in files.items():
            (out / name).write_text(text)
    for name, text in files.items():
        print(f"{name} {len(text.encode())}")
