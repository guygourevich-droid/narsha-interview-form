// Spike: drive pdf.js headlessly with realistic Hebrew sample data + 2 image
// attachments, save the resulting PDF to test-output/ for pixel analysis.
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const dataUrl = f => 'data:image/png;base64,' + fs.readFileSync(f).toString('base64');

const QUESTIONS = [
  'ספר על עצמך ועל הניסיון המקצועי שלך בפרויקטי בנייה.',
  'אילו סוגי פרויקטים ניהלת? (מגורים / ציבורי / מסחרי / תשתיות / תמ"א וכו\').',
  'מה היה תפקידך בפועל באתר? פרט תחומי אחריות, מספר עובדים וקבלני משנה שניהלת.',
  'כיצד אתה מנהל לוחות זמנים ומטפל בפיגורים?',
  'תאר מקרה של תקלה משמעותית באתר וכיצד פתרת אותה.',
  'כיצד אתה פועל כאשר יש סתירה בין תוכניות אדריכלות, קונסטרוקציה ומערכות?',
  'כיצד אתה מבצע בקרת איכות ליציקות בטון, ברזל וטפסנות?',
  'כיצד אתה מנהל את נושא הבטיחות באתר?',
  'כיצד אתה מתמודד עם עימות מול קבלן משנה או מזמין העבודה?',
  'מהן ציפיות השכר שלך ומה זמינותך לתחילת עבודה?',
  'איפה אתה רואה את עצמך בעוד 3–5 שנים?',
  'האם יש לך שאלות אלינו?',
];
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
  '', // left empty on purpose — exercises the "—" placeholder
];
const ENGINEERING = [
  { q: 'במהלך בדיקת ברזל לפני יציקה גילית כי המרווחים בין המוטות אינם תואמים לתוכנית וחסרים ספייסרים. כיצד תפעל? פרט את סדר הפעולות.', a: 'ראשית אעצור את היציקה מיד. אבדוק את התוכנית המקורית, אזמין את הקונסטרוקטור, אציב ספייסרים חסרים, ורק לאחר אישור מחודש אאשר את המשך היציקה.' },
  { q: 'במהלך חפירה לבניין עם שלושה מרתפים מתגלים מים בקרקע ותזוזות בקיר הדיפון. מהם הסיכונים המיידיים, אילו בדיקות תדרוש ומה יהיו הפעולות הראשונות שלך לפני המשך העבודה?', a: 'הסיכונים: התמוטטות קיר הדיפון, הצפת החפירה. אדרוש בדיקות גיאוטכניות, ניטור תזוזה, ופעולות ראשונות: פינוי עובדים וחיזוק מיידי.' },
];

(async () => {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('PAGE ERROR:', e.message));
  page.on('requestfailed', r => { if (!r.url().includes('fonts.g')) console.log('REQ FAIL:', r.url(), r.failure().errorText); });
  await page.goto('file://' + path.join(ROOT, 'test-pdf.html'), { waitUntil: 'networkidle0' });
  await sleep(900); // fonts settle
  const fontOk = await page.evaluate(async () => {
    try { await document.fonts.load('700 16px Heebo'); await document.fonts.load('400 16px Heebo'); return document.fonts.check('700 16px Heebo') && document.fonts.check('400 16px Heebo'); }
    catch (e) { return 'err:' + e.message; }
  });
  console.log('HEBOO loaded:', fontOk);

  const data = {
    contact: { fullname: 'גיא גורביץ', position: 'מהנדס ביצוע', phone: '050-1234567', email: 'guy@example.com' },
    answers: QUESTIONS.map((q, i) => ({ q, a: ANSWERS[i] })),
    engineering: ENGINEERING,
    attachments: [
      { label: 'תעודת זהות', dataUrl: dataUrl(path.join(ROOT, 'test-assets', 'test-id.png')) },
      { label: 'תעודה רלוונטית', dataUrl: dataUrl(path.join(ROOT, 'test-assets', 'test-cert.png')) },
    ],
  };

  const res = await page.evaluate(async (data) => {
    const { blob, filename, debug } = await window.generateInterviewPdf(data);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return { b64: btoa(s), filename, size: blob.size, debug };
  }, data);

  const out = path.join(ROOT, 'test-output', 'spike.pdf');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(res.b64, 'base64'));
  console.log('WROTE', out, '—', res.size, 'bytes —', res.filename);
  if (res.debug) {
    console.log('PAGINATION (page: blocks, fillY/1123):');
    for (const p of res.debug.pages) {
      const cnt = {};
      p.kinds.forEach(k => cnt[k] = (cnt[k] || 0) + 1);
      console.log(`  page ${p.idx + 1}: ${p.blocks} blocks [${Object.entries(cnt).map(([k, v]) => v + 'x' + k).join(', ')}] fillY=${p.fillY}`);
    }
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
