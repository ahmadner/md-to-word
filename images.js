// Images in the document. Each image is stored in the browser (IndexedDB) under the path the Markdown
// uses, e.g. images/photo.jpg. The original file is kept untouched; edits are a recipe that is applied
// to it at full resolution whenever the image is exported.

// ---------- Edits ----------
export const NO_EDITS = Object.freeze({
  rotate: 0, flipH: false, flipV: false, crop: null, resize: null,
  brightness: 0, contrast: 0, saturation: 0, warmth: 0, sharpen: 0, filter: 'none',
  docWidth: 'auto', // size in the document: 'auto' or a percentage of the text width
});
const PIXEL_KEYS = ['rotate', 'flipH', 'flipV', 'crop', 'resize', 'brightness', 'contrast', 'saturation', 'warmth', 'sharpen', 'filter'];
/** True when the edits change the pixels (the document size alone does not). */
export const changesPixels = (e) => PIXEL_KEYS.some((k) => JSON.stringify(e[k]) !== JSON.stringify(NO_EDITS[k]));
const needsPixelPass = (e) => e.brightness || e.contrast || e.saturation || e.warmth || e.sharpen || e.filter !== 'none';

// ---------- Formats ----------
const WORD_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/bmp': 'bmp' };
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/bmp': 'bmp', 'image/webp': 'webp', 'image/avif': 'avif', 'image/svg+xml': 'svg', 'image/x-icon': 'ico', 'image/jxl': 'jxl' };
const LABEL = { jpeg: 'JPEG', png: 'PNG', gif: 'GIF', bmp: 'BMP', webp: 'WebP', avif: 'AVIF', svg: 'SVG', ico: 'ICO', jxl: 'JPEG XL', heic: 'HEIC', tiff: 'TIFF' };
const MIME = { jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml', ico: 'image/x-icon', jxl: 'image/jxl' };
export const ACCEPT = 'image/*,.heic,.heif,.tif,.tiff,.avif,.jxl,.ico,.svg,.bmp,.webp';

/** Works out the format from the file's first bytes, falling back to its name. */
function sniff(bytes, name) {
  const b = (i) => bytes[i];
  const ascii = (from, to) => String.fromCharCode(...bytes.slice(from, to));
  if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return 'jpeg';
  if (b(0) === 0x89 && ascii(1, 4) === 'PNG') return 'png';
  if (ascii(0, 4) === 'GIF8') return 'gif';
  if (ascii(0, 2) === 'BM') return 'bmp';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp';
  if ((b(0) === 0x49 && b(1) === 0x49 && b(2) === 0x2a) || (b(0) === 0x4d && b(1) === 0x4d && b(3) === 0x2a)) return 'tiff';
  if (b(0) === 0 && b(1) === 0 && (b(2) === 1 || b(2) === 2) && b(3) === 0) return 'ico';
  if ((b(0) === 0xff && b(1) === 0x0a) || ascii(4, 8) === 'JXL ') return 'jxl';
  if (ascii(4, 8) === 'ftyp') {
    const brands = ascii(8, Math.min(bytes.length, 64));
    if (/avi[fs]/.test(brands)) return 'avif';
    if (/hei[cxms]|hev[cxms]|mif1|msf1/.test(brands)) return 'heic';
  }
  const head = new TextDecoder().decode(bytes.slice(0, 1024)).trimStart();
  if (head.startsWith('<') && /<svg[\s>]/i.test(head)) return 'svg';
  const ext = (name.split('.').pop() || '').toLowerCase();
  return { jpg: 'jpeg', jpeg: 'jpeg', png: 'png', gif: 'gif', bmp: 'bmp', webp: 'webp', avif: 'avif', svg: 'svg', ico: 'ico', heic: 'heic', heif: 'heic', tif: 'tiff', tiff: 'tiff', jxl: 'jxl' }[ext] || null;
}

/** EXIF orientation of a JPEG (1 = upright). Word ignores it, so rotated photos are re-rendered upright. */
function jpegOrientation(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let i = 2;
  while (i + 4 < view.byteLength) {
    const marker = view.getUint16(i);
    const len = view.getUint16(i + 2);
    if (marker === 0xffe1 && view.getUint32(i + 4) === 0x45786966) { // "Exif"
      const tiff = i + 10;
      const little = view.getUint16(tiff) === 0x4949;
      const u16 = (o) => view.getUint16(o, little);
      const ifd = tiff + view.getUint32(tiff + 4, little);
      for (let n = 0, count = u16(ifd); n < count; n++) {
        const entry = ifd + 2 + n * 12;
        if (u16(entry) === 0x0112) return u16(entry + 8) || 1;
      }
      return 1;
    }
    if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) break;
    i += 2 + len;
  }
  return 1;
}

