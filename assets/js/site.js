/**
 * Fretnoodle — site pages (lessons.html, about.html)
 *
 *   - Videos: a thumbnail with a play button stands in for each YouTube
 *     player and swaps to the real player on click, so the page loads fast.
 *   - Contact: email / phone / WhatsApp links ([data-contact] anywhere on the
 *     page) are built from data-email / data-phone on #contact, and stay
 *     hidden if those are empty. WhatsApp opens with a ready-written hello.
 *   - Mini fretboard: decorative chord maps drawn in the visualiser's style
 *     from data-root (pitch class, C = 0) and data-intervals ("0,4,7,11").
 *   - Footer year.
 */
(function () {
  'use strict';

  /* Videos ----------------------------------------------------------------- */

  document.querySelectorAll('.video-play').forEach(function (button) {
    var id = button.dataset.youtube;
    button.style.backgroundImage = 'url(https://i.ytimg.com/vi/' + id + '/hqdefault.jpg)';
    button.addEventListener('click', function () {
      var iframe = document.createElement('iframe');
      iframe.src = 'https://www.youtube-nocookie.com/embed/' + id + '?autoplay=1&rel=0';
      iframe.title = button.getAttribute('aria-label') || 'YouTube video';
      iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
      iframe.allowFullscreen = true;
      button.replaceWith(iframe);
    });
  });

  /* Contact ---------------------------------------------------------------- */

  var WHATSAPP_MESSAGE = 'Hi Strangeloop! I found you on Fretnoodle and I\u2019m interested in lessons.';

  var contact = document.getElementById('contact');
  if (contact) {
    var email = (contact.dataset.email || '').trim();
    var phone = (contact.dataset.phone || '').trim();
    var digits = phone.replace(/[^\d]/g, '');
    document.querySelectorAll('[data-contact]').forEach(function (link) {
      var kind = link.dataset.contact;
      if (kind === 'email' && email) link.href = 'mailto:' + email + '?subject=' + encodeURIComponent('Lessons enquiry');
      else if (kind === 'phone' && digits) link.href = 'tel:+' + digits;
      else if (kind === 'whatsapp' && digits) link.href = 'https://wa.me/' + digits + '?text=' + encodeURIComponent(WHATSAPP_MESSAGE);
      else return;
      link.hidden = false;
    });
  }

  /* Mini fretboard --------------------------------------------------------- */

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var OPEN_STRINGS = [4, 11, 7, 2, 9, 4];   // high E to low E
  var INTERVAL_LABELS = ['R', 'b2', '2', 'b3', '3', '4', 'b5', '5', 'b6', '6', 'b7', '7'];
  var INLAYS = [3, 5, 7, 9, 12];

  function el(name, attributes) {
    var node = document.createElementNS(SVG_NS, name);
    Object.keys(attributes).forEach(function (key) { node.setAttribute(key, attributes[key]); });
    return node;
  }

  function drawNeck(container) {
    var root = Number(container.dataset.root);
    var intervals = container.dataset.intervals.split(',').map(Number);
    var frets = Number(container.dataset.frets || 12);
    var width = 1000;
    var rowHeight = 36;
    var top = 22;
    var height = top * 2 + rowHeight * 5 + 30;
    var openWidth = 54;

    // Fret positions shrink up the neck, like the visualiser.
    var widths = [];
    for (var f = 1; f <= frets; f++) widths.push(Math.pow(0.9727, f - 1));
    var scale = (width - openWidth) / widths.reduce(function (a, b) { return a + b; }, 0);
    var wireX = [openWidth];
    widths.forEach(function (w) { wireX.push(wireX[wireX.length - 1] + w * scale); });
    var centreX = function (fret) { return fret === 0 ? openWidth / 2 : (wireX[fret - 1] + wireX[fret]) / 2; };

    var svg = el('svg', { viewBox: '0 0 ' + width + ' ' + height, role: 'img', 'aria-label': container.dataset.label || 'Chord tones across the fretboard' });
    var defs = el('defs', {});
    var gradient = el('linearGradient', { id: 'neck-gradient-' + Math.random().toString(36).slice(2), x1: 0, x2: 1, y1: 0, y2: 0 });
    [['0', '#3f9a98'], ['.5', '#4c98a0'], ['.78', '#8c93b5'], ['1', '#cf8fbd']].forEach(function (stop) {
      gradient.appendChild(el('stop', { offset: stop[0], 'stop-color': stop[1] }));
    });
    defs.appendChild(gradient);
    svg.appendChild(defs);

    INLAYS.filter(function (fret) { return fret <= frets; }).forEach(function (fret) {
      var x = wireX[fret - 1];
      var w = wireX[fret] - x;
      svg.appendChild(el('rect', { x: x + w * 0.27, y: top + rowHeight * 0.6, width: w * 0.46, height: rowHeight * 3.8, fill: '#2b2216', rx: 1 }));
    });
    for (var s = 0; s < 6; s++) {
      svg.appendChild(el('rect', { x: 0, y: top + s * rowHeight, width: width, height: 1.2 + s * 0.55, fill: 'url(#' + gradient.id + ')' }));
    }
    wireX.forEach(function (x, i) {
      svg.appendChild(el('rect', { x: x - 1, y: top, width: i === 0 ? 3 : 1.6, height: rowHeight * 5 + 2, fill: '#ebe8e1' }));
    });
    for (f = 0; f <= frets; f++) {
      var number = el('text', { x: centreX(f), y: height - 4, 'text-anchor': 'middle', fill: '#8f8f8f', 'font-family': 'Fraunces, Georgia, serif', 'font-size': 15 });
      number.textContent = f;
      svg.appendChild(number);
    }

    for (s = 0; s < 6; s++) {
      for (f = 0; f <= frets; f++) {
        var interval = ((OPEN_STRINGS[s] + f - root) % 12 + 12) % 12;
        if (intervals.indexOf(interval) < 0) continue;
        var group = el('g', { class: 'dot', style: 'animation-delay:' + (f * 45 + s * 20) + 'ms' });
        group.appendChild(el('circle', { cx: centreX(f), cy: top + s * rowHeight, r: 14, fill: interval === 0 ? '#FFF000' : '#f3f1ea' }));
        var label = el('text', {
          x: centreX(f), y: top + s * rowHeight + 4.5, 'text-anchor': 'middle', fill: '#0a0a0a',
          'font-family': 'Fraunces, Georgia, serif', 'font-weight': 700, 'font-size': 12
        });
        label.textContent = INTERVAL_LABELS[interval];
        group.appendChild(label);
        svg.appendChild(group);
      }
    }
    container.appendChild(svg);
  }

  document.querySelectorAll('.mini-neck').forEach(drawNeck);

  /* Footer year ------------------------------------------------------------ */

  document.querySelectorAll('[data-year]').forEach(function (node) { node.textContent = new Date().getFullYear(); });
})();
