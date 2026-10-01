#!/usr/bin/env python3
"""Write every Heron brand asset from the generators next to this file: orb.py (the glass orb and its lockup), flat.py (the flat pixel heron) and icon.mjs (the Vista app icon).

Run from the repository root:

    python3 docs/brand/tools/build_assets.py

It writes docs/brand/assets/, the copy the site serves at /brand/assets/ (site/public/brand/assets/), the Start orb glyph
and the Heron icons in site/src/assets/. It needs Python 3 and Node 22 or later.
The social preview embeds Heron Sans (a renamed Selawik subset) from site/public/fonts (SIL Open Font License 1.1) as data URIs and the
Heron OS wallpaper from site/src/assets, so it renders the same on a machine without either. It also renders the PNGs with headless Chromium when one is installed:
the mark at 512 by 512 and the social preview at 1280 by 640.
"""
import base64
import re
import shutil
import subprocess
import sys
from pathlib import Path

import build_tokens as T
import flat
import orb

ROOT = Path(__file__).resolve().parents[3]
OUTS = [ROOT / "docs" / "brand" / "assets", ROOT / "site" / "public" / "brand" / "assets"]
C = T.COLOR

def mono_lockup(color):
    """The one-colour heron with the wordmark in the same colour, on the orb lockup's 1200 x 400 canvas."""
    words, width = orb.wordmark_paths()
    s = 2.75
    size = 256 * 1.2
    left = (1200 - (size + 44 + width * s)) / 2
    top = 200 - size / 2
    vx, vy, vw, vh = (float(n) for n in orb.MONO_BOX.split())
    k = size * 0.92 / vh          # the mono heron is drawn tighter than the orb, so scale it to the orb's height
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 400" width="1200" height="400" role="img" aria-label="Heron">'
            f'<title>Heron</title><g transform="translate({left + (size - vw * k) / 2:.1f} {200 - vh * k / 2:.1f}) scale({k:.4f}) translate({-vx} {-vy})">{orb.mono_group(color)}</g>'
            f'<g transform="translate({left + size + 44:.1f} {200 - 70 * s:.1f}) scale({s})"><g fill="none" stroke="{color}" stroke-width="{orb.SW}" '
            f'stroke-linecap="round" stroke-linejoin="round">{words}</g></g></svg>\n')


def orb_inline(x, y, size):
    """The orb as a nested SVG, its ids all starting with L so they stay its own."""
    return (f'<svg x="{x}" y="{y}" width="{size}" height="{size}" viewBox="0 0 256 256" overflow="visible">'
            f'<defs>{orb.defs("L", orb.LARGE)}</defs>{orb.orb_body("L", orb.LARGE)}</svg>')


ICON_SHADOW = ('<filter id="sh" x="-20%" y="-20%" width="140%" height="150%"><feGaussianBlur in="SourceAlpha" stdDeviation="1.2"/><feOffset dy="1.2"/>'
               '<feComponentTransfer><feFuncA type="linear" slope="0.45"/></feComponentTransfer><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>')


def welcome_icon():
    """The Welcome Center icon: the glass orb at 44 px with the site's 48 px icon shadow."""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48"><defs>{ICON_SHADOW}{orb.defs("S", orb.SMALL)}</defs>'
            f'<g filter="url(#sh)"><svg x="2" y="1" width="44" height="44" viewBox="0 0 256 256">{orb.orb_body("S", orb.SMALL)}</svg></g></svg>\n')


