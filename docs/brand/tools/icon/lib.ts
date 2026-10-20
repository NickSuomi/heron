// Geometry helpers for the app icon: a projective map and polygon path builders.
export type Point = [number, number];
export type Quad = [Point, Point, Point, Point];
export type Mapper = (u: number, v: number) => Point;

export const f = (n: number) => (Math.round(n * 100) / 100).toString();

// Square-to-quad projective map (Heckbert). q = [p00, p10, p11, p01].
export function homography(q: Quad): Mapper {
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

export const poly = (pts: ReadonlyArray<Point>, close = true) =>
  "M" + pts.map(([x, y]) => `${f(x)} ${f(y)}`).join("L") + (close ? "Z" : "");

// Rounded rectangle in (u,v) space, sampled, then mapped.
export function rrect(H: Mapper, u0: number, v0: number, u1: number, v1: number, ru: number, rv: number) {
  const pts: Array<Point> = [];
  const arc = (cu: number, cv: number, a0: number) => {
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

export const rect = (H: Mapper, u0: number, v0: number, u1: number, v1: number) => poly([H(u0, v0), H(u1, v0), H(u1, v1), H(u0, v1)]);
