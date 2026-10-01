import { f } from "./lib.mjs";
import { windowParts, HERON as R } from "./mark.mjs";

const WATER_Y = 221;
const HS = 1.07;
const HT = `translate(148.5 90.5) scale(${HS}) translate(-148.5 -90.5)`;

// code symbols as reeds: [kind, x, baseY, w, h, lean]
const REEDS = [
  ["{", 35, 225, 13, 44, -0.05],
  ["<", 12, 224, 11, 21, -0.03],
  ["/", 112, 223, 13, 56, 0.05],
  [">", 131, 224, 11, 24, 0.03],
  ["}", 150, 226, 13, 42, 0.07],
];
function glyph([k, x, y, w, h, lean]) {
  const top = y - h;
  const X = (px, py) => f(px + (y - py) * lean); // lean: shift x with height
  const pt = (px, py) => `${X(px, py)} ${f(py)}`;
  if (k === "{" || k === "}") {
    const s = k === "{" ? 1 : -1;
    const ox = k === "{" ? x : x + w;
    const xx = (t) => ox + s * t * w;
    const m = top + h / 2;
    return `M${pt(xx(1), top)}C${pt(xx(0.42), top)} ${pt(xx(0.42), top + h * 0.06)} ${pt(xx(0.42), top + h * 0.2)}L${pt(xx(0.42), m - h * 0.12)}C${pt(xx(0.42), m - h * 0.02)} ${pt(xx(0.2), m)} ${pt(xx(0), m)}C${pt(xx(0.2), m)} ${pt(xx(0.42), m + h * 0.02)} ${pt(xx(0.42), m + h * 0.12)}L${pt(xx(0.42), y - h * 0.2)}C${pt(xx(0.42), y - h * 0.06)} ${pt(xx(0.42), y)} ${pt(xx(1), y)}`;
  }
  if (k === "<") return `M${pt(x + w, top)}L${pt(x, top + h / 2)}L${pt(x + w, y)}`;
  if (k === ">") return `M${pt(x, top)}L${pt(x + w, top + h / 2)}L${pt(x, y)}`;
  if (k === "/") return `M${pt(x + w, top)}L${pt(x, y)}`;
}

