/* NDC parsing and formatting. No DOM; also loads in Node. */
(function (root, factory) {
  var mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else (root.Alpha = root.Alpha || {}).ndc = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function digits(s) { return String(s == null ? '' : s).replace(/\D/g, ''); }

  function pad(s, n) { while (s.length < n) s = '0' + s; return s; }

  // Returns the 11-digit (5-4-2) form, or null if the input is not an
  // unambiguous NDC. Accepts 5-4-2, 4-4-2, 5-3-2 and 5-4-1 hyphenated forms and
  // plain 11 digits. Plain 10 digits are ambiguous: use tenDigitForms instead.
  function normalize(input) {
    var s = String(input == null ? '' : input).trim().replace(/[\u2010-\u2015\u2212]/g, '-'); // dashes of any kind
    if (/^-|-$/.test(s)) return null;
    var parts = s.split(/[\s\-]+/).filter(Boolean);
    if (parts.length === 1) {
      return /^\d{11}$/.test(parts[0]) ? parts[0] : null;
    }
    if (parts.length !== 3 || !parts.every(function (p) { return /^\d+$/.test(p); })) return null;
    var a = parts[0], b = parts[1], c = parts[2];
    var shape = a.length + '-' + b.length + '-' + c.length;
    if (shape === '5-4-2' || shape === '4-4-2' || shape === '5-3-2' || shape === '5-4-1') {
      return pad(a, 5) + pad(b, 4) + pad(c, 2);
    }
    return null;
  }

  function format(n11) {
    if (!/^\d{11}$/.test(n11 || '')) return n11 == null ? '' : String(n11);
    return n11.slice(0, 5) + '-' + n11.slice(5, 9) + '-' + n11.slice(9);
  }

  // The plain 10-digit strings this NDC could be printed as.
  function tenDigitForms(n11) {
    var out = [];
    if (!/^\d{11}$/.test(n11 || '')) return out;
    var a = n11.slice(0, 5), b = n11.slice(5, 9), c = n11.slice(9);
    if (a[0] === '0') out.push(a.slice(1) + b + c);
    if (b[0] === '0') out.push(a + b.slice(1) + c);
    if (c[0] === '0') out.push(a + b + c.slice(1));
    return out;
  }

  // A UPC-A barcode on US drug packaging is "3" + 10-digit NDC + check digit.
  function fromUpc(s) {
    var d = digits(s);
    if (d.length === 12 && d[0] === '3') return d.slice(1, 11);
    return null;
  }

  function isFakeLabeler(n11) { return /^99999\d{6}$/.test(n11 || ''); }

  return { digits: digits, normalize: normalize, format: format,
    tenDigitForms: tenDigitForms, fromUpc: fromUpc, isFakeLabeler: isFakeLabeler };
});
