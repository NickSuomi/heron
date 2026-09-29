// The browser's glyphs, drawn for Heron OS as inline SVG in the manner of a 2007 web browser. None is a copy of
// a vendor's artwork; the page icon is a plain sheet with a globe, not any browser's logo.

const svg = (body: string, size = 16): string =>
  `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${body}</svg>`)}`

const globeBody = (cx: number, cy: number, r: number) =>
  `<defs><radialGradient id="g" cx="0.35" cy="0.3" r="0.8"><stop offset="0" stop-color="#d6f1ff"/><stop offset="0.5" stop-color="#4aa6e6"/><stop offset="1" stop-color="#1255a8"/></radialGradient></defs><circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#g)" stroke="#0e4c8f" stroke-width=".8"/><path d="M${cx - r * 0.7} ${cy - r * 0.35}c${r * 0.4} ${r * 0.1} ${r * 0.5} ${r * 0.4} ${r * 0.9} ${r * 0.3}s${r * 0.4} ${r * 0.4} ${r * 0.2} ${r * 0.7}-${r * 0.6} ${r * 0.2}-${r * 0.6} ${r * 0.6}M${cx + r * 0.15} ${cy - r * 0.85}c${r * 0.3} 0 ${r * 0.7} ${r * 0.2} ${r * 0.75} ${r * 0.5}" fill="none" stroke="#5dbb4f" stroke-width="${r * 0.32}" stroke-linecap="round"/>`

