# Markdown to Word

A browser-based Markdown workspace: open a `.md` file, preview and edit it, then export it as a Word document, web page, PDF or Markdown. Word export includes a cover page, table of contents, styled tables and code, and Mermaid diagrams rendered as images.

Everything runs in your browser. Your files are never uploaded anywhere.

## Use it

1. Open the page and drop a `.md` file on it, choose one, open the sample, or start a blank document.
2. Edit in the workspace. The preview updates as you type and matches the Word layout.
3. Click **Export** and pick a format.

| Workspace feature | Details |
|-------------------|---------|
| Views | **Edit**, **Split** (editor and preview side by side) or **Preview**. Phones show Edit or Preview |
| Toolbar | Heading, bold, italic, strikethrough, inline code, link, bulleted and numbered lists, note box, code block, table, diagram |
| Shortcuts | Ctrl+B bold, Ctrl+I italic, Ctrl+K link, Ctrl+S save as `.md`, Tab / Shift+Tab indent, Enter continues a list, Esc leaves the editor |
| Outline | Lists the headings; click one to jump to it in the editor and the preview |
| Export | Word (`.docx`), Markdown (`.md`), web page (`.html`, self-contained), PDF (through the browser's print dialog) |
| Draft | Your latest changes are kept in this browser, so a reload or **Continue editing** brings them back. Opening another document replaces the draft |
| Open | Drop a file anywhere on the page, or use **Open** |

When Word opens an exported document it asks whether to update the fields in it. Choose **Yes** to add page numbers to the table of contents.

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
| `![alt](path)` | `[Image: alt]` placeholder; image files are not embedded |

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
| `diagrams.js` | Mermaid rendering: SVG for the preview, PNG for Word |
| `sample.md` | Example input |
| `vendor/` | [docx](https://github.com/dolanmiu/docx) 9.12.0 and [Mermaid](https://github.com/mermaid-js/mermaid) 11.17.2, both MIT licensed (licenses included) |
