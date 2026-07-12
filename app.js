/* app.js — interview form: render, autosave, uploads, PDF + share flow. */
(function () {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
  const LS_KEY = 'narsha_interview_form_v2';
  const LS_ATT = 'narsha_interview_form_v2_att';

  /* ---- render question cards ---- */
  const qWrap = $('#questions');
  (window.QUESTIONS || []).forEach((item, i) => {
    const c = document.createElement('div');
    c.className = 'card';
    c.innerHTML = '<h2><span class="num">' + (i + 1) + '</span></h2>' +
      '<div class="q"><textarea name="q' + i + '" placeholder="הקלידו את התשובה כאן…"></textarea></div>';
    c.querySelector('.num').after(document.createTextNode(' ' + item.q));
    qWrap.appendChild(c);
  });

  if ((window.ENGINEERING || []).length) {
    const title = document.createElement('div');
    title.className = 'section-title';
    title.textContent = 'שאלות הנדסיות';
    qWrap.appendChild(title);
    window.ENGINEERING.forEach((item, i) => {
      const c = document.createElement('div');
      c.className = 'card';
      c.innerHTML = '<h2><span class="num">' + (window.QUESTIONS.length + i + 1) + '</span> שאלה הנדסית</h2>' +
        '<div class="scenario"></div>' +
        '<div class="q"><textarea name="e' + i + '" placeholder="הקלידו את התשובה כאן…"></textarea></div>';
      c.querySelector('.scenario').textContent = item.q;
      qWrap.appendChild(c);
    });
  }

  /* ---- autosave (text fields) ---- */
  const form = $('#form');
  let textPersisted = true;
  function saveForm() {
    const data = {};
    $$('input[name],textarea[name]').forEach(el => { data[el.name] = el.value; });
    try { localStorage.setItem(LS_KEY, JSON.stringify(data)); textPersisted = true; }
    catch (e) { textPersisted = false; }
  }
  function loadForm() {
    try {
      const data = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
      Object.entries(data).forEach(([k, v]) => { const el = $('[name="' + k + '"]'); if (el) el.value = v; });
    } catch (e) {}
  }
  loadForm();
  form.addEventListener('input', saveForm);

  /* ---- uploads ----
     Every picked file is validated + decoded + re-encoded to a bounded JPEG
     data URL at pick time. This surfaces unsupported files (HEIC on
     Chrome/Android, PDFs, corrupt files) immediately instead of silently
     dropping them from the generated PDF, keeps memory bounded, and makes
     attachments small enough to persist in localStorage. */
  const store = { id: [], cert: [] };   // items: { name, dataUrl }
  const MAX_DIM = 1600, JPEG_Q = 0.82;
  let attachmentsPersisted = true;

  function fileToDataUrl(f) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = () => rej(new Error('read'));
      r.readAsDataURL(f);
    });
  }
  function decodeImage(src) {
    return new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => rej(new Error('decode'));
      im.src = src;
    });
  }
  async function processImageFile(f) {
    if (!f.type.startsWith('image/')) { const e = new Error('type'); e.code = 'type'; throw e; }
    const img = await decodeImage(await fileToDataUrl(f));
    const scale = Math.min(1, MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const cx = c.getContext('2d');
    cx.fillStyle = '#fff'; cx.fillRect(0, 0, w, h);   // JPEG has no alpha
    cx.drawImage(img, 0, 0, w, h);
    return { name: f.name, dataUrl: c.toDataURL('image/jpeg', JPEG_Q) };
  }

  function saveAttachments() {
    try {
      localStorage.setItem(LS_ATT, JSON.stringify(store));
      attachmentsPersisted = true;
    } catch (e) {
      // quota exceeded — attachments live in memory only for this visit
      attachmentsPersisted = false;
      try { localStorage.removeItem(LS_ATT); } catch (e2) {}
    }
  }
  function loadAttachments() {
    try {
      const saved = JSON.parse(localStorage.getItem(LS_ATT) || '{}');
      ['id', 'cert'].forEach(k => {
        if (Array.isArray(saved[k])) {
          store[k] = saved[k].filter(it => it && typeof it.dataUrl === 'string' &&
            it.dataUrl.startsWith('data:image/'));
        }
      });
    } catch (e) {}
  }

  function uploadError(key, text) {
    const el = $('#err-' + key);
    if (!el) return;
    el.textContent = text;
    el.style.display = text ? 'block' : 'none';
  }
  function renderThumbs(key) {
    const thumbs = $('#thumbs-' + key);
    thumbs.innerHTML = '';
    store[key].forEach((item, idx) => {
      const t = document.createElement('div');
      t.className = 't';
      const img = document.createElement('img');
      img.src = item.dataUrl;
      img.alt = item.name || 'קובץ מצורף';
      t.appendChild(img);
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.textContent = '×';
      rm.title = 'הסרה';
      rm.setAttribute('aria-label', 'הסרת ' + (item.name || 'הקובץ'));
      rm.onclick = () => { store[key].splice(idx, 1); renderThumbs(key); saveAttachments(); };
      t.appendChild(rm);
      thumbs.appendChild(t);
    });
  }
  function setupUpload(inputId, key) {
    const input = $('#' + inputId);
    input.addEventListener('change', async e => {
      const files = [...e.target.files];
      input.value = '';
      uploadError(key, '');
      const failed = [];
      for (const f of files) {
        try { store[key].push(await processImageFile(f)); }
        catch (err) { failed.push({ f, err }); }
      }
      renderThumbs(key);
      saveAttachments();
      if (failed.length) {
        const names = failed.map(x => x.f.name).join(', ');
        const anyPdf = failed.some(x => x.f.type === 'application/pdf' || /\.pdf$/i.test(x.f.name));
        uploadError(key, anyPdf
          ? 'לא ניתן לצרף קובץ PDF (' + names + '). נא לצלם את המסמך או לצרף תמונה (JPG / PNG).'
          : 'לא ניתן לקרוא את הקובץ: ' + names + '. נא לצרף תמונה בפורמט JPG או PNG.');
      }
    });
  }
  loadAttachments();
  renderThumbs('id');
  renderThumbs('cert');
  setupUpload('file-id', 'id');
  setupUpload('file-cert', 'cert');

  /* ---- collect form data for pdf.js ---- */
  function collectData() {
    const val = n => ($('[name="' + n + '"]') || {}).value || '';
    const answers = (window.QUESTIONS || []).map((item, i) => ({ q: item.q, a: val('q' + i) }));
    const engineering = (window.ENGINEERING || []).map((item, i) => ({ q: item.q, a: val('e' + i) }));
    const attachments = [
      ...store.id.map(it => ({ label: 'תעודת זהות', dataUrl: it.dataUrl })),
      ...store.cert.map(it => ({ label: 'תעודה רלוונטית', dataUrl: it.dataUrl }))
    ];
    return {
      contact: { fullname: val('fullname'), position: val('position'), phone: val('phone'), email: val('email') },
      answers, engineering, attachments
    };
  }

  /* ---- messages ---- */
  function showMsg(type, text) {
    const m = $('#msg');
    m.className = 'msg ' + type;
    m.textContent = text;
    m.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  /* ---- share overlay ---- */
  const overlay = $('#share-overlay');
  const sNative = $('#s-native'), sDownload = $('#s-download');
  const shareHint = $('#share-hint');
  let lastPdf = null;

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.rel = 'noopener';
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
  }
  function openSharePanel(result) {
    lastPdf = result;
    const file = new File([result.blob], result.filename, { type: 'application/pdf' });
    const canShareFile = !!(navigator.canShare && navigator.canShare({ files: [file] }));
    if (canShareFile) {
      sNative.style.display = 'flex';
      sNative._file = file;
      shareHint.textContent = 'לחצו על "שיתוף דרך הטלפון" כדי לפתוח את התפריט ולבחור WhatsApp / אימייל / SMS ועוד.';
    } else {
      sNative.style.display = 'none';
      downloadBlob(result.blob, result.filename);
      shareHint.textContent = 'הקובץ הורד למכשיר. פתחו את WhatsApp או האימייל וצרפו אותו ידנית.';
    }
    overlay.classList.add('show');
  }
  function closeSharePanel() { overlay.classList.remove('show'); }

  $('#share-close').addEventListener('click', closeSharePanel);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeSharePanel(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && overlay.classList.contains('show')) closeSharePanel();
  });

  sNative.addEventListener('click', async () => {
    if (!sNative._file) return;
    try {
      await navigator.share({ files: [sNative._file], title: 'טופס ראיון עבודה', text: 'מצורף טופס ראיון עבודה בקובץ PDF' });
      closeSharePanel();
      showMsg('ok', 'הטופס שותף בהצלחה!');
    } catch (e) { if (e.name !== 'AbortError') console.error(e); }
  });
  sDownload.addEventListener('click', () => { if (lastPdf) downloadBlob(lastPdf.blob, lastPdf.filename); });
  $('#s-whatsapp').addEventListener('click', () => {
    const name = ($('[name=fullname]') || {}).value || '';
    const text = encodeURIComponent('שלום, מצורף טופס ראיון עבודה' + (name ? ' של ' + name : '') + '.\n(יש לצרף את קובץ ה-PDF שהורד)');
    window.open('https://wa.me/?text=' + text, '_blank');
  });
  $('#s-email').addEventListener('click', () => {
    const name = ($('[name=fullname]') || {}).value || '';
    const subject = encodeURIComponent('טופס ראיון עבודה' + (name ? ' – ' + name : ''));
    const body = encodeURIComponent('שלום,\n\nמצורף טופס ראיון עבודה' + (name ? ' של ' + name : '') +
      ' בקובץ PDF.\n\n(יש לצרף את קובץ ה-PDF שהורד)');
    window.location.href = 'mailto:?subject=' + subject + '&body=' + body;
  });

  /* ---- generate button ---- */
  const btn = $('#btn-share');
  function setLoading(loading) {
    if (loading) {
      btn.dataset.orig = btn.innerHTML;
      btn.innerHTML = '<span class="spinner"></span> מכין קובץ PDF…';
      btn.disabled = true;
    } else {
      btn.innerHTML = btn.dataset.orig || btn.innerHTML;
      btn.disabled = false;
    }
  }
  btn.addEventListener('click', async () => {
    setLoading(true);
    showMsg('ok', 'מכין קובץ PDF…');
    try {
      const data = collectData();
      const result = await window.generateInterviewPdf(data);
      const d = result.debug || {};
      if (d.imagesRequested != null && d.imagesEmbedded < d.imagesRequested) {
        showMsg('err', 'שימו לב: ' + (d.imagesRequested - d.imagesEmbedded) +
          ' מהתמונות שצורפו לא נכללו ב-PDF. בדקו את הקבצים ונסו שוב.');
      } else {
        showMsg('ok', 'ה-PDF מוכן לשיתוף.');
      }
      openSharePanel(result);
    } catch (e) {
      console.error(e);
      showMsg('err', 'אירעה שגיאה בהפקת ה-PDF. נסו שוב.');
    } finally {
      setLoading(false);
    }
  });

  /* ---- leave guard: only when something failed to persist ---- */
  window.addEventListener('beforeunload', e => {
    if (textPersisted && attachmentsPersisted) return;
    const has = ($('[name=fullname]') || {}).value || $$('textarea').some(t => t.value.trim()) ||
      store.id.length || store.cert.length;
    if (has) { e.preventDefault(); e.returnValue = ''; }
  });
})();
