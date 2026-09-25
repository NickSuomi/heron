#!/usr/bin/env python3
"""Write site/index.html: the design book as one self-contained page.

Run from the repository root:  python3 docs/brand/tools/build_site.py
"""
from html import escape
from pathlib import Path

import build_assets as A
import build_tokens as T

ROOT = Path(__file__).resolve().parents[3]
P = T.PALETTE


def mark(size=128, cls="mk", eye=True, tuck=True, water=True, width=5):
    parts = [f'<path class="ln" d="{A.HEAD}"/>', f'<path class="bk" d="{A.BEAK}"/>',
             f'<path class="ln" d="{A.BODY}"/>', f'<path class="ln" d="{A.LEG}"/>']
    if tuck:
        parts.append(f'<path class="ln" d="{A.TUCK}"/>')
    if eye:
        parts.append('<circle class="ey" cx="74" cy="23" r="1.6"/>')
    if water:
        parts.append(f'<path class="wt" d="{A.WATER}"/>')
    return (f'<svg class="{cls}" viewBox="0 0 128 128" width="{size}" height="{size}" '
            f'aria-hidden="true" style="--sw:{width}">' + "".join(parts) + "</svg>")


def lockup(width=344):
    h = round(width * 128 / 344)
    return (f'<svg class="mk" viewBox="0 0 344 128" width="{width}" height="{h}" role="img" aria-label="Heron">'
            f'<path class="ln" d="{A.HEAD}"/><path class="bk" d="{A.BEAK}"/><path class="ln" d="{A.BODY}"/>'
            f'<path class="ln" d="{A.LEG}"/><path class="ln" d="{A.TUCK}"/><circle class="ey" cx="74" cy="23" r="1.6"/>'
            f'<path class="wt" d="{A.WATER}"/>'
            f'<g transform="translate(132 32) scale(0.95)"><path class="ln" d="{A.WORD}"/></g></svg>')


def css_vars():
    lines = [f"--heron-color-{k}:{v};" for k, v in P.items()]
    lines += [f"--heron-font-{k}:{v};" for k, v in T.FONTS.items()]
    light = "".join(f"--heron-{k}:var(--heron-color-{v});" for k, v in T.THEMES["light"].items())
    dark = "".join(f"--heron-{k}:var(--heron-color-{v});" for k, v in T.THEMES["dark"].items())
    return (":root{color-scheme:light dark;" + "".join(lines) + light + "}"
            "@media (prefers-color-scheme:dark){:root{" + dark + "}}")