// ---------- Decoders loaded on demand ----------
const scripts = new Map();
const loadScript = (src) => {
  if (!scripts.has(src)) {
    scripts.set(src, new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => { scripts.delete(src); reject(new Error(`could not load ${src}`)); };
      document.head.appendChild(s);
    }));
  }
  return scripts.get(src);
};

async function heicToJpeg(blob) {
  await loadScript('vendor/heic2any.min.js');
  const out = await window.heic2any({ blob, toType: 'image/jpeg', quality: 0.95 });
  return Array.isArray(out) ? out[0] : out;
}

async function tiffToPng(bytes) {
  await loadScript('vendor/pako_inflate.min.js');
  await loadScript('vendor/UTIF.js');
  const { UTIF } = window;
  const ifds = UTIF.decode(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const page = ifds.find((d) => d.t256) || ifds[0];
  UTIF.decodeImage(bytes.buffer, page, ifds);
  const rgba = UTIF.toRGBA8(page);
  const canvas = makeCanvas(page.width, page.height);
  canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, page.width * page.height * 4), page.width, page.height), 0, 0);
  return encode(canvas, 'image/png');
}

// ---------- Canvas helpers ----------
function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}
const encode = (canvas, type, quality = 0.95) => new Promise((resolve, reject) => {
  try { canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('the image is too large for this browser to encode'))), type, quality); } catch (e) { reject(e); }
});
const loadImg = (url) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error('this browser cannot read the image'));
  img.src = url;
});

/** Decodes a stored image: { source, width, height } with EXIF orientation applied. SVGs are drawn at `svgSize` on their long side. */
async function decode(record, svgSize) {
  if (record.type === 'image/svg+xml') {
    const url = URL.createObjectURL(record.blob);
    try {
      const img = await loadImg(url);
      const w = record.width, h = record.height;
      const k = svgSize ? svgSize / Math.max(w, h) : 1;
      return { source: img, width: w * k, height: h * k };
    } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }
  try {
    const bmp = await createImageBitmap(record.blob, { imageOrientation: 'from-image' });
    return { source: bmp, width: bmp.width, height: bmp.height };
  } catch {
    const url = URL.createObjectURL(record.blob);
    try {
      const img = await loadImg(url);
      return { source: img, width: img.naturalWidth, height: img.naturalHeight };
    } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }
}

/** Width and height of an SVG from its attributes or viewBox (1024 on the long side when it has neither). */
async function svgSize(blob) {
  const el = new DOMParser().parseFromString(await blob.text(), 'image/svg+xml').documentElement;
  const num = (v) => (v && !/%/.test(v) ? parseFloat(v) : NaN);
  let w = num(el.getAttribute('width')), h = num(el.getAttribute('height'));
  const vb = (el.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
  if (!(w > 0) || !(h > 0)) {
    if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
      if (w > 0) h = (w * vb[3]) / vb[2];
      else if (h > 0) w = (h * vb[2]) / vb[3];
      else { const k = 1024 / Math.max(vb[2], vb[3]); w = vb[2] * k; h = vb[3] * k; }
    } else { w = 1024; h = 768; }
  }
  return { width: Math.round(w), height: Math.round(h) };
}

// ---------- Rendering ----------
const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

