#!/usr/bin/env python3
"""Write tokens.json and tokens.css, then print the WCAG 2.x contrast tables.

Run from the repository root:  python3 docs/brand/tools/build_tokens.py
"""
import json
from pathlib import Path

BRAND = Path(__file__).resolve().parent.parent

# Night: a near-black with a slight cool tint, and three raised surfaces.
# Plume: the one accent, the blue-grey of a grey heron's back at dusk.
PALETTE = {
    "night": "#08090C",         # page base
    "night-1": "#0E1014",       # first raised surface: bands, code
    "night-2": "#13151A",       # cards
    "night-3": "#1A1D23",       # hover, pressed, active rows
    "hairline": "#1C1D1F",      # 1px borders: white at 8% over night
    "hairline-strong": "#2B2B2E",  # emphasised borders: white at 14% over night
    "frost": "#F4F5F8",         # primary text on night
    "frost-2": "#9FA0A3",       # secondary text: frost at 64% over night
    "frost-3": "#7E7F82",       # tertiary text: frost at 50% over night
    "frost-4": "#454649",       # quaternary: rules, disabled, line numbers
    "plume": "#9097CC",         # accent on night
    "plume-deep": "#3B4070",    # accent fills and glows on night
    "sage": "#86B8A5",          # PASS on night
    "sand": "#D2B48C",          # CHANGES REQUESTED on night
    "rose": "#D48F8F",          # BLOCKED on night
    "paper": "#F7F8FA",         # light background, for README and print
    "paper-line": "#DCDEE3",    # borders on light
    "ink": "#0D0E12",           # text on light
    "ink-2": "#5B5F6B",         # secondary text on light
    "plume-ink": "#4C5391",     # accent on light
    "sage-ink": "#2F6B55",      # PASS on light
    "sand-ink": "#7A5520",      # CHANGES REQUESTED on light
    "rose-ink": "#9A3B3B",      # BLOCKED on light
}

# Alpha forms that components layer over the base. Hex forms above are these, flattened on night.
ALPHA = {
    "hairline": "rgba(255, 255, 255, 0.08)",
    "hairline-strong": "rgba(255, 255, 255, 0.14)",
    "frost-2": "rgba(244, 245, 248, 0.64)",
    "frost-3": "rgba(244, 245, 248, 0.5)",
    "frost-4": "rgba(244, 245, 248, 0.26)",
    "surface-sheen": "rgba(255, 255, 255, 0.03)",
    "plume-glow": "rgba(144, 151, 204, 0.18)",
    "plume-wash": "rgba(144, 151, 204, 0.08)",
}

THEMES = {
    "dark": {
        "bg": "night", "surface": "night-2", "code-bg": "night-1", "raised": "night-3",
        "text": "frost", "text-muted": "frost-2", "text-faint": "frost-3", "link": "frost",
        "border": "hairline", "border-strong": "hairline-strong", "accent": "plume",
        "mark-line": "frost", "mark-fill": "night-2",
        "pass": "sage", "changes": "sand", "blocked": "rose", "superseded": "frost-2",
    },
    "light": {
        "bg": "paper", "surface": "paper", "code-bg": "paper", "raised": "paper",
        "text": "ink", "text-muted": "ink-2", "text-faint": "ink-2", "link": "ink",
        "border": "paper-line", "border-strong": "paper-line", "accent": "plume-ink",
        "mark-line": "ink", "mark-fill": "paper",
        "pass": "sage-ink", "changes": "sand-ink", "blocked": "rose-ink", "superseded": "ink-2",
    },
}

