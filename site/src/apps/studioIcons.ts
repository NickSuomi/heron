// Heron Studio's 16 px toolbar and list glyphs, drawn for Heron OS as inline SVG.

const svg = (body: string): string =>
  `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">${body}</svg>`)}`

const page = (x: number, y: number) =>
  `<path d="M${x + 0.5} ${y + 0.5}h6l3 3v8.5h-9z" fill="#fff" stroke="#7a8aa3"/><path d="M${x + 6.5} ${y + 0.5}v3h3" fill="#e4eaf3" stroke="#7a8aa3"/>`

const floppy = (x: number, y: number) =>
  `<rect x="${x + 0.5}" y="${y + 0.5}" width="11" height="11" rx="1" fill="#3d6fb8" stroke="#1f427a"/><rect x="${x + 2.5}" y="${y + 1}" width="7" height="4" fill="#fff"/><rect x="${x + 3}" y="${y + 7.5}" width="6" height="4" fill="#a9bfdd"/>`

export const toolbarIcons = {
  newItem: svg(`${page(3, 1)}<path d="M2 1.5l1.5 1.5M5 .5v2M.5 4h2" stroke="#e8a317" stroke-width="1.3"/>`),
  open: svg(
    `<path d="M1.5 3.5h4l1 1.5h6v8.5h-11z" fill="#f2c94c" stroke="#b58516"/><path d="M1.5 13.5l2.5-6h11l-2.5 6z" fill="#ffe08a" stroke="#b58516"/>`,
  ),
  save: svg(floppy(2, 2)),
  saveAll: svg(`${floppy(0, 0)}${floppy(4, 4)}`),
  cut: svg(
    `<circle cx="4.5" cy="12" r="2.3" fill="none" stroke="#3a3a3a" stroke-width="1.3"/><circle cx="11.5" cy="12" r="2.3" fill="none" stroke="#3a3a3a" stroke-width="1.3"/><path d="M6 10.5L11 1.5M10 10.5L5 1.5" stroke="#6d7c92" stroke-width="1.4"/>`,
  ),
  copy: svg(`${page(1, 0)}${page(5, 4)}`),
  paste: svg(
    `<rect x="2.5" y="2.5" width="10" height="12" rx="1" fill="#c8964f" stroke="#7d5a26"/><rect x="5" y="1" width="5" height="3" rx="1" fill="#d9d9d9" stroke="#6b6b6b"/>${page(6, 6)}`,
  ),
  undo: svg(`<path d="M4 7.5a5 5 0 1 1 1.5 5.5" fill="none" stroke="#2d5aa0" stroke-width="1.8"/><path d="M1 3.5v5h5z" fill="#2d5aa0"/>`),
  redo: svg(`<path d="M12 7.5a5 5 0 1 0-1.5 5.5" fill="none" stroke="#2d5aa0" stroke-width="1.8"/><path d="M15 3.5v5h-5z" fill="#2d5aa0"/>`),
  run: svg(`<path d="M3.5 2l10 6-10 6z" fill="#3c9a2c" stroke="#23661a" stroke-linejoin="round"/><path d="M4.5 4l6.5 4-6.5 1z" fill="#8fd67a"/>`),
  solution: svg(
    `<rect x="1.5" y="1.5" width="5" height="4" fill="#f2c94c" stroke="#b58516"/><path d="M4 5.5v8h3M4 9.5h3" fill="none" stroke="#7a8aa3"/><rect x="7.5" y="7.5" width="7" height="4" fill="#fff" stroke="#7a8aa3"/><rect x="7.5" y="11.5" width="7" height="4" fill="#fff" stroke="#7a8aa3"/>`,
  ),
  errorList: svg(`${page(1, 0)}<circle cx="11" cy="11" r="4.5" fill="#d8312a" stroke="#8f1510"/><path d="M9 9l4 4M13 9l-4 4" stroke="#fff" stroke-width="1.5"/>`),
  output: svg(
    `<rect x="1.5" y="2.5" width="13" height="11" fill="#fff" stroke="#6b7c95"/><rect x="1.5" y="2.5" width="13" height="2.5" fill="#6d8fc4"/><path d="M4 8h6M4 10.5h4" stroke="#50607a"/>`,
  ),
}

/** A blocker: a red disc with a white cross. */
export const blockerIcon = svg(
  `<circle cx="8" cy="8" r="6.5" fill="#dc3c32" stroke="#98190f"/><path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="#fff" stroke-width="1.7" stroke-linecap="round"/>`,
)

/** An advisory: a blue disc with a white i. */
export const advisoryIcon = svg(
  `<circle cx="8" cy="8" r="6.5" fill="#2f6fd0" stroke="#1a458c"/><circle cx="8" cy="4.8" r="1.1" fill="#fff"/><path d="M8 7v5" stroke="#fff" stroke-width="1.9" stroke-linecap="round"/>`,
)

/** The information glyph of the Save dialog, 32 px. */
export const infoIcon = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><defs><radialGradient id="g" cx="40%" cy="30%" r="75%"><stop offset="0" stop-color="#8ec2ff"/><stop offset=".55" stop-color="#2f74d6"/><stop offset="1" stop-color="#16448f"/></radialGradient></defs><circle cx="16" cy="16" r="14.5" fill="url(#g)" stroke="#123a7a"/><ellipse cx="16" cy="9" rx="10" ry="6" fill="#fff" opacity=".28"/><circle cx="16" cy="9.5" r="2.2" fill="#fff"/><path d="M16 14v10" stroke="#fff" stroke-width="3.6" stroke-linecap="round"/></svg>`,
)}`

export const fileIcon = (name: string): string => {
  const extension = name.slice(name.lastIndexOf(".") + 1).toLowerCase()
  const badge = ({ ts: ["#2f6fd0", "TS"], vue: ["#3a9a5b", "V"], json: ["#b07b12", "{}"], diff: ["#8a4fbf", "±"], md: ["#5d6b80", "M"] } as Record<string, [string, string]>)[
    extension
  ]
  return svg(
    `${page(2, 0)}${badge === undefined ? `<path d="M4.5 6h5M4.5 8.5h5M4.5 11h3" stroke="#9aa7ba"/>` : `<rect x="3" y="8" width="10" height="7" rx="1" fill="${badge[0]}"/><text x="8" y="13.6" font-family="Segoe UI, sans-serif" font-size="${badge[1].length > 1 ? 5.4 : 6.5}" font-weight="700" fill="#fff" text-anchor="middle">${badge[1]}</text>`}`,
  )
}

export const folderIcon = (isOpen: boolean): string =>
  svg(
    isOpen
      ? `<path d="M1.5 3.5h4l1 1.5h6v8.5h-11z" fill="#e8b93c" stroke="#a87812"/><path d="M1.5 13.5l2.5-6h11l-2.5 6z" fill="#ffd970" stroke="#a87812"/>`
      : `<path d="M1.5 3.5h4l1 1.5h7.5v8.5h-12.5z" fill="#f2c94c" stroke="#a87812"/><path d="M1.5 6.5h13" stroke="#fff3c4"/>`,
  )

export const projectIcon = svg(
  `<rect x="1.5" y="3.5" width="13" height="10" rx="1" fill="#e9eef6" stroke="#5b6f8f"/><path d="M4 7l2 1.5L4 10M7.5 10.5h4" fill="none" stroke="#2f6fd0" stroke-width="1.3"/>`,
)

export const solutionIcon = svg(
  `<path d="M2.5 1.5h7l4 4v9h-11z" fill="#fff" stroke="#6b5a9b"/><path d="M5 9l3-3 3 3-3 3z" fill="#8a6fd0" stroke="#5b3fa0"/>`,
)
