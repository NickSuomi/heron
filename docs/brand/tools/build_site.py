#!/usr/bin/env python3
"""Write site/public/brand/index.html, the design book as one page, and copy the assets and fonts next to it.

Run from the repository root, after `pnpm install` in site/:  python3 docs/brand/tools/build_site.py
"""
import shutil
from html import escape
from pathlib import Path

import build_tokens as T

ROOT = Path(__file__).resolve().parents[3]
BRAND = ROOT / "docs" / "brand"
OUT = ROOT / "site" / "public" / "brand"
FONTS = ROOT / "site" / "node_modules" / "@fontsource-variable"
P = T.PALETTE

ROLES = {
    "night": "Page base", "night-1": "Bands, code", "night-2": "Cards, the heron's body", "night-3": "Hover, active rows",
    "hairline": "1px borders, white at 8%", "hairline-strong": "Rim and emphasis, white at 14%",
    "frost": "Primary text", "frost-2": "Secondary text, 64%", "frost-3": "Tertiary text, 50%", "frost-4": "Line numbers, 26%",
    "plume": "The accent", "plume-deep": "Accent fills, glows",
    "sage": "PASS", "sand": "CHANGES REQUESTED, outside the site", "rose": "BLOCKED",
    "paper": "Light background", "paper-line": "Borders on light", "ink": "Text on light", "ink-2": "Secondary on light",
    "plume-ink": "Accent on light", "sage-ink": "PASS on light", "sand-ink": "CHANGES REQUESTED on light", "rose-ink": "BLOCKED on light",
}


def swatches():
    cells = []
    for name, hex_ in P.items():
        cells.append(f'<figure class="sw"><span style="background:{hex_}"></span><figcaption><b>{name}</b>'
                     f'<code>{hex_}</code><small>{escape(ROLES.get(name, ""))}</small></figcaption></figure>')
    return "\n".join(cells)


def contrast():
    rows = []
    for theme, roles in T.THEMES.items():
        for fg, bg in T.TEXT_PAIRS:
            a, b = P[roles[fg]], P[roles[bg]]
            r = T.ratio(a, b)
            rows.append(f'<tr><td>{theme}</td><td><code>{fg}</code> on <code>{bg}</code></td>'
                        f'<td><span class="chip" style="color:{a};background:{b}">Aa</span></td><td>{r:.2f}</td><td>{T.grade(r)}</td></tr>')
    return "\n".join(rows)


def page():
    css = (BRAND / "tokens.css").read_text()
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Heron design book</title>
<meta name="description" content="How Heron looks, moves, and sounds: palette, type, the heron mark, motion, and voice.">
<meta name="theme-color" content="#08090c">
<link rel="icon" href="assets/favicon.svg" type="image/svg+xml">
<style>
@font-face{{font-family:'Inter Variable';src:url(fonts/inter-latin-opsz-normal.woff2) format('woff2');font-weight:100 900;font-display:swap}}
@font-face{{font-family:'JetBrains Mono Variable';src:url(fonts/jetbrains-mono-latin-wght-normal.woff2) format('woff2');font-weight:100 800;font-display:swap}}
{css}
*{{box-sizing:border-box}}
html{{background:var(--heron-bg)}}
body{{margin:0;color:var(--heron-text);font:400 16px/1.6 var(--heron-font-sans);letter-spacing:-0.011em;-webkit-font-smoothing:antialiased;
  background:radial-gradient(60% 40% at 78% 0%,var(--heron-alpha-plume-glow),transparent 70%),linear-gradient(112deg,transparent 40%,rgba(255,255,255,.03) 50%,transparent 60%) no-repeat,var(--heron-bg)}}
