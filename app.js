// Markdown workspace: open a file, edit it with a live preview, export it as Word, Markdown, HTML or PDF.
import { markdownToDocx } from './md2docx.js';
import { renderPreview } from './preview.js';
import { diagramSvg, readySvg, diagramPng, setDiagramTheme } from './diagrams.js';
import { DEFAULT_PRESET, presetTheme, normalizeTheme, resolveTheme, themeStyle, mermaidVariables } from './theme.js';
import { initThemePanel } from './theme-panel.js';
import {
  loadImages, clearImages, addImageFiles, getImage, previewImage, normalizePath,
  wordImage, externalWordImage, finalBlob, changesPixels, ACCEPT as IMAGE_ACCEPT,
} from './images.js';
import { createZip, readZip } from './zip.js';
import { initImageEditor } from './image-editor.js';
import { initImagesPanel } from './images-panel.js';

const MAX_BYTES = 5 * 1024 * 1024;
const DRAFT_KEY = 'md-to-word.draft';
const PREFS_KEY = 'md-to-word.prefs';
const THEME_KEY = 'md-to-word.theme';
const NARROW = matchMedia('(max-width: 859px)');

const $ = (id) => document.getElementById(id);
const editor = $('editor'), preview = $('preview'), previewPane = $('previewPane'), panes = $('panes');
const state = { name: 'untitled', clean: '', headings: [], diagrams: 0, images: [], title: null };
const isExternal = (src) => /^(https?:|data:)/i.test(src);
// ![alt](src "title"), with the src optionally in <> (as in md2docx.js parseInline).
const IMAGE_RE = /!\[([^\]]*)\]\(\s*(?:<([^>]*)>|([^)\s]*))(?:\s+["']([^"']*)["'])?\s*\)/g;

