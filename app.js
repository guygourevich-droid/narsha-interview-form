/* app.js — interview form: render, autosave, uploads, PDF + share flow. */
(function () {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
  const LS_KEY = 'narsha_interview_form_v2';

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

  /* ---- autosave ---- */
  const form = $('#form');
  function saveForm() {
    const data = {};
    $$('input[name],textarea[name]').forEach(el => { data[el.name] = el.value; });
    try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch (e) {}
  }
  function loadForm() {
    try {
      const data = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
      Object.entries(data).forEach(([k, v]) => { const el = $('[name="' + k + '"]'); if (el) el.value = v; });
    } catch (e) {}
  }
  loadForm();
  form.addEventListener('input', saveForm);

  /* ---- uploads ---- */
  const store = { id: [], cert: [] };
  function setupUpload(inputId, key, thumbsId) {
    const input = $('#' + inputId), thumbs = $('#' + thumbsId);
    input.addEventListener('change', e => {
      [...e.target.files].forEach(f => store[key].push(f));
      input.value = '';
      renderThumbs(key, thumbs);
    });
  }
  function renderThumbs(key, thumbs) {
    thumbs.innerHTML = '';
    store[key].forEach((f, idx) => {
      const t = document.createElement('div');
      t.className = 't';
      if (f.type.startsWith('image/')) {
        const img = document.createElement('img');
        img.src = URL.createObjectURL(f);
        t.appendChild(img);
      } else {
        const d = document.createElement('div');
        d.style = 'font-size:11px;color:var(--muted);padding:4px;text-align:center;word-break:break-all';
        d.textContent = '📄 ' + f.name;
        t.appendChild(d);
      }
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.textContent = '×';
      rm.title = 'הסרה';
      rm.onclick = () => { store[key].splice(idx, 1); renderThumbs(key, thumbs); saveForm(); };
      t.appendChild(rm);
      thumbs.appendChild(t);
    });
  }
  setupUpload('file-id', 'id', 'thumbs-id');
  setupUpload('file-cert', 'cert', 'thumbs-cert');

  function fileToDataUrl(f) {
    return new Promise(res => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = () => res(null);
      r.readAsDataURL(f);
    });
  }

  /* ---- collect form data for pdf.js ---- */
  async function collectData() {
    const val = n => ($('[name="' + n + '"]') || {}).value || '';
    const answers = (window.QUESTIONS || []).map((item, i) => ({ q: item.q, a: val('q' + i) }));
    const engineering = (window.ENGINEERING || []).map((item, i) => ({ q: item.q, a: val('e' + i) }));
    const attachments = [];
    for (const f of store.id) {
      if (!f.type.startsWith('image/')) continue;
      const d = await fileToDataUrl(f);
      if (d) attachments.push({ label: 'תעודת זהות', dataUrl: d });
    }
    for (const f of store.cert) {
      if (!f.type.startsWith('image/')) continue;
      const d = await fileToDataUrl(f);
      if (d) attachments.push({ label: 'תעודה רלוונטית', dataUrl: d });
    }
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
      const data = await collectData();
      const result = await window.generateInterviewPdf(data);
      showMsg('ok', 'ה-PDF מוכן לשיתוף.');
      openSharePanel(result);
    } catch (e) {
      console.error(e);
      showMsg('err', 'אירעה שגיאה בהפקת ה-PDF. נסו שוב.');
    } finally {
      setLoading(false);
    }
  });

  /* ---- guard against accidental leave with data ---- */
  window.addEventListener('beforeunload', e => {
    const has = ($('[name=fullname]') || {}).value || $$('textarea').some(t => t.value.trim());
    if (has) { e.preventDefault(); e.returnValue = ''; }
  });
})();