CSS = css_vars() + """
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--heron-bg);color:var(--heron-text);font:1rem/1.6 var(--heron-font-sans)}
a{color:var(--heron-link);text-underline-offset:2px}
a:focus-visible{outline:2px solid var(--heron-link);outline-offset:2px}
main{max-width:60rem;margin:0 auto;padding:0 1.25rem 4rem}
header.top{padding:3.5rem 0 2rem;text-align:left}
header.top p{font-size:1.25rem;color:var(--heron-text-muted);max-width:38rem;margin:.5rem 0 0}
h1,h2,h3{line-height:1.2;font-weight:700}
h2{font-size:1.75rem;margin:3.5rem 0 1rem;padding-top:1.5rem;border-top:1px solid var(--heron-border)}
h3{font-size:1.125rem;margin:2rem 0 .5rem}
p,li{max-width:40rem}
code,pre,kbd{font-family:var(--heron-font-mono);font-size:.875rem}
code{background:var(--heron-code-bg);padding:.1em .35em;border-radius:4px}
pre{background:var(--heron-code-bg);padding:1rem;border-radius:8px;overflow-x:auto;line-height:1.5}
pre code{background:none;padding:0}
nav.toc{display:flex;flex-wrap:wrap;gap:.25rem 1rem;font-size:.875rem}
.mk{max-width:100%;height:auto;display:block}
.mk path,.mk circle{fill:none;stroke-width:var(--sw,5);stroke-linecap:round;stroke-linejoin:round}
.mk .ln{stroke:var(--heron-mark-line)}
.mk .ey{fill:var(--heron-mark-line);stroke:none}
.mk .bk{stroke:var(--heron-mark-beak);fill:var(--heron-mark-beak)}
.mk .wt{stroke:var(--heron-mark-water);stroke-width:3}
.grid{display:grid;gap:1rem;grid-template-columns:repeat(auto-fill,minmax(13rem,1fr))}
.tile{border-radius:16px;padding:1.25rem;display:flex;flex-direction:column;align-items:center;gap:.75rem;font-size:.8125rem;border:1px solid var(--heron-border)}
.tile.light{background:#EEF2F1;color:#1F2A33;--heron-mark-line:#4A5A6A;--heron-mark-water:#6E8B3D}
.tile.dark{background:#151C22;color:#E6ECEA;--heron-mark-line:#EEF2F1;--heron-mark-water:#9DBB67}
.tile.ink{background:#FFFFFF;color:#1F2A33;--heron-mark-line:#1F2A33;--heron-mark-beak:#1F2A33;--heron-mark-water:#1F2A33}
.tile.white{background:#4A5A6A;color:#FFFFFF;--heron-mark-line:#FFFFFF;--heron-mark-beak:#FFFFFF;--heron-mark-water:#FFFFFF}
.clear{position:relative;padding:16px;outline:1px dashed var(--heron-text-muted);outline-offset:0;display:inline-block}
.sizes{display:flex;align-items:end;gap:1.25rem;flex-wrap:wrap}
.fav{display:inline-block;background:#4A5A6A;border-radius:22%;--heron-mark-line:#EEF2F1}
.sw-grid{grid-template-columns:repeat(auto-fill,minmax(9.5rem,1fr))}
.sw{border-radius:8px;overflow:hidden;border:1px solid var(--heron-border);background:var(--heron-surface);font-size:.8125rem}
.sw div:first-child{height:4.5rem}
.sw div:last-child{padding:.5rem .75rem}
.sw b{display:block;font-size:.875rem}
table{border-collapse:collapse;width:100%;font-size:.875rem;margin:1rem 0}
th,td{text-align:left;padding:.4rem .6rem;border-bottom:1px solid var(--heron-border);vertical-align:top}
th{color:var(--heron-text-muted);font-weight:600}
.scroll{overflow-x:auto}
.chip{display:inline-block;width:1.25rem;height:1.25rem;border-radius:4px;vertical-align:middle;border:1px solid var(--heron-border);margin-right:.35rem}
.badge{display:inline-flex;align-items:center;gap:.4rem;padding:.2rem .7rem;border-radius:999px;font:700 .8125rem/1.6 var(--heron-font-sans);letter-spacing:.02em}
.b-pass{background:var(--heron-pass-bg);color:var(--heron-pass-on)}
.b-changes{background:var(--heron-changes-bg);color:var(--heron-changes-on)}
.b-blocked{background:var(--heron-blocked-bg);color:var(--heron-blocked-on)}
.b-superseded{background:var(--heron-superseded-bg);color:var(--heron-superseded-on)}
.t-pass{color:var(--heron-pass)}.t-changes{color:var(--heron-changes)}.t-blocked{color:var(--heron-blocked)}.t-superseded{color:var(--heron-superseded)}
.row{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center}
.card{background:var(--heron-surface);border:1px solid var(--heron-border);border-radius:8px;padding:1rem 1.25rem}
.note h3{margin-top:0;font-size:1.25rem}
.note details{border-top:1px solid var(--heron-border);padding:.5rem 0}
.note summary{cursor:pointer;font-weight:700;font-size:.875rem;letter-spacing:.03em}
.muted{color:var(--heron-text-muted)}
.do,.dont{font-size:.875rem}
.do b{color:var(--heron-pass)}.dont b{color:var(--heron-blocked)}
.term{background:#0F1418;color:#E6ECEA}
.term .g{color:#9DBB67}.term .y{color:#E8B54A}.term .d{color:#A7B4BF}
.label{display:inline-flex;border-radius:999px;overflow:hidden;font-size:.8125rem;font-weight:600;border:1px solid var(--heron-border)}
.label span{padding:.15rem .6rem}
.label span:first-child{background:var(--heron-surface);color:var(--heron-text)}
.social{border-radius:8px;overflow:hidden;border:1px solid var(--heron-border);max-width:40rem}
footer{margin-top:4rem;font-size:.875rem;color:var(--heron-text-muted)}
@media (max-width:40rem){header.top{padding-top:2rem}h2{font-size:1.5rem}}
"""