FONTS = {
    "sans": "'Inter Variable', Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
    "mono": "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
}
SPACE = {"1": "4px", "2": "8px", "3": "12px", "4": "16px", "6": "24px", "8": "32px", "12": "48px", "16": "64px", "24": "96px"}
RADIUS = {"sm": "6px", "md": "10px", "lg": "14px", "pill": "999px"}
SIZE = {
    "xs": "0.75rem", "sm": "0.875rem", "base": "1rem", "lg": "1.25rem",
    "xl": "2rem", "2xl": "3.5rem", "display": "clamp(3rem, 9vw, 9.5rem)",
}
TRACKING = {"display": "-0.045em", "heading": "-0.03em", "body": "-0.011em", "label": "0.12em"}
WEIGHT = {"display": "520", "heading": "500", "body": "400", "label": "500"}

# Example GitLab label colours for the four verdict labels. Heron sets the labels named in its config.
LABELS = {
    "in progress": "plume-ink",
    "pass": "sage-ink",
    "changes requested": "sand-ink",
    "blocked": "rose-ink",
}

TEXT_PAIRS = [
    ("text", "bg"), ("text", "surface"), ("text", "code-bg"),
    ("text-muted", "bg"), ("text-muted", "surface"),
    ("text-faint", "bg"),
    ("accent", "bg"), ("accent", "surface"),
    ("pass", "bg"), ("changes", "bg"), ("blocked", "bg"), ("superseded", "bg"),
]
GRAPHIC_PAIRS = [("mark-line", "bg"), ("border-strong", "bg")]


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
        "alpha": {k: {"$value": v, "$type": "color"} for k, v in ALPHA.items()},
        "theme": {t: {k: {"$value": "{color.%s}" % v, "$type": "color"} for k, v in roles.items()}
                  for t, roles in THEMES.items()},
        "font": {k: {"$value": v, "$type": "fontFamily"} for k, v in FONTS.items()},
        "size": {k: {"$value": v, "$type": "dimension"} for k, v in SIZE.items()},
        "tracking": {k: {"$value": v, "$type": "dimension"} for k, v in TRACKING.items()},
        "weight": {k: {"$value": v, "$type": "fontWeight"} for k, v in WEIGHT.items()},
        "space": {k: {"$value": v, "$type": "dimension"} for k, v in SPACE.items()},
        "radius": {k: {"$value": v, "$type": "dimension"} for k, v in RADIUS.items()},
        "label": {k: {"$value": "{color.%s}" % v, "$type": "color"} for k, v in LABELS.items()},
    }


def tokens_css():
    out = ["/* Heron design tokens. Generated by docs/brand/tools/build_tokens.py. */", ":root {"]
    out += [f"  --heron-color-{k}: {v};" for k, v in PALETTE.items()]
    out += [f"  --heron-alpha-{k}: {v};" for k, v in ALPHA.items()]
    out += [f"  --heron-font-{k}: {v};" for k, v in FONTS.items()]
    out += [f"  --heron-size-{k}: {v};" for k, v in SIZE.items()]
    out += [f"  --heron-tracking-{k}: {v};" for k, v in TRACKING.items()]
    out += [f"  --heron-weight-{k}: {v};" for k, v in WEIGHT.items()]
    out += [f"  --heron-space-{k}: {v};" for k, v in SPACE.items()]
    out += [f"  --heron-radius-{k}: {v};" for k, v in RADIUS.items()]
    out += ["  color-scheme: dark;"]
    out += [f"  --heron-{k}: var(--heron-color-{v});" for k, v in THEMES["dark"].items()]
    out += ["}", "", "/* Light values, for documents and README images on white. The site itself is dark only. */",
            ".heron-light {", "  color-scheme: light;"]
    out += [f"  --heron-{k}: var(--heron-color-{v});" for k, v in THEMES["light"].items()]
    out += ["}", ""]
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
        w, i = ratio("#FFFFFF", bg), ratio(PALETTE["ink"], bg)
        rows.append(f"| {name} | `{bg}` | {w:.2f} | {i:.2f} | {'white' if w >= i else 'ink'} |")
    return "\n".join(rows)


if __name__ == "__main__":
    (BRAND / "tokens.json").write_text(json.dumps(tokens_json(), indent=2) + "\n")
    (BRAND / "tokens.css").write_text(tokens_css())
    print(table())
