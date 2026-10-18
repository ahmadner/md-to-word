// Images panel: the document's images, and references to images that have not been added yet.
import { listImages, getImage, removeImage, changesPixels, previewImage, formatBytes, normalizePath, ACCEPT } from './images.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isExternal = (src) => /^(https?:|data:)/i.test(src);

/**
 * getReferences() -> image paths the text refers to. addFiles(files, pathFor?) stores files (pathFor maps
 * a file to the path it should have). insert(paths) puts references at the cursor. edit(path) opens the
 * editor. changed() refreshes the preview after an image is removed.
 */
export function initImagesPanel({ getReferences, addFiles, insert, edit, changed, download, notify }) {
  const picker = Object.assign(document.createElement('input'), { type: 'file', accept: ACCEPT, multiple: true, hidden: true });
  document.body.appendChild(picker);
  let pickFor = null; // a missing path to fill, or null to add new images

  function render() {
    const refs = getReferences().filter((s) => !isExternal(s)).map(normalizePath);
    const images = listImages();
    const missing = refs.filter((p) => !getImage(p));
    $('imgMissing').innerHTML = missing.length ? `
      <div class="img-missing-list">
        <strong>Referenced but not added</strong>
        ${missing.map((p) => `<div class="img-missing-row"><code>${esc(p)}</code><button type="button" class="el-reset" data-fill="${esc(p)}">Add file</button></div>`).join('')}
      </div>` : '';
    $('imgList').innerHTML = images.length ? images.map((r) => {
      const url = previewImage(r.path)?.url || '';
      const used = refs.includes(r.path);
      const notes = [r.converted && `converted from ${r.converted}`, changesPixels(r.edits) && 'edited', !used && 'not used in the text'].filter(Boolean);
      return `
        <div class="img-card" data-path="${esc(r.path)}">
          <button type="button" class="img-thumb" data-act="edit" title="Edit ${esc(r.path)}"><img src="${esc(url)}" alt=""></button>
          <div class="img-meta">
            <strong title="${esc(r.path)}">${esc(r.path.replace(/^images\//, ''))}</strong>
            <small>${esc(r.format)} · ${r.width} × ${r.height} · ${formatBytes(r.size)}</small>
            ${notes.length ? `<small class="img-notes">${esc(notes.join(' · '))}</small>` : ''}
            <div class="img-actions">
              <button type="button" class="el-reset" data-act="insert">Insert</button>
              <button type="button" class="el-reset" data-act="edit">Edit</button>
              <button type="button" class="el-reset" data-act="download">Download</button>
              <button type="button" class="el-reset" data-act="delete">Delete</button>
            </div>
          </div>
        </div>`;
    }).join('') : '<p class="tp-note">No images yet. Add images here, with the image button in the toolbar, by pasting, or by dropping files on the page.</p>';
  }

  $('imgAdd').addEventListener('click', () => { pickFor = null; picker.click(); });
  picker.addEventListener('change', async () => {
    const files = [...picker.files];
    picker.value = '';
    if (!files.length) return;
    if (pickFor) {
      await addFiles(files.slice(0, 1), () => pickFor);
      pickFor = null;
    } else {
      const added = await addFiles(files);
      if (added.length) insert(added);
    }
    render();
  });

  const drop = $('imgDrop');
  ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); e.stopPropagation(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, () => drop.classList.remove('over')));
  drop.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const added = await addFiles([...e.dataTransfer.files]);
    if (added.length) insert(added);
    render();
  });

  $('imgMissing').addEventListener('click', (e) => {
    const b = e.target.closest('[data-fill]');
    if (b) { pickFor = b.dataset.fill; picker.click(); }
  });

  $('imgList').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const path = b.closest('.img-card').dataset.path;
    const record = getImage(path);
    if (!record) return;
    if (b.dataset.act === 'insert') insert([path]);
    if (b.dataset.act === 'edit') edit(path);
    if (b.dataset.act === 'download') download(record.blob, path.split('/').pop());
    if (b.dataset.act === 'delete') {
      const used = getReferences().map(normalizePath).includes(path);
      if (!confirm(used ? `Delete ${path}? The text still refers to it, so it will show as missing.` : `Delete ${path}?`)) return;
      await removeImage(path);
      changed();
      render();
      notify('ok', `Deleted <strong>${esc(path)}</strong>.`);
    }
  });

  return { render };
}