SHAPES = [("pass", "●", "PASS"), ("changes", "◐", "CHANGES REQUESTED"),
          ("blocked", "■", "BLOCKED"), ("superseded", "○", "SUPERSEDED")]


def swatches():
    roles = [("mist", "Light background"), ("slate", "Heron line, muted text"), ("reed", "Water line, graphics only"),
             ("amber", "Beak, badge fill"), ("ink", "Body text, light"), ("reed-deep", "Links and PASS, light"),
             ("amber-deep", "CHANGES REQUESTED text, light"), ("rust", "BLOCKED, light"), ("night", "Dark background"),
             ("fog", "Body text, dark"), ("reed-light", "Links and PASS, dark"), ("rust-light", "BLOCKED, dark")]
    out = []
    for key, role in roles:
        out.append(f'<div class="sw"><div style="background:{P[key]}"></div><div><b>{key}</b>'
                   f'<code>{P[key]}</code><br><span class="muted">{role}</span></div></div>')
    return '<div class="grid sw-grid">' + "".join(out) + "</div>"


def contrast_rows():
    rows = []
    for theme, roles in T.THEMES.items():
        for fg, bg in T.TEXT_PAIRS:
            a, b = P[roles[fg]], P[roles[bg]]
            r = T.ratio(a, b)
            rows.append(f'<tr><td>{theme}</td><td><code>{fg}</code> on <code>{bg}</code></td>'
                        f'<td><span class="chip" style="background:{b};color:{a};border-color:{a}"></span>'
                        f'<span style="background:{b};color:{a};padding:.1rem .4rem;border-radius:4px">Aa {a}</span></td>'
                        f'<td>{r:.2f}</td><td>{T.grade(r)}</td></tr>')
    return ('<div class="scroll"><table><thead><tr><th>Theme</th><th>Pair</th><th>Sample</th><th>Ratio</th>'
            '<th>WCAG</th></tr></thead><tbody>' + "".join(rows) + "</tbody></table></div>")


def label_chips():
    out = []
    for name, key in T.LABELS.items():
        bg = P[key]
        fg = "#FFFFFF" if T.ratio("#FFFFFF", bg) >= T.ratio(P["ink"], bg) else P["ink"]
        scope, value = name.split("::")
        out.append(f'<span class="label"><span>{scope}</span><span style="background:{bg};color:{fg}">{value}</span></span>')
    return '<div class="row">' + "".join(out) + "</div>"


CLI = """<span class="d">$</span> heron review --mr 42
heron 0.1.0  reviewing !42 at 3f9c2e1d
plan        risk lane standard, gates: standards, spec, ui, design
gate        standards <span class="d">.........</span> <span class="y">1 suggestion</span>           <span class="d">22s</span>
gate        spec <span class="d">..............</span> <span class="y">2 findings</span>             <span class="d">41s</span>
gate        ui <span class="d">................</span> <span class="d">skipped (no UI files)</span>   <span class="d">0s</span>
gate        design <span class="d">............</span> <span class="g">pass</span>                   <span class="d">18s</span>
supervisor  verdict <span class="d">...........</span> <span class="y">CHANGES REQUESTED</span>       <span class="d">6s</span>
judge       <span class="d">not configured</span>
report      posted note on !42
labels      added heron::changes-requested, removed heron::reviewing

verdict     <span class="y">CHANGES REQUESTED</span>  (3 findings, 1m 27s)"""