// ---------- Helpers ----------
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const kb = (n) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const baseName = (name) => String(name).replace(/\.(md|markdown|txt)$/i, '').replace(/[\x00-\x1f"\\/:*?<>|]/g, '_').trim() || 'untitled';
const firstLine = (e) => String(e && e.message ? e.message : e).split('\n')[0];
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

// Browser storage can be unavailable (private windows, blocked site data); the page works without it.
const store = {
  get(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } },
};
const prefs = { view: 'split', outline: false, appearance: 'system', ...store.get(PREFS_KEY) };

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// The Word library is large, so it is only loaded for the first Word export.
let docxReady = null;
const loadDocx = () => (docxReady ??= new Promise((resolve, reject) => {
  const script = document.createElement('script');
  script.src = 'vendor/docx.iife.js';
  script.onload = () => resolve(window.docx);
  script.onerror = () => { docxReady = null; reject(new Error('could not load the Word library')); };
  document.head.appendChild(script);
}));

let toastTimer;
function toast(kind, html, ms = 6000) {
  const t = $('toast');
  t.className = `toast ${kind}`;
  t.innerHTML = `${html}<button class="toast-close" type="button" aria-label="Close">×</button>`;
  t.hidden = false;
  clearTimeout(toastTimer);
  if (ms) toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}
$('toast').addEventListener('click', (e) => { if (e.target.closest('.toast-close')) $('toast').hidden = true; });

// ---------- Icons ----------
const ICONS = {
  history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
  sample: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6"/><path d="M9 17h4"/>',
  new: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M12 12v6"/><path d="M9 15h6"/>',
  open: '<path d="m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  outline: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/><path d="M13 8h4"/><path d="M13 12h4"/>',
  heading: '<path d="M6 12h12"/><path d="M6 20V4"/><path d="M18 20V4"/>',
  bold: '<path d="M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8"/>',
  italic: '<path d="M19 4h-9"/><path d="M14 20H5"/><path d="M15 4 9 20"/>',
  strike: '<path d="M16 4H9a3 3 0 0 0-2.83 4"/><path d="M14 12a4 4 0 0 1 0 8H6"/><path d="M4 12h16"/>',
  code: '<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  bullets: '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>',
  numbers: '<path d="M10 6h11"/><path d="M10 12h11"/><path d="M10 18h11"/><path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/>',
  quote: '<path d="M17 6.1H3"/><path d="M21 12.1H3"/><path d="M15.1 18H3"/><path d="M3 3v18" stroke-width="3"/>',
  codeblock: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="m10 9-3 3 3 3"/><path d="m14 15 3-3-3-3"/>',
  table: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/>',
  diagram: '<rect x="3" y="3" width="8" height="8" rx="2"/><path d="M7 11v4a2 2 0 0 0 2 2h4"/><rect x="13" y="13" width="8" height="8" rx="2"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21"/>',
  images: '<path d="M18 22H4a2 2 0 0 1-2-2V6"/><path d="m22 13-1.3-1.3a2.4 2.4 0 0 0-3.4 0L12 17"/><circle cx="12" cy="8" r="2"/><rect x="6" y="2" width="16" height="16" rx="2"/>',
  rotl: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  rotr: '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
  fliph: '<path d="M8 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h3"/><path d="M16 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3"/><path d="M12 20v2"/><path d="M12 14v2"/><path d="M12 8v2"/><path d="M12 2v2"/>',
  flipv: '<path d="M21 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v3"/><path d="M21 16v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3"/><path d="M4 12H2"/><path d="M10 12H8"/><path d="M16 12h-2"/><path d="M22 12h-2"/>',
  crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>',
  palette: '<path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.65-.75 1.65-1.69 0-.44-.18-.84-.44-1.13-.29-.29-.44-.65-.44-1.12a1.64 1.64 0 0 1 1.67-1.67h2C19.48 16.39 22 13.89 22 10.84 21.97 6.01 17.46 2 12 2z"/><circle cx="7.5" cy="11.5" r="1"/><circle cx="10.5" cy="7.5" r="1"/><circle cx="15.5" cy="7.5" r="1"/>',
};
for (const el of document.querySelectorAll('[data-icon]')) {
  el.insertAdjacentHTML('afterbegin', `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[el.dataset.icon]}</svg>`);
  if (!el.getAttribute('aria-label') && el.title) el.setAttribute('aria-label', el.title.replace(/ \(.*\)$/, ''));
}

// ---------- Screens ----------
function showStart() {
  $('workspace').hidden = true;
  $('start').hidden = false;
  document.title = 'Markdown to Word';
  refreshDraftButton();
}

function showWorkspace() {
  $('start').hidden = true;
  $('workspace').hidden = false;
  document.title = `${state.name} – Markdown to Word`;
}

function refreshDraftButton() {
  const draft = store.get(DRAFT_KEY);
  const btn = $('draft');
  btn.hidden = !(draft && typeof draft.text === 'string' && (draft.text.trim() || draft.name !== 'untitled'));
  if (btn.hidden) return;
  $('draftName').textContent = `${draft.name}.md`;
  const mins = Math.round((Date.now() - (draft.savedAt || 0)) / 60000);
  $('draftTime').textContent = mins < 1 ? 'just now' : mins < 60 ? `${mins} min ago` : mins < 1440 ? `${Math.round(mins / 60)} h ago` : `${Math.round(mins / 1440)} d ago`;
}

const isDirty = () => editor.value !== state.clean;

// Opening another document replaces the draft, so check first when it has changes that were not exported.
function confirmReplace() {
  const inWorkspace = !$('workspace').hidden;
  const draft = inWorkspace ? null : store.get(DRAFT_KEY);
  const dirty = inWorkspace ? isDirty() : Boolean(draft && draft.dirty);
  const name = inWorkspace ? state.name : draft && draft.name;
  return !dirty || confirm(`“${name}” has changes that you have not exported. Open another document and discard them?`);
}

// Images belong to the open document, so opening another one starts with an empty image store.
// images: files that came with the Markdown; pathFor(file) gives each one its path in the text.
async function openDocument(name, text, { clean = text, fromHistory = false, keepImages = false, images = [], pathFor } = {}) {
  if (!keepImages) await clearImages();
  if (images.length) {
    const refs = renderPreview(text).images.filter((src) => !isExternal(src)).map(normalizePath);
    const byName = new Map(refs.map((p) => [p.split('/').pop().toLowerCase(), p]));
    await addImages(images, pathFor || ((file) => byName.get(file.name.toLowerCase())));
  }
  state.name = baseName(name);
  state.clean = clean;
  $('fileName').value = state.name;
  editor.value = text;
  editor.setSelectionRange(0, 0);
  editor.scrollTop = 0;
  previewPane.scrollTop = 0;
  showWorkspace();
  if (!fromHistory && location.hash !== '#edit') history.pushState({ edit: true }, '', '#edit');
  setView(prefs.view);
  updatePreview();
  saveDraftNow();
  if (panes.dataset.view !== 'preview') editor.focus({ preventScroll: true });
}

const isMarkdown = (file) => /\.(md|markdown|txt)$/i.test(file.name);
const isZip = (file) => /\.zip$/i.test(file.name);
const failOpen = (msg) => ($('workspace').hidden ? showStartError(msg) : toast('err', esc(msg)));

/** Opens what the person picked or dropped: a .zip, a Markdown file with its images, or images alone. */
async function openFiles(list) {
  const files = [...list];
  if (!files.length) return;
  const zip = files.find(isZip);
  if (zip) return openZip(zip);
  const md = files.find(isMarkdown);
  if (md) {
    if (md.size > MAX_BYTES) return failOpen('The Markdown file is larger than 5 MB.');
    if (!confirmReplace()) return;
    await openDocument(md.name, await md.text(), { images: files.filter((x) => x !== md) });
    return;
  }
  // Images alone go into the open document, or a new one.
  if ($('workspace').hidden) {
    if (!confirmReplace()) return;
    await openDocument('untitled', '');
  }
  insertImages(await addImages(files));
}

/** A .zip with a Markdown file and its images, as written by "Markdown + images". */
async function openZip(file) {
  try {
    const entries = await readZip(file);
    const md = entries.filter((e) => /\.(md|markdown)$/i.test(e.name)).sort((a, b) => a.name.split('/').length - b.name.split('/').length)[0];
    if (!md) throw new Error('it has no Markdown file');
    if (!confirmReplace()) return;
    const dir = md.name.slice(0, md.name.lastIndexOf('/') + 1);
    const pics = entries.filter((e) => e !== md && e.name.startsWith(dir) && /\.(jpe?g|png|gif|bmp|webp|avif|svg|ico|tiff?|heic|heif|jxl)$/i.test(e.name));
    const files = pics.map((e) => new File([e.data], e.name.split('/').pop()));
    const paths = new Map(files.map((x, i) => [x, pics[i].name.slice(dir.length)]));
    await openDocument(md.name.split('/').pop(), new TextDecoder().decode(md.data), { images: files, pathFor: (x) => paths.get(x) });
  } catch (e) {
    failOpen(`Could not open ${file.name}: ${firstLine(e)}`);
  }
}

/** Stores image files; returns [{ path, name }] for the ones added and reports the ones that failed. */
async function addImages(files, pathFor = () => null) {
  const paths = new Map();
  for (const file of files) { const p = pathFor(file); if (p) paths.set(file, p); }
  const slow = files.length > 1 || files.some((x) => /\.(heic|heif|tiff?)$/i.test(x.name) || x.size > 8e6);
  if (slow) toast('', '<span class="spinner"></span>Adding images…', 0);
  const { added, failed } = await addImageFiles(files, { paths });
  if (failed.length) toast('err', `Could not add ${failed.map((x) => `<strong>${esc(x.name)}</strong> (${esc(x.reason)})`).join(', ')}`, 0);
  else if (slow) $('toast').hidden = true;
  if (imagesPanel) imagesPanel.render();
  if (!$('workspace').hidden) updatePreview();
  return added;
}

const altFrom = (name) => name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').replace(/[[\]]/g, '').trim();

/** Puts ![alt](path) references at the cursor, one paragraph each. */
function insertImages(items) {
  if (!items.length) return;
  const refs = items.map((it) => (typeof it === 'string' ? { path: it, name: it.split('/').pop() } : it))
    .map(({ path, name }) => `![${altFrom(name)}](${/\s/.test(path) ? `<${path}>` : path})`);
  insertBlock(refs.join('\n\n'));
}

/** The first reference to an image: { alt, title }. */
function imageReference(path) {
  for (const m of editor.value.matchAll(IMAGE_RE)) if (normalizePath(m[2] ?? m[3]) === path) return { alt: m[1], title: m[4] || '' };
  return null;
}

/** Rewrites every reference to an image; change(alt, title, target) returns the new parts. */
function rewriteImageRefs(text, path, change) {
  return text.replace(IMAGE_RE, (all, alt, angle, bare, title) => {
    if (normalizePath(angle ?? bare) !== path) return all;
    const next = change({ alt, title: title || '', target: angle != null ? `<${angle}>` : bare });
    return `![${next.alt.replace(/[[\]]/g, '')}](${next.target}${next.title ? ` "${next.title.replace(/"/g, "'")}"` : ''})`;
  });
}

