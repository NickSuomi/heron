#!/usr/bin/env python3
"""Write tokens.json and tokens.css, then print the WCAG 2.x contrast table.

Run from the repository root:  python3 docs/brand/tools/build_tokens.py
"""
import json
from pathlib import Path

BRAND = Path(__file__).resolve().parent.parent

PALETTE = {
    "mist": "#EEF2F1",        # seed: page background, light
    "slate": "#4A5A6A",       # seed: the heron, secondary text
    "reed": "#6E8B3D",        # seed: water line, graphics only
    "amber": "#E0A526",       # seed: the beak, fills only
    "ink": "#1F2A33",
    "paper": "#FFFFFF",
    "shallows": "#E2E9E7",
    "line": "#C9D3D1",
    "reed-deep": "#4F6A26",
    "amber-deep": "#8A5A00",
    "rust": "#A8432A",
    "night": "#151C22",
    "night-raised": "#1E2730",
    "night-deep": "#0F1418",
    "night-line": "#33414C",
    "fog": "#E6ECEA",
    "slate-light": "#A7B4BF",
    "reed-light": "#9DBB67",
    "amber-light": "#E8B54A",
    "rust-light": "#E0826B",
}

# Semantic roles. Each value names a palette entry.
THEMES = {
    "light": {
        "bg": "mist", "surface": "paper", "code-bg": "shallows",
        "text": "ink", "text-muted": "slate", "link": "reed-deep",
        "border": "line", "mark-line": "slate", "mark-beak": "amber", "mark-water": "reed",
        "pass": "reed-deep", "changes": "amber-deep", "blocked": "rust", "superseded": "slate",
        "pass-bg": "reed-deep", "pass-on": "paper",
        "changes-bg": "amber", "changes-on": "ink",
        "blocked-bg": "rust", "blocked-on": "paper",
        "superseded-bg": "slate", "superseded-on": "paper",
    },
    "dark": {
        "bg": "night", "surface": "night-raised", "code-bg": "night-deep",
        "text": "fog", "text-muted": "slate-light", "link": "reed-light",
        "border": "night-line", "mark-line": "mist", "mark-beak": "amber", "mark-water": "reed-light",
        "pass": "reed-light", "changes": "amber-light", "blocked": "rust-light", "superseded": "slate-light",
        "pass-bg": "reed-light", "pass-on": "night",
        "changes-bg": "amber-light", "changes-on": "night",
        "blocked-bg": "rust-light", "blocked-on": "night",
        "superseded-bg": "slate-light", "superseded-on": "night",
    },
}

FONTS = {
    "sans": "'Nunito Sans', Inter, system-ui, -apple-system, 'Segoe UI', Roboto, Ubuntu, sans-serif",
    "mono": "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
}
SPACE = {"1": "4px", "2": "8px", "3": "12px", "4": "16px", "6": "24px", "8": "32px", "12": "48px", "16": "64px"}
RADIUS = {"sm": "4px", "md": "8px", "lg": "16px", "pill": "999px"}
SIZE = {"xs": "0.8125rem", "sm": "0.875rem", "base": "1rem", "lg": "1.25rem", "xl": "1.75rem", "2xl": "2.5rem"}

LABELS = {  # GitLab workflow labels: background colour
    "heron::reviewing": "slate",
    "heron::pass": "reed-deep",
    "heron::changes-requested": "amber",
    "heron::blocked": "rust",
}

# Every text-on-background pair the book recommends, per theme.
TEXT_PAIRS = [
    ("text", "bg"), ("text", "surface"), ("text", "code-bg"),
    ("text-muted", "bg"), ("text-muted", "surface"), ("text-muted", "code-bg"),
    ("link", "bg"), ("link", "surface"),
    ("pass", "bg"), ("pass", "surface"),
    ("changes", "bg"), ("changes", "surface"),
    ("blocked", "bg"), ("blocked", "surface"),
    ("superseded", "bg"), ("superseded", "surface"),
    ("pass-on", "pass-bg"), ("changes-on", "changes-bg"),
    ("blocked-on", "blocked-bg"), ("superseded-on", "superseded-bg"),
]
# Graphic pairs: WCAG 1.4.11 asks 3:1 for meaningful graphics.
GRAPHIC_PAIRS = [("mark-line", "bg"), ("mark-line", "surface"), ("mark-water", "bg"), ("mark-beak", "bg")]


