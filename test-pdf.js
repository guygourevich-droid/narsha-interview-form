const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();

  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
  page.on('requestfailed', req => console.log('REQ FAIL:', req.url(), req.failure().errorText));

  await page.setViewport({ width: 1200, height: 900 });

  const filePath = 'file://' + path.join(__dirname, 'index.html');
  await page.goto(filePath, { waitUntil: 'networkidle0' });
  await sleep(1500);

  // Fill contact fields
  await page.type('[name="fullname"]', 'גיא גורביץ');
  await page.type('[name="position"]', 'מהנדס ביצוע');
  await page.type('[name="phone"]', '050-1234567');
  await page.type('[name="email"]', 'guy@example.com');

  // Fill answers
  const answers = [
    'בעל ניסיון של 10 שנים בניהול פרויקטי בנייה מורכבים, כולל מגדלי מגורים ומבני ציבור. ניהלתי תקציבים של עשרות מיליוני שקלים וצוותים של 50+ עובדים.',
    'ניהלתי מגוון רחב של פרויקטים: מגורים (כולל כ-200 יחידות דיור ב-3 מגדלים), מבני ציבור, מסחר, ותשתיות.',
    'תפקידי כלל ניהול ישיר של כ-40 עובדים באתר, וכן תיאום עם 8-10 קבלני משנה.',
    'אני משתמש בתוכנות ניהול פרויקטים כמו פרימוורה עם עדכון יומי. כשיש פיגורים אני מזהה את הצוואר בקבוק ומקצה משאבים נוספים.',
    'בפרויקט מגורים גילינו סדקים בעמודי יסוד לאחר יציקה. הפסקתי את העבודה, הזמנתי מהנדס קונסטרוקציה, והחלפנו את העמודים.',
    'אני יוזם מפגשי תיאום עם כל הגורמים המקצועיים ומוודא שאין סתירות לפני ביצוע.',
    'בקרת איכות כוללת: בדיקת תוכניות ברזל, בדיקת קוטר ומרווחים, ובזמן יציקה - בדיקת SLUMP ודגימת קוביות.',
    'בטיחות היא בראש סדר העדיפויות. אני מקפיד על תדריך בטיחות יומי ובודק ציוד מגן אישי.',
    'אני מאמין בתקשורת פתוחה ומוקדמת. מציג עובדות ומנסה למצוא פתרון מקצועי.',
    'ציפיות השכר: 35,000-40,000 ש"ח ברוטו לחודש. זמינות: חודשיים מהיום.',
    'בעוד 3-5 שנים אני רואה את עצמי כמנהל פרויקטים בכיר או סמנכ"ל ביצוע.',
    'אשמח לשמוע על הפרויקטים הקרובים והצוות שאעבוד איתו.'
  ];

  for (let i = 0; i < 12; i++) {
    await page.type(`[name="q${i}"]`, answers[i]);
  }

  await page.type('[name="e0"]', 'ראשית אעצור את היציקה מיד. אבדוק את התוכנית המקורית, אזמין את הקונסטרוקטור, אציב ספייסרים חסרים, ורק לאחר אישור מחודש אאשר את המשך היציקה.');
  await page.type('[name="e1"]', 'הסיכונים: התמוטטות קיר הדיפון, הצפת החפירה. אדרוש בדיקות גיאוטכניות, ניטור תזוזה, ופעולות ראשונות: פינוי עובדים וחיזוק מיידי.');

  await sleep(500);

  // Upload files using new Puppeteer API
  const idInput = await page.$('#file-id');
  await idInput.uploadFile(path.join(__dirname, 'test-assets', 'test-id.png'));
  await sleep(300);

  const certInput = await page.$('#file-cert');
  await certInput.uploadFile(path.join(__dirname, 'test-assets', 'test-cert.png'));
  await sleep(300);

  console.log('Form filled. Generating PDF...');

  // Set download behavior
  const client = await page.target().createCDPSession();
  await client.send('Browser.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: __dirname
  });

  // Click generate button
  await page.click('#btn-share');

  console.log('Waiting for PDF download...');
  await sleep(10000);

  const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.pdf'));
  console.log('PDF files found:', files);

  await browser.close();

  if (files.length === 0) {
    console.error('ERROR: No PDF was generated!');
    process.exit(1);
  }

  const pdfPath = path.join(__dirname, files[files.length - 1]);
  console.log('Analyzing:', pdfPath);
  console.log('File size:', fs.statSync(pdfPath).size, 'bytes');
})();