/* Shelf view: the unit as seen standing in front of it, shelf 1 at the top.
   A known shelf is filled yellow; an estimated one is hatched, dashed and
   labelled ESTIMATED; an unknown shelf highlights nothing and says so.
   For locations with several units (FM faces, fridges) a strip above the
   drawing shows which one. */
(function (Alpha) {
  'use strict';
  var esc = Alpha.ui.esc;

  function strip(loc) {
    var L = loc.location;
    if (L.units.length < 2) return '';
    return '<div class="elev-strip" role="group" aria-label="Units at ' + esc(L.code) + '">' + L.units.map(function (u) {
      var on = loc.unit && loc.unit.id === u.id;
      var cls = on ? (loc.unitStatus === 'estimated' ? ' on est' : ' on') : '';
      return '<span class="elev-chip' + cls + '">' + esc(u.label || u.id) + (on && loc.unitStatus === 'estimated' ? ' (est.)' : '') + '</span>';
    }).join('') + '</div>';
  }

  function header(loc) {
    var L = loc.location, u = loc.unit;
    var name = L.code + (L.name && L.name !== L.code ? ' · ' + L.name : '');
    var sub = '';
    if (u && L.units.length > 1) sub = (u.label || u.id) + (loc.unitStatus === 'estimated' ? ' (estimated)' : '');
    if (u && u.range) sub += (sub ? ' · ' : '') + 'holds ' + u.range.from + ' – ' + u.range.to;
    return '<div class="elev-head"><div class="elev-name">' + esc(name) + '</div>' +
      (sub ? '<div class="elev-sub">' + esc(sub) + '</div>' : '') + '</div>';
  }

  // The unit drawing depends only on the unit, so it is built once per unit
  // and kept; mark() then moves the highlight and label.
  function drawing(loc) {
    var u = loc.unit, n = u.shelves, fridge = loc.location.kind === 'ref';
    var W = 100, top = 4, left = 15, right = 97, rowH = Math.min(14, 150 / n), H = top + n * rowH + 6;
    var s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMin meet" data-unit="' + esc(u.id) + '" role="img" data-base-label="' +
      esc((u.label || u.id) + ', ' + n + ' shelves, numbered from the top') + '">';
    s += '<defs><pattern id="ehatch" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">' +
      '<rect width="3" height="3" fill="#fff3a8"/><rect width="1.3" height="3" fill="#e0b400"/></pattern></defs>';
    s += '<rect class="e-frame' + (fridge ? ' fridge' : '') + '" x="' + (left - 2) + '" y="' + (top - 2) + '" width="' + (right - left + 4) + '" height="' + (n * rowH + 4) + '" rx="' + (fridge ? 3 : 0.5) + '"/>';
    for (var i = 1; i <= n; i++) {
      var y = top + (i - 1) * rowH;
      s += '<g class="shelf" data-shelf="' + i + '" data-y="' + y + '" data-h="' + rowH + '">' +
        '<rect class="s-box" x="' + left + '" y="' + y + '" width="' + (right - left) + '" height="' + rowH + '"/>' +
        '<rect class="s-plank" x="' + left + '" y="' + (y + rowH - 1.2) + '" width="' + (right - left) + '" height="1.2"/>' +
        '<text class="s-num" x="' + (left - 4.5) + '" y="' + (y + rowH / 2) + '" font-size="' + Math.min(7, rowH * 0.6) + '">' + i + '</text>' +
        '</g>';
    }
    if (fridge) s += '<rect class="e-handle" x="' + (right + 0.2) + '" y="' + (top + n * rowH * 0.3) + '" width="1.6" height="' + (n * rowH * 0.4) + '" rx="0.8"/>';
    return s + '</svg>';
  }

  // Text drawn on the shelf is at least this many screen pixels; a label
  // that would be smaller goes in the caption instead (as normal text).
  var MIN_PX = 11;
  // Screen pixels per drawing unit, from a ResizeObserver (no layout read
  // while typing). Unknown until the first observation: then the label is
  // drawn, and checked again as soon as the size is known.
  var last = null;
  var ro = window.ResizeObserver ? new ResizeObserver(function (entries) {
    entries.forEach(function (e) {
      var vb = e.target.viewBox && e.target.viewBox.baseVal;
      if (vb && vb.width && vb.height) e.target.__scale = Math.min(e.contentRect.width / vb.width, e.contentRect.height / vb.height);
    });
    if (last && last.svg.__scale && last.el.contains(last.svg)) place(last);
  }) : null;
  function place(st) {
    var shown = mark(st.svg, st.loc, st.p);
    var cap = st.el.querySelector('.elev-caption'), c = caption(st.loc);
    if (cap) cap.textContent = (shown || st.loc.shelf == null ? '' : Alpha.ui.name(st.p) + (st.p.strength ? ' ' + st.p.strength : '') + ': ') + c.text;
  }

  // Highlights the shelf and writes the drug (and ESTIMATED) on it.
  // Returns false when the label would be under MIN_PX and was left off.
  function mark(svg, loc, p) {
    var old = svg.querySelectorAll('.shelf-hi, .shelf-est');
    for (var i = 0; i < old.length; i++) old[i].classList.remove('shelf-hi', 'shelf-est');
    var labels = svg.querySelectorAll('.s-label, .s-est');
    for (var j = 0; j < labels.length; j++) labels[j].parentNode.removeChild(labels[j]);
    if (loc.browse) {
      svg.setAttribute('aria-label', svg.getAttribute('data-base-label') + (loc.unit.range ? '. Holds ' + loc.unit.range.from + ' to ' + loc.unit.range.to : ''));
      (loc.unit.shelfRanges || []).forEach(function (rg, k) {
        var row = svg.querySelector('.shelf[data-shelf="' + (k + 1) + '"]');
        if (!row) return;
        var yy = Number(row.getAttribute('data-y')), hh = Number(row.getAttribute('data-h')), t1 = trim(rg.from === rg.to ? rg.from : rg.from + ' – ' + rg.to, 34);
        var f1 = Math.min(4.6, hh * 0.5, 80 / Math.max(Alpha.ui.textEm(t1), 5));
        if (!svg.__scale || f1 * svg.__scale >= MIN_PX) row.appendChild(text('s-label', yy + hh / 2, f1, t1));
      });
      return true;
    }
    svg.setAttribute('aria-label', svg.getAttribute('data-base-label') + (loc.shelf == null ? '. Shelf unknown' : ''));
    if (loc.shelf == null) return true;
    var g = svg.querySelector('.shelf[data-shelf="' + loc.shelf + '"]');
    if (!g) return true;
    var est = loc.shelfStatus === 'estimated';
    g.classList.add(est ? 'shelf-est' : 'shelf-hi');
    // Two lines, so the strength is never cut off: drug, then strength.
    var y = Number(g.getAttribute('data-y')), h = Number(g.getAttribute('data-h'));
    var line1 = trim(Alpha.ui.name(p), 26), line2 = (p.strength || '') + (est ? ' · ≈ ESTIMATED' : '');
    // Both lines share one size that fits the row height and the shelf width (80 units).
    var widest = Math.max(Alpha.ui.textEm(line1), Alpha.ui.textEm(line2), 5); // in em (bold), see ui.textEm
    var fs = Math.min(5.6, h * 0.4, 80 / widest);
    var shown = !svg.__scale || fs * svg.__scale >= MIN_PX;
    if (shown) {
      g.appendChild(text('s-label', y + h / 2 - fs * 0.55, fs, line1));
      g.appendChild(text(est ? 's-est' : 's-label', y + h / 2 + fs * 0.6, fs, line2));
    }
    svg.setAttribute('aria-label', svg.getAttribute('data-base-label') + '. Highlighted: shelf ' + loc.shelf + (est ? ', estimated' : ''));
    return shown;
  }
  function text(cls, y, size, content) {
    var t = document.createElementNS(Alpha.ui.SVGNS, 'text');
    t.setAttribute('class', cls); t.setAttribute('x', '56'); t.setAttribute('y', y); t.setAttribute('font-size', size);
    t.textContent = content;
    return t;
  }

  function trim(s, max) { return s.length > max ? s.slice(0, max - 1) + '…' : s; }

  function caption(loc) {
    if (loc.browse) return { cls: '', text: loc.unit.shelves + ' shelves, numbered from the top. ' + (loc.unit.range ? 'Holds ' + loc.unit.range.from + ' – ' + loc.unit.range.to + ' by name. ' : '') + 'Search for a drug to see its shelf.' };
    if (loc.shelfStatus === 'known') return { cls: '', text: 'Shelf ' + loc.shelf + ' of ' + loc.unit.shelves + ', counting from the top' };
    if (loc.shelfStatus === 'estimated') {
      return { cls: 'estimated', text: 'Shelf ≈' + loc.shelf + ' of ' + loc.unit.shelves + ' from the top. ESTIMATED from the alphabetical range: check nearby shelves.' };
    }
    return { cls: 'unknown', text: 'Shelf unknown: check the whole unit.' };
  }

  function render(el, loc, p) {
    if (!p && !(loc && loc.browse)) { el.innerHTML = '<p class="elev-msg">Choose a product to see its shelf, or a section on the map.</p>'; return; }
    if (!loc.location) {
      el.innerHTML = loc.code != null
        ? '<p class="elev-msg"><strong>' + esc(loc.code) + ' is not on the map yet.</strong> The layout has no location with that code.</p>'
        : '<p class="elev-msg"><strong>Location unknown.</strong> This product has no location in the data.</p>';
      return;
    }
    if (!loc.unit) {
      var why = loc.unitReason === 'bad-id'
        ? 'The data names unit "' + esc(p.unit) + '", which is not part of ' + esc(loc.location.code) + '.'
        : 'The data gives no unit, and the name is outside every unit\'s alphabetical range.';
      el.innerHTML = header(loc) + strip(loc) + '<p class="elev-msg"><strong>Which unit is unknown.</strong> ' + why + '</p>';
      return;
    }
    if (loc.shelfStatus === 'none') {
      var robot = loc.location.kind === 'robot';
      el.innerHTML = header(loc) + '<div class="elev-robot">' + esc(loc.unit.label || loc.location.code) + '</div>' +
        '<p class="elev-caption">' + (robot ? (loc.browse ? 'No shelves: the robot fills the NDCs it holds.' : 'No shelf: this NDC is filled by the robot.') : 'This unit has no shelves.') + '</p>';
      return;
    }
    var c = caption(loc);
    var draw = cache && cache.unit === loc.unit && el.contains(cache.node) ? cache.node : null;
    el.innerHTML = header(loc) + strip(loc) + '<div class="elev-draw"></div><p class="elev-caption ' + c.cls + '">' + esc(c.text) + '</p>';
    var box = el.querySelector('.elev-draw');
    if (draw) box.appendChild(draw);
    else {
      // A new drawing. Its scale comes from the ResizeObserver after layout
      // (no layout read while typing); until then the label is drawn, and it
      // moves to the caption a frame later if it turns out under MIN_PX.
      if (ro && cache) ro.unobserve(cache.node);
      box.innerHTML = drawing(loc); cache = { unit: loc.unit, node: box.firstChild, minH: minSize(loc.unit).h, minW: minSize(loc.unit).w };
      if (ro) ro.observe(cache.node);
    }
    // Never so short that shelf numbers drop under MIN_PX (Large and Larger
    // text leave less room): the pane scrolls instead.
    box.style.minHeight = cache.minH + 'px';
    box.style.minWidth = cache.minW + 'px';
    last = { svg: cache.node, loc: loc, p: p, el: el };
    place(last);
    keepShown(el);
  }
  // Height and width in pixels at which a unit's shelf numbers are MIN_PX
  // (plus a margin; the width also covers the box's side padding).
  function minSize(u) {
    var n = u.shelves, rowH = Math.min(14, 150 / n), H = 4 + n * rowH + 6, per = (MIN_PX + 0.5) / Math.min(7, rowH * 0.6);
    return { h: Math.ceil(H * per), w: Math.ceil(100 * per) + 16 };
  }
  var cache = null;

  // The highlighted shelf and the caption are scrolled into view when they
  // are off screen: inside the shelf pane when it scrolls (large text), and,
  // between 761 and 1100 px wide, the page (the search pane stays in place
  // beside it). When both do not fit, the shelf wins. Measured a frame
  // later, after the browser's own layout, so typing does not wait for it.
  var mq = window.matchMedia ? window.matchMedia('(min-width: 761px) and (max-width: 1100px)') : null, pending = false;
  // The vertical span of some boxes (null ones skipped).
  function span(list) {
    var top = Infinity, bottom = -Infinity;
    list.forEach(function (b) { if (b) { top = Math.min(top, b.top); bottom = Math.max(bottom, b.bottom); } });
    return { top: top, bottom: bottom };
  }
  // How far to scroll so that span s fits between top and bottom; when it
  // cannot fit, its top (keep) stays in view.
  function into(s, top, bottom, keep) {
    if (s.bottom > bottom) return Math.min(s.bottom - bottom + 6, (s.bottom - s.top <= bottom - top - 12 ? s.top : keep) - top - 6);
    if (s.top < top) return s.top - top - 6;
    return 0;
  }
  function keepShown(el) {
    if (pending) return;
    pending = true;
    requestAnimationFrame(function () {
      pending = false;
      var g = el.querySelector('.shelf-hi, .shelf-est'), cap = el.querySelector('.elev-caption');
      if (!g || !cap) return;
      // 1. Inside the shelf pane, when it scrolls: the caption stays pinned to
      // the pane's bottom (CSS), so the shelf has to show above it.
      if (el.scrollHeight > el.clientHeight + 1) {
        var r = el.getBoundingClientRect(), a = g.getBoundingClientRect(), c = cap.getBoundingClientRect();
        var bottom = c.left < a.right && c.right > a.left ? Math.min(r.bottom, c.top) : r.bottom;
        var d = into({ top: a.top, bottom: a.bottom }, r.top, bottom, a.top);
        if (d) el.scrollTop += d;
      }
      // 2. The page (761-1100 px wide): the shelf and caption, and the map
      // marker too when all of them fit on screen.
      if (mq && mq.matches) {
        var a2 = g.getBoundingClientRect(), c2 = cap.getBoundingClientRect();
        var mk = document.querySelector('#map-marker[visibility="visible"] .marker-dot');
        var must = span([a2, c2]), all = span([a2, c2, mk && mk.getBoundingClientRect()]);
        var s = all.bottom - all.top <= window.innerHeight - 12 ? all : must;
        var dp = into(s, 0, window.innerHeight, a2.top);
        if (dp) window.scrollBy(0, dp);
      }
    });
  }

  Alpha.elevation = { render: render };
})(window.Alpha);
