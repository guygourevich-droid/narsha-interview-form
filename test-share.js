// Verify the mobile native-share path: mock canShare()->true + share() spy,
// generate, confirm the native button appears and share() is called with a PDF File.
const puppeteer = require('puppeteer');
const path = require('path');
const ROOT = __dirname;
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const b = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const p = await b.newPage();
  p.on('pageerror', e => console.log('PAGEERR:', e.message));
  await p.goto('file://' + path.join(ROOT, 'index.html'), { waitUntil: 'networkidle0' });
  await sleep(700);
  await p.type('[name=fullname]', 'גיא גורביץ');
  await p.type('[name=q0]', 'תשובה לדוגמה');

  await p.evaluate(() => {
    window.__shared = null;
    navigator.canShare = () => true;
    navigator.share = (o) => {
      window.__shared = {
        hasFiles: !!(o.files && o.files.length),
        type: o.files && o.files[0] && o.files[0].type,
        name: o.files && o.files[0] && o.files[0].name,
        size: o.files && o.files[0] && o.files[0].size
      };
      return Promise.resolve();
    };
  });

  await p.click('#btn-share');
  await sleep(2500);
  const nativeVisible = await p.evaluate(() => getComputedStyle(document.getElementById('s-native')).display !== 'none');
  await p.click('#s-native');
  await sleep(500);
  const shared = await p.evaluate(() => window.__shared);

  console.log('native button visible:', nativeVisible);
  console.log('navigator.share called with:', JSON.stringify(shared));
  await b.close();
  const ok = nativeVisible && shared && shared.hasFiles && shared.type === 'application/pdf' && shared.size > 30000;
  console.log(ok ? '\nNATIVE SHARE: PASS ✓' : '\nNATIVE SHARE: FAIL ✗');
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
