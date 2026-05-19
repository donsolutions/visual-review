/* Review Mode — Pastel-style annotation overlay
 * Activates on ?review=1 in URL or window.__REVIEW_MODE__ = true.
 * Stores annotations in localStorage keyed by page path.
 * Export produces markdown + JSON for Claude to consume. */

(function () {
  'use strict';

  const params = new URLSearchParams(window.location.search);
  const ENABLED = params.get('review') === '1' || window.__REVIEW_MODE__ === true;
  if (!ENABLED) return;

  const STORAGE_KEY = 'rm:' + window.location.pathname;
  const NAME_KEY = 'rm:reviewerName';

  const DRAW_COLORS = ['#DC2626', '#0089C7', '#16A34A', '#F59E0B', '#000000'];

  const PALETTE = [
    { key: 'headline',    label: 'Headline',    icon: 'H', html: '<h2 style="font-size:2rem;font-weight:800;margin:0;">Your headline here</h2>' },
    { key: 'subheadline', label: 'Subheadline', icon: 'h', html: '<h3 style="font-size:1.25rem;font-weight:600;margin:0;color:#374151;">Your subheadline here</h3>' },
    { key: 'paragraph',   label: 'Paragraph',   icon: '¶', html: '<p style="font-size:1rem;line-height:1.6;margin:0;">Body copy goes here. Click to edit.</p>' },
    { key: 'button',      label: 'Button / CTA',icon: '▢', html: '<a href="#" style="display:inline-block;padding:14px 28px;background:#F59E0B;color:#fff;border-radius:8px;font-weight:700;text-decoration:none;">Button text</a>' },
    { key: 'bullets',     label: 'Bullet list', icon: '≡', html: '<ul style="padding-left:1.5rem;margin:0;line-height:1.7;"><li>First bullet point</li><li>Second bullet point</li><li>Third bullet point</li></ul>' },
    { key: 'image',       label: 'Image',       icon: '🖼', html: '<div style="background:#e5e7eb;color:#6b7280;padding:60px 20px;text-align:center;border-radius:8px;font-size:13px;">[ image placeholder — describe what goes here ]</div>' },
    { key: 'video',       label: 'Video',       icon: '▶', html: '<div style="background:#1a1a1a;color:#fff;padding:80px 20px;text-align:center;border-radius:8px;font-size:14px;position:relative;"><div style="font-size:36px;margin-bottom:8px;">▶</div>[ video placeholder ]</div>' },
    { key: 'quote',       label: 'Testimonial', icon: '"', html: '<blockquote style="border-left:4px solid #0089C7;padding:8px 16px;margin:0;font-style:italic;color:#374151;">"Testimonial text here." <footer style="margin-top:8px;font-style:normal;font-weight:600;font-size:14px;">— Name, location</footer></blockquote>' },
    { key: 'divider',     label: 'Divider',     icon: '─', html: '<hr style="border:none;border-top:1px solid #e5e7eb;margin:0;">' },
    { key: 'section',     label: 'New section', icon: '▭', html: '<section style="padding:60px 24px;background:#f9fafb;border-radius:8px;text-align:center;color:#6b7280;">[ empty section — drag more elements inside ]</section>' },
  ];

  const state = {
    mode: null,              // 'pin' | 'edit' | 'draw' | 'layout' | null
    panelOpen: false,
    annotations: [],         // {id, type, ...}
    reviewer: localStorage.getItem(NAME_KEY) || '',
    hoverEl: null,
    activePopover: null,
    activeEditEl: null,
    drawColor: DRAW_COLORS[0],
    drawStrokeWidth: 3,
    drawSvg: null,
    drawing: false,
    drawCurrentPoints: null,
    drawCurrentPath: null,
    layoutCleanup: [],       // functions to call when leaving layout mode
  };

  // ── persistence ────────────────────────────────────────────────────
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) state.annotations = JSON.parse(raw);
    } catch (e) { state.annotations = []; }
  }
  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.annotations));
  }
  function uid() {
    return Math.random().toString(36).slice(2, 10);
  }

  // ── selector helpers ───────────────────────────────────────────────
  function cssPath(el) {
    if (!(el instanceof Element)) return '';
    if (el.id) return '#' + cssEscape(el.id);
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.body && parts.length < 8) {
      let part = node.nodeName.toLowerCase();
      if (node.className && typeof node.className === 'string') {
        const cls = node.className.trim().split(/\s+/).filter(c => c && !c.startsWith('rm-')).slice(0, 2);
        if (cls.length) part += '.' + cls.join('.');
      }
      const parent = node.parentNode;
      if (parent) {
        const siblings = Array.from(parent.children).filter(c => c.nodeName === node.nodeName);
        if (siblings.length > 1) {
          const idx = siblings.indexOf(node) + 1;
          part += ':nth-of-type(' + idx + ')';
        }
      }
      parts.unshift(part);
      node = node.parentNode;
    }
    return parts.join(' > ');
  }
  function cssEscape(s) {
    return s.replace(/[^a-zA-Z0-9_-]/g, c => '\\' + c);
  }
  function textPreview(el, max = 80) {
    const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    return t.length > max ? t.slice(0, max) + '…' : t;
  }
  function findBySelector(selector) {
    try {
      return document.querySelector(selector);
    } catch (e) { return null; }
  }

  // ── DOM scaffolding ────────────────────────────────────────────────
  const root = document.createElement('div');
  root.className = 'rm-root';
  document.body.appendChild(root);

  const toolbar = document.createElement('div');
  toolbar.className = 'rm-toolbar';
  root.appendChild(toolbar);

  const panel = document.createElement('div');
  panel.className = 'rm-panel';
  root.appendChild(panel);

  // ── toolbar UI ─────────────────────────────────────────────────────
  function renderToolbar() {
    const count = state.annotations.filter(a => !a.resolved).length;
    const swatches = state.mode === 'draw' ? `
      <div class="rm-color-swatches">
        ${DRAW_COLORS.map(c => `<button class="rm-swatch ${state.drawColor === c ? 'rm-active' : ''}" data-color="${c}" style="background:${c};" title="${c}"></button>`).join('')}
        <button class="rm-swatch rm-undo-stroke" title="Undo last stroke" style="background:#374151;color:#fff;font-size:11px;">↶</button>
      </div>
    ` : '';
    toolbar.innerHTML = `
      <div class="rm-name-prompt">
        <input type="text" placeholder="Your name" value="${escapeHtml(state.reviewer)}" />
      </div>
      <div class="rm-divider"></div>
      <button class="rm-pin-btn ${state.mode === 'pin' ? 'rm-active' : ''}" title="Pin a comment">📌 Pin</button>
      <button class="rm-edit-btn ${state.mode === 'edit' ? 'rm-active' : ''}" title="Edit text inline">✏️ Edit</button>
      <button class="rm-draw-btn ${state.mode === 'draw' ? 'rm-active' : ''}" title="Draw / circle">✍️ Draw</button>
      <button class="rm-layout-btn ${state.mode === 'layout' ? 'rm-active' : ''}" title="Move, delete, or add space between sections">↕ Layout</button>
      <button class="rm-add-btn ${state.mode === 'add' ? 'rm-active' : ''}" title="Add new element (drag from palette)">➕ Add</button>
      ${swatches}
      <div class="rm-divider"></div>
      <button class="rm-panel-btn" title="Open review panel">📋 <span class="rm-count">${count}</span></button>
      <button class="rm-export-btn" title="Export review">📤 Send</button>
    `;
    toolbar.querySelector('.rm-pin-btn').addEventListener('click', () => setMode(state.mode === 'pin' ? null : 'pin'));
    toolbar.querySelector('.rm-edit-btn').addEventListener('click', () => setMode(state.mode === 'edit' ? null : 'edit'));
    toolbar.querySelector('.rm-draw-btn').addEventListener('click', () => setMode(state.mode === 'draw' ? null : 'draw'));
    toolbar.querySelector('.rm-layout-btn').addEventListener('click', () => setMode(state.mode === 'layout' ? null : 'layout'));
    toolbar.querySelector('.rm-add-btn').addEventListener('click', () => setMode(state.mode === 'add' ? null : 'add'));
    toolbar.querySelector('.rm-panel-btn').addEventListener('click', togglePanel);
    toolbar.querySelector('.rm-export-btn').addEventListener('click', openExport);
    const nameInput = toolbar.querySelector('.rm-name-prompt input');
    nameInput.addEventListener('input', e => {
      state.reviewer = e.target.value;
      localStorage.setItem(NAME_KEY, state.reviewer);
    });
    toolbar.querySelectorAll('.rm-swatch[data-color]').forEach(btn => {
      btn.addEventListener('click', () => { state.drawColor = btn.dataset.color; renderToolbar(); });
    });
    const undoBtn = toolbar.querySelector('.rm-undo-stroke');
    if (undoBtn) undoBtn.addEventListener('click', undoLastStroke);
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function setMode(mode) {
    if (state.mode === 'edit' && mode !== 'edit') exitEditMode();
    if (state.mode === 'draw' && mode !== 'draw') exitDrawMode();
    if (state.mode === 'layout' && mode !== 'layout') exitLayoutMode();
    if (state.mode === 'add' && mode !== 'add') exitAddMode();
    state.mode = mode;
    document.body.style.cursor = (mode === 'pin') ? 'crosshair' : '';
    if (mode === 'edit') enterEditMode();
    if (mode === 'draw') enterDrawMode();
    if (mode === 'layout') enterLayoutMode();
    if (mode === 'add') enterAddMode();
    renderToolbar();
  }

  // ── pin mode ───────────────────────────────────────────────────────
  function handleHover(e) {
    if (state.mode !== 'pin') return;
    if (e.target.closest('.rm-root')) return;
    if (state.hoverEl) state.hoverEl.classList.remove('rm-hover-target');
    state.hoverEl = e.target;
    state.hoverEl.classList.add('rm-hover-target');
  }
  function handleClick(e) {
    if (state.mode !== 'pin') return;
    if (e.target.closest('.rm-root')) return;
    e.preventDefault();
    e.stopPropagation();
    const target = e.target;
    target.classList.remove('rm-hover-target');
    state.hoverEl = null;
    openPinPopover(target, e.clientX, e.clientY);
    setMode(null);
  }

  function openPinPopover(target, clientX, clientY) {
    closePopover();
    const rect = target.getBoundingClientRect();
    const ax = (clientX - rect.left) / rect.width;
    const ay = (clientY - rect.top) / rect.height;
    const pop = document.createElement('div');
    pop.className = 'rm-popover';
    pop.innerHTML = `
      <div style="font-size:11px;color:#6b7280;margin-bottom:6px;">Commenting on:</div>
      <div class="rm-card-target" style="margin-bottom:8px;">${escapeHtml(cssPath(target))}</div>
      <textarea placeholder="What's the change or comment?"></textarea>
      <div class="rm-popover-actions">
        <button class="rm-cancel">Cancel</button>
        <button class="rm-primary rm-save">Save</button>
      </div>
    `;
    root.appendChild(pop);
    positionPopover(pop, clientX, clientY);
    const textarea = pop.querySelector('textarea');
    textarea.focus();
    pop.querySelector('.rm-cancel').addEventListener('click', closePopover);
    pop.querySelector('.rm-save').addEventListener('click', () => {
      const comment = textarea.value.trim();
      if (!comment) { closePopover(); return; }
      addAnnotation({
        type: 'comment',
        selector: cssPath(target),
        textPreview: textPreview(target),
        anchor: { ax, ay },
        comment,
      });
      closePopover();
    });
    textarea.addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        pop.querySelector('.rm-save').click();
      }
      if (e.key === 'Escape') closePopover();
    });
    state.activePopover = pop;
  }

  function positionPopover(pop, x, y) {
    const W = pop.offsetWidth, H = pop.offsetHeight;
    let left = x + 12, top = y + 12;
    if (left + W > window.innerWidth - 12) left = x - W - 12;
    if (top + H > window.innerHeight - 12) top = y - H - 12;
    if (left < 12) left = 12;
    if (top < 12) top = 12;
    pop.style.left = (left + window.scrollX) + 'px';
    pop.style.top = (top + window.scrollY) + 'px';
  }

  function closePopover() {
    if (state.activePopover) {
      state.activePopover.remove();
      state.activePopover = null;
    }
  }

  // ── edit mode ──────────────────────────────────────────────────────
  function enterEditMode() {
    document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,a,span,button,label,strong,em,td,th,blockquote').forEach(el => {
      if (el.closest('.rm-root')) return;
      if (!el.innerText || !el.innerText.trim()) return;
      const onlyTextOrInline = Array.from(el.childNodes).every(n =>
        n.nodeType === 3 || (n.nodeType === 1 && /^(b|i|em|strong|u|br|span|a|small|mark)$/i.test(n.tagName))
      );
      if (!onlyTextOrInline) return;
      el.classList.add('rm-edit-active');
      el.addEventListener('click', editClickHandler, true);
    });
  }
  function exitEditMode() {
    document.querySelectorAll('.rm-edit-active').forEach(el => {
      el.classList.remove('rm-edit-active');
      el.removeEventListener('click', editClickHandler, true);
      el.removeEventListener('blur', editBlurHandler);
      el.contentEditable = 'false';
    });
    if (state.activeEditEl) {
      finishEdit(state.activeEditEl);
      state.activeEditEl = null;
    }
  }
  let suppressBlur = false;
  function editBlurHandler(e) {
    if (suppressBlur) return;
    const el = e.currentTarget;
    el.removeEventListener('blur', editBlurHandler);
    finishEdit(el);
  }
  function editClickHandler(e) {
    if (state.mode !== 'edit') return;
    if (e.target.closest('.rm-root')) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget;
    if (el.contentEditable === 'true') return;
    if (state.activeEditEl && state.activeEditEl !== el) finishEdit(state.activeEditEl);
    state.activeEditEl = el;
    el.dataset.rmOriginalHtml = el.innerHTML;
    el.dataset.rmOriginalText = el.innerText;
    el.contentEditable = 'true';
    el.focus();
    el.addEventListener('blur', editBlurHandler);
    showFormatToolbar(el);
  }
  function normalizeForCompare(html) {
    return String(html || '')
      .replace(/&nbsp;/g, ' ')
      .replace(/<br\s*\/?>/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
  function finishEdit(el) {
    hideFormatToolbar();
    el.contentEditable = 'false';
    const before = el.dataset.rmOriginalHtml || '';
    const after = el.innerHTML;
    const beforeText = (el.dataset.rmOriginalText || '').trim();
    const afterText = (el.innerText || '').trim();
    delete el.dataset.rmOriginalHtml;
    delete el.dataset.rmOriginalText;
    // Skip when nothing meaningful changed: visible text identical AND normalized markup identical.
    if (beforeText === afterText && normalizeForCompare(before) === normalizeForCompare(after)) return;
    addAnnotation({
      type: 'edit',
      selector: cssPath(el),
      textPreview: textPreview(el),
      before,
      after,
    });
  }

  // ── format toolbar (B / I / U / link) ──────────────────────────────
  let formatRepositionFns = [];
  function showFormatToolbar(el) {
    hideFormatToolbar();
    const tb = document.createElement('div');
    tb.className = 'rm-format-toolbar';
    tb.innerHTML = `
      <button data-cmd="bold" class="rm-fmt-bold" title="Bold (Cmd/Ctrl+B)">B</button>
      <button data-cmd="italic" class="rm-fmt-italic" title="Italic (Cmd/Ctrl+I)">I</button>
      <button data-cmd="underline" class="rm-fmt-underline" title="Underline (Cmd/Ctrl+U)">U</button>
      <span class="rm-fmt-divider"></span>
      <button data-cmd="link" title="Add or edit link">🔗</button>
      <button data-cmd="unlink" title="Remove link">⌫</button>
    `;
    root.appendChild(tb);
    state.formatToolbar = tb;
    positionFormatToolbar(tb, el);
    // Never steal focus from the editable when interacting with the toolbar
    tb.addEventListener('mousedown', e => e.preventDefault());
    tb.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => runFormatCommand(btn.dataset.cmd));
    });
    const reposition = () => positionFormatToolbar(tb, el);
    el.addEventListener('input', reposition);
    window.addEventListener('scroll', reposition, { passive: true });
    window.addEventListener('resize', reposition);
    formatRepositionFns = [
      () => el.removeEventListener('input', reposition),
      () => window.removeEventListener('scroll', reposition),
      () => window.removeEventListener('resize', reposition),
    ];
  }
  function hideFormatToolbar() {
    if (state.formatToolbar) {
      state.formatToolbar.remove();
      state.formatToolbar = null;
    }
    formatRepositionFns.forEach(fn => { try { fn(); } catch (e) {} });
    formatRepositionFns = [];
  }
  function positionFormatToolbar(tb, el) {
    // .rm-root is position:fixed, so toolbar uses viewport coords (no scrollX/Y).
    const r = el.getBoundingClientRect();
    const tbHeight = 40;
    let top = r.top - tbHeight - 4;
    if (top < 4) top = r.bottom + 4;
    let left = r.left;
    const maxLeft = window.innerWidth - tb.offsetWidth - 8;
    if (left > maxLeft) left = maxLeft;
    if (left < 8) left = 8;
    tb.style.left = left + 'px';
    tb.style.top = top + 'px';
  }
  function runFormatCommand(cmd) {
    if (!cmd) return;
    const el = state.activeEditEl || document.activeElement;
    if (cmd === 'link') {
      if (!el) return;
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
        alert('Select the text you want to link, then click 🔗.');
        return;
      }
      const range = sel.getRangeAt(0).cloneRange();
      const existingAnchor = sel.anchorNode && sel.anchorNode.parentElement
        ? sel.anchorNode.parentElement.closest('a') : null;
      const defaultUrl = existingAnchor && existingAnchor.href ? existingAnchor.href : 'https://';
      // Suppress blur-driven finishEdit/save while prompt() takes focus
      suppressBlur = true;
      const url = prompt('Link URL (leave blank to remove the link):', defaultUrl);
      el.focus();
      const newSel = window.getSelection();
      newSel.removeAllRanges();
      newSel.addRange(range);
      if (url !== null) {
        if (!url.trim()) document.execCommand('unlink');
        else document.execCommand('createLink', false, url.trim());
      }
      suppressBlur = false;
      return;
    }
    if (cmd === 'unlink') {
      document.execCommand('unlink');
      return;
    }
    document.execCommand(cmd);
  }

  // ── draw mode ──────────────────────────────────────────────────────
  function ensureDrawSvg() {
    if (state.drawSvg) return state.drawSvg;
    const svgNs = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNs, 'svg');
    svg.setAttribute('class', 'rm-draw-svg');
    svg.style.height = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight) + 'px';
    root.appendChild(svg);
    state.drawSvg = svg;
    return svg;
  }
  function resizeDrawSvg() {
    if (!state.drawSvg) return;
    state.drawSvg.style.height = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight) + 'px';
  }
  function enterDrawMode() {
    const svg = ensureDrawSvg();
    svg.classList.add('rm-draw-active');
    svg.addEventListener('pointerdown', drawStart);
    svg.addEventListener('pointermove', drawMove);
    svg.addEventListener('pointerup', drawEnd);
    svg.addEventListener('pointerleave', drawEnd);
    renderStrokes();
  }
  function exitDrawMode() {
    if (!state.drawSvg) return;
    state.drawSvg.classList.remove('rm-draw-active');
    state.drawSvg.removeEventListener('pointerdown', drawStart);
    state.drawSvg.removeEventListener('pointermove', drawMove);
    state.drawSvg.removeEventListener('pointerup', drawEnd);
    state.drawSvg.removeEventListener('pointerleave', drawEnd);
    state.drawing = false;
    state.drawCurrentPoints = null;
    state.drawCurrentPath = null;
  }
  function pageCoordsFromEvent(e) {
    const rect = state.drawSvg.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
  function drawStart(e) {
    e.preventDefault();
    state.drawing = true;
    state.drawCurrentPoints = [pageCoordsFromEvent(e)];
    const svgNs = 'http://www.w3.org/2000/svg';
    const path = document.createElementNS(svgNs, 'path');
    path.setAttribute('stroke', state.drawColor);
    path.setAttribute('stroke-width', state.drawStrokeWidth);
    state.drawSvg.appendChild(path);
    state.drawCurrentPath = path;
    updateDrawPath();
  }
  function drawMove(e) {
    if (!state.drawing) return;
    const pt = pageCoordsFromEvent(e);
    const last = state.drawCurrentPoints[state.drawCurrentPoints.length - 1];
    if (Math.hypot(pt.x - last.x, pt.y - last.y) < 2) return;
    state.drawCurrentPoints.push(pt);
    updateDrawPath();
  }
  function drawEnd(e) {
    if (!state.drawing) return;
    state.drawing = false;
    const pts = state.drawCurrentPoints || [];
    if (pts.length < 2) {
      if (state.drawCurrentPath) state.drawCurrentPath.remove();
      state.drawCurrentPoints = null;
      state.drawCurrentPath = null;
      return;
    }
    // Find the section the centroid of the stroke lives in
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const anchorEl = sectionAtPoint(cx, cy) || document.body;
    const anchorRect = elementPageRect(anchorEl);
    const normPts = pts.map(p => ({
      x: (p.x - anchorRect.left) / anchorRect.width,
      y: (p.y - anchorRect.top) / anchorRect.height,
    }));
    if (state.drawCurrentPath) state.drawCurrentPath.remove();
    state.drawCurrentPath = null;
    state.drawCurrentPoints = null;
    addAnnotation({
      type: 'draw',
      selector: cssPath(anchorEl),
      textPreview: textPreview(anchorEl, 50),
      color: state.drawColor,
      strokeWidth: state.drawStrokeWidth,
      points: normPts,
    });
  }
  function updateDrawPath() {
    if (!state.drawCurrentPath || !state.drawCurrentPoints) return;
    state.drawCurrentPath.setAttribute('d', pointsToPathD(state.drawCurrentPoints));
  }
  function pointsToPathD(pts) {
    if (pts.length === 0) return '';
    if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`;
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 1; i < pts.length; i++) d += ` L ${pts[i].x} ${pts[i].y}`;
    return d;
  }
  function elementPageRect(el) {
    const r = el.getBoundingClientRect();
    return { left: r.left + window.scrollX, top: r.top + window.scrollY, width: r.width, height: r.height };
  }
  function sectionAtPoint(x, y) {
    // Find the deepest <section> or layout-eligible container under page coords (x, y)
    const candidates = movableSections();
    let best = null;
    candidates.forEach(el => {
      const r = elementPageRect(el);
      if (x >= r.left && x <= r.left + r.width && y >= r.top && y <= r.top + r.height) {
        if (!best || (elementPageRect(best).width > r.width)) best = el;
      }
    });
    return best;
  }
  function renderStrokes() {
    if (!state.drawSvg) return;
    // Remove all existing committed stroke paths (keep the in-progress one)
    state.drawSvg.querySelectorAll('path[data-rm-stroke]').forEach(p => p.remove());
    const svgNs = 'http://www.w3.org/2000/svg';
    state.annotations.filter(a => a.type === 'draw').forEach(a => {
      const el = findBySelector(a.selector);
      if (!el) return;
      const rect = elementPageRect(el);
      const abs = a.points.map(p => ({ x: rect.left + p.x * rect.width, y: rect.top + p.y * rect.height }));
      const path = document.createElementNS(svgNs, 'path');
      path.setAttribute('d', pointsToPathD(abs));
      path.setAttribute('stroke', a.color || '#DC2626');
      path.setAttribute('stroke-width', a.strokeWidth || 3);
      path.setAttribute('data-rm-stroke', a.id);
      if (a.resolved) path.setAttribute('opacity', '0.3');
      state.drawSvg.appendChild(path);
    });
  }
  function undoLastStroke() {
    const draws = state.annotations.filter(a => a.type === 'draw');
    if (!draws.length) return;
    const last = draws[draws.length - 1];
    deleteAnnotation(last.id);
  }

  // ── layout mode ────────────────────────────────────────────────────
  function movableSections() {
    // Top-level sections — direct children of <main>, plus header/footer, plus <section> tags
    const sections = new Set();
    document.querySelectorAll('main > *, body > section, body > header, body > footer').forEach(el => {
      if (el.closest('.rm-root')) return;
      if (el.tagName.toLowerCase() === 'script' || el.tagName.toLowerCase() === 'style') return;
      sections.add(el);
    });
    document.querySelectorAll('section').forEach(el => {
      if (el.closest('.rm-root')) return;
      // Only top-level sections (not nested inside another <section>)
      if (!el.parentElement.closest('section')) sections.add(el);
    });
    return Array.from(sections);
  }
  function enterLayoutMode() {
    const sections = movableSections();
    sections.forEach((sec, i) => attachLayoutControls(sec, i, sections));
    // Insert gap-with-add-space buttons between sections
    sections.forEach((sec, i) => {
      if (i === sections.length - 1) return;
      const gap = document.createElement('div');
      gap.className = 'rm-section-gap';
      gap.dataset.rmGap = '1';
      gap.innerHTML = `<button class="rm-section-space-btn" data-after="${i}">+ Add space here</button>`;
      sec.parentNode.insertBefore(gap, sec.nextSibling);
      gap.querySelector('.rm-section-space-btn').addEventListener('click', () => askSpaceSize(sec));
      state.layoutCleanup.push(() => gap.remove());
    });
    applyLayoutVisualState();
  }
  function exitLayoutMode() {
    state.layoutCleanup.forEach(fn => { try { fn(); } catch (e) {} });
    state.layoutCleanup = [];
    document.querySelectorAll('.rm-section-target').forEach(el => el.classList.remove('rm-section-target'));
    document.querySelectorAll('.rm-section-controls, .rm-drop-indicator').forEach(el => el.remove());
  }
  function attachLayoutControls(sec, index, allSections) {
    sec.classList.add('rm-section-target');
    const ctl = document.createElement('div');
    ctl.className = 'rm-section-controls';
    ctl.innerHTML = `
      <button class="rm-section-handle" draggable="true" title="Drag to reorder">⠿</button>
      <button class="rm-section-delete-btn" title="Mark for deletion">×</button>
    `;
    // Make sure parent can host absolute children
    const prevPos = sec.style.position;
    if (!prevPos || prevPos === 'static') sec.style.position = 'relative';
    sec.appendChild(ctl);
    state.layoutCleanup.push(() => { ctl.remove(); if (prevPos !== sec.style.position) sec.style.position = prevPos; });

    const handle = ctl.querySelector('.rm-section-handle');
    const delBtn = ctl.querySelector('.rm-section-delete-btn');

    handle.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/plain', cssPath(sec));
      e.dataTransfer.effectAllowed = 'move';
      sec.dataset.rmDragging = '1';
    });
    handle.addEventListener('dragend', () => { delete sec.dataset.rmDragging; clearDropIndicators(); });

    sec.addEventListener('dragover', layoutDragOver);
    sec.addEventListener('drop', layoutDrop);
    state.layoutCleanup.push(() => {
      sec.removeEventListener('dragover', layoutDragOver);
      sec.removeEventListener('drop', layoutDrop);
    });

    delBtn.addEventListener('click', () => {
      const existing = state.annotations.find(a => a.type === 'delete' && a.selector === cssPath(sec));
      if (existing) {
        deleteAnnotation(existing.id);
      } else {
        addAnnotation({ type: 'delete', selector: cssPath(sec), textPreview: textPreview(sec, 80) });
      }
    });
  }
  function clearDropIndicators() {
    document.querySelectorAll('.rm-drop-indicator').forEach(el => el.remove());
  }
  function layoutDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const target = e.currentTarget;
    const rect = target.getBoundingClientRect();
    const before = (e.clientY - rect.top) < rect.height / 2;
    clearDropIndicators();
    const indicator = document.createElement('div');
    indicator.className = 'rm-drop-indicator';
    if (before) target.parentNode.insertBefore(indicator, target);
    else target.parentNode.insertBefore(indicator, target.nextSibling);
  }
  function layoutDrop(e) {
    e.preventDefault();
    const draggedSelector = e.dataTransfer.getData('text/plain');
    const dragged = findBySelector(draggedSelector);
    if (!dragged) { clearDropIndicators(); return; }
    const target = e.currentTarget;
    if (dragged === target) { clearDropIndicators(); return; }
    const rect = target.getBoundingClientRect();
    const before = (e.clientY - rect.top) < rect.height / 2;
    const parent = target.parentNode;
    const originalIndex = Array.from(parent.children).filter(c => !c.classList.contains('rm-drop-indicator')).indexOf(dragged);
    if (before) parent.insertBefore(dragged, target);
    else parent.insertBefore(dragged, target.nextSibling);
    clearDropIndicators();
    const newIndex = Array.from(parent.children).filter(c => !c.classList.contains('rm-drop-indicator') && !c.classList.contains('rm-section-gap')).indexOf(dragged);
    const prev = dragged.previousElementSibling;
    const next = dragged.nextElementSibling;
    addAnnotation({
      type: 'move',
      selector: draggedSelector,
      textPreview: textPreview(dragged, 80),
      fromIndex: originalIndex,
      toIndex: newIndex,
      afterSelector: prev && !prev.classList.contains('rm-section-gap') ? cssPath(prev) : null,
      beforeSelector: next && !next.classList.contains('rm-section-gap') ? cssPath(next) : null,
    });
  }
  function askSpaceSize(sec) {
    const choice = prompt('Add space after this section. Size? (sm / md / lg)', 'md');
    if (!choice) return;
    const size = ['sm', 'md', 'lg'].includes(choice.trim().toLowerCase()) ? choice.trim().toLowerCase() : 'md';
    addAnnotation({
      type: 'space',
      selector: cssPath(sec),
      textPreview: textPreview(sec, 60),
      position: 'after',
      size,
    });
  }
  function applyLayoutVisualState() {
    // Apply delete + space + move visuals to the page (idempotent — clears + reapplies)
    document.querySelectorAll('.rm-section-deleted').forEach(el => el.classList.remove('rm-section-deleted'));
    document.querySelectorAll('.rm-space-marker').forEach(el => el.remove());
    state.annotations.forEach(a => {
      if (a.resolved) return;
      if (a.type === 'delete') {
        const el = findBySelector(a.selector);
        if (el) el.classList.add('rm-section-deleted');
      }
      if (a.type === 'space') {
        const el = findBySelector(a.selector);
        if (!el) return;
        const marker = document.createElement('div');
        marker.className = 'rm-space-marker';
        marker.textContent = `+ ${a.size.toUpperCase()} SPACE`;
        if (a.position === 'before') el.parentNode.insertBefore(marker, el);
        else el.parentNode.insertBefore(marker, el.nextSibling);
      }
    });
  }

  // ── add mode (palette + drag-to-insert) ───────────────────────────
  let palette = null;
  let lastDropTarget = null;
  const addCleanup = [];
  const INLINE_CARRIER_TAGS = /^(P|H1|H2|H3|H4|H5|H6|LI|A|SPAN|EM|STRONG|B|I|U|SMALL|MARK|IMG|VIDEO|BR|HR|INPUT|BUTTON|TEXTAREA|SELECT|LABEL|FIGCAPTION|CODE|KBD|SUB|SUP)$/i;
  function isInlineCarrier(el) {
    return el && INLINE_CARRIER_TAGS.test(el.tagName);
  }
  function isExcludedSibling(el) {
    return !!el && (
      el.classList.contains('rm-section-gap') ||
      el.classList.contains('rm-section-controls') ||
      el.classList.contains('rm-add-drop-indicator') ||
      el.classList.contains('rm-space-marker')
    );
  }
  function enterAddMode() {
    palette = document.createElement('div');
    palette.className = 'rm-palette';
    palette.innerHTML = '<h4>Drag onto page</h4>' + PALETTE.map(p => `
      <div class="rm-palette-item" draggable="true" data-pal="${p.key}">
        <span class="rm-pal-icon">${p.icon}</span>${p.label}
      </div>
    `).join('');
    root.appendChild(palette);
    palette.querySelectorAll('.rm-palette-item').forEach(item => {
      item.addEventListener('dragstart', e => {
        e.dataTransfer.setData('text/plain', 'rm-add:' + item.dataset.pal);
        e.dataTransfer.effectAllowed = 'copy';
      });
    });
    document.addEventListener('dragover', addDragOver, true);
    document.addEventListener('drop', addDrop, true);
    document.addEventListener('dragend', addDragEnd, true);
    addCleanup.push(() => {
      document.removeEventListener('dragover', addDragOver, true);
      document.removeEventListener('drop', addDrop, true);
      document.removeEventListener('dragend', addDragEnd, true);
    });
  }
  function exitAddMode() {
    if (palette) { palette.remove(); palette = null; }
    addCleanup.forEach(fn => { try { fn(); } catch (e) {} });
    addCleanup.length = 0;
    clearDropFeedback();
  }
  function clearDropFeedback() {
    if (lastDropTarget) lastDropTarget.classList.remove('rm-add-drop-target');
    lastDropTarget = null;
    document.querySelectorAll('.rm-add-drop-indicator').forEach(el => el.remove());
  }
  function getDropContainer(x, y) {
    const stack = document.elementsFromPoint(x, y);
    for (const node of stack) {
      if (!(node instanceof Element)) continue;
      if (node.closest('.rm-root')) continue;
      let el = node;
      // If the cursor is over an inline carrier (heading, paragraph, link…),
      // walk up to its block-level parent so we drop NEXT TO it, not inside it.
      while (el && el !== document.body && isInlineCarrier(el)) {
        el = el.parentElement;
      }
      if (!el || el === document.documentElement) continue;
      if (el.closest('.rm-root')) continue;
      // Don't drop directly into an existing added wrapper's content div;
      // drop into its parent container instead.
      if (el.closest('.rm-added-element')) {
        const wrapper = el.closest('.rm-added-element');
        el = wrapper.parentElement;
      }
      return el;
    }
    return null;
  }
  function positionIndicator(container, y) {
    document.querySelectorAll('.rm-add-drop-indicator').forEach(el => el.remove());
    const indicator = document.createElement('div');
    indicator.className = 'rm-add-drop-indicator';
    const kids = Array.from(container.children).filter(c => !isExcludedSibling(c));
    let before = null;
    for (const child of kids) {
      const r = child.getBoundingClientRect();
      if (y < r.top + r.height / 2) { before = child; break; }
    }
    if (before) container.insertBefore(indicator, before);
    else container.appendChild(indicator);
    return { indicator, before };
  }
  function addDragOver(e) {
    if (state.mode !== 'add') return;
    if (!e.dataTransfer.types.includes('text/plain')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const target = getDropContainer(e.clientX, e.clientY);
    if (lastDropTarget && lastDropTarget !== target) {
      lastDropTarget.classList.remove('rm-add-drop-target');
    }
    if (!target) { clearDropFeedback(); return; }
    lastDropTarget = target;
    target.classList.add('rm-add-drop-target');
    positionIndicator(target, e.clientY);
  }
  function addDragEnd() {
    clearDropFeedback();
  }
  function addDrop(e) {
    if (state.mode !== 'add') return;
    const data = e.dataTransfer.getData('text/plain') || '';
    if (!data.startsWith('rm-add:')) return;
    e.preventDefault();
    e.stopPropagation();
    const palKey = data.slice('rm-add:'.length);
    const pal = PALETTE.find(p => p.key === palKey);
    if (!pal) { clearDropFeedback(); return; }
    const zone = getDropContainer(e.clientX, e.clientY) || lastDropTarget;
    if (!zone) { clearDropFeedback(); return; }
    const { before } = positionIndicator(zone, e.clientY);
    const wrapper = buildAddedWrapper(pal);
    const id = uid();
    wrapper.dataset.rmAddedId = id;
    if (before) zone.insertBefore(wrapper, before);
    else zone.appendChild(wrapper);
    clearDropFeedback();
    const prevEl = wrapper.previousElementSibling;
    const nextEl = wrapper.nextElementSibling;
    const prev = prevEl && !isExcludedSibling(prevEl) ? cssPath(prevEl) : null;
    const next = nextEl && !isExcludedSibling(nextEl) ? cssPath(nextEl) : null;
    state.annotations.push({
      id,
      type: 'add',
      elementType: pal.key,
      html: wrapper.querySelector('.rm-added-content').innerHTML,
      parentSelector: cssPath(zone),
      afterSelector: prev,
      beforeSelector: next,
      reviewer: state.reviewer || 'anonymous',
      createdAt: new Date().toISOString(),
      resolved: false,
    });
    save();
    renderToolbar();
    renderPanel();
  }
  function buildAddedWrapper(pal) {
    const wrapper = document.createElement('div');
    wrapper.className = 'rm-added-element';
    wrapper.dataset.rmAddedType = pal.key;
    wrapper.style.margin = '12px 0';
    wrapper.innerHTML = `
      <button class="rm-added-remove" title="Remove">×</button>
      <div class="rm-added-content" contenteditable="true">${pal.html}</div>
    `;
    const content = wrapper.querySelector('.rm-added-content');
    content.addEventListener('focus', () => {
      state.activeEditEl = content;
      showFormatToolbar(content);
    });
    content.addEventListener('blur', () => {
      if (suppressBlur) return;
      hideFormatToolbar();
      if (state.activeEditEl === content) state.activeEditEl = null;
      const id = wrapper.dataset.rmAddedId;
      if (!id) return;
      updateAnnotation(id, { html: content.innerHTML });
    });
    wrapper.querySelector('.rm-added-remove').addEventListener('click', e => {
      e.stopPropagation();
      const id = wrapper.dataset.rmAddedId;
      if (id) deleteAnnotation(id);
      wrapper.remove();
    });
    return wrapper;
  }
  function replayAddedElements() {
    // Idempotent: only insert wrappers for annotations that don't already have one in the DOM.
    // Remove wrappers whose annotation no longer exists or was resolved/deleted.
    const activeAdds = state.annotations.filter(a => a.type === 'add' && !a.resolved);
    const activeIds = new Set(activeAdds.map(a => a.id));
    document.querySelectorAll('.rm-added-element').forEach(el => {
      const id = el.dataset.rmAddedId;
      if (!id || !activeIds.has(id)) el.remove();
    });
    activeAdds.forEach(a => {
      if (document.querySelector('.rm-added-element[data-rm-added-id="' + a.id + '"]')) return;
      const parent = findBySelector(a.parentSelector);
      if (!parent) return;
      const pal = PALETTE.find(p => p.key === a.elementType);
      if (!pal) return;
      const wrapper = buildAddedWrapper(pal);
      wrapper.querySelector('.rm-added-content').innerHTML = a.html;
      wrapper.dataset.rmAddedId = a.id;
      const anchor = a.afterSelector ? findBySelector(a.afterSelector) : null;
      const before = a.beforeSelector ? findBySelector(a.beforeSelector) : null;
      if (anchor && anchor.parentNode === parent) parent.insertBefore(wrapper, anchor.nextSibling);
      else if (before && before.parentNode === parent) parent.insertBefore(wrapper, before);
      else parent.appendChild(wrapper);
    });
  }

  // ── annotations ────────────────────────────────────────────────────
  function addAnnotation(data) {
    const a = Object.assign({
      id: uid(),
      reviewer: state.reviewer || 'anonymous',
      createdAt: new Date().toISOString(),
      resolved: false,
    }, data);
    state.annotations.push(a);
    save();
    renderAll();
  }
  function updateAnnotation(id, patch) {
    const a = state.annotations.find(x => x.id === id);
    if (!a) return;
    Object.assign(a, patch);
    save();
    renderAll();
  }
  function deleteAnnotation(id) {
    state.annotations = state.annotations.filter(a => a.id !== id);
    save();
    renderAll();
  }
  function clearAllAnnotations() {
    if (!state.annotations.length) return;
    const n = state.annotations.length;
    if (!confirm(`Clear all ${n} annotation${n === 1 ? '' : 's'} on this page?\n\nThe page will reload to restore the original layout.`)) return;
    state.annotations = [];
    localStorage.removeItem(STORAGE_KEY);
    window.location.reload();
  }

  // ── pin markers ────────────────────────────────────────────────────
  function renderPins() {
    root.querySelectorAll('.rm-pin').forEach(p => p.remove());
    document.querySelectorAll('.rm-pinned, .rm-edited').forEach(el => {
      el.classList.remove('rm-pinned', 'rm-edited');
    });

    state.annotations.forEach((a, i) => {
      if (a.type !== 'comment' && a.type !== 'edit') return;
      const el = findBySelector(a.selector);
      if (!el) return;
      if (a.type === 'edit') {
        el.classList.add('rm-edited');
      } else {
        el.classList.add('rm-pinned');
      }
      const rect = el.getBoundingClientRect();
      const pin = document.createElement('div');
      pin.className = 'rm-pin' + (a.resolved ? ' rm-pin-resolved' : '') + (a.type === 'edit' ? ' rm-pin-edit' : '');
      pin.innerHTML = '<span>' + (i + 1) + '</span>';
      const ax = (a.anchor && a.anchor.ax != null) ? a.anchor.ax : 0;
      const ay = (a.anchor && a.anchor.ay != null) ? a.anchor.ay : 0;
      const left = rect.left + window.scrollX + (rect.width * ax) - 14;
      const top = rect.top + window.scrollY + (rect.height * ay) - 14;
      pin.style.left = left + 'px';
      pin.style.top = top + 'px';
      pin.addEventListener('click', () => {
        state.panelOpen = true;
        renderPanel();
        const card = panel.querySelector('[data-id="' + a.id + '"]');
        if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      root.appendChild(pin);
    });
  }

  // ── side panel ─────────────────────────────────────────────────────
  function togglePanel() {
    state.panelOpen = !state.panelOpen;
    renderPanel();
  }
  function renderPanel() {
    panel.classList.toggle('rm-panel-open', state.panelOpen);
    const items = state.annotations.map((a, i) => renderCard(a, i)).join('') || `<div class="rm-panel-empty">No annotations yet.<br>Use 📌 Pin or ✏️ Edit to start.</div>`;
    panel.innerHTML = `
      <div class="rm-panel-header">
        <h3>Review (${state.annotations.length})</h3>
        <div class="rm-panel-header-actions">
          ${state.annotations.length ? '<button class="rm-panel-clear" title="Clear all annotations and reload">Clear all</button>' : ''}
          <button class="rm-panel-close">×</button>
        </div>
      </div>
      <div class="rm-panel-body">${items}</div>
    `;
    panel.querySelector('.rm-panel-close').addEventListener('click', () => { state.panelOpen = false; renderPanel(); });
    const clearBtn = panel.querySelector('.rm-panel-clear');
    if (clearBtn) clearBtn.addEventListener('click', clearAllAnnotations);
    panel.querySelectorAll('.rm-card').forEach(card => {
      const id = card.dataset.id;
      card.addEventListener('click', (e) => {
        if (e.target.closest('.rm-card-actions')) return;
        const a = state.annotations.find(x => x.id === id);
        if (!a) return;
        const el = findBySelector(a.selector);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      card.querySelector('.rm-toggle').addEventListener('click', e => {
        e.stopPropagation();
        const a = state.annotations.find(x => x.id === id);
        if (a) updateAnnotation(id, { resolved: !a.resolved });
      });
      card.querySelector('.rm-delete').addEventListener('click', e => {
        e.stopPropagation();
        if (confirm('Delete this annotation?')) deleteAnnotation(id);
      });
    });
  }
  function renderCard(a, i) {
    const labels = { comment: 'Comment', edit: 'Edit', draw: 'Draw', move: 'Move', delete: 'Delete', space: 'Add space', add: 'Add element' };
    const numClass = a.type === 'edit' || a.type === 'draw' ? 'rm-card-num rm-card-num-edit' : 'rm-card-num';
    let body = '';
    if (a.type === 'comment') {
      body = `<div class="rm-card-comment">${escapeHtml(a.comment)}</div>`;
    } else if (a.type === 'edit') {
      body = `<div class="rm-card-edit-diff">
        <div class="rm-before">${a.before}</div>
        <div class="rm-after">${a.after}</div>
      </div>`;
    } else if (a.type === 'draw') {
      body = `<div class="rm-card-comment" style="display:flex;align-items:center;gap:6px;">
        <span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:${a.color};"></span>
        Freehand stroke (${a.points.length} pts)
      </div>`;
    } else if (a.type === 'move') {
      body = `<div class="rm-card-comment">Moved → now ${a.afterSelector ? 'after <code>' + escapeHtml(a.afterSelector) + '</code>' : 'at start of container'}</div>`;
    } else if (a.type === 'delete') {
      body = `<div class="rm-card-comment" style="color:#991b1b;">Mark this section for deletion</div>`;
    } else if (a.type === 'space') {
      body = `<div class="rm-card-comment">Add <strong>${escapeHtml(a.size.toUpperCase())}</strong> space ${a.position} this section</div>`;
    } else if (a.type === 'add') {
      body = `<div class="rm-card-comment"><strong>${escapeHtml(a.elementType)}</strong><div style="margin-top:4px;font-family:ui-monospace,Menlo,monospace;font-size:11px;background:#f3f4f6;padding:6px;border-radius:4px;max-height:100px;overflow:auto;">${escapeHtml(a.html)}</div></div>`;
    }
    const target = a.selector || a.parentSelector || '';
    return `
      <div class="rm-card ${a.resolved ? 'rm-card-resolved' : ''}" data-id="${a.id}">
        <div class="rm-card-head">
          <div><span class="${numClass}">${i + 1}</span><strong>${labels[a.type] || a.type}</strong></div>
          <span class="rm-card-meta">${escapeHtml(a.reviewer)}</span>
        </div>
        <div class="rm-card-target" title="${escapeHtml(target)}">${escapeHtml(target)}</div>
        ${a.textPreview ? `<div class="rm-card-meta" style="margin-bottom:6px;">“${escapeHtml(a.textPreview)}”</div>` : ''}
        ${body}
        <div class="rm-card-actions">
          <button class="rm-toggle">${a.resolved ? 'Reopen' : 'Resolve'}</button>
          <button class="rm-delete rm-danger">Delete</button>
        </div>
      </div>
    `;
  }

  // ── export ─────────────────────────────────────────────────────────
  function openExport() {
    const payload = buildExport();
    const backdrop = document.createElement('div');
    backdrop.className = 'rm-modal-backdrop';
    backdrop.innerHTML = `
      <div class="rm-modal">
        <div class="rm-modal-header">
          <h3>Send review to Claude</h3>
          <button class="rm-panel-close rm-modal-close">×</button>
        </div>
        <div class="rm-modal-body">
          <textarea readonly></textarea>
        </div>
        <div class="rm-modal-footer">
          <span class="rm-hint">Paste this into Claude. Annotations stay saved locally until you clear them.</span>
          <div style="display:flex;gap:6px;">
            <button class="rm-clear">Clear all</button>
            <button class="rm-primary rm-copy">Copy</button>
          </div>
        </div>
      </div>
    `;
    root.appendChild(backdrop);
    const ta = backdrop.querySelector('textarea');
    ta.value = payload;
    ta.select();
    backdrop.querySelector('.rm-modal-close').addEventListener('click', () => backdrop.remove());
    backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.remove(); });
    backdrop.querySelector('.rm-copy').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(payload);
        const btn = backdrop.querySelector('.rm-copy');
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
      } catch (e) {
        ta.select(); document.execCommand('copy');
      }
    });
    backdrop.querySelector('.rm-clear').addEventListener('click', () => {
      backdrop.remove();
      clearAllAnnotations();
    });
  }

  function buildExport() {
    const url = window.location.href;
    const path = window.location.pathname;
    const when = new Date().toISOString();
    const reviewer = state.reviewer || 'anonymous';
    const lines = [];
    lines.push('# Lander Review');
    lines.push('');
    lines.push('**Page:** ' + url);
    lines.push('**Reviewer:** ' + reviewer);
    lines.push('**Date:** ' + when);
    lines.push('**Annotations:** ' + state.annotations.length);
    lines.push('');
    state.annotations.forEach((a, i) => {
      lines.push('---');
      lines.push('');
      lines.push('### ' + (i + 1) + '. ' + (a.type === 'edit' ? 'Text edit' : 'Comment') + (a.resolved ? '  _(resolved)_' : ''));
      lines.push('');
      lines.push('**Selector:** `' + a.selector + '`');
      if (a.textPreview) lines.push('**Element text:** "' + a.textPreview + '"');
      lines.push('');
      if (a.type === 'edit') {
        lines.push('**Before:**');
        lines.push('```html');
        lines.push(a.before);
        lines.push('```');
        lines.push('**After:**');
        lines.push('```html');
        lines.push(a.after);
        lines.push('```');
      } else if (a.type === 'comment') {
        lines.push('**Comment:**');
        lines.push('');
        lines.push(a.comment);
      } else if (a.type === 'draw') {
        lines.push('**Freehand stroke** drawn over this section.');
        lines.push(`Color: ${a.color} · Stroke width: ${a.strokeWidth}px · ${a.points.length} points (coords normalized to section bbox)`);
      } else if (a.type === 'move') {
        lines.push('**Move this section.**');
        if (a.afterSelector) lines.push('New position: directly after `' + a.afterSelector + '`');
        else if (a.beforeSelector) lines.push('New position: directly before `' + a.beforeSelector + '`');
        else lines.push('New position: start of parent container');
        lines.push(`From index ${a.fromIndex} → to index ${a.toIndex}`);
      } else if (a.type === 'delete') {
        lines.push('**Delete this section.**');
      } else if (a.type === 'space') {
        lines.push(`**Add ${a.size.toUpperCase()} vertical space ${a.position} this section.**`);
        lines.push('Suggested mapping: sm = 24px, md = 48px, lg = 96px (adjust to brand spacing scale).');
      } else if (a.type === 'add') {
        lines.push(`**Add new element** (type: ${a.elementType})`);
        lines.push('Parent: `' + a.parentSelector + '`');
        if (a.afterSelector) lines.push('Insert after: `' + a.afterSelector + '`');
        else if (a.beforeSelector) lines.push('Insert before: `' + a.beforeSelector + '`');
        else lines.push('Append to end of parent.');
        lines.push('Content (rough HTML — restyle to match brand):');
        lines.push('```html');
        lines.push(a.html);
        lines.push('```');
      }
      lines.push('');
    });
    lines.push('---');
    lines.push('');
    lines.push('<details><summary>Raw JSON (for Claude)</summary>');
    lines.push('');
    lines.push('```json');
    lines.push(JSON.stringify({ page: path, url, reviewer, when, annotations: state.annotations }, null, 2));
    lines.push('```');
    lines.push('');
    lines.push('</details>');
    return lines.join('\n');
  }

  // ── render orchestration ───────────────────────────────────────────
  function renderAll() {
    renderToolbar();
    renderPins();
    renderStrokes();
    applyLayoutVisualState();
    replayAddedElements();
    renderPanel();
    resizeDrawSvg();
  }

  // ── event wiring ───────────────────────────────────────────────────
  document.addEventListener('mouseover', handleHover, true);
  document.addEventListener('mouseout', e => {
    if (state.hoverEl) state.hoverEl.classList.remove('rm-hover-target');
  }, true);
  document.addEventListener('click', handleClick, true);
  window.addEventListener('scroll', () => requestAnimationFrame(() => { renderPins(); renderStrokes(); }), { passive: true });
  window.addEventListener('resize', () => requestAnimationFrame(() => { renderPins(); renderStrokes(); resizeDrawSvg(); }));
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { setMode(null); closePopover(); }
  });

  // ── boot ───────────────────────────────────────────────────────────
  load();
  renderAll();
  console.log('[review-mode] Active. Annotations:', state.annotations.length);
})();
