// Page logic: pick a Markdown file, convert it in the browser, download the .docx.
import { markdownToDocx } from './md2docx.js';

const MAX_BYTES = 5 * 1024 * 1024;
const $ = (id) => document.getElementById(id);
const input = $('file'), drop = $('drop'), btn = $('convert'), statusEl = $('status');
let file = null, lastUrl = null;

// ---------- Diagrams ----------
// mermaid is large, so it is only loaded when a document has diagrams.
let mermaidReady = null;
function loadMermaid() {
  mermaidReady ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'vendor/mermaid.min.js';
    script.onload = () => {
      window.mermaid.initialize({
        startOnLoad: false,
        theme: 'base',
        securityLevel: 'strict',
        htmlLabels: false, // plain SVG text, so the diagram can be drawn onto a canvas
        themeVariables: {
          fontFamily: 'Calibri, "Segoe UI", sans-serif',
          fontSize: '18px',
          primaryColor: '#E9EFF7',
          primaryBorderColor: '#1F3864',
          primaryTextColor: '#1A1A1A',
          lineColor: '#5B6B80',
          secondaryColor: '#F3F6FA',
          tertiaryColor: '#FFFFFF',
          edgeLabelBackground: '#FFFFFF',
        },
        flowchart: { curve: 'basis', padding: 10, nodeSpacing: 30, rankSpacing: 42, wrappingWidth: 260, htmlLabels: false },
      });
      resolve(window.mermaid);
    };
    script.onerror = () => { mermaidReady = null; reject(new Error('could not load the diagram library')); };
    document.head.appendChild(script);
  });
  return mermaidReady;
}

let diagramCount = 0;
async function renderDiagram(code) {
  const mermaid = await loadMermaid();
  const id = `mmd${diagramCount++}`;
  let svg;
  try {
    ({ svg } = await mermaid.render(id, code));
  } finally {
    // mermaid leaves a temporary element behind when a diagram fails to parse
    document.querySelectorAll(`body > [id^="d${id}"]`).forEach((e) => e.remove());
  }
  const el = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
  const [, , w, h] = el.getAttribute('viewBox').split(/[\s,]+/).map(Number);
  el.setAttribute('width', w);
  el.setAttribute('height', h);
  el.removeAttribute('style');

  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(el));
  await img.decode();
  const PAD = 14, SCALE = 3; // white margin in CSS px; render at 3x for print
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil((w + 2 * PAD) * SCALE);
  canvas.height = Math.ceil((h + 2 * PAD) * SCALE);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, PAD * SCALE, PAD * SCALE, w * SCALE, h * SCALE);
  const png = await new Promise((resolve, reject) => {
    try { canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('could not create the image'))), 'image/png'); } catch (e) { reject(e); }
  });
  return { data: new Uint8Array(await png.arrayBuffer()), width: w + 2 * PAD, height: h + 2 * PAD };
}

// ---------- Page ----------
const kb = (n) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const baseName = (name) => name.replace(/\.(md|markdown|txt)$/i, '').replace(/[\x00-\x1f"\\/:*?<>|]/g, '_') || 'document';
const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function setStatus(kind, html) {
  statusEl.className = `status show ${kind}`;
  statusEl.innerHTML = html;
}

function pick(f) {
  if (!f) return;
  if (!/\.(md|markdown|txt)$/i.test(f.name)) return setStatus('err', 'Choose a Markdown file (.md).');
  if (f.size > MAX_BYTES) return setStatus('err', 'The file is larger than 5 MB.');
  file = f;
  $('pickedName').textContent = f.name;
  $('pickedSize').textContent = kb(f.size);
  $('picked').classList.add('show');
  btn.disabled = false;
  statusEl.className = 'status';
}

input.addEventListener('change', () => pick(input.files[0]));
['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, () => drop.classList.remove('over')));
drop.addEventListener('drop', (e) => { e.preventDefault(); pick(e.dataTransfer.files[0]); });
// Dropping a file anywhere else should not navigate away from the page.
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

$('sample').addEventListener('click', async () => {
  try {
    const res = await fetch('sample.md');
    if (!res.ok) throw new Error(res.statusText);
    pick(new File([await res.text()], 'sample.md', { type: 'text/markdown' }));
  } catch (e) {
    setStatus('err', `Could not load the sample file. ${escapeHtml(String(e.message || e))}`);
  }
});

btn.addEventListener('click', async () => {
  if (!file) return;
  btn.disabled = true;
  const started = performance.now();
  setStatus('busy', `<span class="spinner"></span>Converting ${escapeHtml(file.name)}…`);
  try {
    const name = `${baseName(file.name)}.docx`;
    const { doc, notes, hasToc } = await markdownToDocx(await file.text(), { docx: window.docx, title: baseName(file.name), renderDiagram });
    const blob = await window.docx.Packer.toBlob(doc);

    if (lastUrl) URL.revokeObjectURL(lastUrl);
    lastUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = lastUrl;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();

    const secs = Math.max(1, Math.round((performance.now() - started) / 1000));
    const tips = [...notes];
    if (hasToc) tips.unshift('When Word asks to update the fields in the document, choose Yes to add page numbers to the table of contents.');
    setStatus('ok', `Done in ${secs} s: <a href="${lastUrl}" download="${escapeHtml(name)}">${escapeHtml(name)}</a> (${kb(blob.size)})` +
      (tips.length ? `<ul>${tips.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}</ul>` : ''));
  } catch (e) {
    setStatus('err', `Conversion failed.<pre>${escapeHtml(String(e.stack || e.message || e))}</pre>`);
  } finally {
    btn.disabled = false;
  }
});

// On GitHub Pages (user.github.io/repo/), link back to the source repository.
const m = /^([^.]+)\.github\.io$/i.exec(location.hostname);
const repo = location.pathname.split('/').filter(Boolean)[0];
if (m && repo) {
  const link = $('source');
  link.href = `https://github.com/${m[1]}/${repo}`;
  link.hidden = false;
}
