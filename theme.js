// Document themes. A theme is three palette colors (the 60-30-10 rule), two fonts and optional
// per-element overrides. resolveTheme() turns it into the full set of element colors that the
// Word export, the preview, the HTML export and the diagrams all use.

// ---------- Color math ----------
const toRgb = (c) => {
  const h = c.replace('#', '');
  const n = parseInt(h.length === 3 ? [...h].map((x) => x + x).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const toHex = (rgb) => '#' + rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');
/** Blend of a and b: t = 0 gives a, t = 1 gives b. */
export const mix = (a, b, t) => { const A = toRgb(a), B = toRgb(b); return toHex(A.map((v, i) => v + (B[i] - v) * t)); };
const channel = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const luminance = (c) => { const [r, g, b] = toRgb(c).map(channel); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
/** WCAG contrast ratio, from 1 to 21. Body text needs 4.5, large headings 3. */
export const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const readableOn = (bg) => (contrast('#ffffff', bg) >= contrast('#1a1a1a', bg) ? '#ffffff' : '#1a1a1a');
/** Darkens (or, on a dark page, lightens) a color just enough to be readable on bg. */
function legible(color, bg, min) {
  if (contrast(color, bg) >= min) return color;
  const toward = readableOn(bg) === '#ffffff' ? '#ffffff' : '#000000';
  for (let t = 0.1; t < 1; t += 0.1) {
    const c = mix(color, toward, t);
    if (contrast(c, bg) >= min) return c;
  }
  return toward;
}
export const isHex = (c) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);

// ---------- Fonts ----------
// Word uses the font name (it must be installed where the document is opened); the preview uses the stack.
export const FONTS = {
  Calibri: 'Calibri, Carlito, "Segoe UI", system-ui, sans-serif',
  Aptos: 'Aptos, Calibri, Carlito, "Segoe UI", sans-serif',
  Arial: 'Arial, Helvetica, "Liberation Sans", sans-serif',
  'Segoe UI': '"Segoe UI", system-ui, sans-serif',
  Verdana: 'Verdana, Geneva, sans-serif',
  Cambria: 'Cambria, Caladea, Georgia, serif',
  Georgia: 'Georgia, "DejaVu Serif", serif',
  'Times New Roman': '"Times New Roman", Times, "Liberation Serif", serif',
  Garamond: 'Garamond, "EB Garamond", Georgia, serif',
};

// ---------- Presets ----------
export const PRESETS = {
  navy: { name: 'Navy', palette: { dominant: '#ffffff', secondary: '#1f3864', accent: '#2e5c9a' }, fonts: { heading: 'Calibri', body: 'Calibri' } },
  ocean: { name: 'Ocean', palette: { dominant: '#ffffff', secondary: '#0b3c5d', accent: '#1d7a8c' }, fonts: { heading: 'Segoe UI', body: 'Segoe UI' } },
  forest: { name: 'Forest', palette: { dominant: '#fcfcf9', secondary: '#1e4d2b', accent: '#b07d2b' }, fonts: { heading: 'Georgia', body: 'Calibri' } },
  burgundy: { name: 'Burgundy', palette: { dominant: '#fffdf9', secondary: '#6d1a36', accent: '#a8683f' }, fonts: { heading: 'Cambria', body: 'Cambria' } },
  graphite: { name: 'Graphite', palette: { dominant: '#ffffff', secondary: '#2b2d31', accent: '#e4572e' }, fonts: { heading: 'Arial', body: 'Arial' } },
  violet: { name: 'Violet', palette: { dominant: '#ffffff', secondary: '#3b1f6b', accent: '#8a4fd8' }, fonts: { heading: 'Aptos', body: 'Aptos' } },
  slate: { name: 'Slate & Amber', palette: { dominant: '#f8fafc', secondary: '#334155', accent: '#f59e0b' }, fonts: { heading: 'Verdana', body: 'Verdana' } },
  midnight: { name: 'Midnight', palette: { dominant: '#0f172a', secondary: '#93c5fd', accent: '#fbbf24' }, fonts: { heading: 'Segoe UI', body: 'Segoe UI' } },
};
export const DEFAULT_PRESET = 'navy';

// Elements whose color can be set directly. Everything else is derived from them and the palette.
export const ELEMENTS = [
  { key: 'title', label: 'Title', min: 3 },
  { key: 'subtitle', label: 'Subtitle', min: 4.5 },
  { key: 'h1', label: 'Heading 1', min: 3 },
  { key: 'h2', label: 'Heading 2', min: 3 },
  { key: 'h3', label: 'Heading 3', min: 3 },
  { key: 'h4', label: 'Heading 4', min: 4.5 },
  { key: 'text', label: 'Body text', min: 4.5 },
  { key: 'link', label: 'Links', min: 4.5 },
  { key: 'tableHeader', label: 'Table header', min: 0 },
  { key: 'tableHeaderText', label: 'Table header text', min: 4.5, on: 'tableHeader' },
  { key: 'note', label: 'Note box', min: 0 },
  { key: 'code', label: 'Code background', min: 0 },
];

export const presetTheme = (id) => {
  const p = PRESETS[id] || PRESETS[DEFAULT_PRESET];
  return { preset: PRESETS[id] ? id : DEFAULT_PRESET, palette: { ...p.palette }, fonts: { ...p.fonts }, overrides: {} };
};

/** Checks a theme from storage or an imported file; throws if it is not a valid theme. */
export function normalizeTheme(raw) {
  if (!raw || typeof raw !== 'object' || !raw.palette) throw new Error('This is not a theme file.');
  const base = presetTheme(raw.preset);
  const palette = {};
  for (const k of ['dominant', 'secondary', 'accent']) {
    if (!isHex(raw.palette[k])) throw new Error(`The theme's ${k} color is not a #rrggbb color.`);
    palette[k] = raw.palette[k].toLowerCase();
  }
  const fonts = {};
  for (const k of ['heading', 'body']) fonts[k] = raw.fonts && FONTS[raw.fonts[k]] ? raw.fonts[k] : base.fonts[k];
  const overrides = {};
  for (const { key } of ELEMENTS) if (raw.overrides && isHex(raw.overrides[key])) overrides[key] = raw.overrides[key].toLowerCase();
  const preset = PRESETS[raw.preset] && JSON.stringify(PRESETS[raw.preset].palette) === JSON.stringify(palette) ? raw.preset : null;
  return { preset, palette, fonts, overrides };
}

/** Every element color, as #rrggbb, plus the font names and CSS stacks. */
export function resolveTheme(theme) {
  const { dominant: page, secondary, accent } = theme.palette;
  const o = theme.overrides || {};
  const ink = readableOn(page) === '#ffffff' ? '#eef2f7' : '#262626';
  const text = o.text || ink;
  const tableHeader = o.tableHeader || secondary;
  const note = o.note || accent;
  const codeFill = o.code || mix(text, page, 0.955);
  return {
    page,
    text,
    muted: legible(mix(text, page, 0.42), page, 4.5),
    title: o.title || legible(secondary, page, 3),
    kicker: legible(accent, page, 3),
    subtitle: o.subtitle || legible(mix(text, page, 0.42), page, 4.5),
    h1: o.h1 || legible(secondary, page, 3),
    h1Rule: accent,
    h2: o.h2 || legible(secondary, page, 3),
    h3: o.h3 || legible(accent, page, 3),
    h4: o.h4 || legible(mix(secondary, text, 0.55), page, 4.5),
    link: o.link || legible(accent, page, 4.5),
    tableHeader,
    tableHeaderText: o.tableHeaderText || readableOn(tableHeader),
    tableBand: mix(tableHeader, page, 0.95),
    tableBorder: mix(tableHeader, page, 0.75),
    keyFill: mix(tableHeader, page, 0.9),
    noteBar: note,
    noteFill: mix(note, page, 0.92),
    codeFill,
    codeBorder: mix(codeFill, text, 0.14),
    codeText: text,
    inlineCodeFill: mix(text, page, 0.92),
    diagramFill: mix(secondary, page, 0.9),
    diagramLine: mix(text, page, 0.35),
    fontHeading: theme.fonts.heading,
    fontBody: theme.fonts.body,
    fontHeadingStack: FONTS[theme.fonts.heading] || FONTS.Calibri,
    fontBodyStack: FONTS[theme.fonts.body] || FONTS.Calibri,
  };
}

/** CSS custom properties for the preview and the HTML export (see preview.css). */
export function themeStyle(t) {
  const vars = {
    page: t.page, text: t.text, muted: t.muted, title: t.title, kicker: t.kicker, subtitle: t.subtitle,
    h1: t.h1, 'h1-rule': t.h1Rule, h2: t.h2, h3: t.h3, h4: t.h4, link: t.link,
    th: t.tableHeader, 'th-text': t.tableHeaderText, band: t.tableBand, rule: t.tableBorder, key: t.keyFill,
    'note-bar': t.noteBar, 'note-fill': t.noteFill, 'code-fill': t.codeFill, 'code-border': t.codeBorder,
    'code-text': t.codeText, 'inline-code': t.inlineCodeFill, 'font-heading': t.fontHeadingStack, 'font-body': t.fontBodyStack,
  };
  return Object.entries(vars).map(([k, v]) => `--${k}: ${v}`).join('; ');
}

/** Mermaid theme variables for the diagrams. */
export const mermaidVariables = (t) => ({
  fontFamily: t.fontBodyStack,
  fontSize: '18px',
  background: t.page,
  primaryColor: t.diagramFill,
  primaryBorderColor: t.tableHeader,
  primaryTextColor: t.text,
  textColor: t.text,
  lineColor: t.diagramLine,
  secondaryColor: t.tableBand,
  tertiaryColor: t.page,
  edgeLabelBackground: t.page,
  clusterBkg: t.tableBand,
  clusterBorder: t.tableBorder,
  titleColor: t.text,
});
