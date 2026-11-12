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

  // The schedule as a pharmacy writes it (version-51): OTC, Rx only, C-II ... C-V; uncertain ones say so.
  var SCHED_TEXT = { OTC: 'OTC', Rx: 'Rx only', CV: 'C-V', CIV: 'C-IV', CIII: 'C-III', CII: 'C-II' };
  function scheduleText(p) {
    if (!p.schedule) return UNKNOWN;
    var t = esc(SCHED_TEXT[p.schedule] || p.schedule);
    if (/^C/.test(p.schedule)) t = '<strong>' + t + '</strong>';
    return t + (p.scheduleNote ? ' <span class="tag">CHECK</span> <span class="small muted">' + esc(p.scheduleNote) + '</span>' : '');
  }

  // Substitutes (version-53), from the FDA Orange Book's therapeutic equivalence codes: the other NDCs
  // here of the same ingredient, form and strength that share an A code with this one.
  function aCodes(te) { return String(te || '').split(',').map(function (c) { return c.trim(); }).filter(function (c) { return /^A/.test(c); }); }
  function substitutesHtml(p) {
    if (p.obDiscontinued) return UNKNOWN + ' <span class="small muted">(the Orange Book lists this product as discontinued)</span>';
    if (p.te == null) return UNKNOWN + ' <span class="small muted">(not linked to the Orange Book: a biologic, an OTC monograph or unapproved drug, or no match)</span>';
    var mine = aCodes(p.te);
    if (!p.te) return 'Not rated <span class="small muted">(the Orange Book gives no TE code: often the only product of its kind)</span>';
    if (!mine.length) return 'None: not therapeutically equivalent <span class="tag">' + esc(p.te) + '</span>';
    var all = (Alpha.state && Alpha.state.ds && Alpha.state.ds.products) || [];
    var subs = all.filter(function (q) { return q !== p && q.ndc !== p.ndc && q.teKey === p.teKey && aCodes(q.te).some(function (c) { return mine.indexOf(c) >= 0; }); });
    var head = '<span class="tag">' + esc(mine.join(', ')) + '</span>' + (p.rld ? ' <span class="small muted">reference brand</span>' : '') +
      (p.teNote ? ' <span class="tag">CHECK</span> <span class="small muted">' + esc(p.teNote) + '</span>' : '') + ' ';
    if (!subs.length) return head + 'none stocked here';
    return head + '<ul class="subs">' + subs.slice(0, 8).map(function (q) {
      return '<li>' + esc(Alpha.ui.name(q)) + ' ' + esc(q.manufacturer || '') + ' <span class="ndc small">' + esc(Alpha.ndc.format(q.ndc)) + '</span>' + (q.location ? ' <span class="small muted">at ' + esc(q.location) + '</span>' : '') + '</li>';
    }).join('') + '</ul>' + (subs.length > 8 ? '<span class="small muted">and ' + (subs.length - 8) + ' more</span>' : '');
  }

  // Where the NDC comes from (version-50): the FDA's directory, or a placeholder that is not a real NDC.
  function ndcSource(p) {
    var meta = (Alpha.state && Alpha.state.ds && Alpha.state.ds.meta) || {};
    var text = Alpha.ndc.isFakeLabeler(p.ndc) ? 'Placeholder, not a real NDC' : meta.publicNdcs ? 'NDC from the FDA NDC Directory' : '';
    return text ? '<div class="i-ndc-src small muted" data-testid="ndc-source">' + esc(text) + '</div>' : '';
  }

  function render(el, p, loc, warnings) {
    if (!p) {
      el.innerHTML = '<p class="empty">Type a drug and strength (<kbd>atorva 40</kbd>) or scan or type an NDC.</p>';
      return;
    }
    var where = whereText(loc);
    // (version-52: which table of the NIOSH 2024 list, and a note for a local form)
    var niosh = p.niosh === true ? '<span class="yes-hazard">Yes' + (p.nioshTable ? ' (Table ' + p.nioshTable + ')' : '') + '<span class="tag">HAZARDOUS</span></span>' +
      (p.nioshNote ? ' <span class="small muted">' + esc(p.nioshNote) + '</span>' : '') : yesNo(p.niosh);
    el.innerHTML =
      '<h2 class="i-head">' + esc(Alpha.ui.name(p)) + ' ' + show(p.strength) + '</h2>' +
      '<div class="i-ndc">' + esc(Alpha.ndc.format(p.ndc)) + '</div>' + ndcSource(p) +
      '<div class="i-loc ' + where.cls + '" data-testid="where">' + esc(where.text) + '</div>' +
      warningsHtml(warnings) +
      // Two facts per row so the card fits at 1366x768.
      '<dl class="facts">' +
        '<dt>Form</dt><dd>' + show(p.form) + '</dd>' +
        '<dt>NIOSH</dt><dd data-testid="niosh">' + niosh + '</dd>' +
        '<dt>Schedule</dt><dd data-testid="schedule">' + scheduleText(p) + '</dd>' +
        '<dt>Substitutes</dt><dd class="span" data-testid="substitutes">' + substitutesHtml(p) + '</dd>' +
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
