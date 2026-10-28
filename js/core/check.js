/* Cross-checks a dataset beyond what the JSON Schema can say.
   Used by tools/validate.js and by the app when it loads data.
   Returns { errors: [], warnings: [] } of plain strings. No DOM. */
(function (root, factory) {
  var mod = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else (root.Alpha = root.Alpha || {}).check = mod;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
  var A = typeof require === 'function'
    ? { ndc: require('./ndc'), locate: require('./locate'), rules: require('./rules') }
    : root.Alpha;

  function checkDataset(ds) {
    var errors = [], warnings = [];
    if (!ds || typeof ds !== 'object') return { errors: ['dataset missing'], warnings: warnings };
    var layout = ds.layout || {}, locs = layout.locations || [];
    var byCode = {}, unitIds = {};

    locs.forEach(function (l, i) {
      var where = 'layout.locations[' + i + '] (' + l.code + ')';
      if (byCode[l.code]) errors.push(where + ': duplicate location code');
      byCode[l.code] = l;
      (l.units || []).forEach(function (u) {
        if (unitIds[u.id]) errors.push(where + ': duplicate unit id ' + u.id);
        unitIds[u.id] = 1;
        var r = u.rect || {};
        if (r.x < 0 || r.y < 0 || r.x + r.w > layout.width || r.y + r.h > layout.depth) {
          errors.push(where + ': unit ' + u.id + ' is outside the floor');
        }
        if (u.shelfRanges && u.shelfRanges.length !== u.shelves) {
          errors.push(where + ': unit ' + u.id + ' has ' + u.shelves + ' shelves but ' + u.shelfRanges.length + ' shelfRanges');
        }
        [u.range].concat(u.shelfRanges || []).forEach(function (rg) {
          if (rg && !/[a-z0-9]/i.test(rg.from + '') ) errors.push(where + ': unit ' + u.id + ' has a range with no letters or digits');
        });
        if (u.range && A.locate.alphaKey(u.range.from) > A.locate.alphaKey(u.range.to)) {
          errors.push(where + ': unit ' + u.id + ' range runs backwards');
        }
      });
    });

    var ndcs = {}, ranks = {};
    (ds.products || []).forEach(function (p, i) {
      var where = 'products[' + i + '] (' + (p.ndc || '?') + ' ' + (p.drug || '?') + ')';
      if (!/^\d{11}$/.test(p.ndc || '')) errors.push(where + ': NDC must be 11 digits');
      else {
        if (ndcs[p.ndc]) errors.push(where + ': duplicate NDC (also products[' + ndcs[p.ndc] + '])');
        else ndcs[p.ndc] = String(i);
        if (ds.meta && ds.meta.sample && !A.ndc.isFakeLabeler(p.ndc)) errors.push(where + ': sample NDCs must use labeler 99999');
      }

      if (p.location != null) {
        var loc = byCode[p.location];
        if (!loc) errors.push(where + ': location "' + p.location + '" is not in the layout');
        else {
          var unit = null;
          if (p.unit != null) {
            unit = loc.units.filter(function (u) { return u.id === p.unit; })[0];
            if (!unit) errors.push(where + ': unit "' + p.unit + '" is not part of location ' + p.location);
          } else if (loc.units.length === 1) unit = loc.units[0];
          else if (p.shelf != null) errors.push(where + ': shelf given but no unit, and location ' + p.location + ' has several units');
          if (p.shelf != null && !(typeof p.shelf === 'number' && p.shelf % 1 === 0)) errors.push(where + ': shelf must be a whole number');
          else if (unit && p.shelf != null && (p.shelf < 1 || p.shelf > unit.shelves)) {
            errors.push(where + ': shelf ' + p.shelf + ' does not fit unit ' + unit.id + ' (' + unit.shelves + ' shelves)');
          }
          if (unit && unit.range && !A.locate.inRange(p.drug, unit.range)) {
            warnings.push(where + ': drug is outside unit ' + unit.id + ' range ' + unit.range.from + '-' + unit.range.to);
          }
          if (p.robot === true && loc.kind !== 'robot') warnings.push(where + ': marked robot but location ' + p.location + ' is not the robot');
        }
      } else if (p.unit != null || p.shelf != null) {
        errors.push(where + ': unit or shelf given without a location');
      }
      if (p.rank != null) {
        var key = [p.drug, p.strength, p.form].join('|').toLowerCase();
        if (ranks[key] && ranks[key][p.rank]) warnings.push(where + ': rank ' + p.rank + ' used twice for ' + key);
        (ranks[key] = ranks[key] || {})[p.rank] = 1;
      }
    });

    var compiled = A.rules.compile(ds.rules || [], A.rules.PRODUCT_FIELDS);
    compiled.errors.forEach(function (e) { errors.push(e); });
    compiled.warnings.forEach(function (w) { warnings.push(w); });

    var schemeIds = {};
    (ds.basketSchemes || []).forEach(function (s, i) {
      var where = 'basketSchemes[' + i + '] (' + s.id + ')';
      if (schemeIds[s.id]) errors.push(where + ': duplicate scheme id');
      schemeIds[s.id] = 1;
      var colours = {};
      (s.colours || []).forEach(function (c) {
        colours[c.id] = 1;
        if (!/^#[0-9a-f]{6}$/i.test(c.hex || '')) errors.push(where + ': colour ' + c.id + ' needs a hex like #1f5fd1');
      });
      var labels = {};
      (s.groups || []).forEach(function (g) {
        if (labels[g.label]) errors.push(where + ': duplicate group label ' + g.label);
        labels[g.label] = 1;
        (g.baskets || []).forEach(function (b) { if (!colours[b]) errors.push(where + ': group ' + g.label + ' uses unknown colour "' + b + '"'); });
      });
    });
    return { errors: errors, warnings: warnings };
  }

  return { checkDataset: checkDataset };
});
