// Markdown preview that mirrors the Word layout produced by md2docx.js: same parser, same cover page,
// table of contents and heading levels. All text is escaped; only safe link targets are kept.
import { parseBlocks, parseInline, plain } from './md2docx.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeHref = (href) => (/^(https?:|mailto:|#)/i.test(href) ? href : null);
const baseSlug = (t) => plain(t).trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
const isContents = (b) => b.type === 'heading' && /^(table of )?contents$/i.test(plain(b.text).trim());
const safeImageSrc = (src) => (/^(blob:|https?:|data:image\/)/i.test(src) ? src : null);

// Set by renderPreview: src -> { url, docWidth, path } or null when the image is missing.
let imageInfo = () => null;

function imageTag(s) {
  const info = imageInfo(s.src);
  const url = info && safeImageSrc(info.url);
  if (!url) return `<span class="img-missing" title="${esc(s.src)}">Image not found: ${esc(s.src)}</span>`;
  const width = info.docWidth && info.docWidth !== 'auto' ? ` style="width:${Number(info.docWidth)}%"`
    : info.width ? ` width="${Number(info.width)}"` : '';
  return `<img src="${esc(url)}" alt="${esc(s.alt)}"${s.title ? ` title="${esc(s.title)}"` : ''}${info.path ? ` data-path="${esc(info.path)}"` : ''}${width}>`;
}

function inline(text) {
  return parseInline(text).map((s) => {
    if (s.br) return '<br>';
    if (s.image) return imageTag(s);
    let h = esc(s.text);
    if (s.code) h = `<code>${h}</code>`;
    if (s.bold) h = `<strong>${h}</strong>`;
    if (s.italic) h = `<em>${h}</em>`;
    if (s.strike) h = `<del>${h}</del>`;
    if (s.link) {
      const href = safeHref(s.link);
      if (href) h = `<a href="${esc(href)}"${href.startsWith('#') ? '' : ' target="_blank" rel="noopener noreferrer"'}>${h}</a>`;
    }
    return h;
  }).join('');
}

