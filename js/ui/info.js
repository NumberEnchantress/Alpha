/* Info pane: short, scannable facts about the chosen NDC. */
(function (Alpha) {
  'use strict';
  var ui = Alpha.ui, esc = ui.esc, show = ui.show, yesNo = ui.yesNo, UNKNOWN = ui.UNKNOWN;

  // One line saying where it is, with known / estimated / unknown spelled out.
  function whereText(loc) {
    if (!loc.location) return { cls: 'unknown', text: loc.code != null ? loc.code + ' · not on the map yet' : 'Location unknown' };
    var L = loc.location, parts = [L.code === L.name ? L.code : L.code + (L.name ? ' · ' + L.name : '')];
    var estimated = false;
    if (L.units.length > 1) {
      if (loc.unit) {
        parts.push((loc.unit.label || loc.unit.id) + (loc.unitStatus === 'estimated' ? ' (estimated)' : ''));
        estimated = estimated || loc.unitStatus === 'estimated';
      } else parts.push('unit unknown');
    }
    if (loc.shelfStatus === 'known') parts.push('shelf ' + loc.shelf + ' of ' + loc.unit.shelves);
    else if (loc.shelfStatus === 'estimated') { parts.push('shelf ≈' + loc.shelf + ' of ' + loc.unit.shelves + ' (estimated)'); estimated = true; }
    else if (loc.shelfStatus === 'unknown') parts.push('shelf unknown');
    var unknown = !loc.unit || loc.shelfStatus === 'unknown';
    return { cls: unknown ? 'unknown' : estimated ? 'estimated' : '', text: parts.join(' — ') };
  }

  function vials(v) {
    if (v === 'n/a') return 'not used';
    if (!v || typeof v !== 'object') return UNKNOWN;
    return ['20', '40', '60'].map(function (k) { return k + ' dr: ' + show(v[k]); }).join(' · ');
  }

  function basketKey(scheme, problem) {
    if (!scheme) return '';
    var colours = Object.create(null);
    scheme.colours.forEach(function (c) { colours[c.id] = c; });
    var items = scheme.groups.map(function (g) {
      var sw = g.baskets.map(function (b) {
        var c = colours[b] || { name: b, hex: '#ffffff' };
        var hex = /^#[0-9a-f]{6}$/i.test(c.hex) ? c.hex : '#ffffff'; // only plain colours reach style=
        return '<span class="swatch" style="background:' + hex + '" aria-hidden="true"></span>';
      }).join('');
      var names = g.baskets.map(function (b) { return esc((colours[b] || { name: b }).name); }).join(' + ');
      return '<li><strong>' + esc(g.label) + '</strong>' + sw + '<span class="basket-names">' + names + '</span></li>';
    }).join('');
    return '<h3 class="i-section">Baskets · ' + esc(scheme.name) + '</h3>' +
      (problem ? '<p class="warning warn" role="alert"><span class="sev">Warning</span>' + esc(problem) + '</p>' : '') +
      '<ul class="baskets" aria-label="Basket groups">' + items + '</ul>';
  }

  function warningsHtml(warnings) {
    if (!warnings.length) return '';
    return '<ul class="warnings">' + warnings.map(function (w) {
      var label = w.severity === 'danger' ? 'Danger' : w.severity === 'warn' ? 'Warning' : 'Note';
      var btn = w.equivalent ? '<br><button type="button" class="btn" data-ndc="' + esc(w.equivalent.ndc) + '">Show ' + esc(Alpha.ndc.format(w.equivalent.ndc)) + '</button>' : '';
      return '<li class="warning ' + esc(w.severity) + '" data-rule="' + esc(w.id) + '"><span class="sev">' + label + '</span>' + esc(w.message) + btn + '</li>';
    }).join('') + '</ul>';
  }

  function render(el, p, loc, warnings) {
    if (!p) {
      el.innerHTML = '<p class="empty">Type a drug and strength (<kbd>atorva 40</kbd>) or scan or type an NDC.</p>';
      return;
    }
    var where = whereText(loc);
    var niosh = p.niosh === true ? '<span class="yes-hazard">Yes<span class="tag">HAZARDOUS</span></span>' : yesNo(p.niosh);
    el.innerHTML =
      '<h2 class="i-head">' + esc(Alpha.ui.name(p)) + ' ' + show(p.strength) + '</h2>' +
      '<div class="i-ndc">' + esc(Alpha.ndc.format(p.ndc)) + '</div>' +
      '<div class="i-loc ' + where.cls + '" data-testid="where">' + esc(where.text) + '</div>' +
      warningsHtml(warnings) +
      // Two facts per row so the card fits at 1366x768.
      '<dl class="facts">' +
        '<dt>Form</dt><dd>' + show(p.form) + '</dd>' +
        '<dt>NIOSH</dt><dd data-testid="niosh">' + niosh + '</dd>' +
        '<dt>Count</dt><dd>' + show(p.countPerBottle) + '</dd>' +
        '<dt>Safety cap</dt><dd>' + yesNo(p.safetyCap) + '</dd>' +
        '<dt>In robot</dt><dd>' + yesNo(p.robot) + '</dd>' +
        '<dt>Preferred</dt><dd>' + yesNo(p.preferred) + '</dd>' +
        '<dt>Maker</dt><dd class="span">' + show(p.manufacturer) + '</dd>' +
        (p.aka && p.aka.length ? '<dt>Also known as</dt><dd class="span">' + esc(p.aka.join(', ')) + '</dd>' : '') +
        '<dt>Vial fits</dt><dd class="span">' + vials(p.vialCapacity) + '</dd>' +
      '</dl>' +
      (ui.known(p.notes) ? '<div class="notes">' + esc(p.notes) + '</div>' : '');
  }

  // The basket key only changes with the scheme, so it is rendered apart.
  function renderBaskets(el, scheme, problem) { el.innerHTML = basketKey(scheme, problem); }

  Alpha.info = { render: render, renderBaskets: renderBaskets, whereText: whereText };
})(window.Alpha);
