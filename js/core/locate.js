/* Works out which unit and shelf a product is on, and whether that is
   known, estimated from alphabetical ranges, or unknown. Never guesses
   without saying so. No DOM; also loads in Node. */
(function (root, factory) {
  var mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else (root.Alpha = root.Alpha || {}).locate = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEPTH = 10;

  // Maps a name to a number in [0, 1) by its first letters, so names can be
  // placed between alphabetical range ends.
  // Digits sort before letters; spaces and punctuation are ignored.
  var CHARS = '0123456789abcdefghijklmnopqrstuvwxyz', BASE = CHARS.length + 1;
  function clean(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
  function alphaKey(s) {
    var t = clean(s);
    var k = 0, scale = 1;
    for (var i = 0; i < DEPTH; i++) {
      scale /= BASE;
      k += (i < t.length ? CHARS.indexOf(t[i]) + 1 : 0) * scale;
    }
    return k;
  }
  // Upper bound of everything that starts with `s`.
  function alphaKeyEnd(s) {
    var t = clean(s);
    return alphaKey(t + 'zzzzzzzzzz'.slice(0, Math.max(0, DEPTH - t.length)));
  }

  function inRange(name, range) {
    if (!range || range.from == null || range.to == null) return false;
    var k = alphaKey(name);
    return k >= alphaKey(range.from) && k <= alphaKeyEnd(range.to);
  }

  function estimateShelf(name, unit) {
    var n = unit.shelves;
    if (!n) return null;
    if (unit.shelfRanges && unit.shelfRanges.length) {
      for (var i = 0; i < unit.shelfRanges.length; i++) {
        if (inRange(name, unit.shelfRanges[i])) return i + 1;
      }
      return null;
    }
    if (!unit.range || unit.range.from == null || unit.range.to == null) return null;
    var lo = alphaKey(unit.range.from), hi = alphaKeyEnd(unit.range.to);
    if (hi <= lo) return null;
    var t = (alphaKey(name) - lo) / (hi - lo);
    if (t < 0 || t > 1) return null; // outside the unit's range: do not guess
    return Math.min(n, Math.floor(t * n) + 1);
  }

  /* Result:
     location: the layout location or null
     unit: the unit or null; unitStatus: known | estimated | unknown
     shelf: number or null; shelfStatus: known | estimated | unknown | none
       (none = this unit has no shelves, e.g. the robot)
     unitReason (when the unit is unknown): 'bad-id' if the data names a unit
       that is not part of the location, 'no-range' otherwise. */
  function locate(product, layout) {
    var r = { location: null, unit: null, unitStatus: 'unknown', shelf: null, shelfStatus: 'unknown' };
    if (!product || !layout || product.location == null) return r;
    r.code = product.location; // kept even when the layout has no such location
    var loc = null;
    for (var i = 0; i < layout.locations.length; i++) {
      if (layout.locations[i].code === product.location) { loc = layout.locations[i]; break; }
    }
    if (!loc) return r;
    r.location = loc;

    if (product.unit != null) {
      for (var j = 0; j < loc.units.length; j++) {
        if (loc.units[j].id === product.unit) { r.unit = loc.units[j]; r.unitStatus = 'known'; break; }
      }
      if (!r.unit) r.unitReason = 'bad-id';
    } else if (loc.units.length === 1) {
      r.unit = loc.units[0]; r.unitStatus = 'known';
    } else {
      for (var u = 0; u < loc.units.length; u++) {
        if (inRange(product.drug, loc.units[u].range)) { r.unit = loc.units[u]; r.unitStatus = 'estimated'; break; }
      }
    }
    if (!r.unit) { r.unitReason = r.unitReason || 'no-range'; return r; }

    if (!r.unit.shelves) { r.shelfStatus = 'none'; return r; }
    if (product.shelf != null && product.shelf >= 1 && product.shelf <= r.unit.shelves) {
      // A shelf from the data is used as is; it is only "estimated" when the
      // unit it belongs to was itself estimated.
      r.shelf = product.shelf; r.shelfStatus = r.unitStatus === 'known' ? 'known' : 'estimated'; return r;
    }
    var est = estimateShelf(product.drug, r.unit);
    if (est != null) { r.shelf = est; r.shelfStatus = 'estimated'; }
    return r;
  }

  return { alphaKey: alphaKey, inRange: inRange, estimateShelf: estimateShelf, locate: locate };
});
