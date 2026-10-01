"""The glass-orb Heron mark: an orb of dark glass with the heron standing in water and code in the water.
Original artwork; no third-party assets. Imported by build_assets.py; it writes nothing itself."""
import math

# Heron silhouette, facing right, in a 100-unit box. Water line sits at y = 93.
HERON_BODY = (
    "M97 23.4 "
    "L74.2 20.9 "
    "C72.4 16.6 66.4 15.8 63.4 19.1 "          # crown
    "C59.6 19.7 55.2 21.4 50.2 25.8 "            # crest plume, upper edge
    "C55 23.2 59 22 62.6 22.2 C62.2 22.9 62 23.6 62 24.3 "                  # crest plume, lower edge
    "C59.2 28.6 56.2 33.4 56.2 39.4 "            # nape, curving back
    "C56.4 44.4 58.4 47.2 57.8 50.6 "          # lower neck into shoulder
    "C48.4 48.6 33.4 55.4 18.6 72.4 "          # humped back and folded wing to tail
    "C31 75 44.4 74.4 52 71.2 "                # tail underside to belly
    "C61 67.6 66.4 61 64.8 53.4 "              # belly to breast
    "C64 48.4 60.2 45.6 60.2 40.4 "            # breast to lower throat
    "C60.2 35.2 65.6 31.2 69.2 27.4 "          # throat, the S
    "C70.4 26.2 72.2 25.6 74.2 25.6 "          # chin
    "Z"
)
HERON_LEGS = "M46.6 72.4 L44.4 83 L46.4 93.6 M52.6 70.6 L50.6 82.4 L53.4 93.6"
EYE = (69.4, 21.4, 1.15)



C = 128.0
WING = "M57.6 54.6 C48 56.2 35.6 61.6 25.4 69.6"

LARGE = dict(
    R=112.0, HX=40.0, HY=29.6, HS=1.5, water=170.0, leg=2.7, outline=0.0,
    rows=[(0, [12, 8, "{"]), (1, [7, 19]), (2, [5, 10, 13]), (1, [15, 6]), (0, ["}"])],
    row_y=[179.0, 189.0, 199.5, 210.5, 222.0], unit=2.1, bar=3.0, block=40, k=0.06, gl=1.0,
    glow=3.4, glow2=10, rim=1.8, edge=2.2, shadow=True, reflect=True, wing=True, eye=1.0,
)
SMALL = dict(
    R=121.0, HX=31.0, HY=25.0, HS=1.64, water=179.0, leg=6.4, outline=4.4,
    rows=[(0, [15, 9]), (1, [13])], row_y=[197.0, 214.0], unit=3.6, bar=8.0, block=26,
    glow=4, glow2=14, rim=5.0, legs="M45.6 71.6 L42.4 83 L43.8 93.6 M53.6 70.6 L53.2 82.4 L56.6 93.6", edge=6.0, shadow=False, reflect=False, wing=False, eye=1.9, k=0.1, gl=0.85,
)
XS = dict(
    R=124.0, HX=16.0, HY=8.0, HS=2.02, water=197.0, leg=15.0, outline=11.0,
    rows=[], row_y=[], unit=3.6, bar=8.0, block=26,
    glow=5, glow2=10, rim=9.0, edge=12.0, shadow=False, reflect=False, wing=False, eye=0.0, k=0.1, gl=0.5,
)


def brace(x, y, h, w, opening, sw, color, op):
    s = 1 if opening else -1
    x0 = x if opening else x + w
    p = lambda dx, dy: f"{x0 + s * dx * w:.2f} {y + dy * h / 2:.2f}"
    d = (f"M{p(0.95,-1)} C{p(0.5,-1)} {p(0.45,-0.85)} {p(0.45,-0.45)} L{p(0.45,-0.24)} "
         f"C{p(0.45,-0.06)} {p(0.28,0)} {p(0.02,0)} C{p(0.28,0)} {p(0.45,0.06)} {p(0.45,0.24)} "
         f"L{p(0.45,0.45)} C{p(0.45,0.85)} {p(0.5,1)} {p(0.95,1)}")
    return (f'<path d="{d}" fill="none" stroke="{color}" stroke-opacity="{op:.2f}" '
            f'stroke-width="{sw:.2f}" stroke-linecap="round" stroke-linejoin="round"/>')


