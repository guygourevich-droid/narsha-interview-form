# Narsha Interview Form — v2 rebuild SPEC

Hebrew (RTL), in-browser, **no backend**. Collect contact + 13 questions + 2 engineering
scenarios + document uploads → export a **pixel-perfect PDF** → share it.

## Files (all at repo root; plain `<script>` tags, no build step)
- `index.html` — shell; loads Heebo (Google Fonts) + jsPDF (CDN) + `questions.js` + `pdf.js` + `app.js` (in that order).
- `styles.css` — all styling.
- `questions.js` — exposes `window.QUESTIONS = [ {q}, ... ]` (13) and `window.ENGINEERING = [ {q}, ... ]` (2). (Reuse the exact Hebrew question text from `legacy/index.html` — copy it verbatim.)
- `pdf.js` — exposes `async function generateInterviewPdf(data)` → `Promise<{blob, filename}>`. Canvas-rendered. **This is the hard part.**
- `app.js` — renders the form, manages state/autosave/uploads, runs the share flow, calls `generateInterviewPdf`.
- `logo.png` — exists (Narsha logo). Reuse.

## Data contract (app.js builds this, pdf.js consumes it)
```js
{
  contact: { fullname, position, phone, email },   // strings
  answers: [ {q, a}, ... ],                         // 13 (a may be "")
  engineering: [ {q, a}, ... ],                     // 2
  attachments: [ { label, dataUrl }, ... ],         // images only, data URLs
}
```

---

## PDF module (`pdf.js`) — CANVAS-RENDERED, deterministic

**Why canvas, not html2canvas:** html2canvas/html2pdf clone the DOM and their page-slicing +
capture-window logic clips content unpredictably (this is the bug we are eliminating). Drawing on
a `<canvas>` with Canvas 2D is 100% deterministic and the browser renders Hebrew bidi/shaping
correctly.

**Algorithm:**
1. Wait for fonts: `await document.fonts.ready`.
2. Internal scale 2 for crispness. A4 = 794×1123 CSS px → canvas page is 1588×2246 px. Define
   `PAGE_W`, `PAGE_H` (px, incl. scale), side margin `M=112px` (≈28mm×... pick so content x stays
   in [0.06, 0.94] of page), top margin `MT`, bottom margin `MB` (leave room for footer).
3. Create ONE tall offscreen canvas: width `PAGE_W`, height = `N * PAGE_H` where N is computed by
   a **two-pass layout**: pass 1 measures total content height with pagination rules to know N;
   pass 2 draws. (Or draw into a generously-sized canvas and track `y`; if `y` would exceed the
   allocated height, you mis-estimated — so do the measure pass first.)
4. **Pagination rules while drawing (track `y`):**
   - Usable bottom = `(pageIndex+1)*PAGE_H - MB`. Before drawing a block, if `y + blockHeight >
     usableBottom`, advance `y` to `pageIndex+1)*PAGE_H + MT` (new page) first.
   - A "block" = header / contact box / each Q&A / each scenario(answer) / each attachment image.
   - **Never split a block across a page.** (If a single block is taller than a page — e.g. a huge
     image — scale it to fit one page.)
5. Draw with `ctx.direction='rtl'`, `ctx.textAlign='right'`, `ctx.textBaseline='top'`, Hebrew font.
   Word-wrap answers via `ctx.measureText`. Right edge x = `PAGE_W - M`.
6. Slice: for each page `i`, `pageCtx.drawImage(bigCanvas, 0, i*PAGE_H, PAGE_W, PAGE_H, 0,0, PAGE_W, PAGE_H)`,
   then `pageCanvas.toDataURL('image/jpeg', 0.92)`.
7. Assemble with jsPDF: `const doc = new jspdf.jsPDF({unit:'pt', format:'a4', orientation:'portrait'});`
   A4 in pt = 595.3×841.9. For each page: `doc.addImage(dataUrl,'JPEG',0,0,595.3,841.9)` then
   `doc.addPage()` (skip after last). Then `doc.output('blob')`.
