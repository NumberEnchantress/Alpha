/* Top-down floor map, drawn once from the layout as SVG. Showing a product
   only moves classes and one marker, so it stays cheap on slow machines.
   Highlight: the location's units get a heavy outline; the chosen unit is
   filled. An estimated unit is hatched with a dashed outline and says
   "EST." next to the marker, on whichever side covers no unit; an unknown unit leaves every unit of the
   location outlined. A marker shows where to stand (the side the unit is
   approached from). Sizes scale with the floor (k), and strokes are in
   screen pixels, so any layout size works. */
(function (Alpha) {
  'use strict';
  var esc = Alpha.ui.esc;
  var minFont = Infinity, minW = 0, minH = 0, mapRO = null, box = null;
  var el = null, svg = null, layout = null, marker = null, markerEst = null, markerRing = null, title = null, lastHi = [];
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
    var cx = r.x + r.w / 2, cy = r.y + r.h / 2, f = fontFor(r, text);
    if (f < minFont) minFont = f;
    return '<text x="' + cx + '" y="' + cy + '" font-size="' + f + '"' +
      (vertical(r) ? ' transform="rotate(-90 ' + cx + ' ' + cy + ')"' : '') + '>' + esc(text) + '</text>';
  }

  function init(container, lay) {
    el = container; layout = lay; minFont = Infinity;
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
    parts.push('<g id="map-marker" class="marker" visibility="hidden"><circle class="marker-ring" r="4.3" visibility="hidden"/><circle class="marker-dot" r="3"/><text class="marker-text" y="0.1" font-size="2.3">YOU</text>' +
      '<g class="marker-est" visibility="hidden"><rect x="' + (-TAG_W / 2) + '" y="' + (-TAG_H / 2) + '" width="' + TAG_W + '" height="' + TAG_H + '" rx="0.5"/><text y="0.1" font-size="2.3">EST.</text></g></g>');
    parts.push('</svg>');
    el.innerHTML = parts.join('');
    svg = el.firstChild;
    marker = el.querySelector('#map-marker');
    markerEst = marker.querySelector('.marker-est');
    markerRing = marker.querySelector('.marker-ring');
    // The smallest text on the map (unit and feature labels, and YOU / EST.
    // at 2.3 x k) sets the smallest size the map is drawn at: 11 px. A pane
    // smaller than that scrolls, and keeps the marker in view.
    var smallest = Math.min(minFont, 2.3 * k), per = 11 / smallest;
    minW = (W + 2 * k) * per; minH = (D + 2 * k) * per;
    svg.style.minWidth = Math.ceil(minW) + 'px'; svg.style.minHeight = Math.ceil(minH) + 'px';
    if (window.ResizeObserver && !mapRO) {
      mapRO = new ResizeObserver(function (en) { var r = en[0].contentRect; box = { w: r.width, h: r.height }; });
      mapRO.observe(el);
    }
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
    markerRing.setAttribute('visibility', 'hidden');
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
        if (loc.unitStatus === 'estimated') {
          var off = tagOffset(p);
          if (off) {
            markerEst.setAttribute('transform', 'translate(' + off[0] + ' ' + off[1] + ')');
            markerEst.setAttribute('visibility', 'visible');
          } else markerRing.setAttribute('visibility', 'visible'); // no free spot: a dashed ring says "estimated"
        }
        if (box && (box.w < minW - 1 || box.h < minH - 1)) scrollTo(p);
      }
    }
  }

  // When the pane is smaller than the map's smallest size, it scrolls: bring
  // the marker to the middle. Sizes come from the ResizeObserver, so this
  // reads no layout.
  function scrollTo(p) {
    var W = layout.width + 2 * k, D = layout.depth + 2 * k;
    var sw = Math.max(box.w, minW), sh = Math.max(box.h, minH), s = Math.min(sw / W, sh / D);
    var x = (sw - W * s) / 2 + (p[0] + k) * s, y = (sh - D * s) / 2 + (p[1] + k) * s;
    el.scrollLeft = Math.max(0, x - box.w / 2); el.scrollTop = Math.max(0, y - box.h / 2);
  }

  // Where the EST. tag goes, relative to the marker (standard units): the
  // first spot, nearest first, whose box (with a margin, so outlines never
  // touch) covers no unit, label or feature and stays on the floor. Spots are
  // tried in three rings of eight around the marker. If none is free there is
  // no tag; a dashed ring round the marker shows "estimated" instead.
  var TAG_W = 8.6, TAG_H = 3.4, TAG_PAD = 0.7, R = 3; // tag box, margin, marker radius
  var DIRS = [[0, 1], [1, 0], [-1, 0], [0, -1], [-1, 1], [1, 1], [-1, -1], [1, -1]];
  var TAG_SPOTS = [];
  [0, 3, 6.5].forEach(function (extra) {
    DIRS.forEach(function (d) {
      TAG_SPOTS.push([d[0] * (R + TAG_PAD + TAG_W / 2 + extra), d[1] * (R + TAG_PAD + TAG_H / 2 + extra)]);
    });
  });
  function tagOffset(p) {
    var boxes = [];
    layout.locations.forEach(function (l) { l.units.forEach(function (u) { boxes.push(u.rect); }); });
    (layout.features || []).forEach(function (f) { boxes.push(f.rect); });
    var hw = (TAG_W / 2 + TAG_PAD) * k, hh = (TAG_H / 2 + TAG_PAD) * k;
    for (var i = 0; i < TAG_SPOTS.length; i++) {
      var cx = p[0] + TAG_SPOTS[i][0] * k, cy = p[1] + TAG_SPOTS[i][1] * k;
      if (cx - hw < 0 || cy - hh < 0 || cx + hw > layout.width || cy + hh > layout.depth) continue;
      var hit = boxes.some(function (r) { return cx + hw > r.x && cx - hw < r.x + r.w && cy + hh > r.y && cy - hh < r.y + r.h; });
      if (!hit) return TAG_SPOTS[i];
    }
    return null;
  }

  function cssEsc(s) { return String(s).replace(/["\\]/g, '\\$&'); }

  Alpha.map = { init: init, show: show };
})(window.Alpha);