/** Applies brightness, contrast, saturation, warmth, filter and sharpening to a canvas, in place. */
function adjustPixels(canvas, e) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const { width: w, height: h } = canvas;
  const image = ctx.getImageData(0, 0, w, h);
  const d = image.data;
  // Brightness and contrast as one lookup table.
  const c = e.contrast * 1.275;
  const f = (259 * (c + 255)) / (255 * (259 - c));
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) lut[v] = clamp(f * (v + e.brightness * 1.275 - 128) + 128);
  const sat = 1 + e.saturation / 100;
  const warm = e.warmth * 0.35;
  for (let i = 0; i < d.length; i += 4) {
    let r = lut[d[i]], g = lut[d[i + 1]], b = lut[d[i + 2]];
    if (sat !== 1) {
      const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      r = gray + (r - gray) * sat; g = gray + (g - gray) * sat; b = gray + (b - gray) * sat;
    }
    if (warm) { r += warm; b -= warm; }
    if (e.filter === 'grayscale') { r = g = b = 0.2126 * r + 0.7152 * g + 0.0722 * b; }
    else if (e.filter === 'sepia') {
      const R = r, G = g, B = b;
      r = 0.393 * R + 0.769 * G + 0.189 * B; g = 0.349 * R + 0.686 * G + 0.168 * B; b = 0.272 * R + 0.534 * G + 0.131 * B;
    } else if (e.filter === 'invert') { r = 255 - r; g = 255 - g; b = 255 - b; }
    d[i] = clamp(r); d[i + 1] = clamp(g); d[i + 2] = clamp(b);
  }
  if (e.sharpen > 0) {
    // 3x3 sharpening kernel; edge pixels are left as they are.
    const a = e.sharpen / 50; // 0..2
    const src = new Uint8ClampedArray(d);
    const row = w * 4;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * row + x * 4;
        for (let k = 0; k < 3; k++) {
          const v = src[i + k] * (1 + 4 * a) - a * (src[i + k - 4] + src[i + k + 4] + src[i + k - row] + src[i + k + row]);
          d[i + k] = clamp(v);
        }
      }
    }
  }
  ctx.putImageData(image, 0, 0);
}

/** Size of the image after rotation, crop and resize, in pixels. */
export function outputSize(record, e = record.edits) {
  const turned = e.rotate % 180 !== 0;
  const rw = turned ? record.height : record.width;
  const rh = turned ? record.width : record.height;
  const c = e.crop || { x: 0, y: 0, w: 1, h: 1 };
  const cw = Math.max(1, Math.round(c.w * rw)), ch = Math.max(1, Math.round(c.h * rh));
  return e.resize ? { width: e.resize.width, height: e.resize.height } : { width: cw, height: ch };
}

/**
 * Draws the image with its edits. maxSide limits the long side (for previews); by default the image is
 * drawn at full resolution. Pass { crop: false } to draw the whole rotated image (for the crop tool).
 */
export async function render(record, { edits = record.edits, maxSide = Infinity, crop = true, pixels = true } = {}) {
  const e = edits;
  const full = outputSize(record, crop ? e : { ...e, crop: null, resize: null });
  const scale = Math.min(1, maxSide / Math.max(full.width, full.height));
  const { source, width: W, height: H } = await decode(record, record.type === 'image/svg+xml' ? Math.max(record.width, record.height) * Math.max(1, scale * 2) : 0);
  const turned = e.rotate % 180 !== 0;
  // Rotated image size in the decoded source's pixels (SVGs may be decoded larger than their nominal size).
  const rw = turned ? H : W, rh = turned ? W : H;
  const c = crop && e.crop ? e.crop : { x: 0, y: 0, w: 1, h: 1 };
  const out = makeCanvas(full.width * scale, full.height * scale);
  const ctx = out.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const kx = out.width / (c.w * rw), ky = out.height / (c.h * rh);
  ctx.scale(kx, ky);
  ctx.translate(-c.x * rw, -c.y * rh);
  ctx.translate(rw / 2, rh / 2);
  ctx.scale(e.flipH ? -1 : 1, e.flipV ? -1 : 1);
  ctx.rotate((e.rotate * Math.PI) / 180);
  ctx.drawImage(source, -W / 2, -H / 2, W, H);
  if (source.close) source.close();
  if (pixels && needsPixelPass(e)) adjustPixels(out, e);
  return out;
}

