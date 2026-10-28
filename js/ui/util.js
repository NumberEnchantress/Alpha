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
    get: function (key, dflt) {
      try { var v = window.localStorage.getItem('alpha.' + key); return v == null ? dflt : JSON.parse(v); } catch (e) { return dflt; }
    },
    set: function (key, value) {
      try { window.localStorage.setItem('alpha.' + key, JSON.stringify(value)); return true; } catch (e) { return false; }
    },
    remove: function (key) { try { window.localStorage.removeItem('alpha.' + key); } catch (e) { /* ignore */ } }
  };

  var SVGNS = 'http://www.w3.org/2000/svg';

  Alpha.ui = { esc: esc, known: known, show: show, yesNo: yesNo, UNKNOWN: UNKNOWN, store: store, SVGNS: SVGNS };
})(window.Alpha);