main{{max-width:1080px;margin:0 auto;padding:40px 24px 96px}}
a{{color:var(--heron-text);text-decoration-color:var(--heron-alpha-frost-4);text-underline-offset:.22em}}
code{{font-family:var(--heron-font-mono);font-size:.86em;font-feature-settings:"calt" 0,"liga" 0}}
header{{display:flex;justify-content:space-between;align-items:center;padding-bottom:72px}}
header nav{{display:flex;gap:22px;font-size:14px;color:var(--heron-text-muted)}}
header nav a{{color:inherit;text-decoration:none}}
h1{{font-weight:520;font-size:clamp(44px,7vw,96px);line-height:.95;letter-spacing:-.047em;margin:0 0 20px;
  background:linear-gradient(180deg,#f7f8f8 28%,rgba(247,248,248,.52));-webkit-background-clip:text;background-clip:text;color:transparent}}
h2{{font-weight:500;font-size:32px;letter-spacing:-.035em;line-height:1.1;margin:0 0 16px}}
h3{{font-weight:500;font-size:18px;letter-spacing:-.02em;margin:28px 0 10px}}
p,li{{color:var(--heron-text-muted);max-width:68ch}}
.lead{{font-size:20px;letter-spacing:-.015em}}
section{{padding:64px 0;border-top:1px solid var(--heron-alpha-hairline)}}
.k{{font:500 12px/1 var(--heron-font-mono);letter-spacing:.1em;text-transform:uppercase;color:var(--heron-accent);margin:0 0 14px}}
.card{{border:1px solid var(--heron-alpha-hairline);border-radius:14px;background:linear-gradient(180deg,rgba(255,255,255,.035),rgba(255,255,255,.01));box-shadow:inset 0 1px 0 rgba(255,255,255,.04)}}
.hero-art{{display:grid;grid-template-columns:1.2fr 1fr;gap:16px;margin-top:40px}}
.hero-art .card{{display:grid;place-items:center;padding:36px;min-height:240px}}
.light{{background:var(--heron-color-paper)!important;border-color:var(--heron-color-paper-line)!important}}
.grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:12px}}
.sw{{margin:0;padding:10px;border:1px solid var(--heron-alpha-hairline);border-radius:14px;background:var(--heron-color-night-1)}}
.sw span{{display:block;height:64px;border-radius:8px;border:1px solid var(--heron-alpha-hairline)}}
.sw figcaption{{display:grid;gap:2px;padding:10px 4px 2px;font-size:13px}}
.sw b{{font-weight:500}} .sw code{{color:var(--heron-text-muted)}} .sw small{{color:var(--heron-text-faint);font-size:12px}}
table{{border-collapse:collapse;width:100%;font-size:14px}}
th,td{{text-align:left;padding:8px 14px 8px 0;border-bottom:1px solid var(--heron-alpha-hairline);color:var(--heron-text-muted)}}
th{{font-weight:500;color:var(--heron-text-faint)}}
.chip{{display:inline-block;padding:2px 10px;border-radius:6px;border:1px solid var(--heron-alpha-hairline);font-weight:500}}
.type .d{{font-size:clamp(40px,6vw,80px);font-weight:520;letter-spacing:-.047em;line-height:1;background:linear-gradient(180deg,#f7f8f8 28%,rgba(247,248,248,.52));-webkit-background-clip:text;background-clip:text;color:transparent;margin:0}}
.type .m{{font:400 15px/1.8 var(--heron-font-mono);color:var(--heron-text)}}
.assets{{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}}
.assets .card{{padding:24px;display:grid;gap:14px;justify-items:center}}
.assets img{{max-width:100%;height:auto}}
.assets a{{font:400 12px var(--heron-font-mono);color:var(--heron-text-muted)}}
.v{{font-weight:540;font-size:44px;letter-spacing:-.048em;background:linear-gradient(180deg,#f7f8f8 20%,#b9bee6 70%,var(--heron-accent));-webkit-background-clip:text;background-clip:text;color:transparent}}
footer{{padding-top:40px;border-top:1px solid var(--heron-alpha-hairline);font-size:13px;color:var(--heron-text-faint)}}
@media (max-width:720px){{.hero-art{{grid-template-columns:1fr}}header nav a:not(:last-child){{display:none}}}}
</style>
</head>
<body>
<main>
<header><a href="../"><img src="assets/heron-lockup-mono-white.svg" alt="Heron" width="108" height="40"></a>
<nav><a href="#colour">Colour</a><a href="#type">Type</a><a href="#heron">Heron</a><a href="#motion">Motion</a><a href="#voice">Voice</a><a href="../">Site</a></nav></header>

<p class="k">Design book</p>
<h1>The fold is the gate.</h1>
<p class="lead">The site is one face of a dark monolith. Code climbs it and folds over the top edge, where the heron stands and looks down at what comes over. Lines it objects to are marked once, then pinned as findings. When the face lies flat at the end, the verdict is what remains.</p>
<div class="hero-art">
<div class="card"><img src="assets/heron-lockup-on-dark.svg" alt="Heron lockup on dark" width="344" height="128"></div>
<div class="card light"><img src="assets/heron-lockup.svg" alt="Heron lockup on light" width="344" height="128"></div>
</div>

<section id="principles"><p class="k">Principles</p><h2>Still, exact, calm.</h2>
<ol>
<li>Stillness first. The brand moves only when the reader scrolls, and the heron moves once.</li>
<li>Point at the line. Every finding names a path and a line at the reviewed head.</li>
<li>Calm is a feature. CHANGES REQUESTED is ordinary news.</li>
<li>Stable words for machines: PASS, CHANGES REQUESTED, BLOCKED, SUPERSEDED.</li>
<li>Nothing leaves the page: no external fonts, scripts, images, or trackers.</li>
</ol></section>

<section id="colour"><p class="k">Colour</p><h2>Night, hairlines, and one cold light.</h2>
<p>A near-black with a slight cool tint, three raised surfaces, grey text set by opacity, and one accent: <b style="color:var(--heron-accent)">plume</b> <code>#9097CC</code>, the blue-grey of a grey heron's back at dusk. It is desaturated so it reads as light, not as a brand colour competing with the code. Plume marks only what the heron looks at: a caught line, a pinned finding, the verdict, the rim light.</p>
<div class="grid">{swatches()}</div>
<h3>Contrast, WCAG 2.x</h3>
<table><thead><tr><th>Theme</th><th>Pair</th><th>Sample</th><th>Ratio</th><th>Grade</th></tr></thead><tbody>{contrast()}</tbody></table>
</section>

<section id="type" class="type"><p class="k">Typography</p><h2>Inter, and JetBrains Mono for code.</h2>
<p class="d">Every line passes the heron.</p>
<p>Inter, variable with the optical-size axis: display at weight 520 with -0.045em tracking and gradient text, headings at 500, body at 400. JetBrains Mono for code and paths, with ligatures off.</p>
<p class="m">src/projects/archive.ts:14  await api.delete(`/projects/${{id}}`)</p>
<table><thead><tr><th>Family</th><th>Use</th><th>Licence</th></tr></thead><tbody>
<tr><td>Inter</td><td>Display, headings, text</td><td>SIL OFL 1.1, <a href="fonts/Inter-OFL.txt">licence</a></td></tr>
<tr><td>JetBrains Mono</td><td>Code, paths, the marker</td><td>SIL OFL 1.1, <a href="fonts/JetBrainsMono-OFL.txt">licence</a></td></tr>
</tbody></table></section>

<section id="heron"><p class="k">The heron</p><h2>A duotone silhouette on the rim.</h2>
<p>The heron stands on an edge, neck in an S, bill pointed down over the edge. A night body, a frost edge line, a solid bill, one-line legs, and a faint plume glow behind the feet. It has no eye, and it never gets one. On the site it faces into the page; in the mark it faces the wordmark. Both stand on the same rim line as the drawn wordmark.</p>
<div class="assets">
<div class="card"><img src="assets/heron-mark-on-dark.svg" alt="" width="128" height="128"><a href="assets/heron-mark-on-dark.svg">heron-mark-on-dark.svg</a></div>
<div class="card light"><img src="assets/heron-mark.svg" alt="" width="128" height="128"><a href="assets/heron-mark.svg" style="color:#5B5F6B">heron-mark.svg</a></div>
<div class="card"><img src="assets/heron-mark-mono-white.svg" alt="" width="128" height="128"><a href="assets/heron-mark-mono-white.svg">heron-mark-mono-white.svg</a></div>
<div class="card light"><img src="assets/heron-mark-mono-ink.svg" alt="" width="128" height="128"><a href="assets/heron-mark-mono-ink.svg" style="color:#5B5F6B">heron-mark-mono-ink.svg</a></div>
<div class="card"><img src="assets/heron-lockup-mono-white.svg" alt="" width="216" height="80"><a href="assets/heron-lockup-mono-white.svg">heron-lockup-mono-white.svg</a></div>
<div class="card light"><img src="assets/heron-lockup-mono-ink.svg" alt="" width="216" height="80"><a href="assets/heron-lockup-mono-ink.svg" style="color:#5B5F6B">heron-lockup-mono-ink.svg</a></div>
<div class="card"><img src="assets/favicon.svg" alt="" width="64" height="64"><a href="assets/favicon.svg">favicon.svg</a></div>
<div class="card"><img src="assets/heron-mark-512.png" alt="" width="128" height="128"><a href="assets/heron-mark-512.png">heron-mark-512.png</a></div>
</div>
<h3>Social preview</h3>
<div class="card" style="padding:12px"><img src="assets/social-preview.png" alt="Social preview: the heron on the rim and the headline Every line passes the heron." width="1280" height="640" style="width:100%;height:auto;border-radius:8px"></div>
<p>Do not add an eye or a face, colour the bird with the accent, rotate or stretch it, set the wordmark in a font, or animate it idling.</p>
</section>

<section id="motion"><p class="k">Motion</p><h2>Only the scroll moves the page.</h2>
<ol>
<li>The fold: Canvas UI Bend folds the face out over its top and bottom edges, a quarter of the viewport each, to 84 degrees with a rounded crease. Each edge flattens near its end of the scroll.</li>
<li>Without HTML-in-canvas, CSS scroll-driven animations tip each line over the same zones.</li>
<li>A caught line gets one plume underline in 260 ms. Its finding plate lights up over 700 ms. The heron strikes once per visit, when the blocker crosses the edge.</li>
<li>Nothing loops, autoplays, or follows the cursor.</li>
<li>With reduced motion, the fold animation and the strike are off and every finding is shown pinned.</li>
</ol></section>

<section id="voice"><p class="k">Voice</p><h2>A patient reviewer who read the whole change.</h2>
<p>Calm, plain, exact. Name the path and the line, say what happens, then suggest the fix. No hype, no scolding, no exclamation marks, no emoji, no long dashes. Page copy only states what the Heron docs state.</p>
<table><thead><tr><th>Do</th><th>Don't</th></tr></thead><tbody>
<tr><td>Archive deletes the project instead of archiving it (<code>src/projects/archive.ts:14</code>).</td><td>Critical bug!!! You deleted everything.</td></tr>
<tr><td>The review could not finish: session <code>b1.gate.spec</code> failed.</td><td>Something went wrong.</td></tr>
<tr><td>The source branch moved during the review. These results describe <code>abc2c194</code> only.</td><td>Outdated review, ignore.</td></tr>
</tbody></table>
<h3>The verdict</h3>
<p class="v">CHANGES REQUESTED</p>
<p>The verdict words never change, so scripts can match them. On the site the verdict takes the one gradient from soft white to plume.</p>
</section>

<footer>Heron is open source under the Apache License 2.0: <a href="https://github.com/NickSuomi/heron">github.com/NickSuomi/heron</a>. Source of this page: <code>docs/brand/tools/build_site.py</code>.</footer>
</main>
</body>
</html>
"""


if __name__ == "__main__":
    (OUT / "assets").mkdir(parents=True, exist_ok=True)
    (OUT / "fonts").mkdir(parents=True, exist_ok=True)
    for old in (OUT / "assets").iterdir():
        old.unlink()
    for f in (BRAND / "assets").iterdir():
        shutil.copy2(f, OUT / "assets" / f.name)
    shutil.copy2(FONTS / "inter" / "files" / "inter-latin-opsz-normal.woff2", OUT / "fonts")
    shutil.copy2(FONTS / "jetbrains-mono" / "files" / "jetbrains-mono-latin-wght-normal.woff2", OUT / "fonts")
    shutil.copy2(FONTS / "inter" / "LICENSE", OUT / "fonts" / "Inter-OFL.txt")
    shutil.copy2(FONTS / "jetbrains-mono" / "LICENSE", OUT / "fonts" / "JetBrainsMono-OFL.txt")
    out = OUT / "index.html"
    out.write_text(page())
    print(out.relative_to(ROOT), len(out.read_bytes()))
