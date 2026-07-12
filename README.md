# Narsha Interview Form

Hebrew (RTL), in-browser interview form for construction engineer / site-manager
positions. Candidates fill contact details, 12 questions and 2 engineering
scenarios, attach documents, then generate a clean multi-page PDF and share it.
**No backend — nothing leaves the device.**

## Why a canvas PDF (v2)

The PDF is drawn directly onto a `<canvas>` (Canvas 2D renders Hebrew RTL/bidi
perfectly) with explicit pagination, then placed into a jsPDF document. This
replaced an `html2pdf`/`html2canvas` setup whose DOM-cloning + page-slicing
clipped the right edge of every page. Drawing on canvas is deterministic: every
page lands inside its margins, and Hebrew is verified to render identically to
the browser's own text engine.

## Features

- Responsive Hebrew RTL form (desktop + mobile, 0px horizontal overflow)
- Deterministic canvas-rendered PDF; answers longer than a page split cleanly
  across pages; attachments render in a 2-column grid
- **Mobile:** one-tap share via the Web Share API — the PDF is auto-attached
- **Desktop:** the PDF auto-downloads; WhatsApp / email buttons open the app with
  a ready message
- Document uploads (ID + certificate). Every picked file is validated, decoded
  and re-encoded to a bounded JPEG **at pick time** — unsupported files (HEIC on
  Chrome/Android, PDFs, corrupt files) are rejected with a visible Hebrew error
  instead of silently vanishing from the PDF. Inputs are capped (25MB per file,
  6 files per category), decoding streams via object URL so the original never
  loads into JS memory, and a busy indicator shows while converting
- Auto-save to localStorage — **including attachments**, so a mobile tab
  reload/eviction restores everything; the leave-page warning only fires if
  something could not be persisted (e.g. storage quota exceeded)
- jsPDF is vendored locally (`vendor/`) — no CDN dependency at runtime

## Files

- `index.html` — page shell (loads Heebo, vendored jsPDF, then `questions/pdf/app.js`)
- `styles.css` — styling
- `questions.js` — `window.QUESTIONS` (12) + `window.ENGINEERING` (2)
- `pdf.js` — `window.generateInterviewPdf(data) → {blob, filename, debug}` (canvas PDF)
- `app.js` — form rendering, autosave, upload validation/conversion, share flow
- `vendor/jspdf-2.5.1.umd.min.js` — vendored jsPDF (immutable-cached in prod)
- `test-*.js` — headless Puppeteer checks (`test-edge.js` covers the upload
  validation, persistence, page-splitting and wrapping edge cases)
- `tools/analyze.py` — PyMuPDF page renderer + clipping detector used by the tests

## Develop / test

```bash
npm install                 # dev dependency: puppeteer (tests only)
npm run dev                 # serve at http://localhost:3000
npm test                    # images + pdf + e2e + share + final + edge checks
```

`npm test` regenerates sample images, drives the UI headlessly, and verifies both
share paths, upload rejection/persistence, and that no PDF page is clipped.

To run the pixel-level page analyzer directly (used to verify "no clipping"):

```bash
python3 -m venv test-output/.venv
test-output/.venv/bin/pip install pymupdf
test-output/.venv/bin/python tools/analyze.py <pdf> <outdir> [skip-top-fraction]
# prints per-page content bbox; every page must report "clipped: none"
```

## Deploy

Static site on Vercel; pushes to `main` auto-deploy. `.vercelignore` keeps tests
and docs out of the deployment. Caching: HTML/JS/CSS are `no-cache` (revalidated
with 304s, so deploys take effect immediately), `logo.png` is cached for a day,
and the vendored jsPDF (version-stamped filename) is cached immutably for a year.
