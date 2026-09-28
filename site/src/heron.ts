// The heron on the rim, facing into the page. Same drawing as docs/brand/tools/build_assets.py; there is no eye.
export const heronSvg = `
<svg class="heron" viewBox="0 0 200 280" role="presentation" focusable="false">
  <g class="fig">
    <path class="body" d="M100 138 C104 116 126 106 148 112 C168 118 180 146 194 188 C172 183 150 182 134 180 C112 176 98 160 100 138 Z"/>
    <g class="neck">
      <path class="body" d="M126 113 C112 96 97 96 91 80 C85 64 72 58 58 64 L51 77 C61 76 68 82 72 92 C78 107 94 117 102 136 Z"/>
      <ellipse class="body" cx="51" cy="70" rx="11.5" ry="7.5" transform="rotate(52 51 70)"/>
      <path class="plume" fill="none" d="M57 63 C66 55 78 54 90 58"/>
      <path class="bill" d="M42 72 L49 79 L17 120 Z"/>
    </g>
    <path class="wing" fill="none" d="M116 132 C136 124 164 142 188 182"/>
    <path class="legs" fill="none" d="M132 178 L128 228 L131 276 M142 178 L146 228 L150 276 M116 277 H139 M139 277 L147 272 M140 277 H166"/>
  </g>
</svg>`
