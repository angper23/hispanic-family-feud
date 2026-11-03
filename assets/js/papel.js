// Papel picado banner drawn as inline SVG. Each flag is a colored sheet with
// cut-out motifs made by an SVG mask, hung on a string and swaying gently.

const COLORS = ['#e5007d', '#ff6b1a', '#ffd23f', '#00b4a6', '#8ac926', '#7b2cbf', '#e3192b', '#2fa8ff'];
const W = 100;
const H = 118;

function flagPath() {
  let d = `M0 0H${W}V100`;
  const scallops = 5;
  const w = W / scallops;
  for (let k = scallops; k > 0; k--) {
    const x = k * w;
    d += `Q${x - w / 2} ${H} ${x - w} 100`;
  }
  return d + 'Z';
}

function border() {
  let s = '';
  for (let x = 10; x <= 90; x += 10) s += `<circle cx="${x}" cy="14" r="2.6"/>`;
  for (let x = 10; x <= 90; x += 10) s += `<path d="M${x} 84l4 5-4 5-4-5z"/>`;
  return s;
}

function motif(kind) {
  const c = { x: 50, y: 50 };
  if (kind === 'flower') {
    let s = '';
    for (let i = 0; i < 8; i++) {
      s += `<ellipse cx="${c.x}" cy="${c.y - 18}" rx="6" ry="12" transform="rotate(${i * 45} ${c.x} ${c.y})"/>`;
    }
    return s + `<circle cx="${c.x}" cy="${c.y}" r="8" fill="#fff"/><circle cx="${c.x}" cy="${c.y}" r="4.5"/>`;
  }
  if (kind === 'star') {
    const pts = [];
    for (let i = 0; i < 16; i++) {
      const r = i % 2 ? 11 : 27;
      const a = (Math.PI / 8) * i - Math.PI / 2;
      pts.push(`${(c.x + r * Math.cos(a)).toFixed(1)},${(c.y + r * Math.sin(a)).toFixed(1)}`);
    }
    return `<polygon points="${pts.join(' ')}"/><circle cx="${c.x}" cy="${c.y}" r="5" fill="#fff"/>`;
  }
  if (kind === 'sun') {
    let s = `<circle cx="${c.x}" cy="${c.y}" r="13"/><circle cx="${c.x}" cy="${c.y}" r="8" fill="#fff"/><circle cx="${c.x}" cy="${c.y}" r="4.5"/>`;
    for (let i = 0; i < 12; i++) {
      s += `<path d="M${c.x - 3.5} ${c.y - 18}L${c.x} ${c.y - 30}L${c.x + 3.5} ${c.y - 18}Z" transform="rotate(${i * 30} ${c.x} ${c.y})"/>`;
    }
    return s;
  }
  // diamonds lattice
  let s = '';
  for (let r = -1; r <= 1; r++) {
    for (let q = -1; q <= 1; q++) {
      if (Math.abs(r) + Math.abs(q) > 1) continue;
      const x = c.x + q * 17;
      const y = c.y + r * 17;
      s += `<path d="M${x} ${y - 9}L${x + 8} ${y}L${x} ${y + 9}L${x - 8} ${y}Z"/>`;
    }
  }
  return s + `<circle cx="${c.x - 22}" cy="${c.y - 22}" r="4"/><circle cx="${c.x + 22}" cy="${c.y - 22}" r="4"/><circle cx="${c.x - 22}" cy="${c.y + 22}" r="4"/><circle cx="${c.x + 22}" cy="${c.y + 22}" r="4"/>`;
}

const KINDS = ['flower', 'star', 'sun', 'diamond'];
let uid = 0;

/** Renders a banner into `el`. `count` flags spread across `width` user units. */
export function papelPicado(el, { count = 17, width = 1920, height = 128 } = {}) {
  const id = `pp${uid++}`;
  const pitch = width / count;
  const scale = (pitch - 10) / W;
  const masks = KINDS.map(
    (k) => `<mask id="${id}-${k}" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}">
      <rect width="${W}" height="${H}" fill="#fff"/><g fill="#000">${motif(k)}${border()}</g></mask>`
  ).join('');
  const d = flagPath();
  let flags = '';
  for (let i = 0; i < count; i++) {
    const x = i * pitch + 5;
    const color = COLORS[i % COLORS.length];
    const kind = KINDS[(i * 3) % KINDS.length];
    const delay = -((i * 0.37) % 3).toFixed(2);
    flags += `<g transform="translate(${x.toFixed(1)} 5) scale(${scale.toFixed(3)})">
      <g class="flag" style="animation-delay:${delay}s">
        <path d="${d}" fill="${color}" mask="url(#${id}-${kind})"/>
        <rect width="${W}" height="6" fill="#000" opacity=".18"/>
      </g></g>`;
  }
  el.innerHTML = `<svg class="papel" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMin slice" aria-hidden="true">
    <defs>${masks}</defs>
    <path d="M0 5H${width}" stroke="#fff4e0" stroke-opacity=".75" stroke-width="2.5"/>
    ${flags}
  </svg>`;
}