function showStartError(msg) {
  $('startStatus').textContent = msg;
  $('startStatus').hidden = false;
}

// ---------- Start screen ----------
const drop = $('drop');
$('file').addEventListener('change', (e) => { openFiles(e.target.files); e.target.value = ''; });
['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, () => drop.classList.remove('over')));

$('sample').addEventListener('click', async () => {
  try {
    const res = await fetch('sample.md');
    if (!res.ok) throw new Error(res.statusText);
    if (confirmReplace()) openDocument('sample.md', await res.text());
  } catch (e) {
    showStartError(`Could not load the sample file: ${firstLine(e)}`);
  }
});
$('blank').addEventListener('click', () => { if (confirmReplace()) openDocument('untitled', ''); });
$('draft').addEventListener('click', () => {
  const draft = store.get(DRAFT_KEY);
  if (draft) openDocument(draft.name, draft.text, { clean: draft.dirty ? null : draft.text, keepImages: true });
});

// Dropping a file anywhere opens it; dropping elsewhere must not navigate away from the page.
let dragDepth = 0;
window.addEventListener('dragenter', (e) => { if (!$('workspace').hidden && e.dataTransfer.types.includes('Files')) { dragDepth++; $('workspace').classList.add('dragging'); } });
window.addEventListener('dragleave', () => { if (dragDepth && --dragDepth === 0) $('workspace').classList.remove('dragging'); });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  $('workspace').classList.remove('dragging');
  if (e.dataTransfer.files.length && !$('imageEditor').open) openFiles(e.dataTransfer.files);
});