def page():
    verdicts = "".join(f'<span class="badge b-{k}">{s} {w}</span>' for k, s, w in SHAPES)
    verdict_text = "".join(f'<span class="t-{k}" style="margin-right:1rem;font-weight:700">{s} {w}</span>' for k, s, w in SHAPES)
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Heron design book</title>
<meta name="description" content="Brand, voice, and report design for Heron, a self-hosted code-review bot for GitLab merge requests.">
<link rel="icon" href="data:image/svg+xml,{escape(A.FILES['favicon.svg'].strip()).replace('#', '%23')}">
<style>{CSS}</style>
</head>
<body>
<main>
<header class="top">
{lockup(300)}
<p>Heron reviews one GitLab merge request at its current head, posts one report, and sets workflow labels. It never edits code, approves, or merges. This page is its design book.</p>
</header>
<nav class="toc" aria-label="Sections">
<a href="#principles">Principles</a><a href="#logo">Logo</a><a href="#colour">Colour</a><a href="#type">Typography</a>
<a href="#icons">Verdict shapes</a><a href="#voice">Voice</a><a href="#report">Report comment</a><a href="#cli">CLI</a>
<a href="#labels">Labels</a><a href="#readme">README header</a><a href="#social">Social preview</a>
</nav>

<h2 id="principles">Principles</h2>
<ol>
<li><b>Watch, then act once.</b> Heron reads the whole merge request, then posts one comment.</li>
<li><b>Point at the line.</b> Every finding names a file and a line.</li>
<li><b>Calm is a feature.</b> A blocked merge request is ordinary news. Nothing flashes or shouts.</li>
<li><b>Stable words for machines.</b> PASS, CHANGES REQUESTED, BLOCKED, and SUPERSEDED never change. Styling sits next to them.</li>
<li><b>Nothing leaves the page.</b> No external fonts, scripts, images, or trackers. This page makes no network requests.</li>
</ol>
<p>A heron stands still in shallow water and watches. When it moves, it moves once, and it is exact. Write the name as Heron in prose and <code>heron</code> in code. The package is <code>heron-review</code>, the binary is <code>heron</code>, and the repository is <a href="https://github.com/NickSuomi/heron"><code>NickSuomi/heron</code></a>.</p>

<h2 id="logo">Logo</h2>
<p>A heron on one leg, drawn with one 5-unit line on a 128-unit grid. The beak is the only filled shape. The back stops short of the neck, which keeps the drawing open. The wordmark uses the same line and stands on the same water.</p>
<div class="grid">
<div class="tile light">{mark(112)}Colour, light</div>
<div class="tile dark">{mark(112)}Colour, dark</div>
<div class="tile ink">{mark(112)}Mono, ink</div>
<div class="tile white">{mark(112)}Mono, white</div>
</div>
<h3>Clear space and minimum size</h3>
<p>Keep 16 units clear on every side, one eighth of the mark. The dashed box shows it. The mark goes no smaller than 24 px and the lockup no smaller than 120 px wide. Below 24 px, use the favicon.</p>
<div class="sizes">
<span class="clear">{mark(96)}</span>
{mark(48)}{mark(24)}
<span class="fav">{mark(64, eye=False, tuck=False, water=False, width=9)}</span>
<span class="fav">{mark(32, eye=False, tuck=False, water=False, width=9)}</span>
<span class="fav">{mark(16, eye=False, tuck=False, water=False, width=9)}</span>
</div>
<h3>Misuse</h3>
<ul>
<li>Do not fill the body, add a second standing leg, or rotate, flip, or stretch the mark.</li>
<li>Do not colour the line anything other than slate, mist, ink, or white.</li>
<li>Do not set the wordmark in a font, or add shadows, gradients, or outlines.</li>
<li>Do not animate the heron. If anything moves, it is one short fade.</li>
</ul>

