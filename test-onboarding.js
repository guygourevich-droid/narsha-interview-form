// Headless verification for the employee-onboarding form (/klita/).
// Serves the project root over http (so absolute /vendor + /logo.png resolve),
// drives the real page to smoke-test app.js wiring, then generates a fully
// populated PDF for pixel analysis (run tools/analyze.py on the output).
const puppeteer = require('puppeteer');
const http = require('http');
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.json': 'application/json' };

function serve() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      let file = path.join(ROOT, p);
      // serve index.html for a directory request WITHOUT redirecting to add a
      // trailing slash — this is what `npx serve` does and is what exposed the
      // relative-path bug, so the test must reproduce it.
      if (file.startsWith(ROOT) && fs.existsSync(file) && fs.statSync(file).isDirectory())
        file = path.join(file, 'index.html');
      else if (p.endsWith('/')) file = path.join(ROOT, p, 'index.html');
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); return res.end('nf');
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

function fail(msg) { console.error('✗ ' + msg); process.exitCode = 1; }
function ok(msg) { console.log('✓ ' + msg); }

(async () => {
  const srv = await serve();
  const port = srv.address().port;
  const base = `http://127.0.0.1:${port}`;
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('response', r => {
    if (r.status() >= 400 && !r.url().endsWith('/favicon.ico')) errors.push(r.status() + ' ' + r.url());
  });

  // navigate WITHOUT a trailing slash — the case that broke relative asset paths
  await page.goto(`${base}/klita`, { waitUntil: 'networkidle0' });
  await sleep(800);

  /* ---- Part A: app.js wiring smoke ---- */
  const built = await page.evaluate(() => ({
    depts: document.querySelectorAll('.dept').length,
    items: document.querySelectorAll('.item').length,
    pads: document.querySelectorAll('.sign-pad').length,
    count: document.querySelector('#progress-count').textContent.trim()
  }));
  built.depts === 5 ? ok('5 department cards') : fail('depts=' + built.depts);
  built.items === 53 ? ok('53 checklist items') : fail('items=' + built.items);
  built.pads === 7 ? ok('7 signature pads') : fail('pads=' + built.pads);
  built.count === '0 / 53' ? ok('progress starts 0 / 53') : fail('count=' + built.count);

  // open first dept, mark all items done via its toolbar
  await page.evaluate(() => {
    const card = document.querySelector('.dept');
    card.querySelector('.dept-head').click();
    card.querySelector('[data-all="done"]').click();
  });
  const afterMark = await page.evaluate(() => ({
    count: document.querySelector('#progress-count').textContent.trim(),
    firstDone: document.querySelector('.dept').classList.contains('done'),
    deptCount: document.querySelector('.dept .dept-count').textContent.trim()
  }));
  afterMark.count === '12 / 53' ? ok('marking dept 1 → 12 / 53') : fail('after mark count=' + afterMark.count);
  afterMark.firstDone ? ok('dept 1 flagged done') : fail('dept 1 not flagged done');

  // draw a signature on the first (now-visible) pad via synthetic pointer events
  const signed = await page.evaluate(() => {
    const canvas = document.querySelector('.dept.open .sign-pad');
    const r = canvas.getBoundingClientRect();
    const ev = (type, x, y) => canvas.dispatchEvent(new PointerEvent(type, {
      pointerId: 1, bubbles: true, cancelable: true,
      clientX: r.left + x, clientY: r.top + y }));
    ev('pointerdown', 20, 20);
    for (let i = 1; i <= 10; i++) ev('pointermove', 20 + i * 12, 20 + Math.sin(i) * 15 + 20);
    ev('pointerup', 140, 40);
    const saved = JSON.parse(localStorage.getItem('narsha_onboarding_v1') || '{}');
    const sig = saved.departments && saved.departments.ops && saved.departments.ops.signature;
    return typeof sig === 'string' && sig.startsWith('data:image/png');
  });
  signed ? ok('signature captured + persisted to localStorage') : fail('signature not persisted');

  // persistence across reload
  await page.reload({ waitUntil: 'networkidle0' });
  await sleep(500);
  const restored = await page.evaluate(() =>
    document.querySelector('#progress-count').textContent.trim());
  restored === '12 / 53' ? ok('state restored after reload (12 / 53)') : fail('reload count=' + restored);

  /* ---- draft save → fresh device → load round-trip ---- */
  const draftJson = await page.evaluate(() => localStorage.getItem('narsha_onboarding_v1'));
  const draftPath = path.join(ROOT, 'test-output', 'draft-roundtrip.json');
  fs.mkdirSync(path.dirname(draftPath), { recursive: true });
  fs.writeFileSync(draftPath, draftJson);
  // simulate a different device: wipe local storage
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle0' });
  await sleep(400);
  const wiped = await page.evaluate(() => document.querySelector('#progress-count').textContent.trim());
  wiped === '0 / 53' ? ok('fresh device starts empty (0 / 53)') : fail('after wipe count=' + wiped);
  // load the draft file through the real file input (auto-accept the confirm)
  await page.evaluate(() => { window.confirm = () => true; });
  const input = await page.$('#load-draft');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle0' }),
    input.uploadFile(draftPath)
  ]);
  await sleep(400);
  const afterLoad = await page.evaluate(() => ({
    count: document.querySelector('#progress-count').textContent.trim(),
    sig: (() => { try {
      const s = JSON.parse(localStorage.getItem('narsha_onboarding_v1') || '{}');
      const v = s.departments && s.departments.ops && s.departments.ops.signature;
      return typeof v === 'string' && v.startsWith('data:image/png');
    } catch (e) { return false; } })()
  }));
  afterLoad.count === '12 / 53' ? ok('draft loaded → state restored (12 / 53)') : fail('after load count=' + afterLoad.count);
  afterLoad.sig ? ok('signature survived the draft round-trip') : fail('signature lost in draft round-trip');
  fs.unlinkSync(draftPath);

  /* ---- Part B: full PDF for pixel analysis ---- */
  const res = await page.evaluate(async () => {
    // build a signature PNG in-page
    const sc = document.createElement('canvas'); sc.width = 300; sc.height = 90;
    const sx = sc.getContext('2d');
    sx.strokeStyle = '#12263a'; sx.lineWidth = 3; sx.lineCap = 'round';
    sx.beginPath(); sx.moveTo(15, 60);
    for (let i = 0; i < 280; i += 8) sx.lineTo(15 + i, 45 + Math.sin(i / 18) * 22);
    sx.stroke();
    const sig = sc.toDataURL('image/png');

    const D = window.ONBOARDING;
    const states = [1, 1, 2, 1, 0, 1, 1, 2, 1, 1, 1, 0]; // mixed done / N/A / unmarked
    const data = {
      company: D.company, formTitle: D.formTitle, purpose: D.purpose,
      employeeFields: [
        { label: 'שם העובד', value: 'ישראל ישראלי' },
        { label: 'ת.ז', value: '039123456' },
        { label: 'תפקיד', value: 'מנהל עבודה' },
        { label: 'פרויקט', value: 'מגדלי הנרקיסים – בניין A' },
        { label: 'מנהל ישיר', value: 'דוד כהן' },
        { label: 'תאריך תחילת עבודה', value: '2026-08-01' }
      ],
      departments: D.departments.map((d, di) => ({
        index: di + 1, name: d.name, responsibility: d.responsibility,
        signatureLabel: d.signatureLabel,
        items: d.items.map((t, ii) => ({ text: t, state: states[ii % states.length] })),
        signature: sig, date: '2026-07-13'
      })),
      employeeApproval: {
        title: D.employeeApproval.title, text: D.employeeApproval.text,
        signatureLabel: D.employeeApproval.signatureLabel,
        name: 'ישראל ישראלי', signature: sig, date: '2026-07-13'
      },
      ceoApproval: {
        title: D.ceoApproval.title, checkboxLabel: D.ceoApproval.checkboxLabel,
        signatureLabel: D.ceoApproval.signatureLabel,
        done: true, name: 'משה לוי', role: 'סמנכ"ל ביצוע', signature: sig, date: '2026-07-13'
      }
    };
    const { blob, filename, debug } = await window.generateOnboardingPdf(data);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return { b64: btoa(s), filename, size: blob.size, debug };
  });

  const out = path.join(ROOT, 'test-output', 'onboarding.pdf');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(res.b64, 'base64'));
  ok(`PDF generated: ${res.size} bytes, ${res.debug.pageCount} pages → ${out}`);
  res.debug.signaturesEmbedded === res.debug.signaturesRequested
    ? ok(`all ${res.debug.signaturesRequested} signatures embedded`)
    : fail(`signatures ${res.debug.signaturesEmbedded}/${res.debug.signaturesRequested}`);
  console.log('PAGINATION:');
  for (const p of res.debug.pages) {
    const cnt = {}; p.kinds.forEach(k => cnt[k] = (cnt[k] || 0) + 1);
    console.log(`  page ${p.idx + 1}: ${p.blocks} blocks [${Object.entries(cnt).map(([k, v]) => v + 'x' + k).join(', ')}] fillY=${p.fillY}`);
  }

  if (errors.length) fail('page errors: ' + errors.join(' | '));
  else ok('no page/console errors');

  await browser.close();
  srv.close();
  console.log(process.exitCode ? '\nRESULT: FAIL' : '\nRESULT: PASS');
})().catch(e => { console.error(e); process.exit(1); });
