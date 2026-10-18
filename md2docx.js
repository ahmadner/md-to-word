// Markdown to Word (.docx) conversion, running entirely in the browser.
//
// markdownToDocx(markdown, { docx, title, renderDiagram }) returns { doc, notes, hasToc }:
//   docx           the docx library namespace (window.docx in the browser)
//   title          title to use when the Markdown has no single "# Title"
//   renderDiagram  async (mermaidCode) => { data: Uint8Array (PNG), width, height } in CSS pixels
//   theme          element colors and fonts from theme.js resolveTheme(); defaults to the Navy theme
//   loadImage      async (src) => { data, type, width, height, docWidth, fallback? } for each ![image](src)

// ---------- Default theme (Navy) ----------
const NAVY = '1F3864';
const ACCENT = '2E5C9A';
const TEXT = '262626';
const MUTED = '6B7280';
const LINK = '1F5FAD';
const RULE = 'C9D2DE';
const CODE_FILL = 'F4F6F8';
const CODE_BORDER = 'D0D7DE';
const INLINE_CODE_FILL = 'EEF1F5';
const BAND = 'F5F7FA';
const KEY_FILL = 'EAF0F7';
const FONT = 'Calibri';
const MONO = 'Consolas';

const PAGE_W = 11906; // A4
const PAGE_H = 16838;
const MARGIN_X = 1134; // 2 cm
const CONTENT_W = PAGE_W - 2 * MARGIN_X; // 9638
const CONTENT_PX = Math.floor((CONTENT_W / 1440) * 96); // 642
const MAX_IMAGE_H = 860; // tallest image or diagram that fits on a page, in px

// ---------- Markdown block parser ----------
function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') { cur += '|'; i++; continue; }
    if (s[i] === '|') { cells.push(cur.trim()); cur = ''; continue; }
    cur += s[i];
  }
  cells.push(cur.trim());
  return cells;
}

