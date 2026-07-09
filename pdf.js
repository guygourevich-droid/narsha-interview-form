/* =====================================================================
   pdf.js — deterministic, canvas-rendered PDF generator for the
   Hebrew (RTL) interview form.

   Approach: draw the whole document with Canvas 2D (the browser renders
   Hebrew bidi/shaping perfectly via ctx.direction='rtl'), paginate
   explicitly so no Q&A block is ever split across pages, then place each
   finished page into a jsPDF A4 document as a crisp (2x) image.

   No html2canvas / html2pdf — those were the source of the clipping bugs.

   Exposes: window.generateInterviewPdf(data) -> Promise<{blob, filename}>
   data = { contact:{fullname,position,phone,email},
            answers:[{q,a},...], engineering:[{q,a},...],
            attachments:[{label,dataUrl},...] }
   ===================================================================== */
(function () {
  'use strict';

  /* ---- geometry (CSS px; A4 @96dpi = 794x1123) ---- */
  const SCALE = 2;                 // internal crispness
  const PAGE_W = 794, PAGE_H = 1123;
  const M = 48;                    // side margin
  const MT = 42;                   // top margin (pages 2+)
  const MB = 52;                   // bottom margin (footer room)
  const CW2 = PAGE_W - M * 2;      // content width
  const BOTTOM = PAGE_H - MB;      // usable bottom

  const C = {
    brand: '#1f3a5f', brand2: '#2f6fb0', accent: '#e8a33d',
    ink: '#1c2733', scnInk: '#22384f', muted: '#5c6b7a', line: '#e6ebf1',
    boxBg: '#f4f8fc', scnBg: '#f6f9fc', scnBorder: '#9dbcd9', boxBorder: '#dbe6f0',
    footer: '#9aa7b4'
  };
  const F = {
    title: '800 19px Heebo, Arial',
    subtitle: '400 12.5px Heebo, Arial',
    section: '800 17px Heebo, Arial',
    q: '700 14.5px Heebo, Arial',
    a: '400 13.5px Heebo, Arial',
    scn: '500 12.5px Heebo, Arial',
    cellLabel: '700 11.5px Heebo, Arial',
    cellVal: '500 13px Heebo, Arial',
    attLabel: '700 12.5px Heebo, Arial',
    footer: '400 10px Heebo, Arial'
  };

  /* ---- helpers ---- */
  function wrap(ctx, text, maxW, font) {
    ctx.font = font;
    const words = String(text == null ? '' : text).trim().split(/\s+/);
    if (!words.length || words[0] === '') return [''];
    const lines = [];
    let line = words[0];
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
  async function loadImages(attachments) {
    const out = [];
    for (const a of attachments) {
      try {
        const img = await new Promise((res, rej) => {
          const im = new Image();
          im.onload = () => res(im); im.onerror = rej; im.src = a.dataUrl;
        });
        out.push({ label: a.label || 'מסמך', img, w: img.naturalWidth, h: img.naturalHeight });
      } catch (e) { /* skip unreadable */ }
    }
    return out;
  }

  /* ---- block measurers (return descriptor with height h) ---- */
  const HEADER_H = 104;
  function mHeader() { return { kind: 'header', h: HEADER_H + 18 }; }
  function mContact(rows) { return { kind: 'contact', rows, h: 116 + 16 }; }
  function mQA(ctx, num, q, a) {
    const qLines = wrap(ctx, num + q, CW2, F.q);
    const aText = (a && String(a).trim()) ? a : '—';
    const aLines = wrap(ctx, aText, CW2, F.a);
    const h = 8 + qLines.length * 20 + 6 + aLines.length * 18 + 12 + 1;
    return { kind: 'qa', q, a: aText, qLines, aLines, h };
  }
  function mSection(title) { return { kind: 'section', title, h: 48, keepWithNext: true }; }
  function mScenario(ctx, num, q, a) {
    const scnLines = wrap(ctx, num + q, CW2 - 26, F.scn);
    const scnBoxH = scnLines.length * 17 + 20;
    const aText = (a && String(a).trim()) ? a : '—';
    const aLines = wrap(ctx, aText, CW2, F.a);
    const h = 10 + scnBoxH + 8 + aLines.length * 18 + 14;
    return { kind: 'scenario', q, a: aText, scnLines, aLines, scnBoxH, h };
  }
  function mImageRow(group) {
    const gap = 16, cellW = (CW2 - gap) / 2, maxCellH = (BOTTOM - MT) - 60;
    const cells = group.map(im => {
      let dw = cellW, dh = im.h * dw / im.w;
      if (dh > maxCellH) { dh = maxCellH; dw = im.w * dh / im.h; } // fit height, center in cell
      return { im, dw, dh, label: im.label };
    });
    const rowH = 16 + Math.max(...cells.map(c => c.dh)) + 16;
    return { kind: 'imagerow', cells, h: rowH };
  }

  /* ---- block drawers (draw at block._y) ---- */
  function dHeader(ctx, b) {
    const g = ctx.createLinearGradient(0, 0, PAGE_W, HEADER_H);
    g.addColorStop(0, C.brand); g.addColorStop(1, C.brand2);
    ctx.fillStyle = g; ctx.fillRect(0, 0, PAGE_W, HEADER_H);
    ctx.fillStyle = 'rgba(232,163,61,0.18)';
    ctx.beginPath(); ctx.arc(70, -16, 78, 0, Math.PI * 2); ctx.fill();
    ctx.textAlign = 'right'; ctx.textBaseline = 'top';
    ctx.fillStyle = '#fff'; ctx.font = F.title;
    ctx.fillText('טופס ראיון עבודה – מהנדס / מנהל עבודה בבנייה', PAGE_W - M, 28);
    ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.font = F.subtitle;
    ctx.fillText('תאריך מילוי: ' + b.today, PAGE_W - M, 62);
  }
  function dContact(ctx, b) {
    const boxH = 116, x = M, y = b._y + 8;
    roundRect(ctx, x, y, CW2, boxH, 10);
    ctx.fillStyle = C.boxBg; ctx.fill();
    ctx.strokeStyle = C.boxBorder; ctx.lineWidth = 1; ctx.stroke();
    const colW = CW2 / 2, padX = 16;
    // RTL: col 0 = right half, col 1 = left half
    const cellRight = col => (col === 0 ? x + CW2 - padX : x + colW - padX);
    const rows = b.rows;
    const layout = [
      [rows[0], 0, 0], [rows[1], 1, 0],
      [rows[2], 0, 1], [rows[3], 1, 1]
    ];
    ctx.textAlign = 'right'; ctx.textBaseline = 'top';
    layout.forEach(([pair, col, r]) => {
      const cx = cellRight(col), cy = y + 16 + r * 46;
      ctx.fillStyle = C.brand; ctx.font = F.cellLabel; ctx.fillText(pair[0], cx, cy);
      ctx.fillStyle = C.ink; ctx.font = F.cellVal; ctx.fillText(pair[1] || '—', cx, cy + 15);
    });
  }
  function dQA(ctx, b) {
    let y = b._y + 8;
    ctx.textAlign = 'right'; ctx.textBaseline = 'top';
    ctx.fillStyle = C.brand; ctx.font = F.q;
    b.qLines.forEach(ln => { ctx.fillText(ln, PAGE_W - M, y); y += 20; });
    y += 6;
    ctx.fillStyle = C.ink; ctx.font = F.a;
    b.aLines.forEach(ln => { ctx.fillText(ln, PAGE_W - M, y); y += 18; });
    ctx.strokeStyle = C.line; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(M, b._y + b.h - 1); ctx.lineTo(PAGE_W - M, b._y + b.h - 1); ctx.stroke();
  }
  function dSection(ctx, b) {
    const y = b._y + 14;
    ctx.fillStyle = C.accent; ctx.fillRect(PAGE_W - M - 4, y + 1, 4, 20);
    ctx.textAlign = 'right'; ctx.textBaseline = 'top';
    ctx.fillStyle = C.brand; ctx.font = F.section;
    ctx.fillText(b.title, PAGE_W - M - 12, y);
  }
  function dScenario(ctx, b) {
    let y = b._y + 10;
    const bx = M, by = y, bw = CW2, bh = b.scnBoxH;
    roundRect(ctx, bx, by, bw, bh, 8);
    ctx.fillStyle = C.scnBg; ctx.fill();
    ctx.strokeStyle = C.scnBorder; ctx.lineWidth = 1; ctx.setLineDash([5, 4]); ctx.stroke(); ctx.setLineDash([]);
    ctx.textAlign = 'right'; ctx.textBaseline = 'top';
    ctx.fillStyle = C.scnInk; ctx.font = F.scn;
    let ty = by + 10;
    b.scnLines.forEach(ln => { ctx.fillText(ln, PAGE_W - M - 13, ty); ty += 17; });
    y = by + bh + 8;
    ctx.fillStyle = C.ink; ctx.font = F.a;
    b.aLines.forEach(ln => { ctx.fillText(ln, PAGE_W - M, y); y += 18; });
  }
  function dImageRow(ctx, b) {
    const gap = 16, cellW = (CW2 - gap) / 2, y = b._y;
    const cellLeft = i => (i === 0 ? M + cellW + gap : M);     // RTL: cell 0 = right column
    const cellRight = i => (i === 0 ? M + CW2 : M + cellW);
    b.cells.forEach((c, i) => {
      ctx.textAlign = 'right'; ctx.textBaseline = 'top';
      ctx.fillStyle = C.brand; ctx.font = F.attLabel;
      ctx.fillText(c.label, cellRight(i), y);
      const ix = cellLeft(i) + (cellW - c.dw) / 2;
      ctx.drawImage(c.im.img, ix, y + 16, c.dw, c.dh);
      ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.strokeRect(ix, y + 16, c.dw, c.dh);
    });
  }
  function dFooter(ctx, p, n) {
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillStyle = C.footer; ctx.font = F.footer;
    ctx.fillText('הופק אוטומטית מטופס הראיון המקוון   ·   עמוד ' + p + ' מתוך ' + n, PAGE_W / 2, PAGE_H - 30);
  }

  function drawBlock(ctx, b) {
    switch (b.kind) {
      case 'header': dHeader(ctx, b); break;
      case 'contact': dContact(ctx, b); break;
      case 'qa': dQA(ctx, b); break;
      case 'section': dSection(ctx, b); break;
      case 'scenario': dScenario(ctx, b); break;
      case 'imagerow': dImageRow(ctx, b); break;
    }
  }

  window.generateInterviewPdf = async function (data) {
    data = data || {};
    const contact = Object.assign({ fullname: '', position: '', phone: '', email: '' }, data.contact || {});
    const answers = data.answers || [];
    const engineering = data.engineering || [];
    const today = new Date().toLocaleDateString('he-IL');

    // make sure Heebo is loaded before we measure/draw
    if (document.fonts && document.fonts.load) {
      try {
        await Promise.all(Object.values(F).map(f => {
          const m = f.match(/^(\d+)\s+([\d.]+)px/);
          return m ? document.fonts.load(m[1] + ' ' + m[2] + 'px Heebo') : null;
        }));
        await document.fonts.ready;
      } catch (e) { /* ignore */ }
    }
    const images = await loadImages(data.attachments || []);

    // canvas + context (draw in CSS px via SCALE transform)
    const canvas = document.createElement('canvas');
    canvas.width = PAGE_W * SCALE; canvas.height = PAGE_H * SCALE;
    const ctx = canvas.getContext('2d');
    ctx.scale(SCALE, SCALE);
    ctx.direction = 'rtl';          // base direction = RTL (correct bidi for numbered Hebrew)
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';

    /* ---- build block list (measure) ---- */
    const blocks = [];
    blocks.push(Object.assign(mHeader(), { today }));
    blocks.push(mContact([
      ['שם מלא', contact.fullname],
      ['תפקיד מבוקש', contact.position],
      ['טלפון', contact.phone],
      ['דוא"ל', contact.email]
    ]));
    answers.forEach((a, i) => blocks.push(mQA(ctx, (i + 1) + '. ', a.q, a.a)));
    if (engineering.length) {
      blocks.push(mSection('שאלות הנדסיות'));
      engineering.forEach((e, i) => blocks.push(mScenario(ctx, (answers.length + i + 1) + '. ', e.q, e.a)));
    }
    if (images.length) {
      blocks.push(mSection('מסמכים מצורפים'));
      for (let i = 0; i < images.length; i += 2) blocks.push(mImageRow(images.slice(i, i + 2)));
    }

    /* ---- paginate ---- */
    const pages = [[]];
    let page = 0, y = 0;            // page 0 content starts at y=0 (header full-bleed)
    const topFor = p => (p === 0 ? 0 : MT);
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const need = b.h + (b.keepWithNext && blocks[i + 1] ? blocks[i + 1].h : 0);
      const pTop = topFor(page);
      const atTop = (y === pTop);
      const usable = BOTTOM - pTop;
      if (!atTop && y + need > BOTTOM && need <= usable) {
        page++; y = topFor(page); pages[page] = [];
      }
      if (!pages[page]) pages[page] = [];
      b._page = page; b._y = y;
      pages[page].push(b);
      y += b.h;
    }
    const N = pages.length;

    /* ---- assemble PDF with jsPDF ---- */
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

    const blob = doc.output('blob');
    const filename = 'ראיון_' + (contact.fullname || 'מועמד') + '.pdf';
    return {
      blob, filename,
      debug: {
        pageCount: N,
        pages: pages.map((pg, i) => ({
          idx: i, blocks: pg.length,
          kinds: pg.map(b => b.kind),
          fillY: pg.length ? Math.max(...pg.map(b => b._y + b.h)) : 0
        }))
      }
    };
  };
})();