def user_icon():
    """The 'What is Heron?' picture: the user-account landscape with the one-colour heron standing in its meadow."""
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48"><defs>'
            '<linearGradient id="us" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9ee6ff"/><stop offset="0.55" stop-color="#3a9ad8"/><stop offset="1" stop-color="#0d4a7a"/></linearGradient>'
            '<linearGradient id="gr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fd66a"/><stop offset="1" stop-color="#2f7a3a"/></linearGradient></defs>'
            '<rect width="48" height="48" fill="url(#us)"/><path d="M0 38c10-5 30-6 48-2v12H0z" fill="url(#gr)"/>'
            '<path d="M0 40c14-3 30-3 48 0" stroke="#d8ffd0" stroke-width="0.8" fill="none" opacity="0.7"/>'
            f'<g transform="translate(-6.5 -5.5) scale(0.26)"><g fill="#fbfdff"><path d="{orb.HERON_BODY}" transform="translate(40 29.6) scale(1.5)"/></g>'
            f'<path d="{orb.HERON_LEGS}" transform="translate(40 29.6) scale(1.5)" stroke="#fbfdff" stroke-width="2.6" fill="none" stroke-linecap="round"/></g></svg>\n')


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
{orb_inline(70, 70, 190)}
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



def chromium():
    for hit in sorted((Path.home() / ".cache" / "ms-playwright").glob("chromium_headless_shell-*/chrome-linux/headless_shell")):
        return str(hit)
    return shutil.which("chromium") or shutil.which("chromium-browser") or shutil.which("google-chrome")


def render_png(svg, png, w, h):
    """Screenshot an SVG with headless Chromium; the page background stays transparent."""
    browser = chromium()
    if not browser:
        print(f"no headless Chromium found, {png.name} not rendered", file=sys.stderr)
        return
    page = png.with_suffix(".html")
    page.write_text(f'<!doctype html><html><body style="margin:0;background:transparent"><img src="{svg.name}" width="{w}" height="{h}" style="display:block"></body></html>')
    subprocess.run([browser, "--no-sandbox", "--hide-scrollbars", "--default-background-color=00000000",
                    f"--screenshot={png}", f"--window-size={w},{h}", f"file://{page}"],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=120)
    page.unlink()


if __name__ == "__main__":
    ink, white = C["ink-heading"], "#FFFFFF"
    orb_mark = orb.mark_svg()
    files = {
        "heron-mark.svg": orb_mark,
        "heron-mark-on-dark.svg": orb_mark,
        "heron-mark-mono-ink.svg": orb.mono_svg(ink),
        "heron-mark-mono-white.svg": orb.mono_svg(white),
        "heron-lockup.svg": orb.lockup_svg(False)[0],
        "heron-lockup-on-dark.svg": orb.lockup_svg(True)[0],
        "heron-lockup-mono-ink.svg": mono_lockup(ink),
        "heron-lockup-mono-white.svg": mono_lockup(white),
        "favicon.svg": flat.flat_svg(ink),
        "social-preview.svg": social(),
    }
    for out in OUTS:
        out.mkdir(parents=True, exist_ok=True)
        for name, text in files.items():
            (out / name).write_text(text if text.endswith("\n") else text + "\n")
    for name, text in files.items():
        print(f"{name} {len(text.encode())}")

    # The site's Start orb glyph and its desktop and Explorer icon (the Vista app icon, in a large and a 32 and 48 px drawing).
    assets = ROOT / "site" / "src" / "assets"
    (assets / "heron-glyph.svg").write_text(orb.glyph_svg() + "\n")
    subprocess.run(["node", str(Path(__file__).with_name("icon.mjs")), str(assets / "icons" / ".icon")], check=True)
    icons = assets / "icons"
    (icons / "heron-folder.svg").write_text((icons / ".icon" / "mark.svg").read_text() + "\n")
    (icons / "heron-folder-small.svg").write_text((icons / ".icon" / "mark-small.svg").read_text() + "\n")
    shutil.rmtree(icons / ".icon")
    (icons / "welcome.svg").write_text(welcome_icon())
    (icons / "user.svg").write_text(user_icon())

    for out in OUTS:
        render_png(out / "heron-mark.svg", out / "heron-mark-512.png", 512, 512)
        render_png(out / "social-preview.svg", out / "social-preview.png", 1280, 640)