def luminance(hex_):
    def ch(v):
        v /= 255
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = (int(hex_[i:i + 2], 16) for i in (1, 3, 5))
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)


def ratio(a, b):
    hi, lo = sorted((luminance(a), luminance(b)), reverse=True)
    return (hi + 0.05) / (lo + 0.05)


def grade(r, graphic=False):
    if graphic:
        return "pass 3:1" if r >= 3 else "decorative only"
    return "AAA" if r >= 7 else "AA" if r >= 4.5 else "AA large" if r >= 3 else "fail"


def tokens_json():
    return {
        "$schema-note": "Values follow the W3C Design Tokens draft shape: $value and $type.",
        "color": {k: {"$value": v, "$type": "color"} for k, v in PALETTE.items()},
        "theme": {t: {k: {"$value": "{color.%s}" % v, "$type": "color"} for k, v in roles.items()}
                  for t, roles in THEMES.items()},
        "font": {k: {"$value": v, "$type": "fontFamily"} for k, v in FONTS.items()},
        "size": {k: {"$value": v, "$type": "dimension"} for k, v in SIZE.items()},
        "space": {k: {"$value": v, "$type": "dimension"} for k, v in SPACE.items()},
        "radius": {k: {"$value": v, "$type": "dimension"} for k, v in RADIUS.items()},
        "label": {k: {"$value": "{color.%s}" % v, "$type": "color"} for k, v in LABELS.items()},
    }


def tokens_css():
    out = ["/* Heron design tokens. Generated by docs/brand/tools/build_tokens.py. */", ":root {"]
    out += [f"  --heron-color-{k}: {v};" for k, v in PALETTE.items()]
    out += [f"  --heron-font-{k}: {v};" for k, v in FONTS.items()]
    out += [f"  --heron-size-{k}: {v};" for k, v in SIZE.items()]
    out += [f"  --heron-space-{k}: {v};" for k, v in SPACE.items()]
    out += [f"  --heron-radius-{k}: {v};" for k, v in RADIUS.items()]
    out += ["  color-scheme: light dark;"]
    out += [f"  --heron-{k}: var(--heron-color-{v});" for k, v in THEMES["light"].items()]
    out += ["}", "", "@media (prefers-color-scheme: dark) {", "  :root {"]
    out += [f"    --heron-{k}: var(--heron-color-{v});" for k, v in THEMES["dark"].items()]
    out += ["  }", "}", ""]
    return "\n".join(out)


def table():
    rows = ["| Theme | Text token | Background token | Text | Background | Ratio | WCAG |",
            "|---|---|---|---|---|---|---|"]
    for theme, roles in THEMES.items():
        for fg, bg in TEXT_PAIRS:
            a, b = PALETTE[roles[fg]], PALETTE[roles[bg]]
            r = ratio(a, b)
            rows.append(f"| {theme} | `{fg}` | `{bg}` | `{a}` | `{b}` | {r:.2f} | {grade(r)} |")
    rows += ["", "| Theme | Graphic token | Background token | Graphic | Background | Ratio | Use |",
             "|---|---|---|---|---|---|---|"]
    for theme, roles in THEMES.items():
        for fg, bg in GRAPHIC_PAIRS:
            a, b = PALETTE[roles[fg]], PALETTE[roles[bg]]
            r = ratio(a, b)
            rows.append(f"| {theme} | `{fg}` | `{bg}` | `{a}` | `{b}` | {r:.2f} | {grade(r, True)} |")
    rows += ["", "| Label | Background | White text | Ink text | Use text |", "|---|---|---|---|---|"]
    for name, key in LABELS.items():
        bg = PALETTE[key]
        w, i = ratio(PALETTE["paper"], bg), ratio(PALETTE["ink"], bg)
        rows.append(f"| `{name}` | `{bg}` | {w:.2f} | {i:.2f} | {'white' if w >= i else 'ink'} |")
    return "\n".join(rows)


if __name__ == "__main__":
    (BRAND / "tokens.json").write_text(json.dumps(tokens_json(), indent=2) + "\n")
    (BRAND / "tokens.css").write_text(tokens_css())
    print(table())