8. Footer (draw per page, before slicing, at the page's bottom band): small gray centered
   "הופק אוטומטית מטופס הראיון המקוון" and "עמוד X מתוך Y" (page numbers).

**Visual design (replicate the form's look):**
- Header band: vertical/horizontal gradient `#1f3a5f → #2f6fb0`, full width, white bold title +
  smaller subtitle ("תאריך מילוי: <date>"). Rounded bottom corners optional.
- Contact box: bg `#f4f8fc`, 1px border `#dbe6f0`, 2-col grid, label bold brand color + value.
- Q&A: question in `#1f3a5f` bold; answer in `#1c2733`; thin `#e6ebf1` divider after each. Empty
  answer → "—".
- Engineering: section title "שאלות הנדסיות" with `#e8a33d` right border accent; each scenario text
  in a `#f6f9fc` box with dashed `#9dbcd9` border, then the answer.
- Attachments: section "מסמכים מצורפים"; label above each image; image scaled to content width.
- Footer: `#8895a3`, ~11px.

**Palette:** brand `#1f3a5f`, brand-2 `#2f6fb0`, accent `#e8a33d`, ink `#1c2733`, muted `#5c6b7a`,
line `#d7dee6`.

**Filename:** `ראיון_${fullname||'מועמד'}.pdf`.

**CORRECTNESS — must verify before finishing (NON-NEGOTIABLE):**
Using the tools below, iterate until ALL hold:
1. No clipping: every page's content x-range is strictly inside [~0.06, ~0.94] and y inside
   [~0.04, ~0.96]; **no page reports `clipped: RIGHT/LEFT/TOP/BOTTOM`**.
2. No block split across pages (eyeball rendered pages).
3. Hebrew renders right-to-left with correct glyphs (screenshot a page, READ the PNG, confirm).
4. Page count is correct for the sample data (≈3 pages: 2 text + 1 attachments).
5. Blob is valid `%PDF`, size reasonable (>40 KB with images).

**Verification tooling (already installed — use it!):**
- Puppeteer (`node`) is installed. Write a small `node` spike that loads a test HTML (file://) which
  includes jsPDF CDN + your `pdf.js`, fills sample data, calls `generateInterviewPdf`, downloads the
  blob, and saves to `test-output/`.
- Render + analyze pages:
  `test-output/.venv/bin/python test-output/analyze.py <pdf> <outdir>`
  → prints per-page content bbox + `clipped:` flags. Must show `clipped: none` on every page.
- Visually confirm: render page PNGs (analyze.py writes them) and READ one or two to check Hebrew.

---

## Frontend (`index.html` + `styles.css` + `app.js` + `questions.js`)
- Render contact card + all question textareas (from QUESTIONS) + engineering scenario boxes (from
  ENGINEERING) + uploads (ID + certificate, accept image/*, multi, thumbnails + remove).
- Beautiful, modern, RTL, responsive (mobile + desktop). Brand palette. Gradient header with logo.
  Cards, sticky action bar, focus states, 16px inputs on mobile, accessible labels.
- localStorage autosave key `narsha_interview_form_v2`; restore on load. `beforeunload` guard when
  any data present.
- One primary button "יצירת PDF ושיתוף": setLoading → build data → `const r = await
  generateInterviewPdf(data)` → `openSharePanel(r)`.
- Share overlay: if `navigator.canShare?.({files:[new File([blob],filename,{type:'application/pdf'})]})`
  → show native button → `navigator.share({files,title,text})`; else auto-download +
  WhatsApp (`wa.me/?text=`), email (`mailto:`), and Download buttons. Close overlay on success or
  backdrop click.

## Environment notes
- jsPDF CDN: `https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js` (global `window.jspdf.jsPDF`).
- Heebo: `https://fonts.googleapis.com/css2?family=Heebo:wght@400;500;600;700;800&display=swap`.
- Puppeteer headless tests can fetch CDNs (network available). Wait for `networkidle0` + fonts.
- Do NOT use html2canvas or html2pdf anywhere.