const isSep = (l) => l.includes('-') && /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l.trim());
const listRe = /^(\s*)([*+-]|\d+[.)])\s+(.*)$/;
const fenceRe = /^\s*(```+|~~~+)\s*([\w+-]*)/;
const headingRe = /^\s{0,3}(#{1,6})\s+(.*?)(\s+#+)?\s*$/;
const hrRe = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const quoteRe = /^\s{0,3}>/;
const isTableStart = (lines, i) => lines[i].includes('|') && i + 1 < lines.length && lines[i + 1].includes('|') && isSep(lines[i + 1]);
const isBlockStart = (lines, i) => fenceRe.test(lines[i]) || headingRe.test(lines[i]) || hrRe.test(lines[i]) ||
  quoteRe.test(lines[i]) || lines[i].trim().startsWith('|') || isTableStart(lines, i);

export function parseBlocks(lines) {
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    let m;
    if ((m = fenceRe.exec(line))) {
      const fence = m[1];
      const lang = m[2].toLowerCase();
      const body = [];
      i++;
      while (i < lines.length && lines[i].trim() !== fence) body.push(lines[i++]);
      i++;
      blocks.push({ type: lang === 'mermaid' ? 'mermaid' : 'code', lang, lines: body });
      continue;
    }
    if ((m = headingRe.exec(line))) {
      blocks.push({ type: 'heading', level: m[1].length, text: m[2].trim(), line: i });
      i++;
      continue;
    }
    if (hrRe.test(line)) { blocks.push({ type: 'hr' }); i++; continue; }
    if (isTableStart(lines, i)) {
      const header = splitRow(line);
      const aligns = splitRow(lines[i + 1]).map((c) =>
        c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : 'left');
      const rows = [];
      i += 2;
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) rows.push(splitRow(lines[i++]));
      blocks.push({ type: 'table', header, aligns, rows });
      continue;
    }
    if (quoteRe.test(line)) {
      const inner = [];
      while (i < lines.length && quoteRe.test(lines[i])) inner.push(lines[i++].replace(/^\s{0,3}>\s?/, ''));
      blocks.push({ type: 'quote', blocks: parseBlocks(inner) });
      continue;
    }
    if (listRe.test(line)) {
      const items = [];
      const indents = []; // indent of each open nesting level
      while (i < lines.length) {
        const l = lines[i];
        if ((m = listRe.exec(l))) {
          const ind = m[1].length;
          while (indents.length && indents[indents.length - 1] > ind) indents.pop();
          if (!indents.length || indents[indents.length - 1] < ind) indents.push(ind);
          items.push({ level: Math.min(2, indents.length - 1), ordered: /\d/.test(m[2]), text: m[3] });
          i++;
        } else if (l.trim() && !isBlockStart(lines, i)) {
          items[items.length - 1].text += ' ' + l.trim(); // wrapped continuation line
          i++;
        } else if (!l.trim()) {
          let j = i;
          while (j < lines.length && !lines[j].trim()) j++;
          if (j < lines.length && listRe.test(lines[j])) i = j; // loose list: blank lines between items
          else break;
        } else break;
      }
      blocks.push({ type: 'list', items });
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines, i) && !listRe.test(lines[i])) para.push(lines[i++].trim());
    if (!para.length) para.push(lines[i++].trim()); // stray line that looks like a block start but isn't one
    blocks.push({ type: 'para', text: para.join(' ') });
  }
  return blocks;
}

// ---------- Inline parser ----------
export function parseInline(s, st = {}) {
  const out = [];
  let buf = '';
  const flush = () => { if (buf) { out.push({ ...st, text: buf }); buf = ''; } };
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\' && /[\\`*_[\]()#|>-]/.test(s[i + 1] || '')) { buf += s[i + 1]; i += 2; continue; }
    if (c === '`') {
      const j = s.indexOf('`', i + 1);
      if (j > i) { flush(); out.push({ ...st, code: true, text: s.slice(i + 1, j) }); i = j + 1; continue; }
    }
    if (s.startsWith('**', i)) {
      const j = s.indexOf('**', i + 2);
      if (j > i + 1) { flush(); out.push(...parseInline(s.slice(i + 2, j), { ...st, bold: true })); i = j + 2; continue; }
    }
    if (c === '*' && s[i + 1] && s[i + 1] !== ' ') {
      const j = s.indexOf('*', i + 1);
      if (j > i + 1) { flush(); out.push(...parseInline(s.slice(i + 1, j), { ...st, italic: true })); i = j + 1; continue; }
    }
    if (s.startsWith('~~', i)) {
      const j = s.indexOf('~~', i + 2);
      if (j > i + 1) { flush(); out.push(...parseInline(s.slice(i + 2, j), { ...st, strike: true })); i = j + 2; continue; }
    }
    if (c === '<') {
      const br = /^<br\s*\/?>/i.exec(s.slice(i));
      if (br) { flush(); out.push({ ...st, br: true, text: '' }); i += br[0].length; continue; }
      const auto = /^<(https?:\/\/[^>\s]+)>/.exec(s.slice(i));
      if (auto) { flush(); out.push({ ...st, link: auto[1], text: auto[1] }); i += auto[0].length; continue; }
    }
    if (c === '!' && s[i + 1] === '[') {
      // ![alt](src "title"); the src may be wrapped in <> when it contains spaces.
      const m = /^!\[([^\]]*)\]\(\s*(?:<([^>]*)>|([^)\s]*))(?:\s+["']([^"']*)["'])?\s*\)/.exec(s.slice(i));
      if (m) { flush(); out.push({ ...st, image: true, alt: m[1], src: m[2] ?? m[3], title: m[4] || '', text: m[1] }); i += m[0].length; continue; }
    }
    if (c === '[') {
      const m = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(s.slice(i));
      if (m) { flush(); out.push(...parseInline(m[1], { ...st, link: m[2] })); i += m[0].length; continue; }
    }
    buf += c;
    i++;
  }
  flush();
  return out;
}

export const plain = (s) => parseInline(s).map((x) => x.text).join('');

