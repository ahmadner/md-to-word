// Mermaid diagrams: SVG for the preview and HTML export, PNG for Word.

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

// Rendered SVGs by diagram source. Typing inside a diagram creates many variants, so keep only recent ones.
const cache = new Map(); // source -> Promise<svg>
const ready = new Map(); // source -> svg, once rendered
const MAX_CACHED = 60;
let counter = 0;

/** Resolves to the SVG markup for a diagram, or rejects with mermaid's error. */
export function diagramSvg(code) {
  if (!cache.has(code)) {
    cache.set(code, (async () => {
      const mermaid = await loadMermaid();
      const id = `mmd${counter++}`;
      try {
        const { svg } = await mermaid.render(id, code);
        if (cache.has(code)) ready.set(code, svg); // not if evicted meanwhile
        return svg;
      } finally {
        // mermaid leaves a temporary element behind when a diagram fails to parse
        document.querySelectorAll(`body > [id^="d${id}"]`).forEach((e) => e.remove());
      }
    })());
    if (cache.size > MAX_CACHED) {
      const oldest = cache.keys().next().value;
      cache.delete(oldest);
      ready.delete(oldest);
    }
  }
  return cache.get(code);
}

/** The SVG if it has already been rendered, so the preview can show it without a flicker. */
export const readySvg = (code) => ready.get(code) || null;

/** PNG of a diagram for Word: { data: Uint8Array, width, height } in CSS pixels. */
export async function diagramPng(code) {
  const el = new DOMParser().parseFromString(await diagramSvg(code), 'image/svg+xml').documentElement;
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