// ---------- Preview, outline, status ----------
let renderSeq = 0;
function updatePreview() {
  const seq = ++renderSeq;
  const { html, headings, diagrams, images, title } = renderPreview(editor.value, { image: imageFor });
  preview.innerHTML = html.trim() ? html : '<p class="empty">Nothing to preview yet. Start typing in the editor.</p>';
  Object.assign(state, { headings, diagrams: diagrams.length, images, title });
  renderOutline();
  updateStats();
  if (imagesPanel && !$('imagesPanel').hidden) imagesPanel.render();
  // Diagrams that are already rendered are shown at once, so the preview does not jump while typing.
  return Promise.all([...preview.querySelectorAll('figure.diagram')].map(async (fig) => {
    const code = diagrams[Number(fig.dataset.diagram)];
    const svg = readySvg(code);
    if (svg) { fig.innerHTML = svg; return; }
    fig.innerHTML = '<div class="pending">Drawing diagram…</div>';
    try {
      const drawn = await diagramSvg(code);
      if (seq === renderSeq) fig.innerHTML = drawn;
    } catch (e) {
      if (seq === renderSeq) {
        fig.innerHTML = `<div class="failed"><p>This diagram has an error, so it is exported as code: ${esc(firstLine(e))}</p><pre class="code"><code>${esc(code)}</code></pre></div>`;
      }
    }
  }));
}
const schedulePreview = debounce(updatePreview, 250);

// Where the preview finds an image: stored images by path; web addresses and data URIs as they are.
function imageFor(src) {
  if (/^(https?:|data:image\/)/i.test(src)) return { url: src };
  const path = normalizePath(src);
  const info = previewImage(path);
  return info ? { ...info, path } : null;
}

function renderOutline() {
  $('outlineList').innerHTML = state.headings.length
    ? state.headings.map((h, i) => `<button type="button" class="o${h.level}" data-i="${i}" title="${esc(h.text)}">${esc(h.text)}</button>`).join('')
    : '<p class="none">Headings appear here.</p>';
}

function updateStats() {
  const text = editor.value;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const lines = text ? text.split('\n').length : 0;
  const n = (count, word) => `${count.toLocaleString()} ${word}${count === 1 ? '' : 's'}`;
  $('stats').textContent = [n(words, 'word'), n(lines, 'line'), n(state.headings.length, 'heading'), n(state.diagrams, 'diagram'), n(state.images.length, 'image')].join(' · ');
}

$('outlineList').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-i]');
  if (!btn) return;
  const h = state.headings[Number(btn.dataset.i)];
  if (panes.dataset.view !== 'edit') preview.querySelector(`#${CSS.escape(h.id)}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  if (panes.dataset.view !== 'preview') goToLine(h.line);
  if (NARROW.matches) toggleOutline(false);
});

function goToLine(line) {
  const lines = editor.value.split('\n');
  let pos = 0;
  for (let i = 0; i < line && i < lines.length; i++) pos += lines[i].length + 1;
  const lineHeight = parseFloat(getComputedStyle(editor).lineHeight) || 22;
  editor.scrollTop = Math.max(0, line * lineHeight - editor.clientHeight / 4);
  editor.focus({ preventScroll: true });
  editor.setSelectionRange(pos, pos + (lines[line] || '').length);
}

// Links inside the preview: section links scroll the preview instead of changing the page address.
preview.addEventListener('click', (e) => {
  const img = e.target.closest('img[data-path]');
  if (img) { imageEditor.open(img.dataset.path); return; }
  const a = e.target.closest('a[href^="#"]');
  if (!a) return;
  e.preventDefault();
  preview.querySelector(`#${CSS.escape(decodeURIComponent(a.getAttribute('href').slice(1)))}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
});

// ---------- Views ----------
function setView(view) {
  if (view === 'split' && NARROW.matches) view = 'edit';
  panes.dataset.view = view;
  for (const b of document.querySelectorAll('.seg [data-view]')) b.setAttribute('aria-pressed', String(b.dataset.view === view));
  for (const b of document.querySelectorAll('#toolbar [data-cmd]')) b.disabled = view === 'preview';
  if (!NARROW.matches) prefs.view = view;
  store.set(PREFS_KEY, prefs);
}
document.querySelector('.seg').addEventListener('click', (e) => {
  const b = e.target.closest('[data-view]');
  if (!b) return;
  setView(b.dataset.view);
  if (b.dataset.view !== 'preview') editor.focus({ preventScroll: true });
});
NARROW.addEventListener('change', () => setView(prefs.view));