def code_rows(L, color, op_scale=1.0):
    R = L["R"]
    out = []
    for i, ((indent, toks), y) in enumerate(zip(L["rows"], L["row_y"])):
        k = 1 + L["k"] * i                  # perspective: nearer rows are larger
        u = L["unit"] * k
        sw = L["bar"] * k
        half = math.sqrt(R * R - (y - C) ** 2)
        x = C - L["block"] * L["unit"] / 2 + indent * 4 * u
        op = min(1.0, (0.55 + 0.1 * i) * op_scale)
        sag = 2.0 * k
        yb = lambda xx: y + sag - sag * ((xx - C) / half) ** 2
        for j, t in enumerate(toks):
            top = op if j == 0 else op * 0.72
            if t in ("{", "}"):
                bw = 2.6 * u
                out.append(brace(x, yb(x + bw / 2) - 0.3, sw * 5.2, bw, t == "{", sw * 0.62, color, op * 1.3))
                x += bw + 2.0 * u
                continue
            x1, x2 = x, x + t * u
            xm = (x1 + x2) / 2
            ym = 2 * yb(xm) - (yb(x1) + yb(x2)) / 2
            out.append(f'<path d="M{x1:.2f} {yb(x1):.2f} Q{xm:.2f} {ym:.2f} {x2:.2f} {yb(x2):.2f}" '
                       f'stroke="{color}" stroke-opacity="{top:.2f}" stroke-width="{sw:.2f}" stroke-linecap="round" fill="none"/>')
            x = x2 + 2.0 * u
    return "".join(out)


