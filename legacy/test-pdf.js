// End-to-end check for the interview form:
//   1. fills the form + uploads two images
//   2. screenshots the filled form and the #pdf DOM (visual proof)
//   3. calls generatePdfBlob() directly and asserts it returns a valid PDF blob
//   4. clicks the button and confirms a .pdf file is produced (share/download flow)
//
// Run:  node test-images.js && node test-pdf.js
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const OUT = path.join(__dirname, 'test-output');

(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();

  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
  page.on('requestfailed', req => console.log('REQ FAIL:', req.url(), req.failure().errorText));

  await page.setViewport({ width: 1200, height: 900 });
  await page.goto('file://' + path.join(__dirname, 'index.html'), { waitUntil: 'networkidle0' });
  await sleep(1200); // let fonts + question cards render

  // --- fill contact fields ---
  await page.type('[name="fullname"]', 'גיא גורביץ');
  await page.type('[name="position"]', 'מהנדס ביצוע');
  await page.type('[name="phone"]', '050-1234567');
  await page.type('[name="email"]', 'guy@example.com');

  // --- fill the 12 standard + 2 engineering answers ---
  const answers = [
    'בעל ניסיון של 10 שנים בניהול פרויקטי בנייה מורכבים, כולל מגדלי מגורים ומבני ציבור. ניהלתי תקציבים של עשרות מיליוני שקלים וצוותים של 50+ עובדים.',
    'ניהלתי מגוון רחב של פרויקטים: מגורים (כולל כ-200 יחידות דיור ב-3 מגדלים), מבני ציבור, מסחר, ותשתיות.',
    'תפקידי כלל ניהול ישיר של כ-40 עובדים באתר, וכן תיאום עם 8-10 קבלני משנה.',
    'אני משתמש בתוכנות ניהול פרויקטים כמו פרימוורה עם עדכון יומי. כשיש פיגורים אני מזהה את צוואר הבקבוק ומקצה משאבים נוספים.',
    'בפרויקט מגורים גילינו סדקים בעמודי יסוד לאחר יציקה. הפסקתי את העבודה, הזמנתי מהנדס קונסטרוקציה, והחלפנו את העמודים.',
    'אני מוזם מפגשי תיאום עם כל הגורמים המקצועיים ומוודא שאין סתירות לפני ביצוע.',
    'בקרת איכות כוללת: בדיקת תוכניות ברזל, בדיקת קוטר ומרווחים, ובזמן יציקה - בדיקת SLUMP ודגימת קוביות.',
    'בטיחות היא בראש סדר העדיפויות. אני מקפיד על תדריך בטיחות יומי ובודק ציוד מגן אישי.',
    'אני מאמין בתקשורת פתוחה ומוקדמת. מציג עובדות ומנסה למצוא פתרון מקצועי.',
    'ציפיות השכר: 35,000-40,000 ש"ח ברוטו לחודש. זמינות: חודשיים מהיום.',
    'בעוד 3-5 שנים אני רואה את עצמי כמנהל פרויקטים בכיר או סמנכ"ל ביצוע.',
    'אשמח לשמוע על הפרויקטים הקרובים והצוות שאעבוד איתו.',
  ];
  for (let i = 0; i < 12; i++) await page.type(`[name="q${i}"]`, answers[i]);
  await page.type('[name="e0"]', 'ראשית אעצור את היציקה מיד. אבדוק את התוכנית המקורית, אזמין את הקונסטרוקטור, אציב ספייסרים חסרים, ורק לאחר אישור מחודש אאשר את המשך היציקה.');
  await page.type('[name="e1"]', 'הסיכונים: התמוטטות קיר הדיפון, הצפת החפירה. אדרוש בדיקות גיאוטכניות, ניטור תזוזה, ופעולות ראשונות: פינוי עובדים וחיזוק מיידי.');
  await sleep(400);

  // --- upload the two test images ---
  await (await page.$('#file-id')).uploadFile(path.join(__dirname, 'test-assets', 'test-id.png'));
  await sleep(250);
  await (await page.$('#file-cert')).uploadFile(path.join(__dirname, 'test-assets', 'test-cert.png'));
  await sleep(400);

  // --- screenshot the filled form (visual) ---
  await page.screenshot({ path: path.join(OUT, 'form-preview.png') });

  // --- build the PDF DOM and screenshot it (this is exactly what gets rasterized) ---
  await page.evaluate(async () => { const d = await buildPdfDom(); d.classList.add('capturing'); });
  await sleep(700); // let data-URL images paint
  await (await page.$('#pdf')).screenshot({ path: path.join(OUT, 'pdf-preview.png') });
  await page.evaluate(() => document.getElementById('pdf').classList.remove('capturing'));

  // --- call generatePdfBlob() directly, assert a valid PDF blob ---
  const info = await page.evaluate(async () => {
    const { blob, filename } = await generatePdfBlob();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let magic = ''; for (let i = 0; i < 8; i++) magic += String.fromCharCode(bytes[i]);
    return { size: blob.size, filename, magic };
  });
  console.log('BLOB:', JSON.stringify(info));
  const okMagic = info.magic.startsWith('%PDF');
  const okSize = info.size > 15000; // 2 embedded images + full form ⇒ comfortably larger
  console.log(`magic %PDF: ${okMagic ? 'PASS' : 'FAIL'} · size>15KB: ${okSize ? 'PASS' : 'FAIL'}`);

  // --- click the button, confirm the panel opens + a file lands on disk ---
  // Headless Chromium advertises navigator.canShare, so the app (correctly)
  // takes the native-share branch and won't auto-download. Force the desktop
  // branch here to deterministically exercise generatePdfBlob -> openSharePanel
  // -> downloadBlob and assert a real .pdf file is written.
  const client = await page.target().createCDPSession();
  await client.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: OUT });
  await page.evaluate(() => Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true }));
  await page.click('#btn-share');
  await sleep(1500);

  const overlayOpen = await page.evaluate(() =>
    document.getElementById('share-overlay').classList.contains('show'));
  console.log(`OVERLAY open: ${overlayOpen ? 'PASS' : 'FAIL'}`);

  let file = null;
  for (let i = 0; i < 30; i++) {            // poll up to ~15s
    await sleep(500);
    const pdfs = fs.readdirSync(OUT).filter(f => f.endsWith('.pdf'));
    if (pdfs.length) { file = pdfs[pdfs.length - 1]; break; }
  }
  const dlSize = file ? fs.statSync(path.join(OUT, file)).size : 0;
  console.log(`DOWNLOAD: ${file || '(none)'} — ${dlSize} bytes ${file ? '✓' : '✗'}`);

  await browser.close();

  if (!(okMagic && okSize) || !overlayOpen || !file || dlSize < 15000) {
    console.error('\nRESULT: FAIL');
    process.exit(1);
  }
  console.log('\nRESULT: PASS ✓');
})();