export async function markdownToDocx(markdown, { docx, title: fallbackTitle, renderDiagram, theme = {}, loadImage }) {
  const {
    Document, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, ShadingType,
    BorderStyle, AlignmentType, HeadingLevel, TableOfContents, Header, Footer, PageNumber,
    ImageRun, ExternalHyperlink, InternalHyperlink, Bookmark, LevelFormat, TableLayoutType,
    VerticalAlign, TabStopType, Tab,
  } = docx;
  // Theme colors arrive as #rrggbb; Word wants RRGGBB.
  const hex = (v, fallback) => (typeof v === 'string' && /^#?[0-9a-f]{6}$/i.test(v) ? v.replace('#', '').toUpperCase() : fallback);
  const T = {
    page: hex(theme.page, 'FFFFFF'), text: hex(theme.text, TEXT), muted: hex(theme.muted, MUTED), link: hex(theme.link, LINK),
    title: hex(theme.title, NAVY), kicker: hex(theme.kicker, ACCENT), subtitle: hex(theme.subtitle, MUTED),
    h1: hex(theme.h1, NAVY), h1Rule: hex(theme.h1Rule, ACCENT), h2: hex(theme.h2, NAVY), h3: hex(theme.h3, ACCENT), h4: hex(theme.h4, '374151'),
    th: hex(theme.tableHeader, NAVY), thText: hex(theme.tableHeaderText, 'FFFFFF'), band: hex(theme.tableBand, BAND),
    rule: hex(theme.tableBorder, RULE), key: hex(theme.keyFill, KEY_FILL),
    noteBar: hex(theme.noteBar, ACCENT), noteFill: hex(theme.noteFill, 'F3F6FA'),
    codeFill: hex(theme.codeFill, CODE_FILL), codeBorder: hex(theme.codeBorder, CODE_BORDER),
    codeText: hex(theme.codeText, '1F2328'), inlineCode: hex(theme.inlineCodeFill, INLINE_CODE_FILL),
    fontHeading: theme.fontHeading || FONT, fontBody: theme.fontBody || FONT,
  };
  const md = markdown.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const blocks = parseBlocks(md.split('\n'));
  const notes = [];

  // Render every top-level mermaid block before laying out the document.
  const diagrams = new Map();
  for (const b of blocks) {
    if (b.type !== 'mermaid') continue;
    const code = b.lines.join('\n').trim();
    if (diagrams.has(code)) continue;
    try { diagrams.set(code, await renderDiagram(code)); } catch (e) { diagrams.set(code, { error: String(e.message || e).split('\n')[0] }); }
  }

  // Load every image the text refers to, at full resolution, before laying out the document.
  const images = new Map();
  const collect = (text) => { for (const sg of parseInline(text)) if (sg.image && sg.src && !images.has(sg.src)) images.set(sg.src, null); };
  const walk = (list) => {
    for (const b of list) {
      if (b.type === 'para' || b.type === 'heading') collect(b.text);
      else if (b.type === 'list') b.items.forEach((it) => collect(it.text));
      else if (b.type === 'table') [b.header, ...b.rows].forEach((r) => r.forEach(collect));
      else if (b.type === 'quote') walk(b.blocks);
    }
  };
  walk(blocks);
  for (const src of images.keys()) {
    try { images.set(src, loadImage ? await loadImage(src) : null); } catch (e) { images.set(src, { error: String(e.message || e).split('\n')[0] }); }
    const img = images.get(src);
    if (!img || img.error) notes.push(`Image ${src} could not be added${img && img.error ? ` (${img.error})` : ''}; its description is shown instead.`);
  }

  // ---------- Bookmarks for internal links (GitHub-style slugs) ----------
  const baseSlug = (t) => plain(t).trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
  const slugCount = new Map();
  const bookmarks = new Map(); // slug -> bookmark name
  const usedNames = new Set();
  for (const b of blocks) {
    if (b.type !== 'heading') continue;
    const base = baseSlug(b.text);
    const n = slugCount.get(base) || 0;
    slugCount.set(base, n + 1);
    b.slug = n ? `${base}-${n}` : base; // GitHub numbers repeated headings: x, x-1, x-2
    let name = ('bm_' + b.slug.replace(/[^A-Za-z0-9_]/g, '_')).slice(0, 40);
    for (let k = 2; usedNames.has(name); k++) name = name.slice(0, 36) + '_' + k;
    usedNames.add(name);
    bookmarks.set(b.slug, name);
  }
  const missingLinks = new Set();

  // ---------- Inline -> docx runs ----------
  // Images keep their full resolution; only the size they are shown at is fitted to the page.
  function imageRun(seg, maxWidth = CONTENT_PX) {
    const img = images.get(seg.src);
    if (!img || img.error) return new TextRun({ text: `[Image: ${seg.alt || seg.src}]`, italics: true, color: T.muted });
    let w = img.docWidth && img.docWidth !== 'auto' ? (CONTENT_PX * img.docWidth) / 100 : img.width;
    w = Math.min(w, maxWidth);
    let h = (w * img.height) / img.width;
    if (h > MAX_IMAGE_H) { w = (w * MAX_IMAGE_H) / h; h = MAX_IMAGE_H; }
    return new ImageRun({
      type: img.type,
      data: img.data,
      fallback: img.fallback,
      transformation: { width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(h)) },
      altText: { name: seg.src.split('/').pop(), description: seg.alt || '', title: seg.title || seg.alt || '' },
    });
  }

  function runs(text, base = {}) {
    const segs = parseInline(text);
    const out = [];
    let k = 0;
    while (k < segs.length) {
      const seg = segs[k];
      if (seg.br) { out.push(new TextRun({ break: 1 })); k++; continue; }
      if (seg.image) { out.push(imageRun(seg, base.maxImageWidth)); k++; continue; }
      const mk = (sg) => new TextRun({
        text: sg.text,
        bold: sg.bold || base.bold || undefined,
        italics: sg.italic || base.italic || undefined,
        strike: sg.strike || undefined,
        font: sg.code ? MONO : base.font,
        size: sg.code && !base.heading ? (base.size || 21) - 2 : base.size,
        color: sg.link ? T.link : base.color,
        underline: sg.link ? {} : undefined,
        shading: sg.code && !base.noCodeFill ? { type: ShadingType.CLEAR, fill: T.inlineCode, color: 'auto' } : undefined,
      });
      if (!seg.link) { out.push(mk(seg)); k++; continue; }
      const group = [];
      while (k < segs.length && segs[k].link === seg.link) group.push(mk(segs[k++]));
      if (seg.link.startsWith('#')) {
        const anchor = bookmarks.get(seg.link.slice(1));
        if (anchor) out.push(new InternalHyperlink({ anchor, children: group }));
        else { missingLinks.add(seg.link); out.push(...group); }
      } else {
        out.push(new ExternalHyperlink({ link: seg.link, children: group }));
      }
    }
    return out;
  }

  // ---------- Tables ----------
  const border = (color = T.rule, size = 4) => ({ style: BorderStyle.SINGLE, size, color });
  const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: 'auto' };
  const cellBorders = { top: border(), bottom: border(), left: border(), right: border() };

  // Approximate rendered width in DXA of 9 pt Calibri / 8 pt Consolas text.
  function charDxa(ch, code) {
    if (code) return 90;
    if (ch === ' ') return 45;
    if (/[A-Z]/.test(ch)) return 115;
    if (/[0-9]/.test(ch)) return 93;
    if (/[a-z]/.test(ch)) return /[ilfjtr]/.test(ch) ? 50 : 92;
    return 65;
  }
  const strDxa = (t, code) => [...t].reduce((n, ch) => n + charDxa(ch, code), 0);
  const textWidth = (md) => parseInline(md).reduce((n, s) => n + strDxa(s.text, s.code), 0);
  const longestWord = (md) => parseInline(md).reduce((n, s) =>
    Math.max(n, ...s.text.split(/\s+/).map((w) => strDxa(w, s.code))), 0);

  function columnWidths(rows, total) {
    const PAD = 280; // cell margins plus slack
    const ncol = rows[0].length;
    const desired = [];
    const minw = [];
    for (let c = 0; c < ncol; c++) {
      const col = rows.map((r) => r[c] || '');
      desired.push(Math.min(total * 0.6, Math.max(...col.map(textWidth)) * 1.05 + PAD));
      minw.push(Math.max(560, Math.min(total * 0.45, Math.max(...col.map(longestWord)) * 1.05 + PAD)));
    }
    let widths;
    const sumD = desired.reduce((a, b) => a + b, 0);
    const sumM = minw.reduce((a, b) => a + b, 0);
    if (sumD <= total) widths = desired.map((d) => (d / sumD) * total);
    else if (sumM >= total) widths = minw.map((m) => (m / sumM) * total);
    else {
      const extra = desired.map((d, c) => Math.max(0, d - minw[c]));
      const sumE = extra.reduce((a, b) => a + b, 0) || 1;
      widths = minw.map((m, c) => m + (extra[c] / sumE) * (total - sumM));
    }
    widths = widths.map(Math.floor);
    widths[ncol - 1] += total - widths.reduce((a, b) => a + b, 0);
    return widths;
  }

  function buildTable(b, total = CONTENT_W) {
    const all = [b.header, ...b.rows];
    const widths = columnWidths(all, total);
    const keyCol = b.header.length === 2;
    const align = (a) => (a === 'center' ? AlignmentType.CENTER : a === 'right' ? AlignmentType.RIGHT : AlignmentType.LEFT);
    const cell = (text, c, opts) => new TableCell({
      width: { size: widths[c], type: WidthType.DXA },
      borders: cellBorders,
      shading: opts.fill ? { type: ShadingType.CLEAR, fill: opts.fill, color: 'auto' } : undefined,
      margins: { top: 60, bottom: 60, left: 100, right: 100 },
      verticalAlign: VerticalAlign.CENTER,
      children: [new Paragraph({
        alignment: align(b.aligns[c]),
        spacing: { before: 0, after: 0, line: 252 },
        children: runs(text, { size: 18, bold: opts.bold, color: opts.color, noCodeFill: true, maxImageWidth: widths[c] / 15 - 14 }),
      })],
    });
    const headerRow = new TableRow({
      tableHeader: true,
      cantSplit: true,
      children: b.header.map((t, c) => cell(t, c, { fill: T.th, color: T.thText, bold: true, header: true })),
    });
    const bodyRows = b.rows.map((r, ri) => new TableRow({
      cantSplit: true,
      children: b.header.map((_, c) => cell(r[c] || '', c, {
        fill: keyCol && c === 0 ? T.key : ri % 2 === 1 ? T.band : undefined,
        bold: keyCol && c === 0 ? true : undefined,
      })),
    }));
    return new Table({
      width: { size: total, type: WidthType.DXA },
      columnWidths: widths,
      layout: TableLayoutType.FIXED,
      rows: [headerRow, ...bodyRows],
    });
  }

  // Single-cell box used for code blocks and callouts.
  function box(children, { fill, borders, total = CONTENT_W, margins, cantSplit = true }) {
    return new Table({
      width: { size: total, type: WidthType.DXA },
      columnWidths: [total],
      layout: TableLayoutType.FIXED,
      borders: { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER, insideHorizontal: NO_BORDER, insideVertical: NO_BORDER },
      rows: [new TableRow({
        cantSplit,
        children: [new TableCell({
          width: { size: total, type: WidthType.DXA },
          borders,
          shading: { type: ShadingType.CLEAR, fill, color: 'auto' },
          margins,
          children,
        })],
      })],
    });
  }

  const spacer = (after = 120) => new Paragraph({ spacing: { before: 0, after: 0, line: after }, children: [] });

  function codeBlock(lines, total = CONTENT_W) {
    if (!lines.length) lines = [''];
    const paras = lines.map((ln) => new Paragraph({
      spacing: { before: 0, after: 0, line: 240 },
      children: [new TextRun({ text: ln.length ? ln : ' ', font: MONO, size: 17, color: T.codeText })],
    }));
    return box(paras, {
      fill: T.codeFill,
      borders: { top: border(T.codeBorder), bottom: border(T.codeBorder), left: border(T.codeBorder), right: border(T.codeBorder) },
      margins: { top: 100, bottom: 100, left: 160, right: 160 },
      cantSplit: lines.length <= 45,
      total,
    });
  }

  // ---------- Lists ----------
  let listInstance = 0;
  function listParas(b, inBox = false) {
    const inst = ++listInstance;
    return b.items.map((it, idx) => new Paragraph({
      numbering: { reference: it.ordered ? 'numbers' : 'bullets', level: it.level, instance: it.ordered ? inst : undefined },
      spacing: { before: 0, after: idx === b.items.length - 1 && !inBox ? 140 : 60 },
      children: runs(it.text),
    }));
  }

  // ---------- Diagrams ----------
  let diagramIdx = 0;
  function diagram(b) {
    diagramIdx++;
    const d = diagrams.get(b.lines.join('\n').trim());
    if (!d || d.error) {
      // Diagram could not be rendered: show its source instead.
      notes.push(`Diagram ${diagramIdx} could not be drawn (${d ? d.error : 'not rendered'}); it is included as code.`);
      return [codeBlock(b.lines), spacer(200)];
    }
    const w = Math.min(CONTENT_PX, Math.round(d.width * 0.62));
    let h = Math.round((w * d.height) / d.width);
    const maxH = 860; // keep tall diagrams within one page
    const scale = Math.min(1, maxH / h);
    h = Math.round(h * scale);
    return [new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 120, after: 200 },
      keepLines: true,
      children: [new ImageRun({
        type: 'png',
        data: d.data,
        transformation: { width: Math.round(w * scale), height: h },
        altText: { title: `Diagram ${diagramIdx}`, description: `Diagram ${diagramIdx}`, name: `diagram-${diagramIdx}` },
      })],
    })];
  }

  // ---------- Callout (blockquote) ----------
  function callout(b, total = CONTENT_W) {
    const inner = total - 220 - 200;
    const children = [];
    for (const ib of b.blocks) {
      if (ib.type === 'para') children.push(new Paragraph({ spacing: { before: 0, after: 100 }, children: runs(ib.text, { maxImageWidth: inner / 15 }) }));
      else if (ib.type === 'heading') children.push(new Paragraph({ spacing: { before: 0, after: 100 }, children: runs(ib.text, { bold: true }) }));
      else if (ib.type === 'list') children.push(...listParas(ib, true));
      else if (ib.type === 'table') { children.push(spacer(80)); children.push(buildTable(ib, inner)); children.push(spacer(60)); }
      else if (ib.type === 'code' || ib.type === 'mermaid') { children.push(codeBlock(ib.lines, inner)); children.push(spacer(60)); }
      else if (ib.type === 'quote') children.push(callout(ib, inner));
    }
    if (!children.length) children.push(new Paragraph({ children: [] }));
    return box(children, {
      fill: T.noteFill,
      borders: { left: { style: BorderStyle.SINGLE, size: 24, color: T.noteBar }, top: NO_BORDER, bottom: NO_BORDER, right: NO_BORDER },
      margins: { top: 140, bottom: 120, left: 220, right: 200 },
      cantSplit: true,
      total,
    });
  }

  // ---------- Front matter (cover) ----------
  // A single H1 is the document title; a two-column table right after it is the metadata block.
  const h1s = blocks.filter((b) => b.type === 'heading' && b.level === 1);
  const titleBlock = h1s.length === 1 ? h1s[0] : null;
  const afterTitle = titleBlock && blocks[blocks.indexOf(titleBlock) + 1];
  const metaBlock = afterTitle && afterTitle.type === 'table' && afterTitle.header.length === 2 ? afterTitle : null;
  const meta = metaBlock ? Object.fromEntries(metaBlock.rows.map((r) => [plain(r[0]).toLowerCase(), plain(r[1] || '')])) : {};
  const metaVal = (...keys) => keys.map((k) => meta[k.toLowerCase()]).find(Boolean) || '';

  const titleText = titleBlock ? plain(titleBlock.text) : (fallbackTitle || 'Document');
  const titleParts = titleText.split(/\s+[-–—]\s+/);
  const kicker = titleParts.length > 1 ? titleParts[0] : '';
  const mainTitle = titleParts.length > 1 ? titleParts.slice(1).join(' – ') : titleText;
  const subtitle = metaVal('Document', 'Description', 'Subtitle', 'Summary');
  const version = metaVal('Version');
  const date = metaVal('Last Update Date', 'Last Updated', 'Document date', 'Date');
  const handedBy = metaVal('Handed over by');
  const handedTo = metaVal('Handed over to');
  const author = handedBy || metaVal('Author', 'Owner', 'Prepared by');

  const cover = [];
  if (titleBlock) {
    if (kicker) cover.push(new Paragraph({ spacing: { before: 2600, after: 120 }, children: [new TextRun({ text: kicker.toUpperCase(), bold: true, color: T.kicker, size: 26, characterSpacing: 40, font: T.fontHeading })] }));
    cover.push(new Paragraph({ spacing: { before: kicker ? 0 : 2600, after: 160 }, children: [new TextRun({ text: mainTitle, bold: true, color: T.title, size: 60, font: T.fontHeading })] }));
    cover.push(new Paragraph({
      spacing: { before: 0, after: 600 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: T.h1Rule, space: 12 } },
      children: subtitle ? [new TextRun({ text: subtitle, color: T.subtitle, size: 28 })] : [],
    }));
    if (metaBlock) cover.push(buildTable(metaBlock));
  }

  // ---------- Body ----------
  // Shallowest section heading becomes Heading 1 (each starts on a new page).
  const sectionLevels = blocks.filter((b) => b.type === 'heading' && b !== titleBlock).map((b) => b.level);
  const baseLevel = sectionLevels.length ? Math.min(...sectionLevels) : 1;
  const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4];
  const isContents = (b) => b.type === 'heading' && /^(table of )?contents$/i.test(plain(b.text).trim());

  const body = [];
  let pendingBreak = cover.length > 0; // first body element starts after the cover page
  let skipLevel = 0; // inside a Markdown "Contents" list, replaced by a Word TOC
  // Paragraphs carry their own page break; other elements get an empty breaking paragraph first.
  const takeBreak = (extra) => { const brk = pendingBreak || extra; pendingBreak = false; return brk || undefined; };
  function push(...els) {
    if (takeBreak(false)) body.push(new Paragraph({ pageBreakBefore: true, spacing: { before: 0, after: 0 }, children: [] }));
    body.push(...els);
  }

  for (let bi = 0; bi < blocks.length; bi++) {
    const b = blocks[bi];
    const next = blocks[bi + 1];
    if (b === titleBlock || b === metaBlock) continue;
    if (skipLevel) {
      if (b.type === 'heading' && b.level <= skipLevel) skipLevel = 0;
      else continue;
    }
    if (isContents(b)) {
      skipLevel = b.level;
      body.push(new Paragraph({
        pageBreakBefore: takeBreak(body.length > 0),
        spacing: { before: 0, after: 240 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: T.h1Rule, space: 4 } },
        children: [new TextRun({ text: plain(b.text), bold: true, color: T.h1, size: 32, font: T.fontHeading })],
      }));
      body.push(new TableOfContents('Contents', { hyperlink: true, headingStyleRange: '1-3' }));
      continue;
    }
    switch (b.type) {
      case 'hr':
        break;
      case 'heading': {
        const lvl = Math.min(4, Math.max(1, b.level - baseLevel + 1));
        const name = bookmarks.get(b.slug);
        const children = runs(b.text, { noCodeFill: true, heading: true });
        body.push(new Paragraph({
          heading: HEADINGS[lvl - 1],
          pageBreakBefore: lvl === 1 ? takeBreak(body.length > 0) : takeBreak(false),
          children: name ? [new Bookmark({ id: name, children })] : children,
        }));
        break;
      }
      case 'para': {
        // A paragraph that is only an image becomes a centered figure, with its title as the caption.
        const parts = parseInline(b.text).filter((sg) => sg.image || sg.br || sg.text.trim());
        if (parts.length === 1 && parts[0].image) {
          const fig = parts[0];
          body.push(new Paragraph({
            pageBreakBefore: takeBreak(false), alignment: AlignmentType.CENTER, keepLines: true, keepNext: fig.title ? true : undefined,
            spacing: { before: 120, after: fig.title ? 60 : 200 }, children: [imageRun(fig)],
          }));
          if (fig.title) body.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 220 }, children: [new TextRun({ text: fig.title, italics: true, color: T.muted, size: 19 })] }));
          break;
        }
        const leadsIn = /:$/.test(b.text) || (next && ['table', 'code', 'mermaid', 'list'].includes(next.type) && b.text.length < 200);
        body.push(new Paragraph({ pageBreakBefore: takeBreak(false), keepNext: leadsIn || undefined, children: runs(b.text) }));
        break;
      }
      case 'list':
        push(...listParas(b));
        break;
      case 'table':
        push(buildTable(b), spacer(200));
        break;
      case 'code':
        push(codeBlock(b.lines), spacer(200));
        break;
      case 'mermaid':
        push(...diagram(b));
        break;
      case 'quote':
        push(callout(b), spacer(200));
        break;
    }
  }
  if (!body.length && !cover.length) body.push(new Paragraph({ children: [] }));

  // ---------- Header / footer ----------
  const small = { size: 16, color: T.muted };
  const headerRight = [version && `Version ${version}`, date].filter(Boolean).join('  ·  ');
  const footerLeft = handedBy && handedTo ? `${handedBy} → ${handedTo}` : author;
  const header = new Header({
    children: [new Paragraph({
      tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_W }],
      border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: T.rule, space: 4 } },
      children: [
        new TextRun({ text: kicker ? `${kicker} – ${mainTitle}` : mainTitle, ...small }),
        new TextRun({ children: [new Tab(), headerRight], ...small }),
      ],
    })],
  });
  const footer = new Footer({
    children: [new Paragraph({
      tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_W }],
      border: { top: { style: BorderStyle.SINGLE, size: 4, color: T.rule, space: 4 } },
      children: [
        new TextRun({ text: footerLeft, ...small }),
        new TextRun({ children: [new Tab(), 'Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES], ...small }),
      ],
    })],
  });
  const emptyHF = { header: new Header({ children: [new Paragraph({ children: [] })] }), footer: new Footer({ children: [new Paragraph({ children: [] })] }) };

  // ---------- Document ----------
  const heading = (id, name, size, color, before, after, outlineLevel, extra = {}) => ({
    id, name, basedOn: 'Normal', next: 'Normal', quickFormat: true,
    run: { font: T.fontHeading, size, bold: true, color },
    paragraph: { spacing: { before, after }, keepNext: true, keepLines: true, outlineLevel, ...extra },
  });

  const doc = new Document({
    background: T.page !== 'FFFFFF' ? { color: T.page } : undefined,
    creator: author || undefined,
    title: titleText,
    subject: subtitle || undefined,
    description: version ? `Version ${version}` : undefined,
    styles: {
      default: {
        document: { run: { font: T.fontBody, size: 21, color: T.text }, paragraph: { spacing: { after: 140, line: 276 } } },
        hyperlink: { run: { color: T.link, underline: { type: 'single', color: T.link } } },
      },
      paragraphStyles: [
        heading('Heading1', 'Heading 1', 32, T.h1, 0, 240, 0, { border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: T.h1Rule, space: 4 } } }),
        heading('Heading2', 'Heading 2', 26, T.h2, 300, 120, 1),
        heading('Heading3', 'Heading 3', 22, T.h3, 240, 100, 2),
        heading('Heading4', 'Heading 4', 21, T.h4, 200, 80, 3),
        { id: 'TOC1', name: 'toc 1', basedOn: 'Normal', next: 'Normal', run: { bold: true, color: T.h1 }, paragraph: { spacing: { before: 110, after: 20, line: 240 }, tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_W, leader: 'dot' }] } },
        { id: 'TOC2', name: 'toc 2', basedOn: 'Normal', next: 'Normal', paragraph: { indent: { left: 280 }, spacing: { before: 0, after: 10, line: 240 }, tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_W, leader: 'dot' }] } },
        { id: 'TOC3', name: 'toc 3', basedOn: 'Normal', next: 'Normal', run: { size: 19, color: T.muted }, paragraph: { indent: { left: 560 }, spacing: { before: 0, after: 0, line: 240 }, tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_W, leader: 'dot' }] } },
      ],
    },
    numbering: {
      config: [
        {
          reference: 'bullets',
          levels: [
            { level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 400, hanging: 260 } } } },
            { level: 1, format: LevelFormat.BULLET, text: '◦', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 800, hanging: 260 } } } },
            { level: 2, format: LevelFormat.BULLET, text: '▪', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 1200, hanging: 260 } } } },
          ],
        },
        {
          reference: 'numbers',
          levels: [
            { level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 400, hanging: 300 } } } },
            { level: 1, format: LevelFormat.LOWER_LETTER, text: '%2.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 800, hanging: 300 } } } },
            { level: 2, format: LevelFormat.LOWER_ROMAN, text: '%3.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 1200, hanging: 300 } } } },
          ],
        },
      ],
    },
    sections: [{
      properties: {
        titlePage: cover.length > 0,
        page: {
          size: { width: PAGE_W, height: PAGE_H },
          margin: { top: 1418, bottom: 1247, left: MARGIN_X, right: MARGIN_X, header: 680, footer: 600 },
        },
      },
      headers: { default: header, first: emptyHF.header },
      footers: { default: footer, first: emptyHF.footer },
      children: [...cover, ...body],
    }],
  });

  if (missingLinks.size) notes.push(`Links to missing sections were left as plain text: ${[...missingLinks].join(', ')}`);
  return { doc, notes, hasToc: blocks.some(isContents) };
}
