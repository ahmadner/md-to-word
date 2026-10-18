// Mermaid diagrams: SVG for the preview and HTML export, PNG for Word. Colors follow the document theme.

let mermaidReady = null;
let themeVariables = {};
let themeKey = '';
let initializedKey = null;

/** Sets the colors and font for diagrams drawn from now on (see theme.js mermaidVariables). */
export function setDiagramTheme(variables) {
  themeVariables = variables;
  themeKey = JSON.stringify(variables);
}

// mermaid is large, so it is only loaded when a document has diagrams.
function loadMermaid() {
  mermaidReady ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'vendor/mermaid.min.js';
    script.onload = () => resolve(window.mermaid);
    script.onerror = () => { mermaidReady = null; reject(new Error('could not load the diagram library')); };
    document.head.appendChild(script);
  });
  return mermaidReady;
}

function configure(mermaid, variables, key) {
  if (initializedKey === key) return;
  mermaid.initialize({
    startOnLoad: false,
    theme: 'base',
    securityLevel: 'strict',
    htmlLabels: false, // plain SVG text, so the diagram can be drawn onto a canvas
    themeVariables: variables,
    flowchart: { curve: 'basis', padding: 10, nodeSpacing: 30, rankSpacing: 42, wrappingWidth: 260, htmlLabels: false },
  });
  initializedKey = key;
}

// One render at a time, so a theme change cannot interleave with a render in progress.
let queue = Promise.resolve();
const enqueue = (task) => { const run = queue.then(task, task); queue = run.catch(() => {}); return run; };

// Rendered SVGs by theme and source. Typing inside a diagram creates many variants, so keep only recent ones.
const cache = new Map(); // key -> Promise<svg>
const ready = new Map(); // key -> svg, once rendered
const MAX_CACHED = 60;
let counter = 0;
const keyFor = (code) => `${themeKey}\u0000${code}`;

/** Resolves to the SVG markup for a diagram in the current theme, or rejects with mermaid's error. */
export function diagramSvg(code) {
  const key = keyFor(code);
  if (!cache.has(key)) {
    const variables = themeVariables, variablesKey = themeKey; // the theme this render was requested in
    cache.set(key, enqueue(async () => {
      const mermaid = await loadMermaid();
      configure(mermaid, variables, variablesKey);
      const id = `mmd${counter++}`;
      try {
        const { svg } = await mermaid.render(id, code);
        if (cache.has(key)) ready.set(key, svg); // not if evicted meanwhile
        return svg;
      } finally {
        // mermaid leaves a temporary element behind when a diagram fails to parse
        document.querySelectorAll(`body > [id^="d${id}"]`).forEach((e) => e.remove());
      }
    }));
    if (cache.size > MAX_CACHED) {
      const oldest = cache.keys().next().value;
      cache.delete(oldest);
      ready.delete(oldest);
    }
  }
  return cache.get(key);
}

/** The SVG if it has already been rendered in the current theme, so the preview can show it without a flicker. */
export const readySvg = (code) => ready.get(keyFor(code)) || null;

/** PNG of a diagram for Word: { data: Uint8Array, width, height } in CSS pixels. */
export async function diagramPng(code) {
  const background = themeVariables.background || '#ffffff';
  const el = new DOMParser().parseFromString(await diagramSvg(code), 'image/svg+xml').documentElement;
  const [, , w, h] = el.getAttribute('viewBox').split(/[\s,]+/).map(Number);
  el.setAttribute('width', w);
  el.setAttribute('height', h);
  el.removeAttribute('style');

  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(el));
  await img.decode();
  const PAD = 14, SCALE = 3; // margin in CSS px; render at 3x for print
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil((w + 2 * PAD) * SCALE);
  canvas.height = Math.ceil((h + 2 * PAD) * SCALE);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, PAD * SCALE, PAD * SCALE, w * SCALE, h * SCALE);
  const png = await new Promise((resolve, reject) => {
    try { canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('could not create the image'))), 'image/png'); } catch (e) { reject(e); }
  });
  return { data: new Uint8Array(await png.arrayBuffer()), width: w + 2 * PAD, height: h + 2 * PAD };
}
