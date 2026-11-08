/* Small shared helpers for the views. */
(function (Alpha) {
  'use strict';
  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ESC[c]; }); }

  var UNKNOWN = '<span class="unknown-val">unknown</span>';
  function known(v) { return v !== undefined && v !== null && v !== ''; }
  function show(v) { return known(v) ? esc(v) : UNKNOWN; }
  function yesNo(v) { return v === true ? 'Yes' : v === false ? 'No' : UNKNOWN; }

  // localStorage can be missing or throw (private mode, file:// policies).
  var store = {
    // Can this page use localStorage at all? (False when blocked; a full
    // storage is still usable: reads work and writes fail one by one.)
    usable: function () { try { window.localStorage.getItem('alpha.probe'); return true; } catch (e) { return false; } },
    get: function (key, dflt) {
      try { var v = window.localStorage.getItem('alpha.' + key); return v == null ? dflt : JSON.parse(v); } catch (e) { return dflt; }
    },
    set: function (key, value) {
      try { window.localStorage.setItem('alpha.' + key, JSON.stringify(value)); return true; } catch (e) { return false; }
    },
    remove: function (key) { try { window.localStorage.removeItem('alpha.' + key); } catch (e) { /* ignore */ } },
    // The stored text as is (null if none or storage is blocked).
    raw: function (key) { try { return window.localStorage.getItem('alpha.' + key); } catch (e) { return null; } },
    setRaw: function (key, text) { try { window.localStorage.setItem('alpha.' + key, text); return true; } catch (e) { return false; } },
    // Keys (without "alpha.") that start with a prefix; [] if storage is blocked.
    keys: function (prefix) {
      try {
        var out = [], ls = window.localStorage;
        for (var i = 0; i < ls.length; i++) { var k = ls.key(i); if (k && k.indexOf('alpha.' + prefix) === 0) out.push(k.slice(6)); }
        return out.sort();
      } catch (e) { return []; }
    }
  };

  var SVGNS = 'http://www.w3.org/2000/svg';

  // Width of bold text in em, estimated per character (no layout read): wide
  // letters (W, M, m, w, Ж, Ш, CJK) about 1, capitals and digits 0.72, narrow
  // ones (i, l, 1, punctuation, space) 0.35, the rest 0.62. On the generous
  // side, so labels sized or avoided by it are not cut or covered.
  var WIDE = /[WMÆŒ@%&mwЖШЩЮФЫжшщюфыᗪᗅ]|[ᄀ-ᇿ⺀-꓏가-힯豈-﫿︰-﹏＀-｠￠-￦]|[\uD800-\uDBFF]/;
  function textEm(text) {
    var w = 0;
    String(text).replace(/[\s\S]/g, function (c) {
      w += c === '﷽' ? 4 : /[—―⸺⸻Ⅰ-ↈ　-〿]/.test(c) ? 1.1 : WIDE.test(c) ? 1 : /[A-Z0-9#?]/.test(c) || /\p{Lu}/u.test(c) ? 0.75 : /[\s.,:;'!|ilI1jtfr]/.test(c) ? 0.35 : /[\uDC00-\uDFFF]/.test(c) ? 0 : 0.62;
      return c;
    });
    return w;
  }
  // A product's name as shown: the drug, then its brand when it has one
  // ("norgestimate-ethinyl estradiol (Sprintec)").
  function name(p) { return p.drug + (p.brand ? ' (' + p.brand + ')' : ''); }
  Alpha.ui = { name: name, esc: esc, known: known, show: show, yesNo: yesNo, UNKNOWN: UNKNOWN, store: store, SVGNS: SVGNS, textEm: textEm };
})(window.Alpha);
