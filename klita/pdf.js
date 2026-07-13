/* =====================================================================
   pdf.js — deterministic, canvas-rendered PDF generator for the Hebrew
   (RTL) employee-onboarding clearance form ("טופס טיולים נכנס").

   Same approach as the interview form: draw the whole document with
   Canvas 2D (the browser renders Hebrew bidi/shaping perfectly via
   ctx.direction='rtl'), paginate explicitly with measured "blocks" so
   nothing is ever clipped, then place each finished page into a jsPDF A4
   document as a crisp (2x) image. No html2canvas / html2pdf.

   Every block MUST fit within MAXBLK (one page of content). The only
   variable-height blocks here (purpose text, checklist rows) wrap short
   fixed copy and never approach a page, so no splitting logic is needed —
   but the item measurer still clamps, keeping the invariant explicit.

   Exposes: window.generateOnboardingPdf(data) -> Promise<{blob, filename, debug}>
   data shape is produced by app.js collectData().
   Item states: 0 = לא סומן, 1 = בוצע, 2 = לא רלוונטי.
   ===================================================================== */
(function () {
  'use strict';

  /* ---- geometry (CSS px; A4 @96dpi = 794x1123) ---- */
  const SCALE = 2;
  const PAGE_W = 794, PAGE_H = 1123;
  const M = 48, MT = 42, MB = 52;
  const CW2 = PAGE_W - M * 2;
  const BOTTOM = PAGE_H - MB;

  const C = {
    brand: '#1f3a5f', brand2: '#2f6fb0', accent: '#e8a33d',
    ink: '#1c2733', muted: '#5c6b7a', line: '#e6ebf1',
    boxBg: '#f4f8fc', boxBorder: '#dbe6f0',
    ok: '#1f8a54', okBg: '#e7f6ee', okLine: '#b7e4c9',
    na: '#8a6d1f', naBg: '#fbf3e0', naLine: '#ecd9a8',
    footer: '#9aa7b4'
  };
  const F = {
    title: '800 20px Heebo, Arial',
    subtitle: '400 12.5px Heebo, Arial',
    section: '800 16px Heebo, Arial',
    resp: '400 11.5px Heebo, Arial',
    item: '400 13px Heebo, Arial',
    status: '700 11px Heebo, Arial',
    cellLabel: '700 11.5px Heebo, Arial',
    cellVal: '500 13px Heebo, Arial',
    q: '700 13.5px Heebo, Arial',
    a: '400 13px Heebo, Arial',
    date: '600 11.5px Heebo, Arial',
    footer: '400 10px Heebo, Arial'
  };

  const STATUS_W = 104, STATUS_GAP = 14;   // left column reserved for the state chip

  /* ---- helpers ---- */
  function breakLongWord(ctx, word, maxW) {
    const parts = []; let cur = '';
    for (const ch of word) {
      if (cur && ctx.measureText(cur + ch).width > maxW) { parts.push(cur); cur = ch; }
      else cur += ch;
    }
    if (cur) parts.push(cur);
    return parts.length ? parts : [word];
  }
  function wrap(ctx, text, maxW, font) {
    ctx.font = font;
    const rawWords = String(text == null ? '' : text).trim().split(/\s+/);
    if (!rawWords.length || rawWords[0] === '') return [''];
    const words = [];
    for (const w of rawWords) {
      if (ctx.measureText(w).width > maxW) words.push(...breakLongWord(ctx, w, maxW));
      else words.push(w);
    }
    const lines = []; let line = words[0];
    for (let i = 1; i < words.length; i++) {
      const t = line + ' ' + words[i];
      if (ctx.measureText(t).width <= maxW) line = t;
      else { lines.push(line); line = words[i]; }
    }
    lines.push(line);
    return lines;
  }
  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function fmtDate(iso) {
    if (!iso) return '';
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    return m ? m[3] + '/' + m[2] + '/' + m[1] : iso;
  }
  function loadSig(url) {
    if (!url || typeof url !== 'string' || !url.startsWith('data:image/')) return Promise.resolve(null);
    return new Promise(res => {
      const im = new Image();
      im.onload = () => res({ img: im, w: im.naturalWidth, h: im.naturalHeight });
      im.onerror = () => res(null);
      im.src = url;
    });
  }

  const HEADER_H = 104;
  const MAXBLK = BOTTOM - MT;

  /* ---- shared: signature area drawer (used by dept + approval blocks) ---- */
  const SIG_BOX_W = 250, SIG_BOX_H = 56;
  function sigAreaHeight() { return 22 + SIG_BOX_H + 10; }
  function drawSigArea(ctx, y, label, sig, dateIso) {
    const rightX = PAGE_W - M;
    ctx.textAlign = 'right'; ctx.textBaseline = 'top';
    ctx.fillStyle = C.brand; ctx.font = F.q;
    ctx.fillText(label + ':', rightX, y);
    const boxY = y + 22, boxX = rightX - SIG_BOX_W;
    if (sig) {
      const s = Math.min(SIG_BOX_W / sig.w, SIG_BOX_H / sig.h);
      const dw = sig.w * s, dh = sig.h * s;
      ctx.drawImage(sig.img, rightX - SIG_BOX_W + (SIG_BOX_W - dw) / 2, boxY + (SIG_BOX_H - dh) / 2, dw, dh);
    }
    ctx.strokeStyle = C.line; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(boxX, boxY + SIG_BOX_H); ctx.lineTo(rightX, boxY + SIG_BOX_H); ctx.stroke();
    // date on the left
    ctx.textAlign = 'left';
    ctx.fillStyle = C.muted; ctx.font = F.date;
    ctx.fillText('תאריך: ' + (fmtDate(dateIso) || '—'), M, boxY + SIG_BOX_H - 14);
    ctx.textAlign = 'right';
  }

  /* ---- block measurers ---- */
  function mHeader(today, company) { return { kind: 'header', today, company, h: HEADER_H + 18 }; }

  function mEmpBox(ctx, fields) {
    const colW = CW2 / 2, padX = 16, availW = colW - padX * 2;
    const cells = fields.map(f => ({
      label: f.label,
      lines: wrap(ctx, (f.value && String(f.value).trim()) ? f.value : '—', availW, F.cellVal)
    }));
    const nRows = Math.ceil(cells.length / 2);
    const rowHs = [];
    for (let r = 0; r < nRows; r++) {
      const a = cells[r * 2], b = cells[r * 2 + 1];
      rowHs.push(15 + Math.max(a ? a.lines.length : 1, b ? b.lines.length : 1) * 17 + 14);
    }
    const boxH = 16 + rowHs.reduce((s, v) => s + v, 0) + 8;
    return { kind: 'empbox', cells, rowHs, boxH, h: boxH + 16 };
  }

  function mPurpose(ctx, text) {
    const padX = 14;
    const lines = wrap(ctx, text, CW2 - padX * 2, F.a);
    const boxH = 14 + lines.length * 18 + 14;
    return { kind: 'purpose', lines, boxH, h: boxH + 14 };
  }

  function mDeptHeader(ctx, idx, name, resp) {
    const respLines = wrap(ctx, resp, CW2 - 12, F.resp);
    const h = 8 + 22 + 4 + respLines.length * 15 + 12;
    return { kind: 'deptheader', title: idx + '. ' + name, respLines, h, keepWithNext: true };
  }

  function mItem(ctx, text, st) {
    const textMaxW = CW2 - STATUS_W - STATUS_GAP;
    const lines = wrap(ctx, text, textMaxW, F.item);
    const inner = Math.max(lines.length * 18, 22);
    let h = 8 + inner + 10;
    if (h > MAXBLK) h = MAXBLK;   // invariant guard (never triggers for one-line items)
    return { kind: 'item', lines, st, h };
  }

  function mSignRow(label, sig, dateIso) {
    return { kind: 'signrow', label, sig, dateIso, h: sigAreaHeight() + 12 };
  }

  function mEmpApproval(ctx, a, sig) {
    const title = a.title;
    const textLines = wrap(ctx, a.text, CW2, F.a);
    const nameLines = wrap(ctx, 'שם העובד: ' + (a.name || '—'), CW2, F.q);
    let h = 14 + 26 + 6 + textLines.length * 18 + 12 + nameLines.length * 20 + 10 + sigAreaHeight() + 14;
    return { kind: 'approval', variant: 'emp', title, textLines, nameLines,
      sigLabel: a.signatureLabel, sig, dateIso: a.date, h };
  }
  function mCeoApproval(ctx, a, sig) {
    const title = a.title;
    const checkLines = wrap(ctx, a.checkboxLabel, CW2 - 30, F.q);
    const nameLines = wrap(ctx, 'שם המאשר: ' + (a.name || '—'), CW2, F.q);
    const roleLines = wrap(ctx, 'תפקיד: ' + (a.role || '—'), CW2, F.q);
    const checkH = Math.max(checkLines.length * 20, 26);
    let h = 14 + 26 + 10 + checkH + 12 + nameLines.length * 20 + 6 + roleLines.length * 20 + 10 + sigAreaHeight() + 14;
    return { kind: 'approval', variant: 'ceo', title, checkLines, nameLines, roleLines,
      done: a.done, sigLabel: a.signatureLabel, sig, dateIso: a.date, h };
  }

  /* ---- block drawers ---- */
  function dHeader(ctx, b) {
    const g = ctx.createLinearGradient(0, 0, PAGE_W, HEADER_H);
    g.addColorStop(0, C.brand); g.addColorStop(1, C.brand2);
    ctx.fillStyle = g; ctx.fillRect(0, 0, PAGE_W, HEADER_H);
    ctx.fillStyle = 'rgba(232,163,61,0.18)';
    ctx.beginPath(); ctx.arc(70, -16, 78, 0, Math.PI * 2); ctx.fill();
    ctx.textAlign = 'right'; ctx.textBaseline = 'top';
    ctx.fillStyle = '#fff'; ctx.font = F.title;
    ctx.fillText('טופס קליטת עובד חדש', PAGE_W - M, 26);
    ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.font = F.subtitle;
    ctx.fillText(b.company + '   ·   תאריך מילוי: ' + b.today, PAGE_W - M, 60);
  }
  function dEmpBox(ctx, b) {
    const x = M, y = b._y + 8;
    roundRect(ctx, x, y, CW2, b.boxH, 10);
    ctx.fillStyle = C.boxBg; ctx.fill();
    ctx.strokeStyle = C.boxBorder; ctx.lineWidth = 1; ctx.stroke();
    const colW = CW2 / 2, padX = 16;
    const cellRight = col => (col === 0 ? x + CW2 - padX : x + colW - padX);
    ctx.textAlign = 'right'; ctx.textBaseline = 'top';
    let cy = y + 16;
    for (let r = 0; r < b.rowHs.length; r++) {
      for (let col = 0; col < 2; col++) {
        const cell = b.cells[r * 2 + col];
        if (!cell) continue;
        const cx = cellRight(col);
        ctx.fillStyle = C.brand; ctx.font = F.cellLabel; ctx.fillText(cell.label, cx, cy);
        ctx.fillStyle = C.ink; ctx.font = F.cellVal;
        cell.lines.forEach((ln, i) => ctx.fillText(ln, cx, cy + 15 + i * 17));
      }
      cy += b.rowHs[r];
    }
  }
  function dPurpose(ctx, b) {
    const x = M, y = b._y, padX = 14;
    roundRect(ctx, x, y, CW2, b.boxH, 10);
    ctx.fillStyle = C.boxBg; ctx.fill();
    ctx.strokeStyle = C.boxBorder; ctx.lineWidth = 1; ctx.setLineDash([5, 4]); ctx.stroke(); ctx.setLineDash([]);
    ctx.textAlign = 'right'; ctx.textBaseline = 'top';
    ctx.fillStyle = C.ink; ctx.font = F.a;
    let ty = y + 14;
    b.lines.forEach(ln => { ctx.fillText(ln, PAGE_W - M - padX, ty); ty += 18; });
  }
  function dDeptHeader(ctx, b) {
    const y = b._y + 8;
    ctx.fillStyle = C.accent; ctx.fillRect(PAGE_W - M - 4, y + 1, 4, 20);
    ctx.textAlign = 'right'; ctx.textBaseline = 'top';
    ctx.fillStyle = C.brand; ctx.font = F.section;
    ctx.fillText(b.title, PAGE_W - M - 12, y);
    ctx.fillStyle = C.muted; ctx.font = F.resp;
    let ry = y + 26;
    b.respLines.forEach(ln => { ctx.fillText(ln, PAGE_W - M, ry); ry += 15; });
  }
  function drawStatusChip(ctx, y, st) {
    let label, bg, border, fg;
    if (st === 1) { label = '✓ בוצע'; bg = C.okBg; border = C.okLine; fg = C.ok; }
    else if (st === 2) { label = 'לא רלוונטי'; bg = C.naBg; border = C.naLine; fg = C.na; }
    else { label = 'לא סומן'; bg = '#f4f6f8'; border = C.line; fg = C.muted; }
    ctx.font = F.status;
    const tw = ctx.measureText(label).width;
    const chipW = Math.min(STATUS_W, tw + 18), chipH = 22, chipX = M, chipY = y;
    roundRect(ctx, chipX, chipY, chipW, chipH, 6);
    ctx.fillStyle = bg; ctx.fill();
    ctx.strokeStyle = border; ctx.lineWidth = 1; ctx.stroke();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = fg; ctx.fillText(label, chipX + chipW / 2, chipY + chipH / 2 + 1);
    ctx.textAlign = 'right'; ctx.textBaseline = 'top';
  }
  function dItem(ctx, b) {
    const y = b._y + 8;
    ctx.textAlign = 'right'; ctx.textBaseline = 'top';
    ctx.fillStyle = C.ink; ctx.font = F.item;
    let ty = y;
    b.lines.forEach(ln => { ctx.fillText(ln, PAGE_W - M, ty); ty += 18; });
    drawStatusChip(ctx, y, b.st);
    ctx.strokeStyle = '#eef2f6'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(M, b._y + b.h - 1); ctx.lineTo(PAGE_W - M, b._y + b.h - 1); ctx.stroke();
  }
  function dSignRow(ctx, b) {
    drawSigArea(ctx, b._y + 8, b.label, b.sig, b.dateIso);
  }
  function dApproval(ctx, b) {
    let y = b._y + 14;
    ctx.fillStyle = C.accent; ctx.fillRect(PAGE_W - M - 4, y + 1, 4, 22);
    ctx.textAlign = 'right'; ctx.textBaseline = 'top';
    ctx.fillStyle = C.brand; ctx.font = F.section;
    ctx.fillText(b.title, PAGE_W - M - 12, y);
    y += 26 + (b.variant === 'emp' ? 6 : 10);

    if (b.variant === 'emp') {
      ctx.fillStyle = C.ink; ctx.font = F.a;
      b.textLines.forEach(ln => { ctx.fillText(ln, PAGE_W - M, y); y += 18; });
      y += 12;
      ctx.fillStyle = C.brand; ctx.font = F.q;
      b.nameLines.forEach(ln => { ctx.fillText(ln, PAGE_W - M, y); y += 20; });
      y += 10;
    } else {
      // checkbox line
      const boxSize = 20, boxX = PAGE_W - M - boxSize, boxY = y;
      roundRect(ctx, boxX, boxY, boxSize, boxSize, 5);
      ctx.fillStyle = b.done ? C.ok : '#fff'; ctx.fill();
      ctx.strokeStyle = b.done ? C.ok : C.line; ctx.lineWidth = 1.5; ctx.stroke();
      if (b.done) {
        ctx.fillStyle = '#fff'; ctx.font = '800 14px Heebo, Arial';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('✓', boxX + boxSize / 2, boxY + boxSize / 2 + 1);
        ctx.textAlign = 'right'; ctx.textBaseline = 'top';
      }
      ctx.fillStyle = C.ink; ctx.font = F.q;
      let cy = y;
      b.checkLines.forEach(ln => { ctx.fillText(ln, PAGE_W - M - boxSize - 10, cy); cy += 20; });
      y += Math.max(b.checkLines.length * 20, 26) + 12;
      ctx.fillStyle = C.brand; ctx.font = F.q;
      b.nameLines.forEach(ln => { ctx.fillText(ln, PAGE_W - M, y); y += 20; });
      y += 6;
      b.roleLines.forEach(ln => { ctx.fillText(ln, PAGE_W - M, y); y += 20; });
      y += 10;
    }
    drawSigArea(ctx, y, b.sigLabel, b.sig, b.dateIso);
  }
  function dFooter(ctx, p, n) {
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillStyle = C.footer; ctx.font = F.footer;
    ctx.fillText('הופק אוטומטית מטופס קליטת עובד מקוון   ·   עמוד ' + p + ' מתוך ' + n, PAGE_W / 2, PAGE_H - 30);
  }

  function drawBlock(ctx, b) {
    switch (b.kind) {
      case 'header': dHeader(ctx, b); break;
      case 'empbox': dEmpBox(ctx, b); break;
      case 'purpose': dPurpose(ctx, b); break;
      case 'deptheader': dDeptHeader(ctx, b); break;
      case 'item': dItem(ctx, b); break;
      case 'signrow': dSignRow(ctx, b); break;
      case 'approval': dApproval(ctx, b); break;
    }
  }

  window.generateOnboardingPdf = async function (data) {
    data = data || {};
    const today = new Date().toLocaleDateString('he-IL');

    if (document.fonts && document.fonts.load) {
      try {
        await Promise.all(Object.values(F).map(f => {
          const m = f.match(/^(\d+)\s+([\d.]+)px/);
          return m ? document.fonts.load(m[1] + ' ' + m[2] + 'px Heebo') : null;
        }));
        await document.fonts.ready;
      } catch (e) {}
    }

    // preload every signature image (5 depts + employee + CEO)
    const depts = data.departments || [];
    const deptSigs = await Promise.all(depts.map(d => loadSig(d.signature)));
    const empSig = await loadSig((data.employeeApproval || {}).signature);
    const ceoSig = await loadSig((data.ceoApproval || {}).signature);

    const canvas = document.createElement('canvas');
    canvas.width = PAGE_W * SCALE; canvas.height = PAGE_H * SCALE;
    const ctx = canvas.getContext('2d');
    ctx.scale(SCALE, SCALE);
    ctx.direction = 'rtl';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';

    /* ---- build block list (measure) ---- */
    const blocks = [];
    blocks.push(mHeader(today, data.company || ''));
    blocks.push(mEmpBox(ctx, data.employeeFields || []));
    if (data.purpose) blocks.push(mPurpose(ctx, data.purpose));
    depts.forEach((d, di) => {
      blocks.push(mDeptHeader(ctx, d.index, d.name, d.responsibility));
      d.items.forEach(it => blocks.push(mItem(ctx, it.text, it.state)));
      blocks.push(mSignRow(d.signatureLabel, deptSigs[di], d.date));
    });
    if (data.employeeApproval) blocks.push(mEmpApproval(ctx, data.employeeApproval, empSig));
    if (data.ceoApproval) blocks.push(mCeoApproval(ctx, data.ceoApproval, ceoSig));

    /* ---- paginate ---- */
    const pages = [[]];
    let page = 0, y = 0;
    const topFor = p => (p === 0 ? 0 : MT);
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      let need = b.h + (b.keepWithNext && blocks[i + 1] ? blocks[i + 1].h : 0);
      const pTop = topFor(page);
      const atTop = (y === pTop);
      const usable = BOTTOM - pTop;
      if (need > usable) need = b.h;
      if (!atTop && y + need > BOTTOM) { page++; y = topFor(page); pages[page] = []; }
      if (!pages[page]) pages[page] = [];
      b._page = page; b._y = y;
      pages[page].push(b);
      y += b.h;
    }
    const N = pages.length;

    /* ---- assemble PDF ---- */
    const jsPDF = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
    const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });
    for (let p = 0; p < N; p++) {
      ctx.clearRect(0, 0, PAGE_W, PAGE_H);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, PAGE_W, PAGE_H);
      for (const b of pages[p]) drawBlock(ctx, b);
      dFooter(ctx, p + 1, N);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
      if (p > 0) doc.addPage();
      doc.addImage(dataUrl, 'JPEG', 0, 0, 595.28, 841.89, undefined, 'FAST');
    }

    const empName = ((data.employeeFields || []).find(f => /שם העובד/.test(f.label)) || {}).value || '';
    const blob = doc.output('blob');
    const filename = 'קליטה_' + (empName || 'עובד') + '.pdf';
    return {
      blob, filename,
      debug: {
        pageCount: N,
        signaturesRequested: depts.length + 2,
        signaturesEmbedded: deptSigs.filter(Boolean).length + (empSig ? 1 : 0) + (ceoSig ? 1 : 0),
        pages: pages.map((pg, i) => ({
          idx: i, blocks: pg.length, kinds: pg.map(b => b.kind),
          fillY: pg.length ? Math.max(...pg.map(b => b._y + b.h)) : 0
        }))
      }
    };
  };
})();