<h2 id="colour">Colour</h2>
<p>The seeds are Mist, Slate heron, Reed green, and Beak amber. Reed and amber are too light for text on Mist, so each has a darker text variant. Rust marks BLOCKED. This page follows your system's light or dark setting.</p>
{swatches()}
<h3>Contrast of every recommended text pair</h3>
<p>Computed with the WCAG 2.x luminance formula by <code>docs/brand/tools/build_tokens.py</code>. AA needs 4.5:1. Every pair passes. The amber beak on Mist is 1.94:1 and is decorative. The slate line alone carries the heron.</p>
{contrast_rows()}

<h2 id="type">Typography</h2>
<div class="card">
<p style="font-size:2.5rem;line-height:1.2;margin:0;font-weight:700">Watch, then act once.</p>
<p style="font-size:1.25rem;margin:.5rem 0" class="muted">Nunito Sans for text and headings, Inter as the alternate.</p>
<p style="font-family:var(--heron-font-mono);margin:0">src/upload/client.ts:88  IBM Plex Mono for code, paths, and the CLI.</p>
</div>
<div class="scroll"><table>
<thead><tr><th>Family</th><th>Use</th><th>Licence</th></tr></thead>
<tbody>
<tr><td>Nunito Sans</td><td>Text, headings</td><td>SIL OFL 1.1, <a href="https://github.com/googlefonts/NunitoSans/blob/main/OFL.txt">OFL.txt</a></td></tr>
<tr><td>Inter</td><td>Alternate text face</td><td>SIL OFL 1.1, <a href="https://github.com/rsms/inter/blob/master/LICENSE.txt">LICENSE.txt</a></td></tr>
<tr><td>IBM Plex Mono</td><td>Code, paths, CLI</td><td>SIL OFL 1.1, <a href="https://github.com/IBM/plex/blob/master/LICENSE.txt">LICENSE.txt</a>. Reserved Font Name "Plex".</td></tr>
</tbody></table></div>
<p class="muted">This page loads no web fonts. If you have the families installed you see them. Otherwise your system face renders the text.</p>

<h2 id="icons">Verdict shapes</h2>
<p>Each verdict has a shape, so no state depends on colour alone. The shapes are Unicode geometric characters, not emoji.</p>
<div class="row" style="margin-bottom:1rem">{verdicts}</div>
<p>{verdict_text}</p>

<h2 id="voice">Voice and tone</h2>
<p>Heron writes like a patient reviewer who has read the whole change: calm, kind, plain, and exact. It names the file and line, says what happens, then suggests the fix.</p>
<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(17rem,1fr))">
<div class="card do"><b>Do</b><br><code>src/upload/client.ts:88</code> retries on HTTP 429 with no limit. If the server never sends <code>Retry-After</code>, the job never ends.</div>
<div class="card dont"><b>Don't</b><br>Critical bug!!! Infinite loop in the upload client.</div>
<div class="card do"><b>Do</b><br>The spec gate could not read <code>docs/spec.md</code>, so spec coverage is unknown.</div>
<div class="card dont"><b>Don't</b><br>Something went wrong.</div>
<div class="card do"><b>Do</b><br>No findings in the UI gate.</div>
<div class="card dont"><b>Don't</b><br>Awesome work, looks amazing!</div>
</div>

