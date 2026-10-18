// Image editor: rotate, flip, crop, adjust, filter and resize. It works on a reduced copy for speed and
// saves a recipe; images.js applies the recipe to the original at full resolution when exporting.
import { render, outputSize, NO_EDITS, getImage, updateEdits, formatBytes } from './images.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const ADJUST = ['brightness', 'contrast', 'saturation', 'warmth', 'sharpen'];

/**
 * getReference(path) -> { alt, title } of the first Markdown reference to the image.
 * onSave(path, { alt, title }) is called after the edits are stored.
 */
export function initImageEditor({ getReference, onSave, notify }) {
  const dlg = $('imageEditor');
  const canvas = $('ieCanvas');
  const box = $('ieCropBox');
  let record = null, working = null, edits = null, cropping = false, drawing = 0, queued = false;

  const busy = (on, text = 'Working…') => { $('ieBusy').hidden = !on; $('ieBusy').textContent = text; };
  const rotated = () => (edits.rotate % 180 ? { w: record.height, h: record.width } : { w: record.width, h: record.height });
  const aspect = () => {
    const v = $('ieAspect').value;
    if (v === 'free') return null;
    if (v === 'orig') { const r = rotated(); return r.w / r.h; }
    return Number(v);
  };

  async function open(path) {
    record = getImage(path);
    if (!record) { notify('err', 'That image is not in this document.'); return; }
    edits = JSON.parse(JSON.stringify({ ...NO_EDITS, ...record.edits }));
    cropping = false;
    const ref = getReference(path) || { alt: '', title: '' };
    $('ieAlt').value = ref.alt;
    $('ieCaption').value = ref.title;
    $('ieTitle').textContent = record.path;
    $('ieAspect').value = 'free';
    dlg.showModal();
    busy(true, 'Loading…');
    try {
      // A reduced, upright copy of the original to preview edits quickly.
      const base = await render(record, { edits: NO_EDITS, maxSide: 1400 });
      const blob = await new Promise((r) => base.toBlob(r, 'image/png'));
      working = { ...record, blob, type: 'image/png', width: base.width, height: base.height };
      syncControls();
      await draw();
    } catch (e) {
      notify('err', `Could not open the image: ${e.message || e}`);
      dlg.close();
    } finally { busy(false); }
  }

  // Redraws at most once per frame while sliders move.
  function redraw() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; draw(); });
  }

  async function draw() {
    if (!working) return;
    const seq = ++drawing;
    const k = working.width / record.width;
    const e = { ...edits, resize: edits.resize && !cropping ? { width: edits.resize.width * k, height: edits.resize.height * k } : null };
    const out = await render(working, { edits: e, crop: !cropping });
    if (seq !== drawing) return;
    canvas.width = out.width;
    canvas.height = out.height;
    canvas.getContext('2d').drawImage(out, 0, 0);
    const stage = $('ieStage');
    const fit = Math.min(1, (stage.clientWidth - 32) / out.width, (stage.clientHeight - 32) / out.height);
    canvas.style.width = `${out.width * fit}px`;
    canvas.style.height = `${out.height * fit}px`;
    placeCropBox();
    updateInfo();
  }

  function updateInfo() {
    const out = outputSize(record, edits);
    const conv = record.converted ? ` (converted from ${record.converted})` : '';
    $('ieInfo').textContent = `${record.format}${conv} · original ${record.width} × ${record.height} px, ${formatBytes(record.size)} · output ${out.width} × ${out.height} px`;
    $('ieW').value = out.width;
    $('ieH').value = out.height;
    $('ieFull').disabled = !edits.resize;
  }

  function syncControls() {
    for (const k of ADJUST) {
      const input = dlg.querySelector(`[data-adjust="${k}"]`);
      input.value = edits[k];
      input.nextElementSibling.textContent = edits[k];
    }
    for (const b of dlg.querySelectorAll('[data-filter]')) b.setAttribute('aria-pressed', String(b.dataset.filter === edits.filter));
    $('ieDocWidth').value = String(edits.docWidth);
    $('ieCropBtn').setAttribute('aria-pressed', String(cropping));
    $('ieCropHelp').hidden = !cropping;
    $('ieUncrop').disabled = !edits.crop;
  }

  // ---------- Crop box ----------
  function placeCropBox() {
    $('ieCrop').hidden = !cropping;
    if (!cropping) return;
    const c = edits.crop || { x: 0, y: 0, w: 1, h: 1 };
    const stage = $('ieStage').getBoundingClientRect();
    const r = canvas.getBoundingClientRect();
    Object.assign(box.style, {
      left: `${r.left - stage.left + c.x * r.width}px`,
      top: `${r.top - stage.top + c.y * r.height}px`,
      width: `${c.w * r.width}px`,
      height: `${c.h * r.height}px`,
    });
  }

  // Largest centered crop with the chosen aspect ratio.
  function fitAspect() {
    const a = aspect();
    if (!a) return;
    const r = rotated();
    let w = 1, h = (r.w / a) / r.h;
    if (h > 1) { h = 1; w = (r.h * a) / r.w; }
    edits.crop = { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
  }

  let drag = null;
  box.addEventListener('pointerdown', (ev) => {
    drag = { handle: ev.target.dataset.h || 'move', x: ev.clientX, y: ev.clientY, start: { ...(edits.crop || { x: 0, y: 0, w: 1, h: 1 }) } };
    box.setPointerCapture(ev.pointerId);
    ev.preventDefault();
  });
  box.addEventListener('pointermove', (ev) => {
    if (!drag) return;
    const r = canvas.getBoundingClientRect();
    const dx = (ev.clientX - drag.x) / r.width, dy = (ev.clientY - drag.y) / r.height;
    const s = drag.start;
    const MIN = 0.03;
    if (drag.handle === 'move') {
      edits.crop = { ...s, x: clamp(s.x + dx, 0, 1 - s.w), y: clamp(s.y + dy, 0, 1 - s.h) };
    } else {
      let x1 = s.x, y1 = s.y, x2 = s.x + s.w, y2 = s.y + s.h;
      if (drag.handle.includes('w')) x1 = clamp(x1 + dx, 0, x2 - MIN); else x2 = clamp(x2 + dx, x1 + MIN, 1);
      if (drag.handle.includes('n')) y1 = clamp(y1 + dy, 0, y2 - MIN); else y2 = clamp(y2 + dy, y1 + MIN, 1);
      const a = aspect();
      if (a) {
        // Height follows width; if that runs off the image, width follows height instead.
        const rot = rotated();
        let h = ((x2 - x1) * rot.w) / a / rot.h;
        const room = drag.handle.includes('n') ? y2 : 1 - y1;
        if (h > room) { h = room; const w = (h * rot.h * a) / rot.w; if (drag.handle.includes('w')) x1 = x2 - w; else x2 = x1 + w; }
        if (drag.handle.includes('n')) y1 = y2 - h; else y2 = y1 + h;
      }
      edits.crop = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    }
    placeCropBox();
    updateInfo();
  });
  const endDrag = () => { drag = null; };
  box.addEventListener('pointerup', endDrag);
  box.addEventListener('pointercancel', endDrag);

  // ---------- Controls ----------
  // Crops are kept in the rotated image's frame, so they turn and flip with it.
  const turnCrop = (fn) => { if (edits.crop) edits.crop = fn(edits.crop); edits.resize = null; };
  // The flip is applied after the rotation, so a mirrored image turns the other way.
  const turn = (deg) => { edits.rotate = (edits.rotate + (edits.flipH !== edits.flipV ? -deg : deg) + 360) % 360; };
  const actions = {
    rotl() { turn(-90); turnCrop((c) => ({ x: c.y, y: 1 - c.x - c.w, w: c.h, h: c.w })); },
    rotr() { turn(90); turnCrop((c) => ({ x: 1 - c.y - c.h, y: c.x, w: c.h, h: c.w })); },
    fliph() { edits.flipH = !edits.flipH; turnCrop((c) => ({ ...c, x: 1 - c.x - c.w })); },
    flipv() { edits.flipV = !edits.flipV; turnCrop((c) => ({ ...c, y: 1 - c.y - c.h })); },
    crop() {
      cropping = !cropping;
      if (cropping && !edits.crop) { edits.crop = { x: 0, y: 0, w: 1, h: 1 }; fitAspect(); }
      if (!cropping) {
        const c = edits.crop;
        if (c && c.x < 0.001 && c.y < 0.001 && c.w > 0.999 && c.h > 0.999) edits.crop = null;
        edits.resize = null;
      }
    },
    uncrop() { edits.crop = null; edits.resize = null; cropping = false; },
    fullsize() { edits.resize = null; },
    reset() { edits = { ...NO_EDITS, docWidth: edits.docWidth }; cropping = false; },
  };

  dlg.addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-ie], [data-filter]');
    if (!b || b.disabled) return;
    if (b.dataset.filter) { edits.filter = b.dataset.filter; syncControls(); redraw(); return; }
    const act = b.dataset.ie;
    if (act === 'cancel') { dlg.close(); return; }
    if (act === 'save') { await save(); return; }
    actions[act]();
    syncControls();
    await draw();
  });

  dlg.addEventListener('input', (ev) => {
    const el = ev.target;
    if (el.dataset.adjust) {
      edits[el.dataset.adjust] = Number(el.value);
      el.nextElementSibling.textContent = el.value;
      redraw();
    }
  });

  $('ieAspect').addEventListener('change', () => {
    if (!cropping) { cropping = true; if (!edits.crop) edits.crop = { x: 0, y: 0, w: 1, h: 1 }; }
    fitAspect();
    syncControls();
    draw();
  });

  // Width and height in pixels; "Keep proportions" ties them to the cropped image's shape.
  const sizeInput = (which) => () => {
    const base = outputSize(record, { ...edits, resize: null });
    let w = Math.round(Number($('ieW').value)), h = Math.round(Number($('ieH').value));
    if ($('ieLock').checked) {
      if (which === 'w') h = Math.round((w * base.height) / base.width);
      else w = Math.round((h * base.width) / base.height);
    }
    if (!(w >= 1 && h >= 1)) return;
    w = Math.min(w, 20000); h = Math.min(h, 20000);
    edits.resize = w === base.width && h === base.height ? null : { width: w, height: h };
    $('ieW').value = w; $('ieH').value = h;
    $('ieFull').disabled = !edits.resize;
    redraw();
  };
  $('ieW').addEventListener('change', sizeInput('w'));
  $('ieH').addEventListener('change', sizeInput('h'));
  $('ieDocWidth').addEventListener('change', (ev) => { edits.docWidth = ev.target.value === 'auto' ? 'auto' : Number(ev.target.value); });

  async function save() {
    busy(true, 'Saving…');
    try {
      await updateEdits(record.path, edits);
      await onSave(record.path, { alt: $('ieAlt').value.trim(), title: $('ieCaption').value.trim() });
      dlg.close();
    } catch (e) {
      notify('err', `Could not save the image: ${e.message || e}`);
    } finally { busy(false); }
  }

  dlg.addEventListener('close', () => { working = null; record = null; });
  addEventListener('resize', () => { if (dlg.open) draw(); });

  return { open };
}