function toggleOutline(open = $('outline').hidden) {
  $('outline').hidden = !open;
  $('outlineBtn').setAttribute('aria-pressed', String(open));
  if (!NARROW.matches) { prefs.outline = open; store.set(PREFS_KEY, prefs); }
}
$('outlineBtn').addEventListener('click', () => toggleOutline());
toggleOutline(prefs.outline && !NARROW.matches);

// ---------- Editing ----------
// Replaces text through the browser's editing commands so Ctrl+Z still undoes it.
function replaceRange(from, to, text, selStart = from + text.length, selEnd = selStart) {
  editor.focus({ preventScroll: true });
  editor.setSelectionRange(from, to);
  const done = text ? document.execCommand('insertText', false, text) : from === to || document.execCommand('delete');
  if (!done) {
    editor.setRangeText(text, from, to, 'end');
    editor.dispatchEvent(new Event('input'));
  }
  editor.setSelectionRange(selStart, selEnd);
}

function selectedLines() {
  const { selectionStart: s, selectionEnd: e, value } = editor;
  const from = value.lastIndexOf('\n', s - 1) + 1;
  let to = value.indexOf('\n', e > s && value[e - 1] === '\n' ? e - 1 : e);
  if (to < 0) to = value.length;
  return { from, to, lines: value.slice(from, to).split('\n') };
}

function wrap(before, after = before, placeholder = 'text') {
  const { selectionStart: s, selectionEnd: e, value } = editor;
  if (e > s && value.slice(s - before.length, s) === before && value.slice(e, e + after.length) === after) {
    const inner = value.slice(s, e); // already wrapped: unwrap
    replaceRange(s - before.length, e + after.length, inner, s - before.length, s - before.length + inner.length);
    return;
  }
  const inner = value.slice(s, e) || placeholder;
  replaceRange(s, e, before + inner + after, s + before.length, s + before.length + inner.length);
}

function prefixLines(prefix, pattern) {
  const { from, to, lines } = selectedLines();
  const all = lines.every((l) => !l.trim() || pattern.test(l));
  let n = 0; // numbering skips blank lines
  const out = lines.map((l) => (!l.trim() ? l : all ? l.replace(pattern, '') : prefix(n++) + l.replace(pattern, ''))).join('\n');
  replaceRange(from, to, out, from, from + out.length);
}

function insertBlock(block, selectFrom = 0, selectLength = 0) {
  const { selectionStart: s, selectionEnd: e, value } = editor;
  const before = value.slice(0, s);
  const after = value.slice(e);
  const pre = !before || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const post = after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : after ? '\n\n' : '\n';
  const start = s + pre.length + selectFrom;
  replaceRange(s, e, pre + block + post, start, start + selectLength);
}

