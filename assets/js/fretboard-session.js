/**
 * Fretnoodle — Sessions: autosave, files, share links and PDF notes
 *
 * Drives the Session menu in the header of fretboard-visualiser.html.
 *
 *   Autosave     Every change is kept in this browser (localStorage) and
 *                restored on the next visit.
 *   Names        Saving a file or a PDF first asks for the progression's
 *                name (prefilled), which titles the PDF and names the file.
 *   Files        Save as file / Open file read and write the session as
 *                .json (⌘S / ⌘O, or Ctrl on Windows).
 *   Share link   The whole session, drawings included, deflate-compressed
 *                into the page URL after #s= (plain base64 after #session=
 *                where the browser can't compress).
 *   PDF          One page per chord (its shape with drawings, and the full
 *                map) after a summary page. Every page links back to the
 *                progression through its share link. The pages are drawn on
 *                a canvas and wrapped in a small hand-built PDF, so no
 *                library or network connection is needed.
 *
 * The session data itself comes from window.Fretnoodle.serializeSession()
 * and goes back in through loadSession() (section 13 of
 * fretboard-visualiser.js). Load after fretboard-visualiser.js.
 */
(function () {
  'use strict';

  var app = window.Fretnoodle;
  if (!app) return;

  var STORAGE_KEY = 'fretnoodle.session';
  var LINK_PARAM = 's';             // compressed share links
  var PLAIN_LINK_PARAM = 'session'; // uncompressed share links
  var AUTOSAVE_DELAY_MS = 600;
  var IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

  function byId(id) { return document.getElementById(id); }

  /* ========================================================================
   * Helpers
   * ===================================================================== */

  var toastTimer = null;

  /** Short message at the bottom of the screen, with an optional action button. */
  function toast(text, actionLabel, onAction) {
    var toastEl = byId('toast');
    var action = byId('toastAction');
    byId('toastText').textContent = text;
    action.hidden = !actionLabel;
    action.textContent = actionLabel || '';
    action.onclick = function () { hideToast(); onAction(); };
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, actionLabel ? 9000 : 3500);
  }

  function hideToast() { byId('toast').hidden = true; }

  /** "Blues in A" → "blues-in-a" for file names. */
  function fileBaseName() {
    var title = app.getState().title || app.suggestTitle();
    var slug = title.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
    return slug || 'fretnoodle-progression';
  }

  function download(blob, filename) {
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000);
  }

  /** Replace the session, offering Undo back to what was there before. */
  function replaceSession(data, message, undoLabel, previous) {
    var before = previous || app.serializeSession();
    app.loadSession(data);
    toast(message, undoLabel || 'Undo', function () {
      app.loadSession(before);
      toast('Back to your previous session');
    });
  }

  /* ========================================================================
   * Autosave
   * ===================================================================== */

  var saveTimer = null;
  var lastSaved = '';
  var restoring = true;   // no saving until the start-up session has loaded

  function scheduleSave() {
    if (restoring || saveTimer) return;
    saveTimer = setTimeout(function () { saveTimer = null; saveNow(); }, AUTOSAVE_DELAY_MS);
  }

  function saveNow() {
    var json = JSON.stringify(app.serializeSession());
    if (json === lastSaved) return;
    try {
      localStorage.setItem(STORAGE_KEY, json);
      lastSaved = json;
      setSaveStatus('Saved automatically in this browser · ' + timeNow(), true);
    } catch (error) {
      // Usually the storage quota: keep the chords, drop the drawings.
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(app.serializeSession({ drawings: false })));
        lastSaved = json;
        setSaveStatus('Saved in this browser, but the drawings are too big to keep here. Save as a file to keep them.', true);
      } catch (secondError) {
        setSaveStatus('This browser can’t keep sessions (private window?). Use Save as file instead.', false);
      }
    }
  }

  function readSaved() {
    try {
      var json = localStorage.getItem(STORAGE_KEY);
      return json ? JSON.parse(json) : null;
    } catch (error) {
      return null;
    }
  }

  function setSaveStatus(text, ok) {
    byId('sessionStatus').textContent = text;
    byId('sessionSavedDot').classList.toggle('is-off', !ok);
  }

  function timeNow() {
    return new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  /* ========================================================================
   * Files
   * ===================================================================== */

  function saveFile() {
    askName('Save file', function () {
      var data = app.serializeSession();
      data.savedAt = new Date().toISOString();
      var filename = fileBaseName() + '.json';
      download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), filename);
      closeMenu();
      toast('Saved ' + filename);
    });
  }

  function openFile() {
    var input = byId('sessionFileInput');
    input.value = '';
    input.click();
  }

  function onFileChosen(event) {
    var file = event.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        replaceSession(JSON.parse(reader.result), 'Opened ' + file.name);
        closeMenu();
      } catch (error) {
        toast(error instanceof SyntaxError ? 'That file isn’t a Fretnoodle session.' : error.message);
      }
    };
    reader.readAsText(file);
  }

  /* ========================================================================
   * Share links
   * ===================================================================== */

  var canCompress = typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';

  function bytesToBase64Url(bytes) {
    var binary = '';
    for (var i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function base64UrlToBytes(text) {
    var base64 = text.replace(/-/g, '+').replace(/_/g, '/');
    var binary = atob(base64 + '==='.slice((base64.length + 3) % 4));
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  async function pipeBytes(bytes, transform) {
    var stream = new Blob([bytes]).stream().pipeThrough(transform);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /** A link that opens the current session, drawings included. */
  async function shareUrl() {
    var json = new TextEncoder().encode(JSON.stringify(app.serializeSession()));
    var base = location.href.split('#')[0] + '#';
    if (!canCompress) return base + PLAIN_LINK_PARAM + '=' + bytesToBase64Url(json);
    return base + LINK_PARAM + '=' + bytesToBase64Url(await pipeBytes(json, new CompressionStream('deflate-raw')));
  }

  async function shareLink() {
    var input = byId('shareLinkInput');
    byId('shareLinkRow').hidden = false;
    input.value = await shareUrl();
    copyLink();
  }

  function copyLink() {
    var input = byId('shareLinkInput');
    var done = function () { toast('Link copied. Anyone who opens it gets this progression'); };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(input.value).then(done, function () { selectLink(input); });
    } else {
      selectLink(input);
      try { if (document.execCommand('copy')) done(); } catch (error) { /* copy by hand */ }
    }
  }

  function selectLink(input) {
    input.focus();
    input.select();
  }

  /** The session in the URL, if the page was opened from a share link. */
  async function sessionFromUrl() {
    var params = {};
    location.hash.slice(1).split('&').forEach(function (pair) {
      var at = pair.indexOf('=');
      if (at > 0) params[pair.slice(0, at)] = pair.slice(at + 1);
    });
    var packed = params[LINK_PARAM];
    var plain = params[PLAIN_LINK_PARAM];
    if (!packed && !plain) return null;
    try {
      var bytes = packed
        ? await pipeBytes(base64UrlToBytes(packed), new DecompressionStream('deflate-raw'))
        : base64UrlToBytes(plain);
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch (error) {
      toast('That share link looks broken, so your own session was opened instead.');
      return null;
    }
  }

  /* ========================================================================
   * PDF notes
   *
   * Pages are designed on a 1123 × 794 grid (A4 landscape at 96 dpi) and
   * drawn at PAGE_SCALE× for print sharpness. The fretboard is redrawn from
   * the live page's geometry, so the paint canvases line up exactly.
   * ===================================================================== */

  var PAGE_WIDTH = 1123;
  var PAGE_HEIGHT = 794;
  var PAGE_SCALE = 2;
  var MARGIN = 48;

  var INK = '#f3f1ea';
  var MUTED = '#8f8f8f';
  var SOFT = '#bdb8ad';
  var LINE = '#262626';

  var accentColor = '#FFF000';

  function exportPdf() {
    askName('Export PDF', makePdf);
  }

  async function makePdf() {
    var button = byId('sessionPdf');
    var status = byId('sessionStatus').textContent;
    var statusOk = !byId('sessionSavedDot').classList.contains('is-off');
    button.disabled = true;
    setSaveStatus('Making your PDF…', statusOk);
    try {
      await loadFonts();
      accentColor = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || accentColor;
      var geometry = measureBoard();
      var state = app.getState();
      var link = await shareUrl();

      var pages = [renderSummaryPage(state, link)];
      state.chords.forEach(function (chord, index) {
        pages.push(renderChordPage(state, chord, index, geometry));
      });
      pages.forEach(function (page, index) { drawFooter(page, index + 1, pages.length, link); });

      var jpegs = pages.map(function (page) { return dataUrlToBytes(page.canvas.toDataURL('image/jpeg', 0.9)); });
      var links = pages.map(function (page) { return page.links; });
      download(buildPdf(jpegs, PAGE_SCALE, links, state.title || app.suggestTitle()), fileBaseName() + '.pdf');
      closeMenu();
      toast('PDF saved: ' + pages.length + (pages.length === 1 ? ' page' : ' pages'));
    } catch (error) {
      toast('Sorry, the PDF could not be made: ' + error.message);
    } finally {
      button.disabled = false;
      setSaveStatus(status, statusOk);
    }
  }

  function loadFonts() {
    if (!document.fonts) return Promise.resolve();
    return Promise.all([
      '400 64px Fraunces', 'italic 300 36px Fraunces', 'italic 400 28px Fraunces',
      '700 16px Fraunces', '600 20px Fraunces', '400 13px Inter', '600 11px Inter'
    ].map(function (font) { return document.fonts.load(font).catch(function () {}); }));
  }

  function newPage() {
    var canvas = document.createElement('canvas');
    canvas.width = PAGE_WIDTH * PAGE_SCALE;
    canvas.height = PAGE_HEIGHT * PAGE_SCALE;
    var ctx = canvas.getContext('2d');
    ctx.scale(PAGE_SCALE, PAGE_SCALE);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
    ctx.textBaseline = 'alphabetic';
    return { canvas: canvas, ctx: ctx, links: [] };   // links: clickable areas in page units
  }

  function measure(ctx, value, font) {
    ctx.font = font;
    return ctx.measureText(value).width;
  }

  /** Draw text and return its width. */
  function text(ctx, value, x, y, font, color, align, spacing) {
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textAlign = align || 'left';
    if ('letterSpacing' in ctx) ctx.letterSpacing = spacing || '0px';
    ctx.fillText(value, x, y);
    var width = ctx.measureText(value).width;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    return width;
  }

  function eyebrow(ctx, value, x, y, align) {
    return text(ctx, value.toUpperCase(), x, y, '600 10px Inter, sans-serif', MUTED, align, '1.6px');
  }

  function brand(ctx, x, y, size) {
    var width = text(ctx, 'fretnoodle', x, y, 'italic 400 ' + size + 'px Fraunces, Georgia, serif', INK);
    ctx.fillStyle = accentColor;
    ctx.beginPath();
    ctx.arc(x + width + size * 0.3, y - size * 0.12, size * 0.13, 0, Math.PI * 2);
    ctx.fill();
  }

  /** "E" + italic "minMaj7", returns the width used. */
  function chordName(ctx, description, x, y, size) {
    if (!description) return text(ctx, 'Empty chord', x, y, 'italic 300 ' + size * 0.6 + 'px Fraunces, Georgia, serif', SOFT);
    var rootWidth = text(ctx, description.root, x, y, '400 ' + size + 'px Fraunces, Georgia, serif', INK, 'left', (-size * 0.02) + 'px');
    var qualityWidth = text(ctx, description.quality, x + rootWidth + size * 0.06, y,
      'italic 300 ' + Math.round(size * 0.56) + 'px Fraunces, Georgia, serif', SOFT);
    return rootWidth + size * 0.06 + qualityWidth;
  }

  function resolveColor(color) {
    return color.indexOf('var(') === 0 ? accentColor : color;
  }

  function roundedRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + width, y, x + width, y + height, radius);
    ctx.arcTo(x + width, y + height, x, y + height, radius);
    ctx.arcTo(x, y + height, x, y, radius);
    ctx.arcTo(x, y, x + width, y, radius);
    ctx.closePath();
  }

  function renderSummaryPage(state, link) {
    var page = newPage();
    var ctx = page.ctx;

    brand(ctx, MARGIN, MARGIN + 26, 30);
    eyebrow(ctx, 'Session notes · ' + new Date().toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' }),
      PAGE_WIDTH - MARGIN, MARGIN + 20, 'right');

    // "Open in Fretnoodle" button, linked to the share link.
    var label = 'Open this progression in Fretnoodle';
    var buttonWidth = measure(ctx, label, '600 13px Inter, sans-serif') + 64;
    var buttonX = PAGE_WIDTH - MARGIN - buttonWidth;

    // The progression's name, shrunk to fit beside the button.
    var title = state.title || 'Your progression';
    var titleSize = 56;
    while (titleSize > 26 && measure(ctx, title, '400 ' + titleSize + 'px Fraunces, Georgia, serif') > buttonX - MARGIN - 32) titleSize -= 2;
    text(ctx, title, MARGIN, 190, '400 ' + titleSize + 'px Fraunces, Georgia, serif', INK, 'left', '-1px');
    eyebrow(ctx, state.chords.length + (state.chords.length === 1 ? ' chord' : ' chords') + ' · ' + state.bpm + ' bpm · 4/4', MARGIN, 224);

    var buttonY = 150;
    roundedRect(ctx, buttonX, buttonY, buttonWidth, 44, 22);
    ctx.fillStyle = accentColor;
    ctx.fill();
    ctx.textBaseline = 'middle';
    text(ctx, label, buttonX + 24, buttonY + 23, '600 13px Inter, sans-serif', '#0a0a0a');
    ctx.textBaseline = 'alphabetic';
    drawArrow(ctx, buttonX + buttonWidth - 30, buttonY + 22, '#0a0a0a');
    eyebrow(ctx, 'Click to reopen it, ready to play', PAGE_WIDTH - MARGIN, buttonY + 66, 'right');
    page.links.push({ x: buttonX, y: buttonY, width: buttonWidth, height: 44, url: link });

    // Chord cards, wrapping onto new rows.
    var x = MARGIN;
    var y = 262;
    var cardHeight = 92;
    state.chords.forEach(function (chord) {
      var description = app.describeChord(chord);
      var nameWidth = description
        ? measure(ctx, description.root, '400 30px Fraunces, Georgia, serif') + 2 +
          measure(ctx, description.quality, 'italic 300 17px Fraunces, Georgia, serif')
        : 90;
      var cardWidth = Math.max(110, nameWidth + 40);
      if (x + cardWidth > PAGE_WIDTH - MARGIN) { x = MARGIN; y += cardHeight + 12; }
      roundedRect(ctx, x, y, cardWidth, cardHeight, 14);
      ctx.strokeStyle = LINE;
      ctx.lineWidth = 1;
      ctx.stroke();
      chordName(ctx, description, x + 20, y + 46, 30);
      eyebrow(ctx, chord.bars + (chord.bars === 1 ? ' bar' : ' bars'), x + 20, y + 72);
      x += cardWidth + 12;
    });

    // Details row.
    var detailsY = y + cardHeight + 64;
    var tuning = [5, 4, 3, 2, 1, 0].map(app.openStringName).join(' ');
    var details = [
      ['Tempo', state.bpm + ' bpm'],
      ['Tuning (low to high)', tuning],
      ['Transpose', (state.transposeOffset > 0 ? '+' : '') + state.transposeOffset + ' semitones'],
      ['Dot labels', state.labelMode === 'notes' ? 'Note names' : 'Intervals']
    ];
    var columnWidth = (PAGE_WIDTH - MARGIN * 2) / details.length;
    details.forEach(function (detail, i) {
      eyebrow(ctx, detail[0], MARGIN + columnWidth * i, detailsY);
      text(ctx, detail[1], MARGIN + columnWidth * i, detailsY + 30, '400 22px Fraunces, Georgia, serif', INK);
    });

    // How to read the pages.
    var keyY = Math.min(detailsY + 90, PAGE_HEIGHT - 150);
    ctx.fillStyle = accentColor;
    ctx.fillRect(MARGIN, keyY, 2, 62);
    eyebrow(ctx, 'How to read these notes', MARGIN + 18, keyY + 12);
    var body = '400 13px Inter, sans-serif';
    text(ctx, 'Each chord gets a page: the notes you entered (with your drawings), then every place those notes appear on the neck.', MARGIN + 18, keyY + 34, body, SOFT);
    text(ctx, 'R root · b3 / M3 minor / major 3rd · P4 4th · b5 / P5 flat / perfect 5th · M6 6th · b7 / M7 flat / major 7th · ringed dots are your shape.', MARGIN + 18, keyY + 54, body, SOFT);

    return page;
  }

  function renderChordPage(state, chord, index, geometry) {
    var page = newPage();
    var ctx = page.ctx;
    var description = app.describeChord(chord);

    eyebrow(ctx, (state.title ? state.title + ' · ' : '') + 'Chord ' + (index + 1) + ' of ' + state.chords.length + ' · ' + chord.bars + (chord.bars === 1 ? ' bar' : ' bars'),
      MARGIN, MARGIN + 10);
    brand(ctx, PAGE_WIDTH - MARGIN - 10 - measure(ctx, 'fretnoodle', 'italic 400 20px Fraunces, Georgia, serif'), MARGIN + 12, 20);
    chordName(ctx, description, MARGIN, MARGIN + 80, 64);

    // Tone chips.
    var chipX = MARGIN;
    var chipY = MARGIN + 100;
    (description ? description.tones : []).forEach(function (tone) {
      var width = 34 + measure(ctx, tone.note, '400 16px Fraunces, Georgia, serif') + 14;
      ctx.globalAlpha = 1;
      roundedRect(ctx, chipX, chipY, width, 34, 17);
      ctx.strokeStyle = LINE;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.globalAlpha = tone.excluded ? 0.3 : 1;
      ctx.fillStyle = resolveColor(tone.color);
      ctx.beginPath();
      ctx.arc(chipX + 17, chipY + 17, 13, 0, Math.PI * 2);
      ctx.fill();
      ctx.textBaseline = 'middle';
      text(ctx, tone.label, chipX + 17, chipY + 17.5, '700 10px Fraunces, Georgia, serif', '#0a0a0a', 'center');
      ctx.globalAlpha = 1;
      text(ctx, tone.note, chipX + 36, chipY + 18, '400 16px Fraunces, Georgia, serif', '#e7e3d9');
      ctx.textBaseline = 'alphabetic';
      chipX += width + 8;
    });

    // Two boards stacked, as big as the page allows.
    var top = MARGIN + 160;
    var bottom = PAGE_HEIGHT - MARGIN - 24;
    var labelHeight = 20;
    var gap = 24;
    var boardHeight = Math.min((bottom - top - gap - labelHeight * 2) / 2, (PAGE_WIDTH - MARGIN * 2) * geometry.height / geometry.width);
    var scale = boardHeight / geometry.height;

    eyebrow(ctx, app.getDrawing(chord) ? 'Your shape and drawings' : 'Your shape', MARGIN, top + 10);
    drawBoard(ctx, geometry, chord, false, true, MARGIN, top + labelHeight, scale);

    var secondTop = top + labelHeight + boardHeight + gap;
    eyebrow(ctx, 'Every chord tone on the neck · your shape ringed in white', MARGIN, secondTop + 10);
    drawBoard(ctx, geometry, chord, true, false, MARGIN, secondTop + labelHeight, scale);

    return page;
  }

  function drawFooter(page, number, total, link) {
    var ctx = page.ctx;
    var y = PAGE_HEIGHT - MARGIN + 18;
    var x = MARGIN + eyebrow(ctx, 'Made with fretnoodle · ', MARGIN, y);
    var width = text(ctx, 'OPEN THIS PROGRESSION', x, y, '600 10px Inter, sans-serif', accentColor, 'left', '1.6px');
    drawArrow(ctx, x + width + 8, y - 3.5, accentColor, 0.6);
    page.links.push({ x: x - 4, y: y - 14, width: width + 22, height: 22, url: link });
    eyebrow(ctx, number + ' / ' + total, PAGE_WIDTH - MARGIN, y, 'right');
  }

  /** Small ↗ arrow centred on (x, y). */
  function drawArrow(ctx, x, y, color, size) {
    var s = 6 * (size || 1);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x - s, y + s);
    ctx.lineTo(x + s, y - s);
    ctx.moveTo(x - s * 0.3, y - s);
    ctx.lineTo(x + s, y - s);
    ctx.lineTo(x + s, y + s * 0.3);
    ctx.stroke();
    ctx.restore();
  }

  /** Positions of everything on the live fretboard, relative to its frame. */
  function measureBoard() {
    var frame = byId('fretboardFrame');
    var origin = frame.getBoundingClientRect();
    function relative(el) {
      var rect = el.getBoundingClientRect();
      return { left: rect.left - origin.left, top: rect.top - origin.top, width: rect.width, height: rect.height };
    }
    function all(selector) { return Array.prototype.map.call(frame.querySelectorAll(selector), relative); }

    var geometry = {
      width: frame.offsetWidth,
      height: frame.offsetHeight,
      strings: all('.strings .string'),
      inlays: all('.fret-inlay'),
      wires: all('.fret-wire'),
      numbers: all('#fretNumbers div'),
      cells: []
    };
    if (!geometry.width) throw new Error('the fretboard is not on screen');
    for (var string = 0; string < 6; string++) {
      geometry.cells.push([]);
      for (var fret = 0; fret <= 18; fret++) {
        geometry.cells[string].push(relative(frame.querySelector('.fret-cell[data-string="' + string + '"][data-fret="' + fret + '"]')));
      }
    }
    return geometry;
  }

  function drawBoard(ctx, geometry, chord, fullMap, withDrawing, x, y, scale) {
    var state = app.getState();
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.beginPath();
    ctx.rect(0, 0, geometry.width, geometry.height);
    ctx.clip();

    ctx.fillStyle = '#2b2216';
    geometry.inlays.forEach(function (r) { ctx.fillRect(r.left, r.top, r.width, r.height); });

    var gradient = ctx.createLinearGradient(0, 0, geometry.width, 0);
    gradient.addColorStop(0, '#3f9a98');
    gradient.addColorStop(0.5, '#4c98a0');
    gradient.addColorStop(0.78, '#8c93b5');
    gradient.addColorStop(1, '#cf8fbd');
    ctx.fillStyle = gradient;
    geometry.strings.forEach(function (r) { ctx.fillRect(0, r.top, geometry.width, Math.max(1.5, r.height)); });

    ctx.fillStyle = '#ebe8e1';
    geometry.wires.forEach(function (r) { ctx.fillRect(r.left, r.top, r.width, r.height); });

    ctx.textBaseline = 'middle';
    if (state.showNoteNames) {
      geometry.cells.forEach(function (row, string) {
        row.forEach(function (cell, fret) {
          text(ctx, app.noteName(string, fret), cell.left + 7, cell.top + cell.height / 2 - 2,
            '400 19px Fraunces, Georgia, serif', '#4a4a4a');
        });
      });
    }

    app.chordDots(chord, fullMap).forEach(function (dot) {
      var cell = geometry.cells[dot.string][dot.fret];
      var cx = cell.left + cell.width / 2;
      var cy = cell.top + cell.height / 2;
      ctx.globalAlpha = dot.excluded ? 0.3 : 1;
      ctx.fillStyle = resolveColor(dot.color);
      ctx.beginPath();
      ctx.arc(cx, cy, 21, 0, Math.PI * 2);
      ctx.fill();
      if (dot.ringed) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(cx, cy, 22.5, 0, Math.PI * 2);
        ctx.stroke();
      }
      text(ctx, dot.label, cx, cy + 1, '700 16px Fraunces, Georgia, serif', '#0a0a0a', 'center', '-0.3px');
      ctx.globalAlpha = 1;
    });

    geometry.numbers.forEach(function (r, fret) {
      text(ctx, String(fret), r.left + r.width / 2, r.top + r.height / 2, '600 25px Fraunces, Georgia, serif', INK, 'center');
    });
    ctx.textBaseline = 'alphabetic';

    var drawing = withDrawing && app.getDrawing(chord);
    if (drawing) ctx.drawImage(drawing, 0, 0, geometry.width, geometry.height);
    ctx.restore();
  }

  /** Any text as a PDF string (UTF-16BE hex), so accents and symbols survive. */
  function pdfText(value) {
    var hex = 'FEFF';
    for (var i = 0; i < value.length; i++) hex += value.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0');
    return '<' + hex + '>';
  }

  function dataUrlToBytes(dataUrl) {
    var binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  /**
   * A minimal PDF: one A4 landscape page per JPEG, each image filling its page,
   * with optional clickable links (`links[page]`: areas in page units).
   * Objects: 1 catalog, 2 page tree, 3 info, then page / contents / image per
   * page, then one annotation per link.
   */
  function buildPdf(jpegs, scale, links, title) {
    var pageWidth = 842;
    var pageHeight = 595;
    var chunks = [];
    var offsets = [];
    var length = 0;

    function add(part) {
      var bytes = typeof part === 'string' ? new TextEncoder().encode(part) : part;
      chunks.push(bytes);
      length += bytes.length;
    }
    function object(number, body) {
      offsets[number] = length;
      add(number + ' 0 obj\n' + body + '\nendobj\n');
    }

    add('%PDF-1.4\n%âãÏÓ\n');
    var kids = jpegs.map(function (jpeg, i) { return (4 + i * 3) + ' 0 R'; }).join(' ');
    object(1, '<< /Type /Catalog /Pages 2 0 R >>');
    object(2, '<< /Type /Pages /Kids [' + kids + '] /Count ' + jpegs.length + ' >>');
    object(3, '<< /Title ' + pdfText(title || 'Fretnoodle session notes') + ' /Producer (Fretnoodle) >>');

    // Link annotations are numbered after all the pages.
    var points = pageWidth / PAGE_WIDTH;
    var annotations = [];
    var annotationRefs = jpegs.map(function (jpeg, i) {
      return ((links && links[i]) || []).map(function (area) {
        annotations.push(area);
        return (4 + jpegs.length * 3 + annotations.length - 1) + ' 0 R';
      });
    });

    jpegs.forEach(function (jpeg, i) {
      var pageNumber = 4 + i * 3;
      var drawing = 'q ' + pageWidth + ' 0 0 ' + pageHeight + ' 0 0 cm /Im0 Do Q';
      var annots = annotationRefs[i].length ? ' /Annots [' + annotationRefs[i].join(' ') + ']' : '';
      object(pageNumber, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + pageWidth + ' ' + pageHeight + ']' +
        ' /Resources << /XObject << /Im0 ' + (pageNumber + 2) + ' 0 R >> >> /Contents ' + (pageNumber + 1) + ' 0 R' + annots + ' >>');
      object(pageNumber + 1, '<< /Length ' + drawing.length + ' >>\nstream\n' + drawing + '\nendstream');

      offsets[pageNumber + 2] = length;
      add((pageNumber + 2) + ' 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + PAGE_WIDTH * scale +
        ' /Height ' + PAGE_HEIGHT * scale + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode' +
        ' /Length ' + jpeg.length + ' >>\nstream\n');
      add(jpeg);
      add('\nendstream\nendobj\n');
    });

    annotations.forEach(function (area, i) {
      var x1 = (area.x * points).toFixed(2);
      var y1 = (pageHeight - (area.y + area.height) * points).toFixed(2);
      var x2 = ((area.x + area.width) * points).toFixed(2);
      var y2 = (pageHeight - area.y * points).toFixed(2);
      var uri = area.url.replace(/[\\()]/g, '\\$&');
      object(4 + jpegs.length * 3 + i, '<< /Type /Annot /Subtype /Link /Rect [' + [x1, y1, x2, y2].join(' ') + ']' +
        ' /Border [0 0 0] /A << /S /URI /URI (' + uri + ') >> >>');
    });

    var objectCount = 4 + jpegs.length * 3 + annotations.length;
    var xrefStart = length;
    var xref = 'xref\n0 ' + objectCount + '\n0000000000 65535 f \n';
    for (var n = 1; n < objectCount; n++) xref += String(offsets[n]).padStart(10, '0') + ' 00000 n \n';
    add(xref + 'trailer\n<< /Size ' + objectCount + ' /Root 1 0 R /Info 3 0 R >>\nstartxref\n' + xrefStart + '\n%%EOF\n');

    return new Blob(chunks, { type: 'application/pdf' });
  }

  /* ========================================================================
   * Menu and wiring
   * ===================================================================== */

  var menuButton = byId('sessionButton');
  var panel = byId('sessionPanel');

  function openMenu() {
    panel.hidden = false;
    menuButton.setAttribute('aria-expanded', 'true');
  }

  function closeMenu() {
    panel.hidden = true;
    menuButton.setAttribute('aria-expanded', 'false');
    byId('shareLinkRow').hidden = true;
    showNameStep(false);
  }

  var afterNaming = null;

  /** Ask for the progression's name (prefilled), then run `then`. */
  function askName(confirmLabel, then) {
    openMenu();
    afterNaming = then;
    var input = byId('sessionNameInput');
    input.value = app.getState().title || app.suggestTitle();
    byId('sessionNameConfirm').textContent = confirmLabel;
    showNameStep(true);
    input.focus();
    input.select();
  }

  function showNameStep(show) {
    byId('sessionNameStep').hidden = !show;
    byId('sessionItems').hidden = show;
    if (!show) afterNaming = null;
  }

  function confirmName(event) {
    event.preventDefault();
    var then = afterNaming;
    app.setState({ title: byId('sessionNameInput').value.trim().slice(0, 80) });
    showNameStep(false);
    if (then) then();
  }

  menuButton.addEventListener('click', function () { if (panel.hidden) openMenu(); else closeMenu(); });
  document.addEventListener('click', function (event) {
    if (!panel.hidden && !event.target.closest('.session-menu')) closeMenu();
  });
  byId('sessionSaveFile').addEventListener('click', saveFile);
  byId('sessionOpenFile').addEventListener('click', openFile);
  byId('sessionFileInput').addEventListener('change', onFileChosen);
  byId('sessionShare').addEventListener('click', shareLink);
  byId('shareLinkCopy').addEventListener('click', copyLink);
  byId('sessionPdf').addEventListener('click', exportPdf);
  byId('sessionNameStep').addEventListener('submit', confirmName);
  byId('sessionNameCancel').addEventListener('click', function () { showNameStep(false); });

  window.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !panel.hidden) { closeMenu(); menuButton.focus(); return; }
    if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
    var key = event.key.toLowerCase();
    if (key === 's') {
      event.preventDefault();
      if (!byId('sessionNameStep').hidden) byId('sessionNameStep').requestSubmit();
      else saveFile();
    }
    if (key === 'o') { event.preventDefault(); openFile(); }
  });

  if (!IS_MAC) {
    panel.querySelectorAll('kbd').forEach(function (kbd) { kbd.textContent = kbd.textContent.replace('⌘', 'Ctrl '); });
  }

  app.on('change', scheduleSave);
  app.on('drawing', scheduleSave);
  window.addEventListener('pagehide', function () { if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; saveNow(); } });

  /* Start-up: the autosave comes back straight away; a share link (which
     takes a moment to unpack) then replaces it, keeping it for "Back to mine". */
  var saved = readSaved();
  try {
    if (saved) app.loadSession(saved);
  } catch (error) {
    saved = null;
    toast('Your saved session couldn’t be opened, so you’re starting fresh.');
  }

  openSharedLink(saved).then(function () {
    restoring = false;
    lastSaved = JSON.stringify(app.serializeSession());
    if (readSaved()) setSaveStatus('Saved automatically in this browser', true);
  });

  async function openSharedLink(previous) {
    var shared = await sessionFromUrl();
    if (!shared) return;
    history.replaceState(null, '', location.href.split('#')[0]);
    try {
      if (previous) replaceSession(shared, 'Opened a shared progression', 'Back to mine', previous);
      else app.loadSession(shared);
    } catch (error) {
      toast(error.message);
    }
  }

  // A share link opened while the visualiser is already open in this tab.
  window.addEventListener('hashchange', function () { openSharedLink(app.serializeSession()); });
})();
