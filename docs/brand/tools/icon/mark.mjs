import { f, homography, poly, rrect, rect } from "./lib.mjs";

// ---------- the editor window, in perspective ----------
export const WIN = [[66, 34], [234, 46], [234, 178], [66, 192]];

const C = {
  kw: "#2b6fd6", id: "#56677b", str: "#c0562a", com: "#3b9a3b", fn: "#8a3fb8", ty: "#11878a",
};
// [indent, [len, colourKey]...]
const CODE = [
  [0, [0.09, "kw"], [0.15, "ty"], [0.04, "id"]],
  [1, [0.08, "kw"], [0.17, "id"], [0.2, "str"]],
  [1, [0.12, "id"], [0.16, "fn"], [0.08, "id"]],
  [2, [0.1, "kw"], [0.26, "str"]],
  [1, [0.05, "id"]],
  [0],
  [0, [0.36, "com"]],
  [0, [0.09, "kw"], [0.14, "fn"], [0.1, "id"]],
  [1, [0.08, "kw"], [0.12, "id"], [0.14, "ty"]],
  [1, [0.3, "str"]],
  [0, [0.05, "id"]],
];
export const SEL = 2; // the line the heron is spearing
const DIG = {
  0: [[0.5, 0], [0, 0.3], [0, 0.7], [0.5, 1], [1, 0.7], [1, 0.3], [0.5, 0]],
  1: [[0.25, 0.2], [0.65, 0], [0.65, 1]],
  2: [[0, 0.22], [0.3, 0], [0.8, 0], [1, 0.28], [0, 1], [1, 1]],
  3: [[0, 0.05], [0.9, 0], [0.4, 0.42], [1, 0.68], [0.65, 1], [0, 0.92]],
  4: [[0.8, 1], [0.8, 0], [0, 0.72], [1, 0.72]],
  5: [[1, 0], [0.12, 0], [0.05, 0.45], [0.75, 0.4], [1, 0.72], [0.6, 1], [0, 0.9]],
  6: [[0.9, 0], [0.25, 0.25], [0, 0.72], [0.45, 1], [0.95, 0.78], [0.75, 0.48], [0.05, 0.6]],
  7: [[0, 0], [1, 0], [0.35, 1]],
  8: [[0.5, 0.46], [0.1, 0.24], [0.5, 0], [0.9, 0.24], [0.5, 0.46], [0, 0.73], [0.5, 1], [1, 0.73], [0.5, 0.46]],
  9: [[0.95, 0.4], [0.2, 0.45], [0.05, 0.15], [0.5, 0], [0.95, 0.25], [0.75, 0.72], [0.15, 1]],
};

export const LINE0 = 0.175, STEP = 0.0715, BAR = 0.03;

