/* Top-down floor map, drawn once from the layout as SVG. Showing a product
   only moves classes and one marker, so it stays cheap on slow machines.
   Highlight: the location's units get a heavy outline; the chosen unit is
   filled. An estimated unit is hatched with a dashed outline and says
   "EST." beside the marker; an unknown unit leaves every unit of the
   location outlined. A marker shows where to stand (the side the unit is
   approached from). Sizes scale with the floor (k), and strokes are in
   screen pixels, so any layout size works. */
(function (Alpha) {
  'use strict';
  var esc = Alpha.ui.esc;
  var el = null, svg = null, layout = null, marker = null, markerEst = null, title = null, lastHi = [];
  var k = 1; // floor units per "standard" unit: a 100-wide floor has k = 1

  function unitLabel(loc, unit) {
    if (loc.units.length === 1) return loc.code;
    return unit.label || unit.id;
  }

  // Labels in tall, narrow boxes run vertically.
  function vertical(r) { return r.h > r.w * 1.2; }
  function fontFor(r, text) {
    var w = vertical(r) ? r.h : r.w, h = vertical(r) ? r.w : r.h;
    // Fit the label in the box, but never smaller than 2 (scaled) floor units.
    var byW = w / Math.max(2.2, text.length * 0.6), byH = h * 0.7;
    return Math.max(2 * k, Math.min(3.6 * k, byW, byH));
  }
  function label(r, text) {
    var cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    return '<text x="' + cx + '" y="' + cy + '" font-size="' + fontFor(r, text) + '"' +
      (vertical(r) ? ' transform="rotate(-90 ' + cx + ' ' + cy + ')"' : '') + '>' + esc(text) + '</text>';
  }

  function init(container, lay) {
    el = container; layout = lay;
    title = document.getElementById('map-title');
    var W = lay.width, D = lay.depth, parts = [];
    k = Math.max(W, D) / 100;
    parts.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + (-k) + ' ' + (-k) + ' ' + (W + 2 * k) + ' ' + (D + 2 * k) + '" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Floor map of ' + esc(lay.name) + '">');
    var hw = 1.6 * k;
    parts.push('<defs><pattern id="hatch" width="' + hw + '" height="' + hw + '" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">' +
      '<rect width="' + hw + '" height="' + hw + '" fill="#fff3a8"/><rect width="' + hw * 0.45 + '" height="' + hw + '" fill="#e0b400"/></pattern></defs>');
    parts.push('<rect class="floor" x="0" y="0" width="' + W + '" height="' + D + '"/>');
    (lay.features || []).forEach(function (f) {
      var r = f.rect;
      parts.push('<g class="feature ' + esc(f.kind || '') + '"><rect x="' + r.x + '" y="' + r.y + '" width="' + r.w + '" height="' + r.h + '"/>' +
        label(r, f.label) + '</g>');
    });
    lay.locations.forEach(function (loc) {
      loc.units.forEach(function (u) {
        var r = u.rect, text = unitLabel(loc, u);
        parts.push('<g class="unit kind-' + esc(loc.kind) + '" data-loc="' + esc(loc.code) + '" data-unit="' + esc(u.id) + '">' +
          '<rect class="u-box" x="' + r.x + '" y="' + r.y + '" width="' + r.w + '" height="' + r.h + '"/>' +
          faceLine(u) +
          label(r, text) +
          '</g>');
      });
    });
    // Where to stand: a disc with a pointer, placed by show().
    // Drawn last, so nothing covers it. Its contents are in standard units and
    // the group is scaled by k.
    parts.push('<g id="map-marker" class="marker" visibility="hidden"><circle r="3"/><text class="marker-text" y="0.1" font-size="1.75">YOU</text>' +
      '<g class="marker-est" visibility="hidden"><rect x="-3.6" y="3.4" width="7.2" height="2.9" rx="0.5"/><text y="4.85" font-size="2">EST.</text></g></g>');
    parts.push('</svg>');
    el.innerHTML = parts.join('');
    svg = el.firstChild;
    marker = el.querySelector('#map-marker');
    markerEst = marker.querySelector('.marker-est');
  }

  // A thick strip on the side the unit is approached from.
  function faceLine(u) {
    var r = u.rect, t = 0.55 * k, x = r.x, y = r.y, w = r.w, h = r.h;
    if (u.face === 'N') h = t;
    else if (u.face === 'S') { y = r.y + r.h - t; h = t; }
    else if (u.face === 'W') w = t;
    else if (u.face === 'E') { x = r.x + r.w - t; w = t; }
    else return '';
    return '<rect class="u-face" x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '"/>';
  }

  function standPoint(u) {
    var r = u.rect, gap = 3.6 * k;
    switch (u.face) {
      case 'N': return [r.x + r.w / 2, r.y - gap];
      case 'S': return [r.x + r.w / 2, r.y + r.h + gap];
      case 'W': return [r.x - gap, r.y + r.h / 2];
      case 'E': return [r.x + r.w + gap, r.y + r.h / 2];
    }
    return null;
  }

  function show(loc) {
    if (!svg) return;
    lastHi.forEach(function (g) { g.classList.remove('loc-hi', 'unit-hi', 'unit-est'); });
    lastHi = [];
    marker.setAttribute('visibility', 'hidden');
    markerEst.setAttribute('visibility', 'hidden');
    if (!loc || !loc.location) {
      title.textContent = !loc ? 'Floor map' : loc.code != null ? 'Floor map · ' + loc.code + ' is not on the map yet' : 'Floor map · location unknown';
      return;
    }
    var L = loc.location;
    var groups = svg.querySelectorAll('g.unit[data-loc="' + cssEsc(L.code) + '"]');
    for (var i = 0; i < groups.length; i++) {
      var g = groups[i];
      g.classList.add('loc-hi');
      lastHi.push(g);
      if (loc.unit && g.getAttribute('data-unit') === loc.unit.id) {
        g.classList.add(loc.unitStatus === 'estimated' ? 'unit-est' : 'unit-hi');
      }
    }
    // Draw highlighted units last so their outlines sit on top.
    lastHi.forEach(function (g) { g.parentNode.insertBefore(g, marker); });
    var where = L.code + (L.name && L.name !== L.code ? ' · ' + L.name : '');
    if (L.units.length > 1) {
      where += loc.unit ? ' · ' + (loc.unit.label || loc.unit.id) + (loc.unitStatus === 'estimated' ? ' (estimated)' : '') : ' · which unit: unknown';
    }
    title.textContent = 'Floor map · ' + where;
    svg.setAttribute('aria-label', 'Floor map of ' + layout.name + '. Highlighted: ' + where);
    if (loc.unit) {
      var p = standPoint(loc.unit);
      if (p) {
        marker.setAttribute('transform', 'translate(' + p[0] + ' ' + p[1] + ') scale(' + k + ')');
        marker.setAttribute('visibility', 'visible');
        markerEst.setAttribute('visibility', loc.unitStatus === 'estimated' ? 'visible' : 'hidden');
      }
    }
  }

  function cssEsc(s) { return String(s).replace(/["\\]/g, '\\$&'); }

  Alpha.map = { init: init, show: show };
})(window.Alpha);