def defs(idp, L):
    R = L["R"]
    top, bot = C - R, C + R
    return f'''
<radialGradient id="{idp}body" cx="0.5" cy="0.38" r="0.62">
 <stop offset="0" stop-color="#2c4d6b"/><stop offset="0.55" stop-color="#0d1b2b"/><stop offset="1" stop-color="#020509"/></radialGradient>
<radialGradient id="{idp}glow" cx="{C}" cy="{bot + 4}" r="{R * 1.12:.1f}" gradientUnits="userSpaceOnUse" gradientTransform="translate(0 {bot + 4}) scale(1 0.6) translate(0 {-(bot + 4)})">
 <stop offset="0" stop-color="#c4f5ff"/><stop offset="0.26" stop-color="#3cc4ff" stop-opacity="0.85"/>
 <stop offset="0.6" stop-color="#1468b0" stop-opacity="0.32"/><stop offset="1" stop-color="#06345e" stop-opacity="0"/></radialGradient>
<radialGradient id="{idp}vig" cx="0.5" cy="0.5" r="0.5">
 <stop offset="0.8" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.6"/></radialGradient>
<linearGradient id="{idp}gloss" x1="0" y1="{top + 7}" x2="0" y2="{C}" gradientUnits="userSpaceOnUse">
 <stop offset="0" stop-color="#fff" stop-opacity="{0.88 * L['gl']:.2f}"/><stop offset="0.42" stop-color="#fff" stop-opacity="{0.34 * L['gl']:.2f}"/>
 <stop offset="1" stop-color="#fff" stop-opacity="{0.06 * L['gl']:.2f}"/></linearGradient>
<linearGradient id="{idp}rim" x1="0" y1="{top}" x2="0" y2="{bot}" gradientUnits="userSpaceOnUse">
 <stop offset="0" stop-color="#fff" stop-opacity="0.62"/><stop offset="0.38" stop-color="#fff" stop-opacity="0.1"/>
 <stop offset="0.68" stop-color="#7fdcff" stop-opacity="0.28"/><stop offset="1" stop-color="#d2f8ff" stop-opacity="1"/></linearGradient>
<linearGradient id="{idp}cres" x1="0" y1="{bot - 26}" x2="0" y2="{bot}" gradientUnits="userSpaceOnUse">
 <stop offset="0" stop-color="#9fe9ff" stop-opacity="0"/><stop offset="1" stop-color="#e6fbff" stop-opacity="0.85"/></linearGradient>
<linearGradient id="{idp}heron" x1="0" y1="12" x2="0" y2="95" gradientUnits="userSpaceOnUse">
 <stop offset="0" stop-color="#ffffff"/><stop offset="0.62" stop-color="#e2f8ff"/><stop offset="1" stop-color="#8fe0ff"/></linearGradient>
<linearGradient id="{idp}surf" x1="{C - R}" y1="0" x2="{C + R}" y2="0" gradientUnits="userSpaceOnUse">
 <stop offset="0.12" stop-color="#d6f7ff" stop-opacity="0"/><stop offset="0.4" stop-color="#d6f7ff" stop-opacity="0.95"/>
 <stop offset="0.6" stop-color="#d6f7ff" stop-opacity="0.95"/><stop offset="0.88" stop-color="#d6f7ff" stop-opacity="0"/></linearGradient>
<clipPath id="{idp}clip"><circle cx="{C}" cy="{C}" r="{R - 0.5}"/></clipPath>
<filter id="{idp}hglow" x="-40%" y="-40%" width="180%" height="180%">
 <feGaussianBlur in="SourceAlpha" stdDeviation="{L['glow']}" result="b"/>
 <feFlood flood-color="#4fd2ff"/><feComposite operator="in" in2="b" result="g"/>
 <feGaussianBlur in="SourceAlpha" stdDeviation="{L['glow2']}" result="b2"/>
 <feFlood flood-color="#1e90ff" flood-opacity="0.6"/><feComposite operator="in" in2="b2" result="g2"/>
 <feMerge><feMergeNode in="g2"/><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="{idp}ripple" x="-10%" y="-10%" width="120%" height="120%">
 <feTurbulence type="fractalNoise" baseFrequency="0.012 0.16" numOctaves="2" seed="7" result="n"/>
 <feDisplacementMap in="SourceGraphic" in2="n" scale="7" xChannelSelector="R" yChannelSelector="G"/></filter>
<filter id="{idp}soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="5"/></filter>
<filter id="{idp}blur2" x="-10%" y="-50%" width="120%" height="200%"><feGaussianBlur stdDeviation="2"/></filter>
<mask id="{idp}codemask" maskUnits="userSpaceOnUse" x="0" y="0" width="256" height="256">{code_rows(L, "#fff", 2.0)}</mask>'''


def heron(idp, L, eye=True):
    hs = L["HS"]
    ol = (f' stroke="url(#{idp}heron)" stroke-width="{L["outline"] / hs:.2f}" stroke-linejoin="round"'
          if L["outline"] else "")
    wing = (f'<path d="{WING}" fill="none" stroke="#6fc4e6" stroke-opacity="0.55" stroke-width="0.8" stroke-linecap="round"/>'
            if L["wing"] else "")
    e = (f'<circle cx="{EYE[0]}" cy="{EYE[1]}" r="{EYE[2] * L["eye"]:.2f}" fill="#0b2740"/>' if eye and L['eye'] else "")
    return (f'<g transform="translate({L["HX"]} {L["HY"]}) scale({hs})">'
            f'<path d="{HERON_BODY}" fill="url(#{idp}heron)"{ol}/>'
            f'<path d="{L.get("legs", HERON_LEGS)}" fill="none" stroke="url(#{idp}heron)" stroke-width="{L["leg"] / hs:.2f}" '
            f'stroke-linecap="round" stroke-linejoin="round"/>{wing}{e}</g>')


