/* app.js — employee-onboarding clearance form: render, tri-state checklist,
   signature pads, autosave, PDF + share flow. Everything stays on-device. */
(function () {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
  const D = window.ONBOARDING;
  const LS_KEY = 'narsha_onboarding_v1';

  /* item states */
  const UNMARKED = 0, DONE = 1, NA = 2;

  function todayISO() {
    const d = new Date(), p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  /* ---- state ---- */
  const state = {
    employee: {},
    departments: {},
    employeeApproval: { name: '', signature: null, date: '' },
    ceoApproval: { done: false, name: '', role: '', signature: null, date: '' }
  };
  D.departments.forEach(d => {
    state.departments[d.id] = { items: d.items.map(() => UNMARKED), signature: null, date: '' };
  });

  let persisted = true;
  function save() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); persisted = true; }
    catch (e) { persisted = false; }
  }
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
      if (s.employee) Object.assign(state.employee, s.employee);
      if (s.employeeApproval) Object.assign(state.employeeApproval, s.employeeApproval);
      if (s.ceoApproval) Object.assign(state.ceoApproval, s.ceoApproval);
      if (s.departments) {
        D.departments.forEach(d => {
          const sd = s.departments[d.id];
          if (!sd) return;
          const cur = state.departments[d.id];
          if (Array.isArray(sd.items))
            d.items.forEach((_, i) => { if (sd.items[i] != null) cur.items[i] = sd.items[i]; });
          if (typeof sd.signature === 'string') cur.signature = sd.signature;
          if (typeof sd.date === 'string') cur.date = sd.date;
        });
      }
    } catch (e) {}
  }

  /* ---- signature pad (mouse + touch, DPR-aware, restore-safe) ---- */
  const pads = [];
  function SignaturePad(wrap, onEnd) {
    const canvas = $('.sign-pad', wrap);
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let drawing = false, hasInk = false, pending = null;

    function setup() {
      ctx.lineWidth = 2.2 * dpr; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.strokeStyle = '#12263a';
    }
    function drawURL(url) {
      const img = new Image();
      img.onload = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        hasInk = true; pending = null; wrap.classList.add('signed');
      };
      img.src = url;
    }
    function size() {
      const cssW = canvas.clientWidth;
      if (!cssW) return false;                       // hidden (collapsed) → defer
      const cssH = canvas.clientHeight || 140;
      const w = Math.round(cssW * dpr), h = Math.round(cssH * dpr);
      if (canvas.width === w && canvas.height === h) return true;
      const prev = hasInk ? canvas.toDataURL('image/png') : pending;
      canvas.width = w; canvas.height = h;           // resizing clears the canvas
      setup();
      if (prev) drawURL(prev);
      return true;
    }
    function point(e) {
      const r = canvas.getBoundingClientRect();
      return { x: (e.clientX - r.left) * (canvas.width / r.width),
               y: (e.clientY - r.top) * (canvas.height / r.height) };
    }
    canvas.addEventListener('pointerdown', e => {
      if (!size()) return;
      drawing = true;
      try { canvas.setPointerCapture(e.pointerId); } catch (x) {}
      const p = point(e); ctx.beginPath(); ctx.moveTo(p.x, p.y);
      e.preventDefault();
    });
    canvas.addEventListener('pointermove', e => {
      if (!drawing) return;
      const p = point(e); ctx.lineTo(p.x, p.y); ctx.stroke();
      hasInk = true; wrap.classList.add('signed');
      e.preventDefault();
    });
    function end() { if (!drawing) return; drawing = false; onEnd && onEnd(); }
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);

    const api = {
      refresh() { size(); },
      clear() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        hasInk = false; pending = null; wrap.classList.remove('signed');
        onEnd && onEnd();
      },
      getDataURL() { return hasInk ? canvas.toDataURL('image/png') : null; },
      setSaved(url) {
        if (!url) return;
        if (size()) drawURL(url);
        else { pending = url; wrap.classList.add('signed'); }
      }
    };
    pads.push(api);
    return api;
  }

  function signatureBlockHTML(label, dateVal) {
    return '<div class="sign-block">' +
      '<span class="sign-label">' + label + '</span>' +
      '<div class="sign-pad-wrap"><canvas class="sign-pad"></canvas>' +
      '<div class="sign-placeholder">חתמו כאן באצבע או בעכבר</div></div>' +
      '<div class="sign-actions">' +
        '<button type="button" class="sign-clear">🗑 ניקוי חתימה</button>' +
        '<div class="sign-date"><label>תאריך:</label>' +
          '<input type="date" class="sign-date-input" value="' + (dateVal || '') + '"></div>' +
      '</div></div>';
  }

  /* ---- progress ---- */
  function deptHandled(id) {
    return state.departments[id].items.filter(v => v !== UNMARKED).length;
  }
  function updateProgress() {
    let handled = 0, total = 0;
    D.departments.forEach(d => {
      const done = deptHandled(d.id), tot = d.items.length;
      handled += done; total += tot;
      const card = $('#dept-' + d.id);
      if (card) {
        const complete = done === tot;
        card.classList.toggle('done', complete);
        $('.dept-count', card).textContent = done + ' / ' + tot;
        $('.dept-status', card).textContent = complete ? '✓' : done;
      }
    });
    $('#progress-count').textContent = handled + ' / ' + total;
    $('#progress-fill').style.width = (total ? (handled / total) * 100 : 0) + '%';
    $('#progress-bar').classList.toggle('complete', handled === total);
  }

  /* ---- render: employee fields ---- */
  const empWrap = $('#employee-fields');
  D.employeeFields.forEach(f => {
    const q = document.createElement('div');
    q.className = 'q';
    const type = f.type === 'date' ? 'date' : 'text';
    q.innerHTML = '<label></label><input type="' + type + '" data-emp="' + f.key + '">';
    $('label', q).textContent = f.label;
    empWrap.appendChild(q);
    const input = $('input', q);
    input.value = state.employee[f.key] || '';
    input.addEventListener('input', () => { state.employee[f.key] = input.value; save(); });
  });
  $('#purpose-text').textContent = D.purpose;

  /* ---- render: department cards ---- */
  const deptsWrap = $('#departments');
  D.departments.forEach((d, di) => {
    const card = document.createElement('div');
    card.className = 'dept';
    card.id = 'dept-' + d.id;

    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'dept-head';
    head.innerHTML =
      '<span class="dept-status">0</span>' +
      '<span class="dept-titles"><span class="dept-name"></span>' +
        '<span class="dept-resp"></span></span>' +
      '<span class="dept-count">0 / ' + d.items.length + '</span>' +
      '<span class="dept-chevron">▼</span>';
    $('.dept-name', head).textContent = (di + 1) + '. ' + d.name;
    $('.dept-resp', head).textContent = d.responsibility;
    head.addEventListener('click', () => {
      card.classList.toggle('open');
      if (card.classList.contains('open')) pads.forEach(p => p.refresh());
    });
    card.appendChild(head);

    const body = document.createElement('div');
    body.className = 'dept-body';

    const tools = document.createElement('div');
    tools.className = 'dept-tools';
    tools.innerHTML =
      '<button type="button" class="tool-btn" data-all="done">✓ סמן הכל כבוצע</button>' +
      '<button type="button" class="tool-btn" data-all="clear">נקה סימונים</button>';
    body.appendChild(tools);

    const cur = state.departments[d.id];
    d.items.forEach((text, ii) => {
      const row = document.createElement('div');
      row.className = 'item';
      row.innerHTML =
        '<span class="item-text"></span>' +
        '<span class="seg">' +
          '<button type="button" class="seg-done">✓ בוצע</button>' +
          '<button type="button" class="seg-na">לא רלוונטי</button>' +
        '</span>';
      $('.item-text', row).textContent = text;
      const segDone = $('.seg-done', row), segNa = $('.seg-na', row);
      function apply() {
        const v = cur.items[ii];
        row.classList.toggle('done', v === DONE);
        row.classList.toggle('na', v === NA);
        segDone.classList.toggle('active', v === DONE);
        segNa.classList.toggle('active', v === NA);
      }
      function set(target) {
        cur.items[ii] = (cur.items[ii] === target) ? UNMARKED : target;
        apply(); updateProgress(); save();
      }
      segDone.addEventListener('click', () => set(DONE));
      segNa.addEventListener('click', () => set(NA));
      apply();
      body.appendChild(row);
    });

    tools.querySelector('[data-all="done"]').addEventListener('click', () => {
      cur.items = cur.items.map(() => DONE);
      $$('.item', body).forEach((row, ii) => {
        row.classList.add('done'); row.classList.remove('na');
        $('.seg-done', row).classList.add('active');
        $('.seg-na', row).classList.remove('active');
      });
      updateProgress(); save();
    });
    tools.querySelector('[data-all="clear"]').addEventListener('click', () => {
      cur.items = cur.items.map(() => UNMARKED);
      $$('.item', body).forEach(row => {
        row.classList.remove('done', 'na');
        $('.seg-done', row).classList.remove('active');
        $('.seg-na', row).classList.remove('active');
      });
      updateProgress(); save();
    });

    // department signature
    const signWrap = document.createElement('div');
    signWrap.innerHTML = signatureBlockHTML(d.signatureLabel, cur.date);
    body.appendChild(signWrap);
    wireSignature($('.sign-pad-wrap', signWrap), $('.sign-clear', signWrap),
      $('.sign-date-input', signWrap), cur, 'signature', 'date');

    card.appendChild(body);
    deptsWrap.appendChild(card);
  });

  /* wire a signature pad + clear + date input to a state object's fields */
  function wireSignature(wrapEl, clearBtn, dateInput, obj, sigKey, dateKey) {
    const pad = SignaturePad(wrapEl, () => {
      obj[sigKey] = pad.getDataURL();
      if (obj[sigKey] && !dateInput.value) { dateInput.value = todayISO(); obj[dateKey] = dateInput.value; }
      save();
    });
    if (obj[sigKey]) pad.setSaved(obj[sigKey]);
    clearBtn.addEventListener('click', () => pad.clear());
    dateInput.addEventListener('input', () => { obj[dateKey] = dateInput.value; save(); });
    return pad;
  }

  /* ---- render: employee approval ---- */
  (function () {
    const a = D.employeeApproval, s = state.employeeApproval;
    const card = $('#employee-approval');
    card.innerHTML =
      '<div class="approval-title"><span class="num">✍️</span>' + a.title + '</div>' +
      '<p class="approval-text"></p>' +
      '<div class="approval-fields"><div class="q"><label>שם העובד</label>' +
        '<input type="text" id="emp-appr-name"></div></div>';
    $('.approval-text', card).textContent = a.text;
    const nameInput = $('#emp-appr-name', card);
    nameInput.value = s.name || '';
    nameInput.addEventListener('input', () => { s.name = nameInput.value; save(); });
    const signWrap = document.createElement('div');
    signWrap.innerHTML = signatureBlockHTML(a.signatureLabel, s.date);
    card.appendChild(signWrap);
    wireSignature($('.sign-pad-wrap', signWrap), $('.sign-clear', signWrap),
      $('.sign-date-input', signWrap), s, 'signature', 'date');
  })();

  /* ---- render: CEO approval ---- */
  (function () {
    const a = D.ceoApproval, s = state.ceoApproval;
    const card = $('#ceo-approval');
    card.innerHTML =
      '<div class="approval-title"><span class="num">🏛️</span>' + a.title + '</div>' +
      '<div class="check-row"><button type="button" class="check-box" id="ceo-check"></button>' +
        '<span class="check-label">' + a.checkboxLabel + '</span></div>' +
      '<div class="approval-fields">' +
        '<div class="q"><label>שם המאשר</label><input type="text" id="ceo-name"></div>' +
        '<div class="q"><label>תפקיד</label><input type="text" id="ceo-role"></div>' +
      '</div>';
    const box = $('#ceo-check', card);
    function paintBox() { box.classList.toggle('checked', !!s.done); box.textContent = s.done ? '✓' : ''; }
    box.addEventListener('click', () => { s.done = !s.done; paintBox(); save(); });
    paintBox();
    const nameInput = $('#ceo-name', card), roleInput = $('#ceo-role', card);
    nameInput.value = s.name || ''; roleInput.value = s.role || '';
    nameInput.addEventListener('input', () => { s.name = nameInput.value; save(); });
    roleInput.addEventListener('input', () => { s.role = roleInput.value; save(); });
    const signWrap = document.createElement('div');
    signWrap.innerHTML = signatureBlockHTML(a.signatureLabel, s.date);
    card.appendChild(signWrap);
    wireSignature($('.sign-pad-wrap', signWrap), $('.sign-clear', signWrap),
      $('.sign-date-input', signWrap), s, 'signature', 'date');
  })();

  /* ---- load saved state into the freshly-built DOM ---- */
  load();
  // re-apply employee + approval inputs (built before load ran on first paint)
  $$('[data-emp]').forEach(i => { i.value = state.employee[i.dataset.emp] || ''; });
  updateProgress();
  window.addEventListener('resize', () => pads.forEach(p => p.refresh()));

  /* ---- collect for pdf.js ---- */
  function collectData() {
    return {
      company: D.company,
      formTitle: D.formTitle,
      purpose: D.purpose,
      employeeFields: D.employeeFields.map(f => ({ label: f.label, value: state.employee[f.key] || '' })),
      departments: D.departments.map((d, di) => {
        const cur = state.departments[d.id];
        return {
          index: di + 1,
          name: d.name,
          responsibility: d.responsibility,
          signatureLabel: d.signatureLabel,
          items: d.items.map((text, ii) => ({ text, state: cur.items[ii] })),
          signature: cur.signature,
          date: cur.date
        };
      }),
      employeeApproval: {
        title: D.employeeApproval.title, text: D.employeeApproval.text,
        signatureLabel: D.employeeApproval.signatureLabel,
        name: state.employeeApproval.name, signature: state.employeeApproval.signature,
        date: state.employeeApproval.date
      },
      ceoApproval: {
        title: D.ceoApproval.title, checkboxLabel: D.ceoApproval.checkboxLabel,
        signatureLabel: D.ceoApproval.signatureLabel,
        done: state.ceoApproval.done, name: state.ceoApproval.name,
        role: state.ceoApproval.role, signature: state.ceoApproval.signature,
        date: state.ceoApproval.date
      }
    };
  }

  /* ---- messages ---- */
  function showMsg(type, text) {
    const m = $('#msg');
    m.className = 'msg ' + type; m.textContent = text;
    m.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  /* ---- share overlay (same pattern as the interview form) ---- */
  const overlay = $('#share-overlay');
  const sNative = $('#s-native'), sDownload = $('#s-download'), shareHint = $('#share-hint');
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
      sNative.style.display = 'flex'; sNative._file = file;
      shareHint.textContent = 'לחצו על "שיתוף דרך הטלפון" כדי לבחור WhatsApp / אימייל / SMS ועוד.';
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
      await navigator.share({ files: [sNative._file], title: 'טופס קליטת עובד', text: 'מצורף טופס קליטת עובד חדש בקובץ PDF' });
      closeSharePanel(); showMsg('ok', 'הטופס שותף בהצלחה!');
    } catch (e) { if (e.name !== 'AbortError') console.error(e); }
  });
  sDownload.addEventListener('click', () => { if (lastPdf) downloadBlob(lastPdf.blob, lastPdf.filename); });
  $('#s-whatsapp').addEventListener('click', () => {
    const name = state.employee.name || '';
    const text = encodeURIComponent('שלום, מצורף טופס קליטת עובד' + (name ? ' של ' + name : '') + '.\n(יש לצרף את קובץ ה-PDF שהורד)');
    window.open('https://wa.me/?text=' + text, '_blank');
  });
  $('#s-email').addEventListener('click', () => {
    const name = state.employee.name || '';
    const subject = encodeURIComponent('טופס קליטת עובד' + (name ? ' – ' + name : ''));
    const body = encodeURIComponent('שלום,\n\nמצורף טופס קליטת עובד חדש' + (name ? ' של ' + name : '') +
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
      btn.innerHTML = btn.dataset.orig || btn.innerHTML; btn.disabled = false;
    }
  }
  btn.addEventListener('click', async () => {
    setLoading(true);
    showMsg('ok', 'מכין קובץ PDF…');
    try {
      const result = await window.generateOnboardingPdf(collectData());
      showMsg('ok', 'ה-PDF מוכן לשיתוף.');
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
    if (persisted) return;
    e.preventDefault(); e.returnValue = '';
  });
})();
