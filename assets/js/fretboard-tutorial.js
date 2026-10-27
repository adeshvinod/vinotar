/**
 * Fretnoodle — Visualiser tutorial
 *
 * A guided tour of fretboard-visualiser.html, opened from the Tutorial button
 * next to the logo (or the ? key, which jumps straight to the shortcut sheet).
 *
 * How it works
 *   - Each step spotlights part of the real page and shows a card beside it.
 *   - Most steps carry a small "Try it" task. The tour watches the app
 *     through window.Fretnoodle (see the end of fretboard-visualiser.js) and
 *     ticks the task off when the student has done it. Nothing is faked: the
 *     student uses the actual controls, so the page stays fully clickable
 *     while the tour is open.
 *   - `check(state, start, flags)` gets the live state, a snapshot taken when
 *     the step opened, and per-step flags set by paint strokes.
 *   - `target` is what the spotlight shows; `focus` (default: the target) is
 *     what the student has to click. The card never covers the focus and
 *     covers as little of the target as it can (see Positioning).
 *
 * Load after fretboard-visualiser.js.
 */
(function () {
  'use strict';

  var app = window.Fretnoodle;
  if (!app) return;

  var SEEN_KEY = 'fretnoodle.tutorialSeen';
  var EDGE = 16;          // px kept clear around the card
  var SPOTLIGHT_PAD = 8;  // px of breathing room around the highlighted area

  /** ⌘ on a Mac, Ctrl elsewhere. */
  var MOD = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl';

  /** Key cap helper for step text. */
  function key(label) { return '<kbd>' + label + '</kbd>'; }

  function activeChord(state) {
    return state.chords[Math.min(state.activeIndex, state.chords.length - 1)] || null;
  }

  /* ========================================================================
   * Steps
   * ===================================================================== */

  var STEPS = [
    {
      eyebrow: 'Welcome',
      title: 'See the <i>whole</i> neck',
      body:
        '<p>Fretnoodle shows every note of a chord across all 18 frets, and the job each note does.</p>' +
        '<p class="tour-why">Each step has a small task. Do it and the tour ticks it off.</p>',
      nextLabel: 'Start'
    },
    {
      eyebrow: 'The key feature',
      title: 'Turn on Full map',
      target: ['.map-bar', '.fretboard-scroll'],
      focus: ['.full-map-switch'],
      enter: function () { app.setState({ fullMap: false }); },
      body:
        '<p>See every note of the chord, everywhere on the neck. Your shape is ringed in white.</p>' +
        '<p class="tour-why">A chord is not one shape. It lives all over the board, so you are never stuck in one position.</p>',
      task: 'Click <strong>Full map</strong> or press ' + key('Space') + '.',
      check: function (state) { return state.fullMap; }
    },
    {
      eyebrow: 'Notes',
      title: 'Click a fret to add a note',
      target: ['.fretboard-scroll'],
      focus: ['.fretboard-scroll'],
      body: '<p>Click it again to remove it. The first note is the root.</p>',
      task: 'Add a note.',
      check: function (state, start) {
        var chord = activeChord(state);
        return !!chord && (chord.id !== start.chordId ? chord.positions.length > 0 : chord.positions.length > start.noteCount);
      }
    },
    {
      eyebrow: 'Chord name',
      title: 'Named for you',
      target: ['.hero'],
      body: '<p>Each chip is a note and its interval: <strong>R</strong> root, <strong>b3 M3</strong> thirds, <strong>P5</strong> fifth, <strong>b7 M7</strong> sevenths.</p>'
    },
    {
      eyebrow: 'Progression',
      title: 'Add chords',
      target: ['#progression'],
      enter: function () { app.setState({ showProgression: true }); },
      body: '<p><strong>Add chord</strong> places a shape for you. <strong>Blank chord</strong> starts empty. Click a card to edit it.</p>',
      task: 'Add a chord, or press ' + key('Enter') + '.',
      check: function (state, start) { return state.chords.length > start.chordCount; }
    },
    {
      eyebrow: 'Changing chords',
      title: 'Step through with ← →',
      target: ['.hero', '.fretboard-scroll'],
      focus: ['.fretboard-scroll'],
      enter: function () { app.setState({ fullMap: true }); },
      body: '<p>Notes slide to the nearest note of the next chord. That is voice leading.</p>',
      task: 'Press ' + key('←') + ' or ' + key('→') + '.',
      check: function (state, start) { return state.activeIndex !== start.activeIndex; }
    },
    {
      eyebrow: 'Playback',
      title: 'Play it in time',
      target: ['.hero-transport'],
      body: '<p>Loops the progression with a metronome and strum. Set the tempo below.</p>',
      task: 'Press ' + key('M') + ' or play.',
      check: function (state, start) { return state.playing !== start.playing; }
    },
    {
      eyebrow: 'Paint',
      title: 'Write on the neck',
      target: ['.map-bar', '.fretboard-scroll'],
      focus: ['[data-action=togglePaintMode]'],
      body: '<p>Draw notes right on the fretboard. Each chord keeps its own drawing.</p>',
      task: 'Press ' + key('P') + ' or click <strong>Paint</strong>.',
      check: function (state) { return state.paintMode; }
    },
    {
      eyebrow: 'Paint',
      title: 'Draw on every chord',
      target: ['#paintToolbar', '.fretboard-scroll'],
      focus: ['#paintToolbar', '.fretboard-scroll'],
      enter: function () { app.setState({ paintMode: true }); },
      body: '<p>Hold ' + key('Shift') + ' while drawing to mark all chords at once. ' + key('E') + ' erases. ' + key('P') + ' to stop.</p>',
      task: 'Draw a line. Bonus: hold ' + key('Shift') + '.',
      doneText: function (flags) {
        return flags.shiftStroked ? 'On every chord. Press → to check.' : 'Nice. Now try holding Shift.';
      },
      check: function (state, start, flags) { return flags.stroked; }
    },
    {
      eyebrow: 'Advanced',
      title: 'Shift-click to set the root',
      target: ['.hero', '.fretboard-scroll'],
      focus: ['.fretboard-scroll'],
      enter: function () { app.setState({ paintMode: false }); },
      body: '<p>Same notes, new chord: C E G A is <strong>C6</strong>, or <strong>Amin7</strong> with A as the root.</p>',
      task: 'Hold ' + key('Shift') + ' and click a note.',
      check: function (state, start) {
        var chord = activeChord(state);
        return !!chord && chord.id === start.chordId && chord.root !== start.root && chord.root !== null;
      }
    },
    {
      eyebrow: 'Advanced',
      title: 'Hold ↑ and click to dim',
      target: ['.hero', '.fretboard-scroll'],
      focus: ['.fretboard-scroll'],
      enter: function () { app.setState({ paintMode: false }); },
      body:
        '<p>A dimmed note stays visible but sits out of the slides.</p>' +
        '<p class="tour-why">Dim the root and 5th to follow just the 3rds and 7ths.</p>',
      task: 'Hold ' + key('↑') + ' and click a note.',
      check: function (state, start) {
        var chord = activeChord(state);
        return !!chord && chord.id === start.chordId && (chord.excluded || []).join() !== start.excluded;
      }
    },
    {
      eyebrow: 'Labels',
      title: 'Intervals or notes',
      target: ['.settings-cell.is-labels'],
      enter: function () { app.setState({ paintMode: false, streamMode: false }); },
      body: '<p>Switch dot labels, colour by interval, or press ' + key('N') + ' to hide fret names and test yourself.</p>',
      task: 'Change a label setting, or press ' + key('N') + '.',
      check: function (state, start) {
        return state.labelMode !== start.labelMode || state.colorByInterval !== start.colorByInterval ||
          state.showNoteNames !== start.showNoteNames;
      }
    },
    {
      eyebrow: 'Settings',
      title: 'Motion, tuning, MIDI',
      target: ['.settings'],
      enter: function () { app.setState({ streamMode: false }); },
      body: '<p><strong>Motion</strong>: slide speed. <strong>Tuning</strong>: retune any string. <strong>MIDI guitar</strong>: see what you play.</p>'
    },
    {
      eyebrow: 'Saving',
      title: 'It saves itself',
      target: ['.session-menu'],
      focus: ['.session-menu', '#sessionPanel'],
      body:
        '<p>Your work stays in this browser. <strong>Session</strong> also saves a named file (' + key(MOD) + key('S') + '), ' +
        'a share link, or PDF notes, drawings included.</p>'
    },
    {
      eyebrow: 'Teaching',
      title: 'Stream mode',
      target: ['.site-header'],
      focus: ['[data-action=toggleStreamMode]'],
      body: '<p>Hides menus for screen sharing. ' + key('B') + ' hides the progression, ' + key('F') + ' goes full screen.</p>'
    },
    {
      eyebrow: 'Shortcuts',
      title: 'Shortcut sheet',
      wide: true,
      body: shortcutSheet(),
      nextLabel: 'Done',
      backLabel: 'Restart tour'
    }
  ];

  function shortcutSheet() {
    function row(text, keys) {
      return '<div class="shortcut-row"><span>' + text + '</span><span class="shortcut-keys">' + keys + '</span></div>';
    }
    return '<div class="shortcut-groups">' +
      '<div class="shortcut-group"><span class="eyebrow">Fretboard</span>' +
        row('Full map', key('Space')) +
        row('Add or remove a note', 'click') +
        row('Set the root', key('Shift') + ' + click') +
        row('Dim a note', 'hold ' + key('↑') + ' + click') +
        row('Note names on frets', key('N')) +
      '</div>' +
      '<div class="shortcut-group"><span class="eyebrow">Progression</span>' +
        row('Previous / next chord', key('←') + key('→')) +
        row('Add a blank chord', key('Enter')) +
        row('Play / stop', key('M')) +
        row('Show / hide progression', key('B')) +
        row('Full screen', key('F')) +
      '</div>' +
      '<div class="shortcut-group"><span class="eyebrow">Paint</span>' +
        row('Paint mode', key('P') + ' or double-click') +
        row('Eraser', key('E')) +
        row('Draw on every chord', 'hold ' + key('Shift')) +
      '</div>' +
      '<div class="shortcut-group"><span class="eyebrow">Session</span>' +
        row('Save as file', key(MOD) + key('S')) +
        row('Open file', key(MOD) + key('O')) +
      '</div>' +
      '<div class="shortcut-group"><span class="eyebrow">This tutorial</span>' +
        row('Open this sheet', key('?')) +
        row('Close', key('Esc')) +
      '</div>' +
    '</div>';
  }

  /* ========================================================================
   * Tour
   * ===================================================================== */

  var tourEl = document.getElementById('tour');
  var spotlight = document.getElementById('tourSpotlight');
  var card = document.getElementById('tourCard');
  var backButton = document.getElementById('tourBack');
  var nextButton = document.getElementById('tourNext');
  var newDot = document.getElementById('tutorialNewDot');

  var stepIndex = -1;
  var start = null;      // snapshot of the app when the step opened
  var flags = null;      // things the snapshot cannot capture (paint strokes)
  var done = false;
  var frame = 0;         // pending requestAnimationFrame for positioning
  var lastStepTime = 0;

  function isOpen() { return !tourEl.hidden; }

  function snapshot() {
    var state = app.getState();
    var chord = activeChord(state);
    return {
      chordId: chord ? chord.id : null,
      noteCount: chord ? chord.positions.length : 0,
      root: chord ? chord.root : null,
      excluded: chord ? (chord.excluded || []).join() : '',
      chordCount: state.chords.length,
      activeIndex: state.activeIndex,
      fullMap: state.fullMap,
      playing: state.playing,
      labelMode: state.labelMode,
      colorByInterval: state.colorByInterval,
      showNoteNames: state.showNoteNames
    };
  }

  function open(index) {
    if (!isOpen()) {
      tourEl.hidden = false;
      if (app.getState().streamMode) app.setState({ streamMode: false });
    }
    try { localStorage.setItem(SEEN_KEY, '1'); } catch (error) { /* storage unavailable */ }
    newDot.hidden = true;
    goTo(index || 0);
  }

  function close() {
    tourEl.hidden = true;
    stepIndex = -1;
    document.getElementById('tutorialButton').focus({ preventScroll: true });
  }

  function goTo(index) {
    var step = STEPS[index];
    stepIndex = index;
    if (step.enter) step.enter();
    start = snapshot();
    flags = { stroked: false, shiftStroked: false };
    done = false;

    document.getElementById('tourEyebrow').textContent = step.eyebrow + ' · ' + (index + 1) + ' of ' + STEPS.length;
    document.getElementById('tourTitle').innerHTML = step.title;
    document.getElementById('tourBody').innerHTML = step.body;
    document.getElementById('tourTaskSlot').innerHTML = step.task ? taskHtml(step) : '';
    document.getElementById('tourProgress').innerHTML = STEPS.map(function (s, i) {
      return '<span class="' + (i === index ? 'is-current' : i < index ? 'is-seen' : '') + '"></span>';
    }).join('');

    backButton.textContent = step.backLabel || 'Back';
    backButton.hidden = index === 0;
    card.classList.toggle('is-wide', !!step.wide);
    card.classList.remove('is-dock');
    updateNextButton();

    card.classList.add('is-fading');
    setTimeout(function () { card.classList.remove('is-fading'); }, 120);
    placeForStep();

    // Focus the card, not a button, so Space and Enter reach the app's
    // shortcuts instead of pressing the tour's Next button.
    card.focus({ preventScroll: true });
  }

  function taskHtml(step) {
    return '<div class="tour-task" id="tourTask">' +
      '<span class="tour-task-icon" aria-hidden="true"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>' +
      '<span><span class="tour-task-label" id="tourTaskLabel">Try it</span><span id="tourTaskText">' + step.task + '</span></span>' +
    '</div>';
  }

  function updateNextButton() {
    var step = STEPS[stepIndex];
    var isLast = stepIndex === STEPS.length - 1;
    nextButton.textContent = step.nextLabel || (step.task && !done ? 'Skip' : 'Next');
    nextButton.classList.toggle('is-primary', !step.task || done || isLast);
  }

  /** Re-check the current step's task after any change in the app. */
  function checkTask() {
    var step = STEPS[stepIndex];
    if (!isOpen() || !step || !step.check) return;
    if (!step.check(app.getState(), start, flags)) return;

    var task = document.getElementById('tourTask');
    task.classList.add('is-done');
    document.getElementById('tourTaskLabel').textContent = 'Done';
    if (step.doneText) document.getElementById('tourTaskText').textContent = step.doneText(flags);
    if (!done) {
      done = true;
      updateNextButton();
    }
  }

  function next() {
    if (stepIndex >= STEPS.length - 1) close();
    else goTo(stepIndex + 1);
  }

  function back() {
    if (stepIndex === STEPS.length - 1) goTo(0);   // "Restart tour" on the last step
    else if (stepIndex > 0) goTo(stepIndex - 1);
  }

  /* ========================================================================
   * Positioning
   * ===================================================================== */

  /*
   * Placement works on rectangles in viewport coordinates. For a step we
   * consider a handful of scroll positions (stay put, centre the target or
   * focus, stack target and card) and, for each, card spots around the
   * target and focus and in the viewport corners, at normal and wide widths.
   * Every option is scored and the cheapest wins:
   *   - covering the focus, or the focus being off screen, is very costly;
   *   - covering or hiding the target costs a little;
   *   - scrolling a long way and the wide card cost a little more.
   * Steps scroll once when they open. After that (student scrolls, the page
   * layout changes) the card only moves if it would cover the focus.
   */

  var GAP = 14;            // px between the card and what it points at

  /** Card shapes: the normal card, a wider one, and the short dock. */
  var CARD_SHAPES = [
    { name: 'normal', className: '', cost: 0 },
    { name: 'wide', className: 'is-wide', cost: 6000 },
    { name: 'dock', className: 'is-dock', cost: 9000 }
  ];

  var lockedUntil = 0;     // while a step's scroll runs, keep the card still
  var cardSpot = null;     // where the card was last sent (it may still be animating there)

  function elementsFor(selectors) {
    return (selectors || [])
      .map(function (selector) { return document.querySelector(selector); })
      .filter(function (el) { return el && !el.hidden && el.offsetParent !== null && el.getClientRects().length; });
  }

  function targetElements(step) { return elementsFor(step.target); }

  /** Bounding box (viewport coordinates) around elements, padded. */
  function unionRect(elements, pad) {
    if (!elements.length) return null;
    var rects = elements.map(function (el) { return el.getBoundingClientRect(); });
    return {
      top: Math.min.apply(null, rects.map(function (r) { return r.top; })) - pad,
      left: Math.max(4, Math.min.apply(null, rects.map(function (r) { return r.left; })) - pad),
      bottom: Math.max.apply(null, rects.map(function (r) { return r.bottom; })) + pad,
      right: Math.min(window.innerWidth - 4, Math.max.apply(null, rects.map(function (r) { return r.right; })) + pad)
    };
  }

  function rect(left, top, width, height) {
    return { left: left, top: top, right: left + width, bottom: top + height };
  }

  function shift(r, dy) {
    return r && { left: r.left, right: r.right, top: r.top + dy, bottom: r.bottom + dy };
  }

  function area(r) { return r ? Math.max(0, r.right - r.left) * Math.max(0, r.bottom - r.top) : 0; }

  function overlap(a, b) {
    if (!a || !b) return 0;
    return area({
      left: Math.max(a.left, b.left), right: Math.min(a.right, b.right),
      top: Math.max(a.top, b.top), bottom: Math.min(a.bottom, b.bottom)
    });
  }

  /** How much of `r` is outside the viewport. */
  function hidden(r) {
    return r ? area(r) - overlap(r, rect(0, 0, window.innerWidth, window.innerHeight)) : 0;
  }

  /** Measure each card shape this step can use. */
  function cardSizes(step) {
    var shapes = window.innerWidth <= 640 || step.wide ? [CARD_SHAPES[0]]
      : window.innerWidth < 900 ? CARD_SHAPES.slice(0, 2) : CARD_SHAPES;
    var previous = card.className;
    var sizes = shapes.map(function (shape) {
      setShape(shape, step);
      return { shape: shape, width: card.offsetWidth, height: card.offsetHeight };
    });
    card.className = previous;
    return sizes;
  }

  function setShape(shape, step) {
    card.classList.toggle('is-wide', shape.name === 'wide' || !!step.wide);
    card.classList.toggle('is-dock', shape.name === 'dock');
  }

  /** Possible card rectangles for a target and focus already in viewport coordinates. */
  function cardSpots(size, target, focus) {
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    var w = size.width;
    var h = size.height;
    var spots = [];
    var clampX = function (x) { return Math.max(EDGE, Math.min(x, vw - w - EDGE)); };
    var clampY = function (y) { return Math.max(EDGE, Math.min(y, vh - h - EDGE)); };

    if (vw <= 640) {   // phones: a sheet along the top or bottom edge
      return [rect(EDGE, vh - h - EDGE, w, h), rect(EDGE, EDGE, w, h)];
    }

    [target, focus].forEach(function (anchor) {
      if (!anchor) return;
      [clampX(anchor.left), clampX(anchor.right - w)].forEach(function (x) {
        spots.push(rect(x, anchor.bottom + GAP, w, h));
        spots.push(rect(x, anchor.top - GAP - h, w, h));
      });
      spots.push(rect(anchor.right + GAP, clampY(anchor.top), w, h));
      spots.push(rect(anchor.left - GAP - w, clampY(anchor.top), w, h));
    });
    spots.push(rect(EDGE, EDGE, w, h), rect(vw - w - EDGE, EDGE, w, h),
      rect(EDGE, vh - h - EDGE, w, h), rect(vw - w - EDGE, vh - h - EDGE, w, h));

    return spots.filter(function (spot) {
      return spot.left >= EDGE - 1 && spot.top >= EDGE - 1 && spot.right <= vw - EDGE + 1 && spot.bottom <= vh - EDGE + 1;
    });
  }

  function score(spot, target, focus, size, scrollChange) {
    var guarded = focus && { left: focus.left - 6, right: focus.right + 6, top: focus.top - 6, bottom: focus.bottom + 6 };
    return overlap(spot, guarded) * 40 +
      hidden(focus) * 20 +
      overlap(spot, target) +
      hidden(target) * 0.5 +
      Math.abs(scrollChange) * 40 +
      size.shape.cost;
  }

  /** Scroll positions worth trying so the target, focus and card all fit. */
  function scrollOptions(target, focus, sizes, allowScroll) {
    var current = window.scrollY;
    if (!allowScroll) return [current];
    var vh = window.innerHeight;
    var max = Math.max(0, document.documentElement.scrollHeight - vh);
    var options = [current];
    [target, focus].forEach(function (r) {
      if (!r) return;
      var top = r.top + current;
      var height = r.bottom - r.top;
      options.push(top + height / 2 - vh / 2);                  // centred
      options.push(top - EDGE);                                  // at the top
      sizes.forEach(function (size) {
        var block = height + GAP + size.height;
        options.push(top - (vh - block) / 2);                    // centred, card below
        options.push(top - size.height - GAP - (vh - block) / 2); // centred, card above
      });
    });
    return options
      .map(function (y) { return Math.round(Math.max(0, Math.min(max, y))); })
      .filter(function (y, i, all) { return all.indexOf(y) === i; });
  }

  /** The cheapest scroll position and card spot for the current step. */
  function plan(step, allowScroll) {
    var target = unionRect(targetElements(step), SPOTLIGHT_PAD);
    var focus = unionRect(elementsFor(step.focus || step.target), 0) || target;
    var sizes = cardSizes(step);
    var best = null;

    if (!target) {
      var size = sizes[0];
      return {
        scroll: allowScroll ? 0 : window.scrollY,
        size: size,
        spot: rect((window.innerWidth - size.width) / 2, Math.max(EDGE, (window.innerHeight - size.height) / 2), size.width, size.height)
      };
    }

    scrollOptions(target, focus, sizes, allowScroll).forEach(function (y) {
      var dy = window.scrollY - y;
      var t = shift(target, dy);
      var f = shift(focus, dy);
      sizes.forEach(function (size) {
        cardSpots(size, t, f).forEach(function (spot) {
          var cost = score(spot, t, f, size, y - window.scrollY);
          if (!best || cost < best.cost) best = { cost: cost, scroll: y, size: size, spot: spot };
        });
      });
    });
    return best;
  }

  /** Called when a step opens: scroll (if needed) and place the card. */
  function placeForStep() {
    var step = STEPS[stepIndex];
    var best = plan(step, true);
    if (!best) return;
    applyCard(best);

    if (Math.abs(best.scroll - window.scrollY) > 1) {
      // Smooth scrolling is dropped if the student clicks on before it ends,
      // so quick steps jump instead.
      var now = Date.now();
      var quick = now - lastStepTime < 700;
      lastStepTime = now;
      lockedUntil = now + (quick ? 0 : 900);
      window.scrollTo({ top: best.scroll, behavior: quick ? 'auto' : 'smooth' });
    } else {
      lastStepTime = Date.now();
    }
    updateSpotlight(step);
  }

  function schedulePosition() {
    if (frame || !isOpen()) return;
    frame = requestAnimationFrame(function () { frame = 0; reposition(); });
  }

  /** After scrolling or a layout change: follow the target, and move the card
   *  only if it now covers the focus or has run off screen. */
  function reposition() {
    var step = STEPS[stepIndex];
    if (!step) return;
    updateSpotlight(step);
    if (Date.now() < lockedUntil) return;

    var focus = unionRect(elementsFor(step.focus || step.target), 0);
    var current = cardSpot && rect(cardSpot.left, cardSpot.top, card.offsetWidth, card.offsetHeight);
    var onScreen = current && current.top >= EDGE - 1 && current.bottom <= window.innerHeight - EDGE + 1 &&
      current.left >= EDGE - 1 && current.right <= window.innerWidth - EDGE + 1;
    if (onScreen && !overlap(current, focus)) return;

    var best = plan(step, false);
    if (best) applyCard(best);
  }

  function applyCard(best) {
    var step = STEPS[stepIndex];
    setShape(best.size.shape, step);
    cardSpot = best.spot;
    if (window.innerWidth <= 640) {
      var atTop = best.spot.top < window.innerHeight / 2;
      setCard(atTop ? { top: EDGE, left: EDGE, right: EDGE } : { bottom: EDGE, left: EDGE, right: EDGE });
    } else {
      setCard({ top: best.spot.top, left: best.spot.left });
    }
  }

  function updateSpotlight(step) {
    var r = unionRect(targetElements(step), SPOTLIGHT_PAD);
    spotlight.classList.toggle('is-empty', !r);
    if (r) setBox(spotlight, r.top, r.left, r.right - r.left, r.bottom - r.top);
    else setBox(spotlight, window.innerHeight / 2, window.innerWidth / 2, 0, 0);
  }

  function setBox(el, top, left, width, height) {
    el.style.top = top + 'px';
    el.style.left = left + 'px';
    el.style.width = width + 'px';
    el.style.height = height + 'px';
  }

  function setCard(place) {
    ['top', 'left', 'right', 'bottom'].forEach(function (side) {
      card.style[side] = place[side] === undefined ? 'auto' : place[side] + 'px';
    });
  }

  /* ========================================================================
   * Wiring
   * ===================================================================== */

  document.getElementById('tutorialButton').addEventListener('click', function () { open(0); });
  document.getElementById('tourClose').addEventListener('click', close);
  nextButton.addEventListener('click', function () { next(); });
  backButton.addEventListener('click', back);

  app.on('change', function () { checkTask(); schedulePosition(); });
  app.on('stroke', function (detail) {
    if (!isOpen() || !flags) return;
    flags.stroked = true;
    if (detail.allChords) flags.shiftStroked = true;
    checkTask();
  });

  window.addEventListener('keydown', function (event) {
    var target = event.target;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
    if (event.key === '?') {
      open(STEPS.length - 1);
      event.preventDefault();
    } else if (event.key === 'Escape' && isOpen()) {
      close();
    }
  });
  window.addEventListener('resize', function () { if (isOpen()) placeForStep(); });
  window.addEventListener('scroll', schedulePosition, { passive: true });
  window.addEventListener('scrollend', function () { lockedUntil = 0; schedulePosition(); });
  // Opening menus or pickers changes what the student needs to see.
  document.addEventListener('click', function () { setTimeout(schedulePosition, 0); });

  // A dot on the Tutorial button until it has been opened once.
  try { newDot.hidden = !!localStorage.getItem(SEEN_KEY); } catch (error) { newDot.hidden = false; }
})();