export const browserIcons = {
  arrowBack: svg(`<path d="M13 8H4.5M8 3.5L3.5 8 8 12.5" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`),
  arrowForward: svg(`<path d="M3 8h8.5M8 3.5l4.5 4.5L8 12.5" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`),
  refresh: svg(
    `<path d="M12.8 6.2A5 5 0 0 0 3.6 5" fill="none" stroke="#2f8f2b" stroke-width="1.9"/><path d="M2.3 2.6l.9 4 3.8-1.5z" fill="#2f8f2b"/><path d="M3.2 9.8a5 5 0 0 0 9.2 1.2" fill="none" stroke="#2f8f2b" stroke-width="1.9"/><path d="M13.7 13.4l-.9-4-3.8 1.5z" fill="#2f8f2b"/>`,
  ),
  stop: svg(
    `<defs><linearGradient id="r" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff8a7a"/><stop offset="1" stop-color="#c8200f"/></linearGradient></defs><rect x="1.5" y="1.5" width="13" height="13" rx="2.5" fill="url(#r)" stroke="#8d1508"/><path d="M5 5l6 6M11 5l-6 6" stroke="#fff" stroke-width="2" stroke-linecap="round"/>`,
  ),
  stopDisabled: svg(`<rect x="1.5" y="1.5" width="13" height="13" rx="2.5" fill="#e3e3e3" stroke="#a8a8a8"/><path d="M5 5l6 6M11 5l-6 6" stroke="#fff" stroke-width="2" stroke-linecap="round"/>`),
  search: svg(`<circle cx="6.5" cy="6.5" r="4" fill="#eaf5ff" stroke="#2c5d93" stroke-width="1.6"/><path d="M9.5 9.5l4.5 4.5" stroke="#2c5d93" stroke-width="2.4" stroke-linecap="round"/>`),
  favorites: svg(
    `<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff6a8"/><stop offset="1" stop-color="#f0a800"/></linearGradient></defs><path d="M8 1.2l2 4.3 4.7.5-3.5 3.2 1 4.6L8 11.5l-4.2 2.3 1-4.6L1.3 6l4.7-.5z" fill="url(#s)" stroke="#a86b00" stroke-linejoin="round"/>`,
  ),
  addFavorite: svg(
    `<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff6a8"/><stop offset="1" stop-color="#f0a800"/></linearGradient></defs><path d="M7 1.2l1.8 3.9 4.2.5-3.1 2.9.9 4.1L7 10.5l-3.8 2.1.9-4.1L1 5.6l4.2-.5z" fill="url(#s)" stroke="#a86b00" stroke-linejoin="round"/><circle cx="12" cy="12" r="3.6" fill="#3c9a2c" stroke="#fff"/><path d="M12 10v4M10 12h4" stroke="#fff" stroke-width="1.5"/>`,
  ),
  quickTabs: svg(
    `<rect x="1.5" y="1.5" width="5.5" height="5.5" fill="#fff" stroke="#5a7da8"/><rect x="9" y="1.5" width="5.5" height="5.5" fill="#fff" stroke="#5a7da8"/><rect x="1.5" y="9" width="5.5" height="5.5" fill="#fff" stroke="#5a7da8"/><rect x="9" y="9" width="5.5" height="5.5" fill="#fff" stroke="#5a7da8"/><path d="M2 2.5h4.5M9.5 2.5H14M2 10h4.5M9.5 10H14" stroke="#8fb4e0"/>`,
  ),
  newTab: svg(`<path d="M3.5 2.5h6l3 3v8h-9z" fill="#fff" stroke="#7a8aa3"/><circle cx="11.5" cy="11.5" r="3.4" fill="#3c9a2c" stroke="#fff"/><path d="M11.5 9.6v3.8M9.6 11.5h3.8" stroke="#fff" stroke-width="1.4"/>`),
  home: svg(
    `<path d="M2 8.5L8 2.8l6 5.7" fill="none" stroke="#7b4b18" stroke-width="1.6" stroke-linejoin="round"/><path d="M3.8 7.5v6.5h8.4V7.5L8 3.8z" fill="#f7e2b0" stroke="#9a6a2a"/><rect x="6.8" y="9.5" width="2.6" height="4.5" fill="#b35b1e"/><rect x="10.5" y="3" width="1.6" height="3" fill="#a33"/>`,
  ),
  feeds: svg(
    `<defs><linearGradient id="f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffc16b"/><stop offset="1" stop-color="#e46a0c"/></linearGradient></defs><rect x="1.5" y="1.5" width="13" height="13" rx="2.5" fill="url(#f)" stroke="#b64f06"/><circle cx="5" cy="11" r="1.4" fill="#fff"/><path d="M4 7.2a4.8 4.8 0 0 1 4.8 4.8M4 4a8 8 0 0 1 8 8" fill="none" stroke="#fff" stroke-width="1.6"/>`,
  ),
  feedsDisabled: svg(
    `<rect x="1.5" y="1.5" width="13" height="13" rx="2.5" fill="#d4d4d4" stroke="#a3a3a3"/><circle cx="5" cy="11" r="1.4" fill="#fff"/><path d="M4 7.2a4.8 4.8 0 0 1 4.8 4.8M4 4a8 8 0 0 1 8 8" fill="none" stroke="#fff" stroke-width="1.6"/>`,
  ),
  print: svg(
    `<rect x="4" y="1.5" width="8" height="5" fill="#fff" stroke="#7a7a7a"/><rect x="1.5" y="6" width="13" height="6" rx="1.5" fill="#bfc6cf" stroke="#5e6670"/><rect x="4" y="10" width="8" height="4.5" fill="#fff" stroke="#7a7a7a"/><circle cx="12.3" cy="8" r=".8" fill="#3c9a2c"/>`,
  ),
  page: svg(`<path d="M3.5 1.5h6l3 3v10h-9z" fill="#fff" stroke="#6b7a90"/><path d="M9.5 1.5v3h3" fill="#dfe6ef" stroke="#6b7a90"/><path d="M5.5 7h5M5.5 9h5M5.5 11h3.5" stroke="#9aa9bd"/>`),
  tools: svg(
    `<circle cx="8" cy="8" r="4.2" fill="#c7cfd9" stroke="#56606d" stroke-width="1"/><circle cx="8" cy="8" r="1.6" fill="#fff" stroke="#56606d"/><path d="M8 1.2v2.2M8 12.6v2.2M1.2 8h2.2M12.6 8h2.2M3.2 3.2l1.6 1.6M11.2 11.2l1.6 1.6M3.2 12.8l1.6-1.6M11.2 4.8l1.6-1.6" stroke="#56606d" stroke-width="1.8" stroke-linecap="round"/>`,
  ),
  help: svg(
    `<defs><radialGradient id="h" cx="0.35" cy="0.3" r="0.8"><stop offset="0" stop-color="#b5dcff"/><stop offset="1" stop-color="#1d5fb8"/></radialGradient></defs><circle cx="8" cy="8" r="6.5" fill="url(#h)" stroke="#12458c"/><path d="M6 6.2a2 2 0 1 1 2.6 1.9c-.6.2-.6.7-.6 1.4" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/><circle cx="8" cy="11.6" r="1" fill="#fff"/>`,
  ),
  globe: svg(globeBody(8, 8, 6.3)),
  padlock: svg(`<path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="#8a6d1c" stroke-width="1.6"/><rect x="3.5" y="7" width="9" height="7" rx="1.2" fill="#f3c93b" stroke="#8a6d1c"/><rect x="7.3" y="9" width="1.4" height="3" fill="#8a6d1c"/>`),
  pageGlobe: svg(`<path d="M2.5 1.5h7l3 3v10h-10z" fill="#fff" stroke="#6b7a90"/><path d="M9.5 1.5v3h3" fill="#dfe6ef" stroke="#6b7a90"/>${globeBody(8.5, 10, 4.2)}`),
  info: svg(
    `<defs><radialGradient id="i" cx="0.35" cy="0.3" r="0.85"><stop offset="0" stop-color="#c3e4ff"/><stop offset="0.6" stop-color="#2f7fd8"/><stop offset="1" stop-color="#0f4ea3"/></radialGradient></defs><circle cx="16" cy="16" r="14" fill="url(#i)" stroke="#0b3e84" stroke-width="1.2"/><circle cx="16" cy="9.5" r="2.3" fill="#fff"/><path d="M13 13.5h4.5v9.5H19.5v2.3h-7v-2.3H14v-7.2h-1z" fill="#fff"/><path d="M5 12a12 11 0 0 1 22 0" fill="#fff" opacity=".22"/>`,
    32,
  ),
  shield: svg(`<path d="M8 1.2l5.5 2v4.2c0 3.5-2.4 6-5.5 7.4C4.9 13.4 2.5 10.9 2.5 7.4V3.2z" fill="#4b87d1" stroke="#1f4f8f"/><path d="M8 1.2v13.6c3.1-1.4 5.5-3.9 5.5-7.4V3.2z" fill="#f2c53d" stroke="#1f4f8f"/>`),
  zoom: svg(`<circle cx="6.5" cy="6.5" r="4.2" fill="#fff" stroke="#3a5f8d" stroke-width="1.4"/><path d="M9.6 9.6l4.4 4.4" stroke="#3a5f8d" stroke-width="2.2" stroke-linecap="round"/><path d="M4.5 6.5h4M6.5 4.5v4" stroke="#3a5f8d" stroke-width="1.2"/>`),
  dropdown: svg(`<path d="M2 3.5h5l-2.5 3z" fill="#2b2b2b"/>`, 8),
  close: svg(`<path d="M4 4l6 6M10 4l-6 6" stroke="#4e5d73" stroke-width="1.6" stroke-linecap="round"/>`, 14),
  closeHot: svg(`<rect x=".5" y=".5" width="13" height="13" rx="2" fill="#d6503f" stroke="#8d2618"/><path d="M4 4l6 6M10 4l-6 6" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>`, 14),
} as const

/** The mock GitLab's own mark: an orange rounded square with a branching line, drawn for gitlab.heron.local. */
export const forgeMark = svg(
  `<defs><linearGradient id="m" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffb35c"/><stop offset="1" stop-color="#e2530f"/></linearGradient></defs><rect x="1" y="1" width="22" height="22" rx="5" fill="url(#m)" stroke="#a83a08"/><path d="M8 5.5v13M8 13c0-3 8-2 8-6" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/><circle cx="8" cy="5.5" r="2" fill="#fff"/><circle cx="8" cy="18.5" r="2" fill="#fff"/><circle cx="16" cy="6.5" r="2" fill="#fff"/><path d="M2 9C6 4 16 3 22 6V6a5 5 0 0 0-5-5H6a5 5 0 0 0-5 5z" fill="#fff" opacity=".28"/>`,
  24,
)
