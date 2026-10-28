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

  // Highlights the shelf and writes the drug (and ESTIMATED) on it.
  function mark(svg, loc, p) {
    var old = svg.querySelectorAll('.shelf-hi, .shelf-est');
    for (var i = 0; i < old.length; i++) old[i].classList.remove('shelf-hi', 'shelf-est');
    var labels = svg.querySelectorAll('.s-label, .s-est');
    for (var j = 0; j < labels.length; j++) labels[j].parentNode.removeChild(labels[j]);
    svg.setAttribute('aria-label', svg.getAttribute('data-base-label') + (loc.shelf == null ? '. Shelf unknown' : ''));
    if (loc.shelf == null) return;
    var g = svg.querySelector('.shelf[data-shelf="' + loc.shelf + '"]');
    if (!g) return;
    var est = loc.shelfStatus === 'estimated';
    g.classList.add(est ? 'shelf-est' : 'shelf-hi');
    // Two lines, so the strength is never cut off: drug, then strength.
    var y = Number(g.getAttribute('data-y')), h = Number(g.getAttribute('data-h'));
    var line1 = trim(p.drug, 26), line2 = (p.strength || '') + (est ? ' · ≈ ESTIMATED' : '');
    // Both lines share one size that fits the row height and the shelf width (80 units).
    var widest = Math.max(line1.length, line2.length, 8);
    var fs = Math.min(5.6, h * 0.4, 80 / (widest * 0.7)); // bold text is about 0.7em per character
    g.appendChild(text('s-label', y + h / 2 - fs * 0.55, fs, line1));
    g.appendChild(text(est ? 's-est' : 's-label', y + h / 2 + fs * 0.6, fs, line2));
    svg.setAttribute('aria-label', svg.getAttribute('data-base-label') + '. Highlighted: shelf ' + loc.shelf + (est ? ', estimated' : ''));
  }
  function text(cls, y, size, content) {
    var t = document.createElementNS(Alpha.ui.SVGNS, 'text');
    t.setAttribute('class', cls); t.setAttribute('x', '56'); t.setAttribute('y', y); t.setAttribute('font-size', size);
    t.textContent = content;
    return t;
  }

  function trim(s, max) { return s.length > max ? s.slice(0, max - 1) + '…' : s; }

  function caption(loc) {
    if (loc.shelfStatus === 'known') return { cls: '', text: 'Shelf ' + loc.shelf + ' of ' + loc.unit.shelves + ', counting from the top' };
    if (loc.shelfStatus === 'estimated') {
      return { cls: 'estimated', text: 'Shelf ≈' + loc.shelf + ' of ' + loc.unit.shelves + ' from the top. ESTIMATED from the alphabetical range: check nearby shelves.' };
    }
    return { cls: 'unknown', text: 'Shelf unknown: check the whole unit.' };
  }

  function render(el, loc, p) {
    if (!p) { el.innerHTML = '<p class="elev-msg">Choose a product to see its shelf.</p>'; return; }
    if (!loc.location) { el.innerHTML = '<p class="elev-msg"><strong>Location unknown.</strong> This product has no location in the data.</p>'; return; }
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
        '<p class="elev-caption">' + (robot ? 'No shelf: this NDC is filled by the robot.' : 'This unit has no shelves.') + '</p>';
      return;
    }
    var c = caption(loc);
    var draw = cache && cache.unit === loc.unit && el.contains(cache.node) ? cache.node : null;
    el.innerHTML = header(loc) + strip(loc) + '<div class="elev-draw"></div><p class="elev-caption ' + c.cls + '">' + esc(c.text) + '</p>';
    var box = el.querySelector('.elev-draw');
    if (draw) box.appendChild(draw);
    else { box.innerHTML = drawing(loc); cache = { unit: loc.unit, node: box.firstChild }; }
    mark(cache.node, loc, p);
  }
  var cache = null;

  Alpha.elevation = { render: render };
})(window.Alpha);