const commands = {
  heading() {
    const { from, to, lines } = selectedLines();
    const m = /^(#{1,6})\s+/.exec(lines[0]);
    const level = m ? m[1].length : 0;
    const next = level === 0 ? 2 : level >= 4 ? 0 : level + 1; // none → ## → ### → #### → none
    const out = lines.map((l) => (next ? `${'#'.repeat(next)} ` : '') + l.replace(/^#{1,6}\s+/, '')).join('\n');
    replaceRange(from, to, out, from, from + out.length);
  },
  bold: () => wrap('**'),
  italic: () => wrap('*'),
  strike: () => wrap('~~'),
  code: () => wrap('`', '`', 'code'),
  link() {
    const { selectionStart: s, selectionEnd: e, value } = editor;
    const label = value.slice(s, e) || 'link text';
    const text = `[${label}](https://)`;
    const urlStart = s + label.length + 3;
    replaceRange(s, e, text, urlStart, urlStart + 8);
  },
  bullets: () => prefixLines(() => '- ', /^\s*[-*+]\s+/),
  numbers: () => prefixLines((i) => `${i + 1}. `, /^\s*\d+[.)]\s+/),
  quote: () => prefixLines(() => '> ', /^\s{0,3}>\s?/),
  codeblock() {
    const sel = editor.value.slice(editor.selectionStart, editor.selectionEnd) || 'code';
    insertBlock(`\`\`\`text\n${sel}\n\`\`\``, 8, sel.length);
  },
  table: () => insertBlock('| Column 1 | Column 2 |\n|----------|----------|\n| Cell     | Cell     |', 2, 8),
  diagram() {
    const body = 'flowchart LR\n    A["Start"] --> B["Finish"]';
    insertBlock(`\`\`\`mermaid\n${body}\n\`\`\``, 11, body.length);
  },
  image: () => imagePicker.click(),
};
const imagePicker = Object.assign(document.createElement('input'), { type: 'file', accept: IMAGE_ACCEPT, multiple: true, hidden: true });
document.body.appendChild(imagePicker);
imagePicker.addEventListener('change', async () => {
  const files = [...imagePicker.files];
  imagePicker.value = '';
  if (files.length) insertImages(await addImages(files));
});

// Pasted images (for example screenshots) are added and referenced at the cursor.
editor.addEventListener('paste', async (e) => {
  const files = [...(e.clipboardData?.files || [])].filter((x) => x.type.startsWith('image/'));
  if (!files.length) return;
  e.preventDefault();
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
  const named = files.map((x, i) => {
    const ext = ({ 'image/jpeg': 'jpg', 'image/svg+xml': 'svg' })[x.type] || x.type.split('/')[1] || 'png';
    const generic = !x.name || /^image\.\w+$/i.test(x.name);
    return generic ? new File([x], `pasted-${stamp}${files.length > 1 ? `-${i + 1}` : ''}.${ext}`, { type: x.type }) : x;
  });
  insertImages(await addImages(named));
});
$('toolbar').addEventListener('click', (e) => {
  const b = e.target.closest('[data-cmd]');
  if (b && !b.disabled) commands[b.dataset.cmd]();
});

// Tab indents list items and selected lines; Shift+Tab outdents.
function indent(outdent) {
  const { selectionStart: s, selectionEnd: e, value } = editor;
  const { from, to, lines } = selectedLines();
  const listLine = /^\s*([-*+]|\d+[.)])\s/.test(lines[0]);
  if (!outdent && s === e && !listLine) { replaceRange(s, e, '  '); return; }
  const out = lines.map((l) => (outdent ? l.replace(/^ {1,2}|^\t/, '') : `  ${l}`)).join('\n');
  if (out === value.slice(from, to)) return;
  replaceRange(from, to, out, from, from + out.length);
}

// Enter on a list item starts the next item; Enter on an empty item ends the list.
function continueList() {
  const { selectionStart: s, selectionEnd: e, value } = editor;
  if (s !== e) return false;
  const lineStart = value.lastIndexOf('\n', s - 1) + 1;
  const m = /^(\s*)(?:([-*+])|(\d+)([.)]))(\s+)(.*)$/.exec(value.slice(lineStart, s));
  if (!m) return false;
  let lineEnd = value.indexOf('\n', s);
  if (lineEnd < 0) lineEnd = value.length;
  if (!m[6].trim() && !value.slice(s, lineEnd).trim()) {
    replaceRange(lineStart, lineEnd, '', lineStart, lineStart);
    return true;
  }
  const marker = m[2] || `${Number(m[3]) + 1}${m[4]}`;
  replaceRange(s, s, `\n${m[1]}${marker}${m[5]}`);
  return true;
}

editor.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && !e.altKey && !e.shiftKey) {
    const cmd = { b: 'bold', i: 'italic', k: 'link' }[e.key.toLowerCase()];
    if (cmd) { e.preventDefault(); commands[cmd](); return; }
  }
  if (e.key === 'Tab' && !mod && !e.altKey) { e.preventDefault(); indent(e.shiftKey); return; }
  if (e.key === 'Escape') { editor.blur(); return; }
  if (e.key === 'Enter' && !e.shiftKey && !mod && !e.altKey && !e.isComposing && continueList()) e.preventDefault();
});

// ---------- Draft ----------
function saveDraftNow() {
  const ok = store.set(DRAFT_KEY, { name: state.name, text: editor.value, dirty: isDirty(), savedAt: Date.now() });
  $('saved').textContent = ok ? (isDirty() ? 'Draft saved · not exported' : 'Draft saved') : 'Too large to keep a draft';
}
const saveDraft = debounce(saveDraftNow, 600);

editor.addEventListener('input', () => {
  schedulePreview();
  updateStats();
  $('saved').textContent = 'Editing…';
  saveDraft();
});

$('fileName').addEventListener('input', (e) => {
  state.name = baseName(e.target.value);
  document.title = `${state.name} – Markdown to Word`;
  saveDraft();
});
$('fileName').addEventListener('blur', (e) => { e.target.value = state.name; });
$('fileName').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });

