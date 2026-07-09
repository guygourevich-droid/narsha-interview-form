# Narsha Interview Form

Hebrew (RTL) interview form for construction engineer / site manager positions.
Candidates fill in their details and answers, attach documents, then generate a
shareable PDF — no backend, runs entirely in the browser.

## Features

- Fully responsive (desktop + mobile), Hebrew RTL
- PDF generation in-browser via [html2pdf.js](https://github.com/eKoopmans/html2pdf.js)
- **One-tap sharing on mobile** — the Web Share API attaches the PDF automatically
  to WhatsApp / email / SMS on devices that support file sharing
- **Desktop fallback** — the PDF downloads automatically; the WhatsApp/email buttons
  open the app with a ready-made message so the file can be attached manually
- Document uploads (ID + certificate) — images are embedded in the PDF
- Auto-save to localStorage (the form survives a page reload)
- No backend — form data never leaves the device

## Tech stack

- Pure HTML/CSS/JS — no build step, single `index.html`
- html2pdf.js (loaded from CDN)
- Google Fonts (Heebo)

## Development

```bash
npm install        # dev dependency: puppeteer (used by the test only)
npm run dev        # serve locally at http://localhost:3000
npm test           # regenerate test images + run the headless PDF/share checks
```

`npm test` fills the form headlessly, generates the PDF, and asserts the blob is a
valid non-empty PDF and that the share/download flow writes a file. Screenshots land
in `test-output/`.

## Deployment

Hosted on Vercel as a static site. Any push to `main` auto-deploys via the GitHub
integration.
