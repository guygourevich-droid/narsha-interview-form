// End-to-end: drive the real index.html UI — fill, upload, click generate,
// confirm the share overlay opens and a PDF lands on disk, then it gets
// analyzed separately. Also screenshots the form for a visual check.
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const OUT = path.join(ROOT, 'test-output');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const ANSWERS = [
  'בעל ניסיון של 10 שנים בניהול פרויקטי בנייה מורכבים, כולל מגדלי מגורים ומבני ציבור. ניהלתי תקציבים של עשרות מיליוני שקלים וצוותים של 50+ עובדים.',
  'ניהלתי מגוון רחב של פרויקטים: מגורים (כולל כ-200 יחידות דיור ב-3 מגדלים), מבני ציבור, מסחר, ותשתיות.',
  'תפקידי כלל ניהול ישיר של כ-40 עובדים באתר, וכן תיאום עם 8-10 קבלני משנה.',
  'אני משתמש בתוכנות ניהול פרויקטים כמו פרימוורה עם עדכון יומי. כשיש פיגורים אני מזהה את צוואר הבקבוק ומקצה משאבים נוספים.',
  'בפרויקט מגורים גילינו סדקים בעמודי יסוד לאחר יציקה. הפסקתי את העבודה, הזמנתי מהנדס קונסטרוקציה, והחלפנו את העמודים.',
  'אני מזמן מפגשי תיאום עם כל הגורמים המקצועיים ומוודא שאין סתירות לפני הביצוע.',
  'בקרת איכות כוללת: בדיקת תוכניות ברזל, בדיקת קוטר ומרווחים, ובזמן יציקה - בדיקת SLUMP ודגימת קוביות.',
  'בטיחות היא בראש סדר העדיפויות. אני מקפיד על תדריך בטיחות יומי ובודק ציוד מגן אישי.',
  'אני מאמין בתקשורת פתוחה ומוקדמת. מציג עובדות ומנסה למצוא פתרון מקצועי.',
  'ציפיות השכר: 35,000-40,000 ש"ח ברוטו לחודש. זמינות: חודשיים מהיום.',
  'בעוד 3-5 שנים אני רואה את עצמי כמנהל פרויקטים בכיר או סמנכ"ל ביצוע.',
  '',
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  // clean old e2e pdfs
  fs.readdirSync(OUT).filter(f => f.endsWith('.pdf') && f.startsWith('ראיון')).forEach(f => fs.unlinkSync(path.join(OUT, f)));

  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.setViewport({ width: 1200, height: 900 });
  await page.goto('file://' + path.join(ROOT, 'index.html'), { waitUntil: 'networkidle0' });
  await sleep(800);

  await page.type('[name=fullname]', 'גיא גורביץ');
  await page.type('[name=position]', 'מהנדס ביצוע');
  await page.type('[name=phone]', '050-1234567');
  await page.type('[name=email]', 'guy@example.com');
  for (let i = 0; i < 12; i++) if (ANSWERS[i]) await page.type('[name=q' + i + ']', ANSWERS[i]);
  await page.type('[name=e0]', 'ראשית אעצור את היציקה מיד. אבדוק את התוכנית המקורית, אזמין את הקונסטרוקטור, אציב ספייסרים חסרים, ורק לאחר אישור מחודש אאשר את המשך היציקה.');
  await page.type('[name=e1]', 'הסיכונים: התמוטטות קיר הדיפון, הצפת החפירה. אדרוש בדיקות גיאוטכניות, ניטור תזוזה, ופעולות ראשונות: פינוי עובדים וחיזוק מיידי.');
  await (await page.$('#file-id')).uploadFile(path.join(ROOT, 'test-assets', 'test-id.png'));
  await (await page.$('#file-cert')).uploadFile(path.join(ROOT, 'test-assets', 'test-cert.png'));
  await sleep(400);

  await page.screenshot({ path: path.join(OUT, 'form-e2e.png') });

  // force the desktop download branch (headless advertises canShare)
  const client = await page.target().createCDPSession();
  await client.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: OUT });
  await page.evaluate(() => Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true }));

  await page.click('#btn-share');
  await sleep(3000);
  const overlayOpen = await page.evaluate(() => document.getElementById('share-overlay').classList.contains('show'));
  const msgText = await page.evaluate(() => document.getElementById('msg').textContent);

  let file = null;
  for (let i = 0; i < 24; i++) {
    await sleep(400);
    const pdfs = fs.readdirSync(OUT).filter(f => f.endsWith('.pdf') && f.startsWith('ראיון'));
    if (pdfs.length) { file = pdfs[0]; break; }
  }
  const size = file ? fs.statSync(path.join(OUT, file)).size : 0;
  console.log('OVERLAY open:', overlayOpen);
  console.log('MSG:', msgText);
  console.log('PDF:', file, '-', size, 'bytes');
  console.log('JS ERRORS:', errors.length ? errors.join(' | ') : 'none');

  await browser.close();
  if (!overlayOpen || !file || size < 30000 || errors.length) { console.error('E2E: FAIL'); process.exit(1); }
  console.log('E2E: PASS');
})().catch(e => { console.error(e); process.exit(1); });