// ---------- Export ----------
const exporters = {
  async docx() {
    toast('', '<span class="spinner"></span>Creating the Word document…', 0);
    try {
      const docx = await loadDocx();
      const name = `${state.name}.docx`;
      const { doc, notes, hasToc } = await markdownToDocx(editor.value, { docx, title: state.name, renderDiagram: diagramPng, theme: themeTokens, loadImage: loadWordImage });
      const blob = await docx.Packer.toBlob(doc);
      download(blob, name);
      const tips = [...notes];
      if (hasToc) tips.unshift('When Word asks to update the fields in the document, choose Yes to add page numbers to the table of contents.');
      toast('ok', `Saved <strong>${esc(name)}</strong> (${kb(blob.size)})` + (tips.length ? `<ul>${tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''), tips.length ? 14000 : 5000);
    } catch (e) {
      toast('err', `Could not create the Word document.<pre>${esc(String(e.message || e))}</pre>`, 0);
    }
  },
  md() {
    download(new Blob([editor.value], { type: 'text/markdown;charset=utf-8' }), `${state.name}.md`);
    state.clean = editor.value;
    saveDraftNow();
    const stored = state.images.some((src) => !isExternal(src) && getImage(src));
    toast('ok', `Saved <strong>${esc(state.name)}.md</strong>` +
      (stored ? '<ul><li>The images are not inside a .md file. Use Export → Markdown + images to keep them together.</li></ul>' : ''), stored ? 9000 : 4000);
  },
  async zip() {
    toast('', '<span class="spinner"></span>Packing the Markdown and images…', 0);
    try {
      let text = editor.value;
      const files = [];
      for (const path of [...new Set(state.images.filter((src) => !isExternal(src)).map(normalizePath))]) {
        const record = getImage(path);
        if (!record) continue;
        const blob = await finalBlob(record);
        let name = path;
        // An edited image is saved as JPEG or PNG; give it a matching name if the original was another type.
        const ext = { 'image/jpeg': 'jpg', 'image/png': 'png' }[blob.type];
        if (changesPixels(record.edits) && ext && !new RegExp(ext === 'jpg' ? '\\.jpe?g$' : '\\.png$', 'i').test(path)) {
          name = `${path.replace(/\.[^./]+$/, '')}-edited.${ext}`;
          text = rewriteImageRefs(text, path, (r) => ({ ...r, target: name }));
        }
        files.push({ name, data: blob });
      }
      const zip = await createZip([{ name: `${state.name}.md`, data: text }, ...files]);
      download(zip, `${state.name}.zip`);
      state.clean = editor.value;
      saveDraftNow();
      toast('ok', `Saved <strong>${esc(state.name)}.zip</strong> with ${files.length} image${files.length === 1 ? '' : 's'} (${kb(zip.size)}). Open it here again to keep editing.`, 6000);
    } catch (e) {
      toast('err', `Could not create the .zip file.<pre>${esc(String(e.message || e))}</pre>`, 0);
    }
  },
  async html() {
    try {
      await updatePreview(); // diagrams finished drawing
      const css = await (await fetch('preview.css')).text();
      // The page carries its images inside it, at full resolution.
      const doc = preview.cloneNode(true);
      for (const img of doc.querySelectorAll('img[data-path]')) {
        const record = getImage(img.dataset.path);
        if (record) img.src = await blobToDataUrl(await finalBlob(record));
        img.removeAttribute('data-path');
      }
      const page = `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
        `<title>${esc(state.title || state.name)}</title>\n<style>\nbody { margin: 0; background: ${themeTokens.page}; }\n${css}</style>\n</head>\n<body>\n` +
        `<article class="doc" style="${esc(themeStyle(themeTokens))}">\n${doc.innerHTML}\n</article>\n</body>\n</html>\n`;
      download(new Blob([page], { type: 'text/html;charset=utf-8' }), `${state.name}.html`);
      toast('ok', `Saved <strong>${esc(state.name)}.html</strong>`, 4000);
    } catch (e) {
      toast('err', `Could not create the web page.<pre>${esc(String(e.message || e))}</pre>`, 0);
    }
  },
  async pdf() {
    await updatePreview();
    $('toast').hidden = true;
    const title = document.title;
    document.title = state.name; // suggested PDF file name
    addEventListener('afterprint', () => { document.title = title; }, { once: true });
    window.print();
  },
};

const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});

/** Images for Word at full resolution: stored images by path, web addresses and data URIs fetched. */
async function loadWordImage(src) {
  if (isExternal(src)) return externalWordImage(src);
  const record = getImage(src);
  if (!record) throw new Error('it has not been added to this document');
  return wordImage(record);
}

const menu = $('exportMenu'), menuBtn = $('exportBtn');
function toggleMenu(open = menu.hidden) {
  menu.hidden = !open;
  menuBtn.setAttribute('aria-expanded', String(open));
  if (open) menu.querySelector('button').focus();
}
menuBtn.addEventListener('click', () => toggleMenu());
menu.addEventListener('click', (e) => {
  const b = e.target.closest('[data-export]');
  if (!b) return;
  toggleMenu(false);
  exporters[b.dataset.export]();
});
menu.addEventListener('keydown', (e) => {
  const items = [...menu.querySelectorAll('button')];
  const i = items.indexOf(document.activeElement);
  if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
  if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
});
document.addEventListener('click', (e) => { if (!menu.hidden && !e.target.closest('.menu-wrap')) toggleMenu(false); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !menu.hidden) { toggleMenu(false); menuBtn.focus(); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && !$('workspace').hidden) { e.preventDefault(); exporters.md(); }
});

