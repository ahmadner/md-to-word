// Theme panel: presets, the 60-30-10 palette, fonts and per-element colors, with contrast warnings.
import { PRESETS, FONTS, ELEMENTS, DEFAULT_PRESET, presetTheme, normalizeTheme, resolveTheme, contrast } from './theme.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = (t) => JSON.parse(JSON.stringify(t));

/**
 * getTheme() returns the current theme; setTheme(theme) applies and saves it.
 * setAppearance('system' | 'light' | 'dark') switches the app's own colors.
 * notify(kind, html) shows a message; download(blob, name) saves a file.
 */
export function initThemePanel({ getTheme, setTheme, setAppearance, notify, download }) {
  const panel = $('themePanel');

  // Static controls: presets, font lists, element rows.
  $('presets').innerHTML = Object.entries(PRESETS).map(([id, p]) => `
    <button type="button" class="preset" data-preset="${id}" aria-pressed="false">
      <span class="swatch"><i style="background:${p.palette.dominant}"></i><i style="background:${p.palette.secondary}"></i><i style="background:${p.palette.accent}"></i></span>
      <span>${esc(p.name)}</span>
    </button>`).join('');
  for (const sel of panel.querySelectorAll('select[data-font]')) {
    sel.innerHTML = Object.keys(FONTS).map((f) => `<option value="${esc(f)}" style="font-family:${esc(FONTS[f])}">${esc(f)}</option>`).join('');
  }
  $('elementRows').innerHTML = ELEMENTS.map((e) => `
    <div class="el-row" data-key="${e.key}">
      <input type="color" aria-label="${esc(e.label)} color">
      <span class="el-label">${esc(e.label)}</span>
      <span class="el-warn" hidden></span>
      <button type="button" class="el-reset" title="Use the automatic color">Auto</button>
    </div>`).join('');

  const update = (mutate) => {
    const next = clone(getTheme());
    mutate(next);
    // Still a preset only while its palette is untouched.
    if (next.preset && JSON.stringify(PRESETS[next.preset].palette) !== JSON.stringify(next.palette)) next.preset = null;
    setTheme(next);
    render();
  };

  function render() {
    const theme = getTheme();
    const t = resolveTheme(theme);
    for (const b of panel.querySelectorAll('[data-preset]')) b.setAttribute('aria-pressed', String(b.dataset.preset === theme.preset));
    for (const input of panel.querySelectorAll('input[data-palette]')) input.value = theme.palette[input.dataset.palette];
    const [d, s, a] = $('ratio').children;
    d.style.background = theme.palette.dominant; d.style.color = t.text;
    s.style.background = theme.palette.secondary; s.style.color = t.tableHeaderText;
    a.style.background = theme.palette.accent;
    for (const sel of panel.querySelectorAll('select[data-font]')) sel.value = theme.fonts[sel.dataset.font];

    for (const e of ELEMENTS) {
      const row = panel.querySelector(`.el-row[data-key="${e.key}"]`);
      const value = e.key === 'note' ? t.noteBar : e.key === 'code' ? t.codeFill : t[e.key];
      const own = Boolean(theme.overrides[e.key]);
      row.querySelector('input').value = value;
      row.classList.toggle('own', own);
      row.querySelector('.el-reset').hidden = !own;
      const warn = row.querySelector('.el-warn');
      const ratio = e.min ? contrast(value, e.on ? t[e.on] : t.page) : Infinity;
      warn.hidden = ratio >= e.min;
      if (!warn.hidden) {
        warn.textContent = `Low contrast ${ratio.toFixed(1)}:1`;
        warn.title = `Hard to read. Aim for at least ${e.min}:1 against the ${e.on ? 'table header' : 'page'}.`;
      }
    }
    const appearance = document.documentElement.dataset.appearance || 'system';
    for (const b of panel.querySelectorAll('[data-appearance]')) b.setAttribute('aria-pressed', String(b.dataset.appearance === appearance));
  }

  // Presets
  $('presets').addEventListener('click', (e) => {
    const b = e.target.closest('[data-preset]');
    if (b) { setTheme(presetTheme(b.dataset.preset)); render(); }
  });

  // Palette, fonts, elements. Color inputs fire "input" while dragging, so the preview follows live.
  panel.addEventListener('input', (e) => {
    const el = e.target;
    if (el.dataset.palette) update((t) => { t.palette[el.dataset.palette] = el.value.toLowerCase(); });
    else if (el.dataset.font) update((t) => { t.fonts[el.dataset.font] = el.value; });
    else if (el.closest('.el-row') && el.type === 'color') update((t) => { t.overrides[el.closest('.el-row').dataset.key] = el.value.toLowerCase(); });
  });
  $('elementRows').addEventListener('click', (e) => {
    const b = e.target.closest('.el-reset');
    if (b) update((t) => { delete t.overrides[b.closest('.el-row').dataset.key]; });
  });

  // Reset, export, import
  $('themeReset').addEventListener('click', () => { setTheme(presetTheme(getTheme().preset || DEFAULT_PRESET)); render(); });
  $('themeExport').addEventListener('click', () => {
    const theme = getTheme();
    const data = { app: 'md-to-word', version: 1, ...theme };
    const name = `theme-${theme.preset || 'custom'}.json`;
    download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), name);
    notify('ok', `Saved <strong>${esc(name)}</strong>. Import it on another computer to use the same theme.`);
  });
  $('themeImport').addEventListener('click', () => $('themeFile').click());
  $('themeFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      setTheme(normalizeTheme(JSON.parse(await file.text())));
      render();
      notify('ok', `Theme imported from <strong>${esc(file.name)}</strong>.`);
    } catch (err) {
      notify('err', `Could not import <strong>${esc(file.name)}</strong>: ${esc(err.message)}`);
    }
  });

  // App appearance: the page around the document, not the document itself.
  panel.querySelector('.appearance').addEventListener('click', (e) => {
    const b = e.target.closest('[data-appearance]');
    if (b) { setAppearance(b.dataset.appearance); render(); }
  });

  return { render };
}
