# Markdown to Word

A browser-based Markdown workspace: open a `.md` file, preview and edit it, add and edit images, then export it as a Word document, web page, PDF or Markdown. Word export includes a cover page, table of contents, styled tables and code, Mermaid diagrams, and your images at full resolution.

Everything runs in your browser. Your files are never uploaded anywhere.

## Use it

1. Open the page and drop a `.md` file on it, choose one, open the sample, or start a blank document.
2. Edit in the workspace. The preview updates as you type and matches the Word layout.
3. Click **Export** and pick a format.

| Workspace feature | Details |
|-------------------|---------|
| Views | **Edit**, **Split** (editor and preview side by side) or **Preview**. Phones show Edit or Preview |
| Toolbar | Heading, bold, italic, strikethrough, inline code, link, bulleted and numbered lists, note box, code block, table, diagram, image |
| Shortcuts | Ctrl+B bold, Ctrl+I italic, Ctrl+K link, Ctrl+S save as `.md`, Tab / Shift+Tab indent, Enter continues a list, Esc leaves the editor |
| Outline | Lists the headings; click one to jump to it in the editor and the preview |
| Export | Word (`.docx`), Markdown (`.md`), Markdown + images (`.zip`), web page (`.html`, self-contained), PDF (through the browser's print dialog) |
| Draft | Your latest changes and images are kept in this browser, so a reload or **Continue editing** brings them back. Opening another document replaces the draft |
| Open | Drop files anywhere on the page, or use **Open**: a `.md` file (with its images, if you select them too), a `.zip` from Markdown + images, or images on their own |
| Images | Add, edit and manage images; see below |
| Theme | Colors and fonts for the preview and every export; see below |

When Word opens an exported document it asks whether to update the fields in it. Choose **Yes** to add page numbers to the table of contents.

## Images

Add images with the image button in the toolbar, the **Images** panel, by pasting (for example a screenshot) or by dropping image files on the page. Each image is stored in this browser under `images/<name>` and referenced in the text as `![description](images/name.png "Caption")`.

| Format | Handling |
|--------|----------|
| JPEG, PNG, GIF, BMP | Word gets the original file, byte for byte (GIF animation included) |
| SVG | Word gets the original vector file, plus a 2400 px PNG for older Word versions |
| WebP, AVIF, ICO | Kept as they are; Word gets a lossless PNG at full resolution |
| TIFF | Converted to a lossless PNG at full resolution when added (first page) |
| HEIC / HEIF (iPhone photos) | Converted to a 95% quality JPEG at full resolution when added |
| JPEG XL | Only where the browser can read it (Safari) |

Click an image in the preview, or **Edit** in the Images panel, to open the image editor:

| Tool | Details |
|------|---------|
| Rotate and flip | 90° left or right, mirror, flip upside down |
| Crop | Free, original shape, 1:1, 4:3, 3:2, 16:9, 3:4, 9:16; drag the box or its corners |
| Adjust | Brightness, contrast, saturation, warmth, sharpen |
| Filter | Gray, sepia, invert |
| Size in pixels | Keep full resolution (default) or set a width and height |
| In the document | Description (alt text), caption shown under the image, width on the page (automatic, 25–100%) |

Edits never change the original. They are applied to it at full resolution whenever you export, so you can open the editor again and change or reset them. An edited JPEG is saved as a 95% quality JPEG; any other edited image as a lossless PNG. JPEG photos whose camera marked them as rotated are saved upright, because Word ignores that mark.

In the document, images are as wide as the text by default, or their own width if smaller, and never taller than a page; the file inside keeps every pixel. An image on a line of its own becomes a centered figure, with its caption (the `"title"`) underneath.

**Markdown + images (.zip)** saves the `.md` file and its `images/` folder together, so the document opens correctly in other Markdown editors and on GitHub. Open the `.zip` here to continue editing. Images from web addresses (`https://…`) are fetched when you export to Word, if the site allows it.

## Themes

Click **Theme** in the workspace. One theme drives the preview, the Word document, the HTML page, the PDF and the diagrams.

| Setting | What it does |
|---------|--------------|
| Presets | Navy (default), Ocean, Forest, Burgundy, Graphite, Violet, Slate & Amber, Midnight (dark page) |
| Colors, 60-30-10 | **Dominant (60%)**: page background. **Secondary (30%)**: title, headings, table headers, diagrams. **Accent (10%)**: links, heading rules, note bars, highlights |
| Fonts | Heading and body font. Word uses them only if they are installed on the computer that opens the document |
| Fine-tune element colors | Title, subtitle, headings 1–4, body text, links, table header and its text, note box, code background. Each starts with a color worked out from the palette; **Auto** goes back to it |
| Export / Import | Save the theme as a `.json` file to reuse it on another computer or share it |
| App appearance | System, light or dark for the app around the document |

Colors worked out from the palette are kept readable: text colors are darkened (or lightened on a dark page) until they meet the WCAG contrast ratio, 4.5:1 for text and links and 3:1 for headings. Table header text switches between white and dark to suit the header color. A color you set yourself is used as is, with a warning when its contrast is low.

The theme is saved in this browser.

## How the Markdown is laid out

| In the Markdown | In the Word document and preview |
|-----------------|----------------------------------|
| A single `#` title | Cover page. Text before ` - ` becomes the small label above the title |
| Two-column table right after the title | Cover-page details table. `Version`, `Date` / `Last Update Date`, `Document`, `Author` also fill the subtitle, header and footer |
| `## Contents` (or `Table of Contents`) | Generated table of contents, replacing the hand-written list |
| Shallowest section heading (`##` in the sample) | Heading 1, starting on a new page |
| `mermaid` code blocks | Diagrams. A diagram with an error is kept as code |
| `[text](#heading-anchor)` | Clickable cross-reference |
| `> quote` | Shaded note box |
| `![alt](path "Caption")` | Image at full resolution; on a line of its own, a centered figure with the caption under it |

Without a `#` title the document has no cover page and uses the file name in the header. See [sample.md](sample.md) for a complete example.

## Run it locally

The page uses JavaScript modules, so it has to be served over HTTP rather than opened as a file. From this folder:

```bash
python -m http.server 8000
```

Then open http://localhost:8000.

## Files

| File | Role |
|------|------|
| `index.html`, `styles.css` | The start page and the workspace |
| `app.js` | Opening files, editor, toolbar, outline, exports and draft |
| `preview.js`, `preview.css` | Preview that mirrors the Word layout; the stylesheet is also embedded in HTML exports |
| `md2docx.js` | Markdown parser and Word layout. Colours, fonts and margins are set at the top |
| `diagrams.js` | Mermaid rendering in the theme's colors: SVG for the preview, PNG for Word |
| `theme.js` | Presets, fonts, color math, and `resolveTheme()`, which turns a theme into every element color |
| `theme-panel.js` | The Theme panel |
| `images.js` | Image store (IndexedDB), format detection, HEIC and TIFF conversion, full-resolution rendering of edits, images for Word |
| `image-editor.js` | The image editor |
| `images-panel.js` | The Images panel |
| `zip.js` | Reads and writes `.zip` files for Markdown + images |
| `sample.md` | Example input |
| `vendor/` | [docx](https://github.com/dolanmiu/docx) 9.12.0 and [Mermaid](https://github.com/mermaid-js/mermaid) 11.17.2 (MIT); [heic2any](https://github.com/alexcorvi/heic2any) 0.0.4 (MIT, includes libheif and libde265 under LGPL-3.0), [UTIF.js](https://github.com/photopea/UTIF.js) 3.1.0 (MIT) and [pako](https://github.com/nodeca/pako) 1.0.11 (MIT and Zlib), loaded only when needed. Licenses are included |
