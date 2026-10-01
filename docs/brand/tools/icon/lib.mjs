// Geometry helpers for the app icon: a projective map and polygon path builders.
export const f = (n) => (Math.round(n * 100) / 100).toString();

// Square-to-quad projective map (Heckbert). q = [p00, p10, p11, p01].
export function homography(q) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const sx = x0 - x1 + x2 - x3;
  const sy = y0 - y1 + y2 - y3;
  const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2;
  const den = dx1 * dy2 - dx2 * dy1;
  const g = (sx * dy2 - dx2 * sy) / den;
  const h = (dx1 * sy - sx * dy1) / den;
  const a = x1 - x0 + g * x1, b = x3 - x0 + h * x3, c = x0;
  const d = y1 - y0 + g * y1, e = y3 - y0 + h * y3, ff = y0;
  return (u, v) => {
    const w = g * u + h * v + 1;
    return [(a * u + b * v + c) / w, (d * u + e * v + ff) / w];
  };
}

export const poly = (pts, close = true) =>
  "M" + pts.map(([x, y]) => `${f(x)} ${f(y)}`).join("L") + (close ? "Z" : "");

// Rounded rectangle in (u,v) space, sampled, then mapped.
export function rrect(H, u0, v0, u1, v1, ru, rv) {
  const pts = [];
  const arc = (cu, cv, a0) => {
    for (let i = 0; i <= 5; i++) {
      const a = a0 + (i / 5) * (Math.PI / 2);
      pts.push(H(cu + ru * Math.cos(a), cv + rv * Math.sin(a)));
    }
  };
  arc(u1 - ru, v0 + rv, -Math.PI / 2);
  arc(u1 - ru, v1 - rv, 0);
  arc(u0 + ru, v1 - rv, Math.PI / 2);
  arc(u0 + ru, v0 + rv, Math.PI);
  return poly(pts);
}

export const rect = (H, u0, v0, u1, v1) => poly([H(u0, v0), H(u1, v0), H(u1, v1), H(u0, v1)]);
