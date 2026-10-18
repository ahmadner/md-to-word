// Markdown workspace: open a file, edit it with a live preview, export it as Word, Markdown, HTML or PDF.
import { markdownToDocx } from './md2docx.js';
import { renderPreview } from './preview.js';
import { diagramSvg, readySvg, diagramPng, setDiagramTheme } from './diagrams.js';
import { DEFAULT_PRESET, presetTheme, normalizeTheme, resolveTheme, themeStyle, mermaidVariables } from './theme.js';
import { initThemePanel } from './theme-panel.js';

const MAX_BYTES = 5 * 1024 * 1024;
const DRAFT_KEY = 'md-to-word.draft';
const PREFS_KEY = 'md-to-word.prefs';
const THEME_KEY = 'md-to-word.theme';
const NARROW = matchMedia('(max-width: 859px)');

const $ = (id) => document.getElementById(id);
const editor = $('editor'), preview = $('preview'), previewPane = $('previewPane'), panes = $('panes');
const state = { name: 'untitled', clean: '', headings: [], diagrams: 0, title: null };

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

function openDocument(name, text, { clean = text, fromHistory = false } = {}) {
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

async function openFile(f) {
  if (!f) return;
  const fail = (msg) => ($('workspace').hidden ? showStartError(msg) : toast('err', esc(msg)));
  if (!/\.(md|markdown|txt)$/i.test(f.name)) return fail('Choose a Markdown file (.md).');
  if (f.size > MAX_BYTES) return fail('The file is larger than 5 MB.');
  if (!confirmReplace()) return;
  openDocument(f.name, await f.text());
}

function showStartError(msg) {
  $('startStatus').textContent = msg;
  $('startStatus').hidden = false;
}

// ---------- Start screen ----------
const drop = $('drop');
$('file').addEventListener('change', (e) => { openFile(e.target.files[0]); e.target.value = ''; });
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
  if (draft) openDocument(draft.name, draft.text, { clean: draft.dirty ? null : draft.text });
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
  if (e.dataTransfer.files.length) openFile(e.dataTransfer.files[0]);
});

// ---------- Preview, outline, status ----------
let renderSeq = 0;
function updatePreview() {
  const seq = ++renderSeq;
  const { html, headings, diagrams, title } = renderPreview(editor.value);
  preview.innerHTML = html.trim() ? html : '<p class="empty">Nothing to preview yet. Start typing in the editor.</p>';
  Object.assign(state, { headings, diagrams: diagrams.length, title });
  renderOutline();
  updateStats();
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
  $('stats').textContent = [n(words, 'word'), n(lines, 'line'), n(state.headings.length, 'heading'), n(state.diagrams, 'diagram')].join(' · ');
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
};
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
      const { doc, notes, hasToc } = await markdownToDocx(editor.value, { docx, title: state.name, renderDiagram: diagramPng, theme: themeTokens });
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
    toast('ok', `Saved <strong>${esc(state.name)}.md</strong>`, 4000);
  },
  async html() {
    try {
      await updatePreview(); // diagrams finished drawing
      const css = await (await fetch('preview.css')).text();
      const page = `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
        `<title>${esc(state.title || state.name)}</title>\n<style>\nbody { margin: 0; background: ${themeTokens.page}; }\n${css}</style>\n</head>\n<body>\n` +
        `<article class="doc" style="${esc(themeStyle(themeTokens))}">\n${preview.innerHTML}\n</article>\n</body>\n</html>\n`;
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

initThemePanel({ getTheme: () => theme, setTheme: applyTheme, setAppearance, notify: (kind, html) => toast(kind, html), download });

// ---------- Workspace buttons and history ----------
$('openBtn').addEventListener('click', () => $('openFile').click());
$('openFile').addEventListener('change', (e) => { openFile(e.target.files[0]); e.target.value = ''; });
$('newBtn').addEventListener('click', () => { if (confirmReplace()) openDocument('untitled', ''); });
$('home').addEventListener('click', () => { saveDraftNow(); history.pushState(null, '', location.pathname); showStart(); });

addEventListener('popstate', () => {
  if (location.hash === '#edit') {
    const draft = store.get(DRAFT_KEY);
    if ($('workspace').hidden && draft) openDocument(draft.name, draft.text, { clean: draft.dirty ? null : draft.text, fromHistory: true });
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

// Reloading the editor page reopens the draft.
const draftOnLoad = store.get(DRAFT_KEY);
if (location.hash === '#edit' && draftOnLoad) {
  openDocument(draftOnLoad.name, draftOnLoad.text, { clean: draftOnLoad.dirty ? null : draftOnLoad.text, fromHistory: true });
} else {
  if (location.hash === '#edit') history.replaceState(null, '', location.pathname);
  showStart();
}
