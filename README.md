# Narsha Interview Form

Hebrew RTL interview form for construction engineer / site manager positions.
Generates a PDF and lets the user share it via WhatsApp, email, or native mobile sharing.

## Features

- Fully responsive (desktop + mobile)
- PDF generation in-browser (html2pdf.js)
- Native sharing via Web Share API (WhatsApp, email, SMS on mobile)
- Download button for desktop
- File uploads (ID + certificate) — images embedded in PDF
- Auto-save to localStorage (form data persists across page reloads)
- Works on any device with a browser — no backend required

## Tech Stack

- Pure HTML/CSS/JS (no build step)
- [html2pdf.js](https://github.com/eKoopmans/html2pdf.js)
- Google Fonts (Heebo)

## Deployment

Hosted on Vercel. Any push to `main` triggers auto-deploy via GitHub integration.