export function markSvg() {
  const w = windowParts();
  const reeds = REEDS.map(glyph);
  const [ex, ey] = R.eye;
  const defs = `
  <linearGradient id="glass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7fb0cc"/><stop offset=".4" stop-color="#3f7aa0"/><stop offset="1" stop-color="#1b4466"/></linearGradient>
  <linearGradient id="gloss" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".75"/><stop offset="1" stop-color="#fff" stop-opacity=".18"/></linearGradient>
  <linearGradient id="side" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#2a4e6b"/><stop offset="1" stop-color="#5b88a8"/></linearGradient>
  <linearGradient id="page" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".6" stop-color="#f6f9fc"/><stop offset="1" stop-color="#e3eaf2"/></linearGradient>
  <linearGradient id="sheen" x1="0" y1="0" x2=".7" y2=".7"><stop offset="0" stop-color="#fff" stop-opacity=".9"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
  <linearGradient id="gut" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#eef3f8"/><stop offset="1" stop-color="#dfe7f0"/></linearGradient>
  <linearGradient id="sel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f2f8fd"/><stop offset="1" stop-color="#cfe5fb"/></linearGradient>
  <linearGradient id="close" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f2a08c"/><stop offset=".5" stop-color="#d9553b"/><stop offset="1" stop-color="#b8321f"/></linearGradient>
  <linearGradient id="btn" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".6"/><stop offset="1" stop-color="#fff" stop-opacity=".12"/></linearGradient>
  <linearGradient id="thumb" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#f4f8fb"/><stop offset="1" stop-color="#bccbd9"/></linearGradient>
  <linearGradient id="hbody" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d2deea"/><stop offset=".5" stop-color="#8299b3"/><stop offset="1" stop-color="#425d7c"/></linearGradient>
  <linearGradient id="neckfade" gradientUnits="userSpaceOnUse" x1="0" y1="96" x2="0" y2="132"><stop offset="0" stop-color="#fbfdff"/><stop offset="1" stop-color="#fbfdff" stop-opacity="0"/></linearGradient>
  <linearGradient id="hneck" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#dfe8f1"/></linearGradient>
  <linearGradient id="hwing" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8aa2bc"/><stop offset=".6" stop-color="#4f6a89"/><stop offset="1" stop-color="#2c4260"/></linearGradient>
  <linearGradient id="bill" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe27a"/><stop offset=".5" stop-color="#f6b53c"/><stop offset="1" stop-color="#d07f1c"/></linearGradient>
  <linearGradient id="leg" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#e6c66a"/><stop offset="1" stop-color="#9a7428"/></linearGradient>
  <linearGradient id="reed" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b6ef6a"/><stop offset=".55" stop-color="#4fbf5c"/><stop offset="1" stop-color="#1e7f4f"/></linearGradient>
  <radialGradient id="water" cx=".38" cy=".25" r=".8"><stop offset="0" stop-color="#bfeaf6"/><stop offset=".45" stop-color="#48a9cf"/><stop offset="1" stop-color="#14567f"/></radialGradient>
  <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".7"/><stop offset=".75" stop-color="#fff" stop-opacity="0"/></linearGradient>
  <mask id="reflMask" maskUnits="userSpaceOnUse" x="0" y="0" width="256" height="256"><rect x="0" y="${WATER_Y}" width="256" height="35" fill="url(#fade)"/></mask>
  <filter id="soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="4"/></filter>
  <filter id="soft2" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="1.6"/></filter>
  <clipPath id="frameClip"><path d="${w.frame}"/></clipPath>
  <clipPath id="pageClip"><path d="${w.body}"/></clipPath>
  <clipPath id="waterClip"><ellipse cx="132" cy="231" rx="123" ry="20"/></clipPath>
  <path id="hb" d="${R.body}"/>
  <path id="hw" d="${R.wing}"/>
  <clipPath id="hbClip"><use href="#hb"/></clipPath>`;

  const windowG = `
  <g id="win">
    <path d="${w.side}" fill="url(#side)" stroke="#173149" stroke-width=".8"/>
    <path d="${w.frame}" fill="url(#glass)"/>
    <g clip-path="url(#frameClip)"><path d="M150 20 L172 20 L120 200 L98 200Z M182 20 L190 20 L140 200 L132 200Z" fill="#fff" opacity=".16"/></g>
    <path d="${w.titleGloss}" fill="url(#gloss)"/>
    <path d="${w.body}" fill="url(#page)"/>
    <path d="${w.gutter}" fill="url(#gut)"/>
    <g clip-path="url(#pageClip)"><path d="M60 40L200 40L60 170Z" fill="url(#sheen)"/></g>
    <path d="${w.gutterEdge}" stroke="#c9d5e2" stroke-width=".8" fill="none"/>
    <path d="${w.track}" fill="#eef2f6"/>
    <path d="${w.thumb}" fill="url(#thumb)" stroke="#8ea3b8" stroke-width=".6"/>
    <path d="${w.sel}" fill="url(#sel)" stroke="#84acdd" stroke-width=".7"/>
    ${w.nums.map((d) => `<path d="${d}"/>`).join("").replace(/^/, '<g fill="none" stroke="#91a3b7" stroke-width=".75" stroke-linejoin="round" stroke-linecap="round">') + "</g>"}
    ${w.toks.map((t) => `<path d="${t.d}" fill="${t.col}"/>`).join("")}
    <path d="${w.squiggle}" fill="none" stroke="#e0242a" stroke-width="1.1" stroke-linejoin="round"/>
    <path d="${w.appIcon}" fill="#2b6fd6" stroke="#fff" stroke-width=".5"/>
    <path d="${w.titleText}" fill="#fff" fill-opacity=".85"/>
    <path d="${w.btnMin}" fill="url(#btn)" stroke="#1d3d58" stroke-width=".6"/>
    <path d="${w.btnMax}" fill="url(#btn)" stroke="#1d3d58" stroke-width=".6"/>
    <path d="${w.btnClose}" fill="url(#close)" stroke="#6e1a10" stroke-width=".6"/>
    <g fill="none" stroke="#fff" stroke-width="1" stroke-linecap="round"><path d="${w.glyphMin}"/><path d="${w.glyphMax}" stroke-width=".8"/><path d="${w.glyphClose}"/></g>
    <path d="${w.frame}" fill="none" stroke="#10273a" stroke-opacity=".85" stroke-width="1"/>
    <path d="${w.hiTop}" fill="none" stroke="#fff" stroke-opacity=".85" stroke-width=".9"/>
    <path d="${w.hiLeft}" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width=".9"/>
    <path d="${w.hiBody}" fill="none" stroke="#163a58" stroke-opacity=".55" stroke-width=".8"/>
  </g>`;

  const heronG = `
  <g id="heron" transform="${HT}">
    <path d="${R.legA}" fill="none" stroke="#5d4512" stroke-width="4.4" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="${R.legA}" fill="none" stroke="url(#leg)" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="${R.legB}" fill="none" stroke="#5d4512" stroke-width="4.4" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="${R.legB}" fill="none" stroke="url(#leg)" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="${R.crest1}" fill="#17202c"/>
    <path d="${R.crest2}" fill="#17202c"/>
    <use href="#hb" fill="url(#hbody)"/>
    <g clip-path="url(#hbClip)">
      <rect x="80" y="40" width="50" height="100" fill="url(#neckfade)"/>
      <use href="#hb" transform="translate(1.2 1.2)" fill="none" stroke="#fff" stroke-opacity=".8" stroke-width="1.6"/>
    </g>
    <use href="#hb" fill="none" stroke="#1c3048" stroke-width="1.3" stroke-linejoin="round"/>
    <path d="${R.plumes}" fill="#dfe7ef" stroke="#1c3048" stroke-width="1" stroke-linejoin="round"/>
    <use href="#hw" fill="url(#hwing)" stroke="#1c3048" stroke-width="1.1" stroke-linejoin="round"/>
    <path d="${R.primaries}" fill="#1f2d3f"/>
    <path d="M97 132C86 138 72 148 62 160" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="1" stroke-linecap="round"/>
    <path d="${R.streaks}" transform="translate(-3.2 0)" fill="none" stroke="#4a5a6e" stroke-opacity=".5" stroke-width=".9" stroke-linecap="round"/>
    <path d="${R.stripe}" fill="#17202c"/>
    <path d="${R.bill}" fill="url(#bill)" stroke="#7c4f0c" stroke-width="1" stroke-linejoin="round"/>
    <path d="${R.mandible}" fill="none" stroke="#9a6414" stroke-width=".7"/>
    <circle cx="${ex}" cy="${ey}" r="2.3" fill="#ffd23a" stroke="#5a3d06" stroke-width=".6"/>
    <circle cx="${ex + 0.3}" cy="${ey + 0.1}" r="1.05" fill="#111"/>
    <circle cx="${ex - 0.5}" cy="${ey - 0.6}" r=".45" fill="#fff"/>
  </g>`;

  const reedsG = `
  <g id="reeds" fill="none" stroke-linecap="round" stroke-linejoin="round">
    ${reeds.map((d) => `<path d="${d}" stroke="#145a37" stroke-width="7"/>`).join("")}
    ${reeds.map((d) => `<path d="${d}" stroke="url(#reed)" stroke-width="4.6"/>`).join("")}
    ${reeds.map((d) => `<path d="${d}" transform="translate(-.8 -.6)" stroke="#fff" stroke-opacity=".55" stroke-width="1.1"/>`).join("")}
  </g>`;

  const body = `
  <ellipse cx="140" cy="240" rx="116" ry="11" fill="#000" opacity=".4" filter="url(#soft)"/>
  <path d="${w.frame}" fill="#000" opacity=".35" filter="url(#soft)" transform="translate(5 7)"/>
  <ellipse cx="132" cy="231" rx="123" ry="20" fill="url(#water)"/>
  <g clip-path="url(#waterClip)" mask="url(#reflMask)">
    <g transform="translate(0 ${2 * WATER_Y}) scale(1 -1)"><use href="#win"/><use href="#heron"/><use href="#reeds"/></g>
  </g>
  ${windowG}
  <g clip-path="url(#pageClip)"><use href="#hb" fill="#0b2036" opacity=".3" filter="url(#soft2)" transform="translate(6 4) ${HT}"/></g>
  ${heronG}
  ${reedsG}
  <g fill="none" stroke="#fff" stroke-linecap="round">
    <ellipse cx="68" cy="224" rx="8" ry="2" stroke-opacity=".75" stroke-width=".9"/>
    <ellipse cx="94" cy="224" rx="8" ry="2" stroke-opacity=".75" stroke-width=".9"/>
    <path d="M14 229 A123 20 0 0 1 250 229" stroke-opacity=".8" stroke-width="1"/>
    <path d="M28 237 A110 14 0 0 0 238 237" stroke="#0c3a5c" stroke-opacity=".5" stroke-width="1.2"/>
    <ellipse cx="152" cy="225" rx="9" ry="2" stroke-opacity=".5" stroke-width=".8"/>
    <ellipse cx="119" cy="224" rx="7" ry="1.8" stroke-opacity=".5" stroke-width=".8"/>
    <ellipse cx="40" cy="226" rx="8" ry="1.8" stroke-opacity=".5" stroke-width=".8"/>
  </g>
  <g fill="#fff">
    <path d="M34 225 C66 216 118 213 160 215 C118 217 70 221 40 229Z" opacity=".55"/>
    <ellipse cx="206" cy="223" rx="18" ry="2.2" opacity=".35"/>
  </g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256"><defs>${defs}</defs>${body}</svg>`;
}

