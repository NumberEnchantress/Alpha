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
    return '<div class="elev-strip" aria-label="Units at ' + esc(L.code) + '">' + L.units.map(function (u) {
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

  function drawing(loc, p) {
    var u = loc.unit, n = u.shelves, fridge = loc.location.kind === 'ref';
    var W = 100, top = 4, left = 15, right = 97, rowH = Math.min(14, 150 / n), H = top + n * rowH + 6;
    var s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMin meet" data-unit="' + esc(u.id) + '" role="img" aria-label="' +
      esc((u.label || u.id) + ', ' + n + ' shelves, numbered from the top') + '">';
    s += '<defs><pattern id="ehatch" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">' +
      '<rect width="3" height="3" fill="#fff3a8"/><rect width="1.3" height="3" fill="#e0b400"/></pattern></defs>';
    s += '<rect class="e-frame' + (fridge ? ' fridge' : '') + '" x="' + (left - 2) + '" y="' + (top - 2) + '" width="' + (right - left + 4) + '" height="' + (n * rowH + 4) + '" rx="' + (fridge ? 3 : 0.5) + '"/>';
    for (var i = 1; i <= n; i++) {
      var y = top + (i - 1) * rowH, cls = 'shelf';
      if (loc.shelf === i) cls += loc.shelfStatus === 'estimated' ? ' shelf-est' : ' shelf-hi';
      s += '<g class="' + cls + '" data-shelf="' + i + '">' +
        '<rect class="s-box" x="' + left + '" y="' + y + '" width="' + (right - left) + '" height="' + rowH + '"/>' +
        '<rect class="s-plank" x="' + left + '" y="' + (y + rowH - 1.2) + '" width="' + (right - left) + '" height="1.2"/>' +
        '<text class="s-num" x="' + (left - 4.5) + '" y="' + (y + rowH / 2) + '" font-size="' + Math.min(7, rowH * 0.6) + '">' + i + '</text>';
      if (loc.shelf === i) {
        var est = loc.shelfStatus === 'estimated';
        var fs = Math.min(6.5, rowH * 0.42);
        s += '<text class="s-label" x="' + ((left + right) / 2) + '" y="' + (y + rowH / 2 - (est ? fs * 0.45 : 0)) + '" font-size="' + fs + '">' +
          esc(trim(p.drug + ' ' + (p.strength || ''), 24)) + '</text>';
        if (est) s += '<text class="s-est" x="' + ((left + right) / 2) + '" y="' + (y + rowH / 2 + fs * 0.65) + '" font-size="' + fs * 0.85 + '">≈ ESTIMATED</text>';
      }
      s += '</g>';
    }
    if (fridge) s += '<rect class="e-handle" x="' + (right - 3.5) + '" y="' + (top + n * rowH * 0.3) + '" width="1.6" height="' + (n * rowH * 0.4) + '" rx="0.8"/>';
    return s + '</svg>';
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
      el.innerHTML = header(loc) + strip(loc) +
        '<p class="elev-msg"><strong>Which unit is unknown.</strong> The data gives no unit, and the name is outside every unit\'s alphabetical range.</p>';
      return;
    }
    if (loc.shelfStatus === 'none') {
      el.innerHTML = header(loc) + '<div class="elev-robot" role="img" aria-label="Robot">' + esc(loc.unit.label || loc.location.code) + '</div>' +
        '<p class="elev-caption">No shelf: this NDC is filled by the robot.</p>';
      return;
    }
    var c = caption(loc);
    el.innerHTML = header(loc) + strip(loc) + '<div class="elev-draw">' + drawing(loc, p) + '</div>' +
      '<p class="elev-caption ' + c.cls + '">' + esc(c.text) + '</p>';
  }

  Alpha.elevation = { render: render };
})(window.Alpha);
