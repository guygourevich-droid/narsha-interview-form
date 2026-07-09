// Final verification: edge cases for pdf.js + a mobile overflow check.
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const OUT = path.join(ROOT, 'test-output');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const dataUrl = f => 'data:image/png;base64,' + fs.readFileSync(f).toString('base64');
const ID = dataUrl(path.join(ROOT, 'test-assets', 'test-id.png'));
const CERT = dataUrl(path.join(ROOT, 'test-assets', 'test-cert.png'));

const Q = [
  'ספר על עצמך ועל הניסיון המקצועי שלך בפרויקטי בנייה.', 'אילו סוגי פרויקטים ניהלת?',
  'מה היה תפקידך בפועל באתר?', 'כיצד אתה מנהל לוחות זמנים?', 'תאר מקרה של תקלה.',
  'כיצד אתה פועל בסתירות בין תוכניות?', 'בקרת איכות ליציקות?', 'ניהול בטיחות?',
  'עימות מול קבלן משנה?', 'ציפיות שכר?', 'היכן תהיה בעוד 3–5 שנים?', 'שאלות אלינו?'
];
const ENG = [
  'בדיקת ברזל לפני יציקה: מרווחים לא תואמים וחסרים ספייסרים. כיצד תפעל?',
  'חפירה עם מרתפים: מים בקרקע ותזוזות בקיר הדיפון. מה הסיכונים והפעולות?'
];

async function gen(page, data, outName) {
  const res = await page.evaluate(async (data) => {
    const { blob, debug } = await window.generateInterviewPdf(data);
    const b = new Uint8Array(await blob.arrayBuffer());
    let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return { b64: btoa(s), size: blob.size, debug };
  }, data);
  fs.writeFileSync(path.join(OUT, outName), Buffer.from(res.b64, 'base64'));
  console.log(outName.padEnd(12), 'pages=' + res.debug.pageCount, 'size=' + res.size);
}

(async () => {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });

  // mobile overflow check
  const mp = await browser.newPage();
  await mp.setViewport({ width: 375, height: 812, isMobile: true });
  await mp.goto('file://' + path.join(ROOT, 'index.html'), { waitUntil: 'networkidle0' });
  await sleep(700);
  await mp.screenshot({ path: path.join(OUT, 'mobile.png') });
  const overflow = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  console.log('MOBILE horizontal overflow px:', overflow, overflow > 2 ? '✗' : '✓');
  await mp.close();

  const page = await browser.newPage();
  page.on('pageerror', e => console.log('PAGEERR:', e.message));
  await page.goto('file://' + path.join(ROOT, 'test-pdf.html'), { waitUntil: 'networkidle0' });
  await sleep(700);

  const baseA = Q.map(q => ({ q, a: 'תשובה לדוגמה קצרה.' }));

  await gen(page, { contact: {}, answers: Q.map(q => ({ q, a: '' })), engineering: ENG.map(e => ({ q: e, a: '' })), attachments: [] }, 'empty.pdf');
  await gen(page, { contact: { fullname: 'גיא גורביץ', position: 'מהנדס ביצוע', phone: '050-1234567', email: 'a@b.c' }, answers: baseA, engineering: ENG.map(e => ({ q: e, a: 'תשובה לדוגמה.' })), attachments: [] }, 'noimg.pdf');
  const longA = 'זוהי תשובה ארוכה מאוד שחוזרת על עצמה פעמים רבות כדי לבדוק עטיפת שורות ושבירת עמודים. '.repeat(8);
  await gen(page, { contact: { fullname: 'מועמד עם תשובות ארוכות', position: 'מהנדס', phone: '050', email: 'x@y.z' }, answers: Q.map(q => ({ q, a: longA })), engineering: ENG.map(e => ({ q: e, a: longA })), attachments: [] }, 'long.pdf');
  const atts = []; for (let i = 0; i < 6; i++) atts.push({ label: 'מסמך ' + (i + 1), dataUrl: i % 2 ? CERT : ID });
  await gen(page, { contact: { fullname: 'מועמד', position: 'מהנדס', phone: '050', email: 'a@b.c' }, answers: baseA, engineering: ENG.map(e => ({ q: e, a: 'תשובה.' })), attachments: atts }, 'many.pdf');

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