def orb_body(idp, L):
    R, W = L["R"], L["water"]
    top, bot = C - R, C + R
    hx = lambda x: x * L["HS"] + L["HX"]
    legs = [hx(43.8), hx(56.6)] if 'legs' in L else [hx(46.4), hx(53.4)]
    g = R * 0.82                      # gloss half width
    gt = top + 7                      # gloss top
    gloss = (f"M{C - g:.1f} {C - 16:.1f} C{C - g:.1f} {gt + 32:.1f} {C - g * 0.56:.1f} {gt:.1f} {C} {gt} "
             f"C{C + g * 0.56:.1f} {gt:.1f} {C + g:.1f} {gt + 32:.1f} {C + g:.1f} {C - 16:.1f} "
             f"C{C + g * 0.7:.1f} {C - 3:.1f} {C + g * 0.36:.1f} {C:.1f} {C} {C} "
             f"C{C - g * 0.36:.1f} {C:.1f} {C - g * 0.7:.1f} {C - 3:.1f} {C - g:.1f} {C - 16:.1f} Z")
    a = lambda r, deg: (C + r * math.cos(math.radians(deg)), C + r * math.sin(math.radians(deg)))
    r1, r2 = R - 3, R - 3 - R * 0.11
    p1, p2, p3, p4 = a(r1, 32), a(r1, 148), a(r2, 128), a(r2, 52)
    cres = (f"M{p1[0]:.1f} {p1[1]:.1f} A{r1} {r1} 0 0 1 {p2[0]:.1f} {p2[1]:.1f} "
            f"Q{C} {bot - R * 0.05:.1f} {p1[0]:.1f} {p1[1]:.1f} Z")
    sw = L["rim"]
    span = R * 0.82
    surface = (f'<path d="M{C - span:.1f} {W} H{legs[0] - 5:.1f} M{legs[0] + 4.4:.1f} {W} H{legs[1] - 4.4:.1f} '
               f'M{legs[1] + 5:.1f} {W} H{C + span:.1f}" stroke="url(#{idp}surf)" '
               f'stroke-width="{sw:.1f}" stroke-linecap="round"/>')
    rings = "".join(f'<ellipse cx="{x:.1f}" cy="{W + 0.6}" rx="{r}" ry="{r * 0.22:.2f}" fill="none" '
                    f'stroke="#bff1ff" stroke-opacity="{o}" stroke-width="1.1"/>'
                    for x in legs for r, o in ((7, 0.5), (12, 0.22))) if L["reflect"] else ""
    refl_xf = f'translate(0 {W}) scale(1 -0.82) translate(0 {-W})'
    refl = (f'<g filter="url(#{idp}ripple)"><g transform="{refl_xf}" opacity="0.16">{heron(idp, L, False)}</g></g>'
            if L["reflect"] else "")
    refl_code = (f'<g mask="url(#{idp}codemask)"><g filter="url(#{idp}ripple)"><g transform="{refl_xf}">'
                 f'{heron(idp, L, False)}</g></g></g>' if L["reflect"] else "")
    shadow = (f'<ellipse cx="{C}" cy="{bot - 2}" rx="{R * 0.8:.1f}" ry="9" fill="#000" opacity="0.42" filter="url(#{idp}soft)"/>'
              f'<circle cx="{C}" cy="{C + 3}" r="{R + 1}" fill="#000" opacity="0.32" filter="url(#{idp}soft)"/>'
              if L["shadow"] else "")
    return f'''{shadow}
<circle cx="{C}" cy="{C}" r="{R}" fill="url(#{idp}body)"/>
<g clip-path="url(#{idp}clip)">
 <circle cx="{C}" cy="{C}" r="{R}" fill="url(#{idp}glow)"/>
 {refl}{code_rows(L, "#a6ebff")}{refl_code}{surface}{rings}
 <g filter="url(#{idp}hglow)">{heron(idp, L)}</g>
 <circle cx="{C}" cy="{C}" r="{R}" fill="url(#{idp}vig)"/>
 <path d="{cres}" fill="url(#{idp}cres)" filter="url(#{idp}blur2)"/>
</g>
<circle cx="{C}" cy="{C}" r="{R - sw * 1.3:.2f}" fill="none" stroke="url(#{idp}rim)" stroke-width="{sw}"/>
<path d="{gloss}" fill="url(#{idp}gloss)"/>
<circle cx="{C}" cy="{C}" r="{R}" fill="none" stroke="#000" stroke-opacity="0.92" stroke-width="{L['edge']}"/>
<circle cx="{C}" cy="{C}" r="{R + L['edge'] / 2 + 0.7:.2f}" fill="none" stroke="#fff" stroke-opacity="0.16" stroke-width="1.2"/>'''