<h2 id="report">Report comment</h2>
<p>One comment per head: the verdict line, a summary, findings with locations, then two collapsed sections. This is how the example in the design book renders in a GitLab note. The Markdown source is in <code>docs/brand/README.md</code>.</p>
<div class="card note">
<h3><span class="t-changes">◐</span> Heron: <span class="t-changes">CHANGES REQUESTED</span></h3>
<p class="muted">Reviewed !42 at <code>3f9c2e1d</code>, risk lane <b>standard</b>, 4 gates, 1 min 27 s.</p>
<p>The new upload retry loop can run forever when the server answers HTTP 429 without a <code>Retry-After</code> header. Two findings must change before merge. One is a suggestion.</p>
<h4>Findings</h4>
<ol>
<li><b>Must change.</b> <code>src/upload/client.ts:88</code><br>The loop retries on 429 with no attempt limit. If the server never sends <code>Retry-After</code>, the CI job runs until it times out. <code>UploadConfig.maxRetries</code> already exists. Use it here.</li>
<li><b>Must change.</b> <code>src/upload/client.ts:112</code><br>The catch block drops the original error and throws <code>new Error("upload failed")</code>. Logs lose the status code. Pass the original error as <code>cause</code>.</li>
<li><b>Consider.</b> <code>docs/upload.md:14</code><br>The docs still describe three retries. After the fix above, link to the <code>maxRetries</code> setting instead of repeating the number.</li>
</ol>
<details><summary>REVIEW CHECKS (4 gates, 2 with findings)</summary>
<div class="scroll"><table><thead><tr><th>Gate</th><th>Result</th><th>Findings</th><th>Time</th></tr></thead><tbody>
<tr><td>Standards</td><td class="t-changes">◐ findings</td><td>1 suggestion</td><td>22 s</td></tr>
<tr><td>Spec</td><td class="t-changes">◐ findings</td><td>2</td><td>41 s</td></tr>
<tr><td>UI</td><td class="t-superseded">○ skipped: no UI files changed</td><td>0</td><td>0 s</td></tr>
<tr><td>Design</td><td class="t-pass">● pass</td><td>0</td><td>18 s</td></tr>
<tr><td>Supervisor</td><td class="t-changes">◐ CHANGES REQUESTED</td><td>3</td><td>6 s</td></tr>
<tr><td>Judge</td><td class="muted">not configured</td><td></td><td></td></tr>
</tbody></table></div>
<p class="muted">Plan: risk lane <code>standard</code>, chosen from 6 changed files and 212 changed lines.</p>
</details>
<details><summary>AGENT PROVENANCE</summary>
<div class="scroll"><table><thead><tr><th>Role</th><th>Access</th><th>Model</th><th>Input head</th></tr></thead><tbody>
<tr><td>Gates</td><td>Claude subscription</td><td><code>claude-sonnet-4-5</code></td><td><code>3f9c2e1d</code></td></tr>
<tr><td>Supervisor</td><td>ChatGPT subscription (Codex)</td><td><code>gpt-5-codex</code></td><td><code>3f9c2e1d</code></td></tr>
</tbody></table></div>
<p class="muted">Heron 0.1.0, config <code>heron.yml</code> at <code>3f9c2e1d</code>. Heron does not edit code, approve, or merge. This comment was written by an automated reviewer.</p>
</details>
</div>

<h2 id="cli">CLI output</h2>
<p>Plain ASCII, one step per line, the verdict word in full on the last line. Colour is optional and follows the terminal's own palette. With <code>NO_COLOR</code> set, or when output is not a terminal, Heron prints no colour.</p>
<pre class="term"><code>{CLI}</code></pre>

<h2 id="labels">Workflow labels</h2>
<p>Scoped labels keep one Heron state on a merge request at a time. The names are suggestions. The product's configured names win.</p>
{label_chips()}

<h2 id="readme">README header</h2>
<pre><code>{escape('''<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/assets/heron-lockup-on-dark.svg">
    <img alt="Heron" src="docs/brand/assets/heron-lockup.svg" width="344">
  </picture>
</p>
<p align="center">Calm, exact code review for GitLab merge requests.</p>''')}</code></pre>

<h2 id="social">Social preview</h2>
<p>1280 by 640 px, Mist background, text inside a 64 px margin. Upload <code>docs/brand/assets/social-preview.png</code> under the repository's <b>Social preview</b> setting.</p>
<div class="social">{(A.OUT / 'social-preview.svg').read_text().replace('width="1280" height="640"', 'width="100%" style="display:block;height:auto"')}</div>

<footer>
<p>Heron is open source under the Apache License 2.0. Source: <a href="https://github.com/NickSuomi/heron">github.com/NickSuomi/heron</a>.</p>
</footer>
</main>
</body>
</html>
"""


if __name__ == "__main__":
    out = ROOT / "site" / "index.html"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(page())
    print(out.relative_to(ROOT), len(out.read_bytes()))
