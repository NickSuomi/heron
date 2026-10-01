"""The flat pixel heron: one colour, drawn on a 16 px grid so 16 and 32 px renders stay crisp.
Only the bill tip, crest tip and tail tip are diagonals. Imported by build_assets.py; it writes nothing itself."""
ROWS = {            # row: (first, last) filled pixel runs
    1: [(9, 10)],             # crown
    2: [(8, 14)],             # head + bill
    3: [(8, 9)],              # S-neck: forward under the head,
    4: [(7, 8)],
    5: [(6, 7)],              # back,
    6: [(6, 7)],
    7: [(7, 8)],              # and forward into the breast
    8: [(7, 9)],
    9: [(5, 9)],              # back and breast
    10: [(2, 9)],
    11: [(1, 7)],             # wing and tail
    12: [(5, 5), (7, 7)],     # legs
    13: [(5, 5), (7, 7)],
    14: [(5, 5), (7, 7)],
    15: [(1, 14)],            # water line
}
parts = [f"M{a} {y} H{b + 1} V{y + 1} H{a} Z" for y, runs in ROWS.items() for a, b in runs]
parts += [
    "M15 2 L16 2.5 L15 3 Z",        # bill tip
    "M9 1.2 L5.8 2.6 L8 2 Z",       # crest plume trailing off the nape
    "M1 11 L0 12 H1 Z",             # tail tip
]
D = " ".join(parts)


def flat_svg(color="#1E395B"):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" role="img" aria-label="Heron">'
            f'<title>Heron</title><path d="{D}" fill="{color}"/></svg>')