// ---------- Theme ----------
// One theme drives the preview, the HTML export, the diagrams and the Word export.
let theme = (() => { try { return normalizeTheme(store.get(THEME_KEY)); } catch { return presetTheme(DEFAULT_PRESET); } })();
let themeTokens = resolveTheme(theme);

function applyTheme(next, save = true) {
  theme = next;
  themeTokens = resolveTheme(theme);
  preview.setAttribute('style', themeStyle(themeTokens));
  setDiagramTheme(mermaidVariables(themeTokens));
  if (save) store.set(THEME_KEY, theme);
  if (!$('workspace').hidden && state.diagrams) schedulePreview(); // redraw diagrams in the new colors
}
applyTheme(theme, false);

function setAppearance(value) {
  if (value === 'light' || value === 'dark') document.documentElement.dataset.appearance = value;
  else delete document.documentElement.dataset.appearance;
  prefs.appearance = value;
  store.set(PREFS_KEY, prefs);
}

const themePanel = initThemePanel({ getTheme: () => theme, setTheme: applyTheme, setAppearance, notify: (kind, html) => toast(kind, html), download });

// ---------- Images ----------
const imageEditor = initImageEditor({
  getReference: imageReference,
  notify: (kind, html) => toast(kind, html),
  async onSave(path, { alt, title }) {
    const next = rewriteImageRefs(editor.value, path, (r) => ({ ...r, alt, title }));
    if (next !== editor.value) {
      const at = editor.selectionStart;
      replaceRange(0, editor.value.length, next, Math.min(at, next.length));
    }
    await updatePreview();
    imagesPanel.render();
  },
});

const imagesPanel = initImagesPanel({
  getReferences: () => state.images,
  addFiles: (files, pathFor) => addImages(files, pathFor),
  insert: insertImages,
  edit: (path) => imageEditor.open(path),
  changed: () => updatePreview(),
  download,
  notify: (kind, html) => toast(kind, html),
});

// ---------- Side panels: one at a time on the right ----------
const panels = {
  images: { el: $('imagesPanel'), btn: $('imagesBtn'), render: () => imagesPanel.render() },
  theme: { el: $('themePanel'), btn: $('themeBtn'), render: () => themePanel.render() },
};
function togglePanel(name, open = panels[name].el.hidden) {
  for (const [key, p] of Object.entries(panels)) {
    const show = key === name && open;
    p.el.hidden = !show;
    p.btn.setAttribute('aria-expanded', String(show));
  }
  document.body.classList.toggle('panel-open', open); // messages move clear of the panel
  if (open) {
    panels[name].render();
    panels[name].el.querySelector('.tp-body button, .tp-body input, .tp-body select')?.focus();
  }
}
for (const [name, p] of Object.entries(panels)) {
  p.btn.addEventListener('click', () => togglePanel(name));
  p.el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { togglePanel(name, false); p.btn.focus(); } });
}
document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => {
  togglePanel(b.dataset.close, false);
  panels[b.dataset.close].btn.focus();
}));

// ---------- Workspace buttons and history ----------
$('openBtn').addEventListener('click', () => $('openFile').click());
$('openFile').addEventListener('change', (e) => { openFiles(e.target.files); e.target.value = ''; });
$('newBtn').addEventListener('click', () => { if (confirmReplace()) openDocument('untitled', ''); });
$('home').addEventListener('click', () => { saveDraftNow(); history.pushState(null, '', location.pathname); showStart(); });

addEventListener('popstate', () => {
  if (location.hash === '#edit') {
    const draft = store.get(DRAFT_KEY);
    if ($('workspace').hidden && draft) openDocument(draft.name, draft.text, { clean: draft.dirty ? null : draft.text, fromHistory: true, keepImages: true });
  } else if (!$('workspace').hidden) {
    saveDraftNow();
    showStart();
  }
});

// ---------- Start ----------
// On GitHub Pages (user.github.io/repo/), link back to the source repository.
const pagesUser = /^([^.]+)\.github\.io$/i.exec(location.hostname);
const repo = location.pathname.split('/').filter(Boolean)[0];
if (pagesUser && repo) {
  $('source').href = `https://github.com/${pagesUser[1]}/${repo}`;
  $('source').hidden = false;
}

// Reloading the editor page reopens the draft, with its images.
loadImages().finally(() => {
  const draftOnLoad = store.get(DRAFT_KEY);
  if (location.hash === '#edit' && draftOnLoad) {
    openDocument(draftOnLoad.name, draftOnLoad.text, { clean: draftOnLoad.dirty ? null : draftOnLoad.text, fromHistory: true, keepImages: true });
  } else {
    if (location.hash === '#edit') history.replaceState(null, '', location.pathname);
    showStart();
  }
});
