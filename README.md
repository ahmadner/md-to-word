# Markdown to Word

A web page that converts a Markdown file into a formatted Word document (`.docx`): cover page, table of contents, styled tables and code, and Mermaid diagrams rendered as images.

The conversion runs entirely in your browser. Your file is never uploaded anywhere.

## Use it

Open the page, drop a `.md` file on it (or click **try it with a sample file**), and click **Convert to Word**. The `.docx` downloads straight away.

When Word opens the document it asks whether to update the fields in it. Choose **Yes** to add page numbers to the table of contents.

## How the Markdown is laid out

| In the Markdown | In the Word document |
|-----------------|----------------------|
| A single `#` title | Cover page. Text before ` - ` becomes the small label above the title |
| Two-column table right after the title | Cover-page details table. `Version`, `Date` / `Last Update Date`, `Document`, `Author` also fill the subtitle, header and footer |
| `## Contents` (or `Table of Contents`) | Word table of contents, replacing the hand-written list |
| Shallowest section heading (`##` in the sample) | Heading 1, starting on a new page |
| `mermaid` code blocks | Diagram images. A diagram that fails to render is kept as code |
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
| `index.html` | The page |
| `app.js` | File picking, diagram rendering and download |
| `md2docx.js` | Markdown parser and Word layout. Colours, fonts and margins are set at the top |
| `sample.md` | Example input |
| `vendor/` | [docx](https://github.com/dolanmiu/docx) 9.12.0 and [Mermaid](https://github.com/mermaid-js/mermaid) 11.17.2, both MIT licensed (licenses included) |