export function windowParts(p = "w") {
  const H = homography(WIN);
  const parts = {};
  const P = (pts) => poly(pts.map(([u, v]) => H(u, v)));
  parts.frame = rect(H, 0, 0, 1, 1);
  parts.body = rect(H, 0.018, 0.118, 0.982, 0.982);
  parts.gutter = rect(H, 0.018, 0.118, 0.13, 0.982);
  parts.gutterEdge = poly([H(0.13, 0.118), H(0.13, 0.982)], false);
  parts.titleGloss = rect(H, 0, 0, 1, 0.058);
  parts.hiTop = poly([H(0.004, 0.006), H(0.996, 0.006)], false);
  parts.hiLeft = poly([H(0.004, 0.006), H(0.004, 0.994)], false);
  parts.hiBody = poly([H(0.982, 0.118), H(0.018, 0.118), H(0.018, 0.982)], false);
  // side slab (near, left edge)
  const [tl, bl] = [WIN[0], WIN[3]];
  parts.side = poly([tl, bl, [bl[0] - 5, bl[1] - 1.5], [tl[0] - 5, tl[1] + 1.2]]);
  // caption buttons
  parts.btnMin = rrect(H, 0.745, 0.008, 0.815, 0.07, 0.008, 0.01);
  parts.btnMax = rrect(H, 0.815, 0.008, 0.885, 0.07, 0.008, 0.01);
  parts.btnClose = rrect(H, 0.885, 0.008, 0.975, 0.07, 0.01, 0.01);
  parts.glyphMin = poly([H(0.765, 0.05), H(0.795, 0.05)], false);
  parts.glyphMax = rect(H, 0.835, 0.025, 0.865, 0.052);
  parts.glyphClose = poly([H(0.918, 0.024), H(0.942, 0.054)], false) + poly([H(0.942, 0.024), H(0.918, 0.054)], false);
  parts.appIcon = rrect(H, 0.03, 0.03, 0.068, 0.085, 0.006, 0.008);
  parts.titleText = rrect(H, 0.085, 0.045, 0.34, 0.065, 0.008, 0.008);
  // scrollbar
  parts.track = rect(H, 0.952, 0.118, 0.982, 0.982);
  parts.thumb = rrect(H, 0.956, 0.16, 0.978, 0.42, 0.008, 0.01);
  // code
  const toks = [];
  const nums = [];
  CODE.forEach(([indent, ...tk], i) => {
    const v0 = LINE0 + i * STEP, v1 = v0 + BAR;
    let u = 0.17 + indent * 0.055;
    tk.forEach(([len, col]) => {
      toks.push({ d: rrect(H, u, v0, u + len, v1, 0.008, BAR / 2), col: C[col], i, u0: u, u1: u + len });
      u += len + 0.022;
    });
    const n = String(i + 1);
    const dw = 0.017, dh = BAR * 1.1;
    let ux = 0.112 - n.length * (dw + 0.007);
    for (const ch of n) {
      const vx = v0 - 0.002;
      nums.push(poly(DIG[ch].map(([x, y]) => H(ux + x * dw, vx + y * dh)), false));
      ux += dw + 0.007;
    }
  });
  parts.toks = toks;
  parts.nums = nums;
  const sv0 = LINE0 + SEL * STEP - 0.016;
  parts.sel = rect(H, 0.135, sv0, 0.948, sv0 + BAR + 0.032);
  // squiggle under the fn token on the selected line
  const t = toks.find((x) => x.i === SEL && x.col === C.fn);
  const sq = [];
  const vy = LINE0 + SEL * STEP + BAR + 0.012;
  const n = 9;
  for (let k = 0; k <= n; k++) sq.push(H(t.u0 + (k / n) * (t.u1 - t.u0), vy + (k % 2 ? 0.012 : 0)));
  parts.squiggle = poly(sq, false);
  parts.squiggleMid = H((t.u0 + t.u1) / 2, vy);
  parts.H = H;
  return parts;
}

// ---------- the heron (facing right) ----------
export const HERON = {
  body: "M103.5 64C96.5 72 94.5 84 95 94C96 102 101 110 101 118C86 122 68 134 56 150C50 160 44 170 40 177C56 173 78 164 96 156C102 153 106 150 108 146C112 138 113 128 111 120C109 110 104 104 104 94C104 84 110 76 116.5 68.6L119 68.8L120 59C118 53 112 49.5 106 52C103 54 102 58 102 63Z",
  wing: "M101 124C86 127 68 138 55 154C48 164 40 176 29 190C43 183 54 177 62 172C76 165 90 156 97 146C101 140 102 132 101 124Z",
  plumes: "M110 138C110 148 107 155 103 162C102 158 101 156 99 161C98 157 96 155 93 158C96 152 100 149 104 145Z",
  primaries: "M58 166C50 174 40 182 29 190C42 184 52 179 61 173Z",
  bill: "M118 58C129 65 139 74 148.5 90.5C138 84 128 77 118 69Z",
  mandible: "M120 63.6C130 70 138 77 144.5 85.4",
  stripe: "M115.4 57.2C110.5 54.6 105 54.2 99.5 55.4C104 57.6 109.5 58.6 115 59Z",
  crest1: "M104 56C95 53 85 53 74 57.5C85 56.4 95 57.6 103 59.4Z",
  crest2: "M102.6 59C95 60.5 88 63.5 81 69C89 64.8 96 63 103.4 61.6Z",
  streaks: "M111.6 73.6l-1.1 2.4M108.2 80.4l-.8 2.4M106.8 87.8l-.2 2.4M107.4 95.6l.6 2.3M109.8 102.8l1 2.2",
  legA: "M72 162L76 190L72 216",
  legB: "M83 158L92 188L96 216",
  eye: [113.6, 60.6],
};