def svg_open(px, label="Heron"):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="{px}" height="{px}" '
            f'role="img" aria-label="{label}"><title>{label}</title>')


def mark_svg():
    # One file, two drawings: small sizes get the bolder orb automatically.
    style = ('<style>@media (max-width: 48px) { .lg { display: none } } '
             '@media (min-width: 48.01px), (max-width: 24px) { .sm { display: none } } '
             '@media (min-width: 24.01px) { .xs { display: none } }</style>')
    return (svg_open(256) + style + f'<defs>{defs("L", LARGE)}{defs("S", SMALL)}{defs("X", XS)}</defs>'
            f'<g class="lg">{orb_body("L", LARGE)}</g><g class="sm">{orb_body("S", SMALL)}</g>'
            f'<g class="xs">{orb_body("X", XS)}</g></svg>')


def glyph_svg(px=54):
    return svg_open(px) + f'<defs>{defs("S", SMALL)}</defs>{orb_body("S", SMALL)}</svg>'


# wordmark
# "heron" drawn as centre-line strokes with round ends: a soft humanist sans.
# Units: baseline y = 100, x-height y = 52, ascender y = 30. Stroke width SW.
SW = 8.2
H2 = SW / 2
XT, BL, AS = 52 + H2, 100 - H2, 28 + H2      # centre-line x-height, baseline, ascender
HB = BL - XT
FX = 0.9                                     # horizontal proportion of the drawn shapes


def Y(t):
    return f"{XT + t * HB:.2f}"


def X(x):
    return f"{x * FX:.2f}"


def arch(w):  # shoulder of h, n
    return (f"M0 {Y(0.4)} C{X(1.8)} {Y(0.13)} {X(7.6)} {Y(0)} {X(w / 2 + 1)} {Y(0)} "
            f"C{X(w - 4.4)} {Y(0)} {X(w)} {Y(0.15)} {X(w)} {Y(0.42)} V{BL}")


GLYPHS = {
    # name: (path, left centre-line x, right centre-line x)
    "h": (f"M0 {AS} V{BL} " + arch(30), 0, 30 * FX),
    "n": (f"M0 {XT} V{BL} " + arch(30), 0, 30 * FX),
    "e": (f"M{X(1.4)} {Y(0.52)} H{X(31.4)} C{X(31.6)} {Y(0.2)} {X(25.6)} {Y(0)} {X(16.6)} {Y(0)} "
          f"C{X(7)} {Y(0)} {X(0.6)} {Y(0.22)} {X(0.6)} {Y(0.51)} "
          f"C{X(0.6)} {Y(0.82)} {X(7.4)} {Y(1.015)} {X(17.6)} {Y(1.015)} "
          f"C{X(23)} {Y(1.015)} {X(27.2)} {Y(0.97)} {X(30.4)} {Y(0.89)}", 0.6 * FX, 31.6 * FX),
    "r": (f"M0 {XT} V{BL} M0 {Y(0.42)} C{X(1.8)} {Y(0.14)} {X(7.6)} {Y(0)} {X(15.4)} {Y(0)} "
          f"C{X(17)} {Y(0)} {X(18.6)} {Y(0.01)} {X(20)} {Y(0.03)}", 0, 20 * FX),
    "o": (f"M{X(16.4)} {Y(-0.015)} C{X(25.8)} {Y(-0.015)} {X(32.6)} {Y(0.21)} {X(32.6)} {Y(0.5)} "
          f"C{X(32.6)} {Y(0.79)} {X(25.8)} {Y(1.015)} {X(16.4)} {Y(1.015)} "
          f"C{X(7)} {Y(1.015)} {X(0.2)} {Y(0.79)} {X(0.2)} {Y(0.5)} "
          f"C{X(0.2)} {Y(0.21)} {X(7)} {Y(-0.015)} {X(16.4)} {Y(-0.015)} Z", 0.2 * FX, 32.6 * FX),
}
# Outer-edge gaps after each glyph (optical spacing).
GAPS = {"h": 6.4, "e": 6.2, "r": 3.2, "o": 6.8, "n": 0}


