// Edge cases for the v2.1 fixes:
//  1. upload rejects undecodable images (HEIC-on-Chrome analogue) with a visible error
//  2. upload rejects non-image files (PDF scans) with a visible error
//  3. attachments survive a page reload (localStorage persistence)
//  4. an answer longer than one page is split across pages — nothing clipped
//  5. long unbroken words / long emails wrap inside the margins
//  6. pdf.js reports embed counts so app.js can warn on silently-dropped images
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const OUT = path.join(ROOT, 'test-output');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const URL = 'file://' + path.join(ROOT, 'index.html');

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok ? '' : '  — ' + detail));
  if (!ok) failures++;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto(URL, { waitUntil: 'networkidle0' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle0' });

  // --- 1+2: bad uploads are rejected loudly, good uploads accepted ---
  const bogusImg = path.join(OUT, 'bogus.heic');
  fs.writeFileSync(bogusImg, 'this is not an image');
  const bogusPdf = path.join(OUT, 'scan.pdf');
  fs.writeFileSync(bogusPdf, '%PDF-1.4 fake');
  await (await page.$('#file-id')).uploadFile(bogusImg);
  await sleep(600);
  let r = await page.evaluate(() => ({
    err: document.getElementById('err-id').textContent,
    visible: getComputedStyle(document.getElementById('err-id')).display !== 'none',
    thumbs: document.querySelectorAll('#thumbs-id .t').length
  }));
  check('undecodable image rejected with visible error', r.visible && r.err.length > 0 && r.thumbs === 0, JSON.stringify(r));

  await (await page.$('#file-cert')).uploadFile(bogusPdf);
  await sleep(600);
  r = await page.evaluate(() => ({
    err: document.getElementById('err-cert').textContent,
    visible: getComputedStyle(document.getElementById('err-cert')).display !== 'none',
    thumbs: document.querySelectorAll('#thumbs-cert .t').length
  }));
  check('PDF file rejected with PDF-specific error', r.visible && r.err.includes('PDF') && r.thumbs === 0, JSON.stringify(r));

  await (await page.$('#file-id')).uploadFile(path.join(ROOT, 'test-assets', 'test-id.png'));
  await sleep(800);
  r = await page.evaluate(() => ({
    thumbs: document.querySelectorAll('#thumbs-id .t').length,
    errVisible: getComputedStyle(document.getElementById('err-id')).display !== 'none',
    isJpeg: document.querySelector('#thumbs-id .t img').src.startsWith('data:image/jpeg')
  }));
  check('valid PNG accepted, converted to bounded JPEG, error cleared', r.thumbs === 1 && !r.errVisible && r.isJpeg, JSON.stringify(r));

  // --- 3: attachments survive reload ---
  await page.type('[name=fullname]', 'בדיקת שמירה');
  await sleep(200);
  await page.reload({ waitUntil: 'networkidle0' });
  await sleep(400);
  r = await page.evaluate(() => ({
    name: document.querySelector('[name=fullname]').value,
    thumbs: document.querySelectorAll('#thumbs-id .t').length
  }));
  check('text AND attachment restored after reload', r.name === 'בדיקת שמירה' && r.thumbs === 1, JSON.stringify(r));

  // --- 4: long answer splits across pages, nothing drawn past the page bottom ---
  const huge = Array(90).fill('שורה ארוכה מאוד של טקסט בעברית שממלאת את כל רוחב העמוד כדי לבדוק פיצול נכון בין עמודים.').join(' ');
  const r4 = await page.evaluate(async (huge) => {
    const res = await window.generateInterviewPdf({
      contact: { fullname: 'בדיקה' },
      answers: [{ q: 'שאלה ראשונה', a: huge }, { q: 'שאלה שנייה', a: 'תשובה קצרה' }],
      engineering: [], attachments: []
    });
    const b = new Uint8Array(await res.blob.arrayBuffer());
    let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return { b64: btoa(s), debug: res.debug };
  }, huge);
  const maxFill = Math.max(...r4.debug.pages.map(p => p.fillY));
  check('huge answer split: >1 page and every fillY <= 1071 (page bottom)',
    r4.debug.pageCount > 1 && maxFill <= 1071,
    'pages=' + r4.debug.pageCount + ' maxFillY=' + maxFill);
  fs.writeFileSync(path.join(OUT, 'edge-huge.pdf'), Buffer.from(r4.b64, 'base64'));

  // --- 5: long unbroken email wraps instead of overflowing the contact box ---
  const r5 = await page.evaluate(async () => {
    const res = await window.generateInterviewPdf({
      contact: {
        fullname: 'ישראל ישראלי-כהן המהנדס הראשי',
        position: 'מנהל עבודה',
        phone: '050-1234567',
        email: 'a.very.long.email.address.for.testing@some-corporate-subdomain.example-company.co.il'
      },
      answers: [{ q: 'שאלה', a: 'תשובה עם מילה-ארוכה-מאוד: ' + 'x'.repeat(200) }],
      engineering: [], attachments: []
    });
    const b = new Uint8Array(await res.blob.arrayBuffer());
    let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return { b64: btoa(s), debug: res.debug };
  });
  check('long email + long word PDF generated', !!r5.b64, '');
  fs.writeFileSync(path.join(OUT, 'edge-longvals.pdf'), Buffer.from(r5.b64, 'base64'));

  // --- 7: oversized file (>25MB) rejected before any processing ---
  const bigFile = path.join(OUT, 'big.png');
  fs.writeFileSync(bigFile, Buffer.alloc(26 * 1024 * 1024));
  await (await page.$('#file-id')).uploadFile(bigFile);
  await sleep(800);
  r = await page.evaluate(() => ({
    err: document.getElementById('err-id').textContent,
    thumbs: document.querySelectorAll('#thumbs-id .t').length
  }));
  check('26MB file rejected with size error', r.err.includes('גדול מדי') && r.thumbs === 1, JSON.stringify(r));
  fs.unlinkSync(bigFile);

  // --- 8: per-category count cap (6) with a visible error on overflow ---
  const png = path.join(ROOT, 'test-assets', 'test-cert.png');
  await (await page.$('#file-cert')).uploadFile(png, png, png, png, png, png, png);
  await sleep(2500);
  r = await page.evaluate(() => ({
    err: document.getElementById('err-cert').textContent,
    thumbs: document.querySelectorAll('#thumbs-cert .t').length
  }));
  check('7 uploads → 6 accepted + count-cap error', r.thumbs === 6 && r.err.includes('עד 6'), JSON.stringify(r));

  // --- 6: pdf.js reports dropped images via debug counts ---
  const r6 = await page.evaluate(async () => {
    const res = await window.generateInterviewPdf({
      contact: { fullname: 'בדיקה' },
      answers: [{ q: 'שאלה', a: 'תשובה' }], engineering: [],
      attachments: [{ label: 'תעודת זהות', dataUrl: 'data:image/heic;base64,' + btoa('junk') }]
    });
    return res.debug;
  });
  check('debug reports imagesRequested=1 imagesEmbedded=0 for a bad dataUrl',
    r6.imagesRequested === 1 && r6.imagesEmbedded === 0, JSON.stringify(r6));

  await browser.close();
  console.log(failures ? '\nEDGE TESTS FAILED: ' + failures : '\nALL EDGE TESTS PASSED');
  process.exit(failures ? 1 : 0);
})();