// ---------- Store ----------
const DB_NAME = 'md-to-word';
const STORE = 'images';
const images = new Map(); // path -> record
const previewUrls = new Map(); // path -> object URL of the preview image
let dbReady = null;

function openDb() {
  dbReady ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'path' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null); // storage unavailable: images last for this visit only
    } catch { resolve(null); }
  });
  return dbReady;
}
async function dbDo(mode, fn) {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req && req.result);
    tx.onerror = tx.onabort = () => resolve(null);
  });
}

/** Loads the stored images (call once at start). */
export async function loadImages() {
  const all = (await dbDo('readonly', (s) => s.getAll())) || [];
  for (const r of all) images.set(r.path, { ...r, edits: { ...NO_EDITS, ...r.edits } });
  await Promise.all(all.map((r) => refreshPreview(r.path)));
}

export const listImages = () => [...images.values()].sort((a, b) => a.added - b.added);
export const getImage = (path) => images.get(normalizePath(path)) || null;
export const normalizePath = (p) => { try { p = decodeURI(p); } catch { /* keep as is */ } return p.replace(/^\.\//, '').replace(/\\/g, '/'); };

export async function clearImages() {
  for (const url of previewUrls.values()) URL.revokeObjectURL(url);
  previewUrls.clear();
  images.clear();
  await dbDo('readwrite', (s) => s.clear());
}

async function save(record) {
  images.set(record.path, record);
  await dbDo('readwrite', (s) => s.put(record));
}

export async function removeImage(path) {
  const url = previewUrls.get(path);
  if (url) URL.revokeObjectURL(url);
  previewUrls.delete(path);
  images.delete(path);
  await dbDo('readwrite', (s) => s.delete(path));
}

export async function updateEdits(path, edits) {
  const record = images.get(path);
  if (!record) return;
  await save({ ...record, edits: { ...NO_EDITS, ...edits } });
  await refreshPreview(path);
}

/** Preview image: the stored file when unedited, otherwise a render up to 1600 px on the long side. */
async function refreshPreview(path) {
  const record = images.get(path);
  if (!record) return;
  let blob = record.blob;
  if (changesPixels(record.edits)) {
    const canvas = await render(record, { maxSide: 1600 });
    blob = await encode(canvas, record.type === 'image/jpeg' ? 'image/jpeg' : 'image/png', 0.9);
  }
  const old = previewUrls.get(path);
  previewUrls.set(path, URL.createObjectURL(blob));
  if (old) URL.revokeObjectURL(old);
}

/**
 * For the preview: { url, docWidth, width? } of a stored image, or null when there is none at that path.
 * width is given for SVGs, which may have no size of their own and would otherwise show tiny.
 */
export function previewImage(path) {
  const p = normalizePath(path);
  const url = previewUrls.get(p);
  if (!url) return null;
  const r = images.get(p);
  return { url, docWidth: r.edits.docWidth, width: r.type === 'image/svg+xml' && !changesPixels(r.edits) ? r.width : undefined };
}

/** A unique, Markdown-friendly path under images/ for a file name. */
function uniquePath(name, ext, taken) {
  const base = name.replace(/\.[^.]+$/, '').normalize('NFKD').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'image';
  let path = `images/${base}.${ext}`;
  for (let n = 2; images.has(path) || taken.has(path); n++) path = `images/${base}-${n}.${ext}`;
  return path;
}

/**
 * Reads image files and stores them. HEIC and TIFF, which browsers cannot show, are converted:
 * HEIC to a 95% quality JPEG and TIFF to a lossless PNG, both at full resolution.
 * Returns { added: [{ path, name }], failed: [{ name, reason }] }. `paths` can give a file its path.
 */
export async function addImageFiles(files, { paths = new Map() } = {}) {
  const added = [], failed = [], taken = new Set();
  for (const file of files) {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const kind = sniff(bytes, file.name);
      if (!kind) throw new Error('not an image this app can read');
      let blob = new Blob([bytes], { type: MIME[kind] || file.type });
      let converted = null;
      if (kind === 'heic') { blob = await heicToJpeg(file); converted = 'HEIC'; }
      else if (kind === 'tiff') { blob = await tiffToPng(bytes); converted = 'TIFF'; }
      const type = blob.type;
      let width, height;
      if (type === 'image/svg+xml') ({ width, height } = await svgSize(blob));
      else {
        const probe = await decode({ blob, type });
        width = probe.width; height = probe.height;
        if (probe.source.close) probe.source.close();
      }
      const ext = EXT[type] || 'png';
      const wanted = paths.get(file) && normalizePath(paths.get(file));
      const path = wanted || uniquePath(file.name, ext, taken);
      taken.add(path);
      const record = {
        path, name: file.name, type, blob, size: blob.size, width, height,
        format: LABEL[kind] || kind, converted,
        orientation: type === 'image/jpeg' ? jpegOrientation(new Uint8Array(await blob.arrayBuffer())) : 1,
        edits: { ...NO_EDITS }, added: Date.now() + added.length,
      };
      await save(record);
      await refreshPreview(path);
      added.push({ path, name: file.name });
    } catch (e) {
      failed.push({ name: file.name, reason: String(e.message || e) });
    }
  }
  return { added, failed };
}

/** The file to export for an image: the original when unedited, otherwise a full-resolution render. */
export async function finalBlob(record) {
  if (!changesPixels(record.edits)) return record.blob;
  const canvas = await render(record);
  return encode(canvas, record.type === 'image/jpeg' ? 'image/jpeg' : 'image/png', 0.95);
}

/**
 * The image for Word, at full resolution: { data, type, width, height, docWidth, fallback? }.
 * Unedited JPEG, PNG, GIF and BMP files go in byte for byte. SVGs stay vector with a PNG fallback.
 * Anything else is rendered at full resolution: JPEG photos as 95% JPEG, everything else as lossless PNG.
 */
export async function wordImage(record) {
  const e = record.edits;
  const bytes = async (blob) => new Uint8Array(await blob.arrayBuffer());
  // SVGs have no fixed pixel size: rasterize them at least 2400 px on the long side.
  const svgRaster = () => {
    const k = Math.max(1, 2400 / Math.max(record.width, record.height));
    return render({ ...record, width: record.width * k, height: record.height * k });
  };
  if (!changesPixels(e)) {
    const kind = WORD_TYPES[record.type];
    if (kind && !(record.type === 'image/jpeg' && record.orientation > 1)) {
      return { data: await bytes(record.blob), type: kind, width: record.width, height: record.height, docWidth: e.docWidth };
    }
    if (record.type === 'image/svg+xml') {
      const fallback = await svgRaster();
      return {
        data: await bytes(record.blob), type: 'svg', width: record.width, height: record.height, docWidth: e.docWidth,
        fallback: { type: 'png', data: await bytes(await encode(fallback, 'image/png')) },
      };
    }
  }
  const canvas = record.type === 'image/svg+xml' ? await svgRaster() : await render(record);
  const jpeg = record.type === 'image/jpeg';
  const blob = await encode(canvas, jpeg ? 'image/jpeg' : 'image/png', 0.95);
  return { data: await bytes(blob), type: jpeg ? 'jpg' : 'png', width: canvas.width, height: canvas.height, docWidth: e.docWidth };
}

/** Images referenced by URL or data URI, for Word: fetched, and converted to PNG if Word cannot read them. */
export async function externalWordImage(src) {
  const res = await fetch(src);
  if (!res.ok) throw new Error(`could not download ${src} (${res.status})`);
  const blob = await res.blob();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const kind = sniff(bytes, src.split('?')[0]);
  const type = MIME[kind];
  const record = { blob: new Blob([bytes], { type }), type, edits: { ...NO_EDITS }, orientation: kind === 'jpeg' ? jpegOrientation(bytes) : 1 };
  if (type === 'image/svg+xml') Object.assign(record, await svgSize(record.blob));
  else {
    const probe = await decode(record);
    record.width = probe.width; record.height = probe.height;
    if (probe.source.close) probe.source.close();
  }
  return wordImage(record);
}

export const formatBytes = (n) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