function table(b, keyCol = b.header.length === 2) {
  const align = (c) => (b.aligns[c] && b.aligns[c] !== 'left' ? ` style="text-align:${b.aligns[c]}"` : '');
  const head = b.header.map((h, c) => `<th${align(c)}>${inline(h)}</th>`).join('');
  const rows = b.rows.map((r) => `<tr>${b.header.map((_, c) => `<td${align(c)}>${inline(r[c] || '')}</td>`).join('')}</tr>`).join('');
  return `<div class="table-wrap"><table${keyCol ? ' class="kv"' : ''}><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

// Items carry a nesting level (0-2) and their own list type, as in the Word numbering.
function list(items) {
  let html = '';
  const types = []; // ordered flag of each open list
  for (const it of items) {
    const level = Math.min(it.level, types.length);
    if (level === types.length) {
      html += it.ordered ? '<ol>' : '<ul>';
      types.push(it.ordered);
    } else {
      while (types.length > level + 1) html += '</li>' + (types.pop() ? '</ol>' : '</ul>');
      html += '</li>';
      if (types[level] !== it.ordered) {
        html += (types.pop() ? '</ol>' : '</ul>') + (it.ordered ? '<ol>' : '<ul>');
        types.push(it.ordered);
      }
    }
    html += `<li>${inline(it.text)}`;
  }
  while (types.length) html += '</li>' + (types.pop() ? '</ol>' : '</ul>');
  return html;
}

const codeBlock = (lines) => `<pre class="code"><code>${esc(lines.join('\n'))}</code></pre>`;

/**
 * Renders Markdown to preview HTML.
 * Returns { html, headings: [{ id, text, level, line }], diagrams: [mermaid source], images: [src], title }.
 * Each diagram is an empty <figure class="diagram" data-diagram="i"> for the caller to fill.
 * `image(src)` gives { url, docWidth, path } for an image, or null when it is missing.
 */
export function renderPreview(markdown, { image = () => null } = {}) {
  imageInfo = image;
  const md = markdown.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const blocks = parseBlocks(md.split('\n'));

  // Heading ids match the GitHub-style anchors that links (and the Word bookmarks) use.
  const counts = new Map();
  for (const b of blocks) {
    if (b.type !== 'heading') continue;
    const base = baseSlug(b.text);
    const n = counts.get(base) || 0;
    counts.set(base, n + 1);
    b.id = n ? `${base}-${n}` : base;
  }

  // Same rules as the Word cover page: a single "# Title", and a two-column table right after it.
  const h1s = blocks.filter((b) => b.type === 'heading' && b.level === 1);
  const titleBlock = h1s.length === 1 ? h1s[0] : null;
  const afterTitle = titleBlock && blocks[blocks.indexOf(titleBlock) + 1];
  const metaBlock = afterTitle && afterTitle.type === 'table' && afterTitle.header.length === 2 ? afterTitle : null;
  const levels = blocks.filter((b) => b.type === 'heading' && b !== titleBlock).map((b) => b.level);
  const baseLevel = levels.length ? Math.min(...levels) : 1;
  const wordLevel = (b) => Math.min(4, Math.max(1, b.level - baseLevel + 1));

  const headings = blocks
    .filter((b) => b.type === 'heading' && b !== titleBlock && !isContents(b))
    .map((b) => ({ id: b.id, text: plain(b.text), level: wordLevel(b), line: b.line }));
  const diagrams = [];

  const block = (b, inQuote = false) => {
    switch (b.type) {
      case 'heading': {
        if (inQuote) return `<p><strong>${inline(b.text)}</strong></p>`;
        const lvl = wordLevel(b);
        return `<h${lvl + 1} id="${esc(b.id)}" class="wl${lvl}">${inline(b.text)}</h${lvl + 1}>`;
      }
      case 'para': {
        // A paragraph that is only an image becomes a figure, with its title as the caption (as in Word).
        const parts = parseInline(b.text).filter((s) => s.image || s.br || s.text.trim());
        if (parts.length === 1 && parts[0].image) {
          const f = parts[0];
          return `<figure class="figure">${imageTag(f)}${f.title ? `<figcaption>${esc(f.title)}</figcaption>` : ''}</figure>`;
        }
        return `<p>${inline(b.text)}</p>`;
      }
      case 'list': return list(b.items);
      case 'table': return table(b);
      case 'code': return codeBlock(b.lines);
      case 'mermaid': {
        if (inQuote) return codeBlock(b.lines); // as in Word: diagrams inside notes stay code
        const i = diagrams.push(b.lines.join('\n').trim()) - 1;
        return `<figure class="diagram" data-diagram="${i}"></figure>`;
      }
      case 'quote': return `<div class="callout">${b.blocks.map((x) => block(x, true)).join('')}</div>`;
      default: return ''; // horizontal rules are not carried into Word
    }
  };

  const out = [];
  let title = null;
  if (titleBlock) {
    const meta = metaBlock ? Object.fromEntries(metaBlock.rows.map((r) => [plain(r[0]).toLowerCase(), plain(r[1] || '')])) : {};
    const subtitle = ['document', 'description', 'subtitle', 'summary'].map((k) => meta[k]).find(Boolean);
    title = plain(titleBlock.text);
    const parts = title.split(/\s+[-–—]\s+/);
    out.push('<header class="cover">' +
      (parts.length > 1 ? `<div class="kicker">${esc(parts[0])}</div>` : '') +
      `<h1 id="${esc(titleBlock.id)}">${esc(parts.length > 1 ? parts.slice(1).join(' – ') : title)}</h1>` +
      (subtitle ? `<p class="subtitle">${esc(subtitle)}</p>` : '') +
      (metaBlock ? table(metaBlock, true) : '') +
      '</header>');
  }

  let skipLevel = 0; // inside a hand-written "Contents" list, replaced by a generated one as in Word
  for (const b of blocks) {
    if (b === titleBlock || b === metaBlock) continue;
    if (skipLevel) {
      if (b.type === 'heading' && b.level <= skipLevel) skipLevel = 0;
      else continue;
    }
    if (isContents(b)) {
      skipLevel = b.level;
      const items = headings.filter((h) => h.level <= 3)
        .map((h) => `<li class="t${h.level}"><a href="#${esc(h.id)}">${esc(h.text)}</a></li>`).join('');
      out.push(`<nav class="toc"><div class="toc-title">${esc(plain(b.text))}</div><ul>${items}</ul></nav>`);
      continue;
    }
    out.push(block(b));
  }

  // Every image the text refers to, in order, for the Images panel.
  const images = [];
  const collect = (text) => { for (const s of parseInline(text)) if (s.image && s.src && !images.includes(s.src)) images.push(s.src); };
  const walk = (list) => {
    for (const b of list) {
      if (b.type === 'para' || b.type === 'heading') collect(b.text);
      else if (b.type === 'list') b.items.forEach((it) => collect(it.text));
      else if (b.type === 'table') [b.header, ...b.rows].forEach((r) => r.forEach(collect));
      else if (b.type === 'quote') walk(b.blocks);
    }
  };
  walk(blocks);

  return { html: out.join('\n'), headings, diagrams, images, title };
}
