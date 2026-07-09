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
page lands inside its margins, no Q&A is ever split across pages, and Hebrew is
verified to render identically to the browser's own text engine.

## Features

- Responsive Hebrew RTL form (desktop + mobile, 0px horizontal overflow)
- Deterministic canvas-rendered PDF, 2–3 pages, attachments in a 2-column grid
- **Mobile:** one-tap share via the Web Share API — the PDF is auto-attached
- **Desktop:** the PDF auto-downloads; WhatsApp / email buttons open the app with
  a ready message
- Document uploads (ID + certificate) — images embed into the PDF
- Auto-save to localStorage; guard before navigating away

## Files

- `index.html` — page shell (loads Heebo, jsPDF, then `questions/pdf/app.js`)
- `styles.css` — styling
- `questions.js` — `window.QUESTIONS` (12) + `window.ENGINEERING` (2)
- `pdf.js` — `window.generateInterviewPdf(data) → {blob, filename}` (canvas PDF)
- `app.js` — form rendering, autosave, uploads, share flow
- `test-*.js` — headless Puppeteer checks; `test-output/` holds the PyMuPDF renderer
- `legacy/` — the previous (broken-PDF) version, kept as a fallback

## Develop / test

```bash
npm install                 # dev dependency: puppeteer (tests only)
npm run dev                 # serve at http://localhost:3000
npm test                    # images + pdf + e2e + share + edge-case checks
```

`npm test` regenerates sample images, drives the UI headlessly, and renders each
PDF page to verify (via pixel analysis) that there is **no clipping** on any page,
that Hebrew metrics match the browser, and that both share paths work.

## Deploy

Static site on Vercel; pushes to `main` auto-deploy.
