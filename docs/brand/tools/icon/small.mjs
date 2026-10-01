import { f, homography, poly, rrect, rect } from "./lib.mjs";
import { HERON as R } from "./mark.mjs";

// Small colour icon for 32 and 48 px. Same story, fewer and fatter parts.
// Units are a 256 grid: 1 px at 48 = 5.33 units, 1 px at 32 = 8 units.
const QUAD = [[86, 20], [246, 30], [246, 172], [86, 184]];
const S = 1.12, AX = 84, AY = 214;
const HT = `translate(${AX} ${AY}) scale(${S}) translate(${-AX} ${-AY})`;
const tip = [AX + (148.5 - AX) * S, AY + (90.5 - AY) * S];

export function smallSvg() {
  const H = homography(QUAD);
  const lines = [
    [0, [0.16, "#2b6fd6"], [0.3, "#56677b"]],
    [1, [0.2, "#56677b"], [0.24, "#8a3fb8"]],
    [1, [0.14, "#2b6fd6"], [0.34, "#c0562a"]],
    [0, [0.42, "#3b9a3b"]],
    [1, [0.26, "#56677b"]],
  ];
  const L0 = 0.2, ST = 0.152, BH = 0.07;
  const toks = [];
  lines.forEach(([ind, ...tk], i) => {
    let u = 0.16 + ind * 0.08;
    const v0 = L0 + i * ST;
    tk.forEach(([len, c]) => {
      toks.push(`<path d="${rrect(H, u, v0, u + len, v0 + BH, 0.02, BH / 2)}" fill="${c}"/>`);
      u += len + 0.04;
    });
  });
  const sv = L0 + 1 * ST;
  const sel = rect(H, 0.125, sv - 0.035, 0.97, sv + BH + 0.05);
  const under = poly([H(0.39, sv + BH + 0.03), H(0.63, sv + BH + 0.03)], false);
  const reeds = [
    "M38 150C24 150 25 156 25 168L25 178C25 184 22 186 15 186C22 186 25 188 25 194L25 204C25 216 24 220 38 220",
    "M148 152L128 218",
    "M160 188L178 203L160 218",
  ];
  const defs = `
  <linearGradient id="sg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7fb0cc"/><stop offset=".4" stop-color="#3f7aa0"/><stop offset="1" stop-color="#1b4466"/></linearGradient>
  <linearGradient id="sgl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".75"/><stop offset="1" stop-color="#fff" stop-opacity=".15"/></linearGradient>
  <linearGradient id="sp" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#e1e9f2"/></linearGradient>
  <linearGradient id="ssel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#eaf4fd"/><stop offset="1" stop-color="#c4def9"/></linearGradient>
  <linearGradient id="sb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d2deea"/><stop offset=".5" stop-color="#8299b3"/><stop offset="1" stop-color="#425d7c"/></linearGradient>
  <linearGradient id="snk" gradientUnits="userSpaceOnUse" x1="0" y1="96" x2="0" y2="132"><stop offset="0" stop-color="#e2eaf2"/><stop offset="1" stop-color="#e2eaf2" stop-opacity="0"/></linearGradient>
  <linearGradient id="sw" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8aa2bc"/><stop offset=".6" stop-color="#4f6a89"/><stop offset="1" stop-color="#2c4260"/></linearGradient>
  <linearGradient id="sbl" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe27a"/><stop offset=".5" stop-color="#f6b53c"/><stop offset="1" stop-color="#d07f1c"/></linearGradient>
  <linearGradient id="sr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b6ef6a"/><stop offset=".55" stop-color="#4fbf5c"/><stop offset="1" stop-color="#1e7f4f"/></linearGradient>
  <radialGradient id="swt" cx=".38" cy=".25" r=".8"><stop offset="0" stop-color="#bfeaf6"/><stop offset=".45" stop-color="#48a9cf"/><stop offset="1" stop-color="#14567f"/></radialGradient>
  <filter id="sbl2" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="5"/></filter>
  <path id="shb" d="${R.body}"/>
  <clipPath id="shc"><use href="#shb"/></clipPath>`;
  const body = `
  <ellipse cx="138" cy="232" rx="116" ry="16" fill="#000" opacity=".35" filter="url(#sbl2)"/>
  <path d="${poly(QUAD)}" fill="#000" opacity=".35" filter="url(#sbl2)" transform="translate(5 7)"/>
  <ellipse cx="134" cy="222" rx="122" ry="26" fill="url(#swt)" stroke="#0f4870" stroke-width="3"/>
  <path d="M22 214C60 202 120 198 170 200C120 204 70 210 30 222Z" fill="#fff" opacity=".6"/>
  <path d="${poly(QUAD)}" fill="url(#sg)"/>
  <path d="${rect(H, 0, 0, 1, 0.075)}" fill="url(#sgl)"/>
  <path d="${rect(H, 0.03, 0.15, 0.97, 0.97)}" fill="url(#sp)"/>
  <path d="${rect(H, 0.03, 0.15, 0.115, 0.97)}" fill="#dfe7f0"/>
  <path d="${sel}" fill="url(#ssel)" stroke="#6f9ad3" stroke-width="3"/>
  ${toks.join("")}
  <path d="${under}" stroke="#e0242a" stroke-width="7" stroke-linecap="round"/>
  <path d="${rrect(H, 0.82, 0.02, 0.965, 0.115, 0.02, 0.02)}" fill="#d9553b" stroke="#6e1a10" stroke-width="2.5"/>
  <path d="${poly(QUAD)}" fill="none" stroke="#10273a" stroke-width="4"/>
  <path d="${poly([H(0.012, 0.012), H(0.988, 0.012)], false)}" stroke="#fff" stroke-opacity=".8" stroke-width="3"/>
  <g transform="${HT}">
    <g fill="none" stroke-linecap="round" stroke-linejoin="round">
      <path d="${R.legA}" stroke="#5d4512" stroke-width="10"/><path d="${R.legA}" stroke="#d9b552" stroke-width="5.5"/>
      <path d="${R.legB}" stroke="#5d4512" stroke-width="10"/><path d="${R.legB}" stroke="#d9b552" stroke-width="5.5"/>
    </g>
    <path d="M104 56C94 52 84 52 72 57C84 57 94 59 103 61Z" fill="#17202c"/>
    <use href="#shb" fill="url(#sb)"/>
    <g clip-path="url(#shc)"><rect x="80" y="40" width="50" height="100" fill="url(#snk)"/></g>
    <use href="#shb" fill="none" stroke="#14253a" stroke-width="6" stroke-linejoin="round"/>
    <path d="${R.wing}" fill="url(#sw)" stroke="#1c3048" stroke-width="3.2" stroke-linejoin="round"/>
    <path d="${R.primaries}" fill="#1f2d3f"/>
    <path d="M118 57C129 64 140 74 150 92C138 85 128 78 118 70Z" fill="url(#sbl)" stroke="#7c4f0c" stroke-width="2.6" stroke-linejoin="round"/>
    <circle cx="113" cy="60" r="4" fill="#ffd23a" stroke="#17202c" stroke-width="2"/>
  </g>
  <g fill="none" stroke-linecap="round" stroke-linejoin="round">
    ${reeds.map((d) => `<path d="${d}" stroke="#145a37" stroke-width="20"/>`).join("")}
    ${reeds.map((d) => `<path d="${d}" stroke="url(#sr)" stroke-width="12"/>`).join("")}
  </g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="48" height="48"><defs>${defs}</defs>${body}</svg>`;
}
export const smallTip = tip;