def wordmark_paths():
    x = H2
    out = []
    for ch in "heron":
        d, l, r = GLYPHS[ch]
        ox = x - l
        out.append(f'<path transform="translate({ox:.2f} 0)" d="{d}"/>')
        x = ox + r + SW + GAPS[ch]
    return "".join(out), x - GAPS["n"] - H2 + H2   # width to the right outer edge


def lockup_svg(dark):
    words, width = wordmark_paths()
    s = 2.75
    ow = 256 * 1.2
    left = (1200 - (ow + 44 + width * s)) / 2
    tx = left + ow + 44
    ty = 200 - 70 * s      # centre the x-height band on the orb centre line
    if dark:
        fill = ('<linearGradient id="wm" x1="0" y1="30" x2="0" y2="100" gradientUnits="userSpaceOnUse">'
                '<stop offset="0" stop-color="#ffffff"/><stop offset="0.55" stop-color="#e8f8ff"/><stop offset="1" stop-color="#9fe2ff"/></linearGradient>'
                '<filter id="wmglow" x="-10%" y="-30%" width="120%" height="160%">'
                '<feGaussianBlur in="SourceAlpha" stdDeviation="2.2" result="b"/><feFlood flood-color="#49c8ff" flood-opacity="0.75"/>'
                '<feComposite operator="in" in2="b" result="g"/><feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge></filter>')
        flt = ' filter="url(#wmglow)"'
    else:
        fill = ('<linearGradient id="wm" x1="0" y1="30" x2="0" y2="100" gradientUnits="userSpaceOnUse">'
                '<stop offset="0" stop-color="#2a6bb4"/><stop offset="0.5" stop-color="#1E4f8c"/><stop offset="1" stop-color="#1E395B"/></linearGradient>')
        flt = ""
    orb = f'<g transform="translate({left:.1f} {200 - 128 * 1.2:.1f}) scale(1.2)">{orb_body("L", LARGE)}</g>'
    label = "Heron"
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 400" width="1200" height="400" role="img" aria-label="{label}">'
            f'<title>{label}</title><defs>{defs("L", LARGE)}{fill}</defs>{orb}'
            f'<g transform="translate({tx} {ty:.1f}) scale({s})"{flt}><g fill="none" stroke="url(#wm)" stroke-width="{SW}" '
            f'stroke-linecap="round" stroke-linejoin="round">{words}</g></g></svg>'), width * s + tx




# The one-colour mark: the same heron, its water line and the code-line ripples as the orb, in one flat colour, with no orb.
def mono_group(color, L=None):
    L = L or LARGE
    hs = L["HS"]
    water = f'<path d="M{C - 74} {L["water"]} H{C + 74}" stroke="{color}" stroke-width="{L["rim"] * 1.5}" stroke-linecap="round" fill="none"/>'
    body = (f'<g transform="translate({L["HX"]} {L["HY"]}) scale({hs})">'
            f'<path d="{HERON_BODY}" fill="{color}"/>'
            f'<path d="{HERON_LEGS}" fill="none" stroke="{color}" stroke-width="{L["leg"] / hs:.2f}" stroke-linecap="round" stroke-linejoin="round"/></g>')
    return body + water + code_rows(L, color, 1.4)


MONO_BOX = "52 44 152 190"


def mono_svg(color):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{MONO_BOX}" width="152" height="190" role="img" aria-label="Heron">'
            f'<title>Heron</title>{mono_group(color)}</svg>')
