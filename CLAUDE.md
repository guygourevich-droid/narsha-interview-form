# CLAUDE.md

Hebrew (RTL) interview form for construction engineer / site-manager candidates.
Static site, no backend, no build step — plain `<script>` tags. Deployed on
Vercel (pushes to `main` auto-deploy). Everything the candidate enters stays on
their device; the output is a canvas-rendered PDF shared via the Web Share API
(mobile) or download + WhatsApp/email (desktop).

## Two forms on one site

- `/` (root) — the **interview form** (`index.html`, `app.js`, `pdf.js`,
  `questions.js`, `styles.css`).
- `/klita/` — the **employee-onboarding clearance form** ("טופס טיולים נכנס",
  `klita/`): 5 collapsible department checklists (53 tri-state items:
  בוצע / לא רלוונטי / לא סומן), 7 draw-on-screen signature pads, employee +
  CEO sign-off. Self-contained folder that mirrors the interview form's
  patterns; it references the shared `/vendor/jspdf-*` and `/logo.png` by
  absolute path but has its own `data.js`/`app.js`/`pdf.js`/`styles.css` and its
  own localStorage key (`narsha_onboarding_v1`). The two forms do **not** share
  code — if a third form appears, extract a shared canvas-PDF core then.
  Verified by `test-onboarding.js` (spins up a static server so the absolute
  paths resolve). Both forms' PDF generators must keep the MAXBLK invariant.

## Architecture

- `app.js` → builds a data object → `pdf.js` (`window.generateInterviewPdf`)
  consumes it. That data contract is documented at the top of `pdf.js`.
- `pdf.js` draws pages with Canvas 2D (browser handles Hebrew bidi/shaping),
  paginates explicitly with measured "blocks", then images each page into jsPDF.
  **Never use html2canvas/html2pdf** — that was v1 and it clipped pages.
- No block may exceed `MAXBLK` (one page of content): `mQA`/`mScenario` split
  long answers into continuation chunks. If you add a new block type, keep that
  invariant or pagination will clip it.
- Uploads are validated + re-encoded to bounded JPEG data URLs at pick time in
  `app.js` (`processImageFile`), so `pdf.js` only ever sees decodable JPEGs, and
  attachments fit in localStorage. Never accept a raw File into `store`.
- jsPDF is vendored at `vendor/jspdf-2.5.1.umd.min.js` (filename is
  version-stamped because prod caches `/vendor/*` immutably — bump the filename
  if you ever upgrade it, and update `index.html` + `test-pdf.html`).

## Testing

- `npm test` — full headless Puppeteer suite (needs `npm install` first).
- PDF correctness is verified pixel-wise: `tools/analyze.py` (PyMuPDF) renders
  each page and asserts `clipped: none`. Venv setup is in README.md.
- After any change to `pdf.js` layout, run `npm test` AND eyeball a rendered
  page PNG from `test-output/` — Hebrew glyph/RTL regressions don't always show
  up in bbox checks.

## Conventions

- All user-facing copy is Hebrew; keep it RTL-correct and match existing tone.
- `SPEC.md` is the historical v2 build spec, not current-state docs; README.md
  is the source of truth for behavior.
