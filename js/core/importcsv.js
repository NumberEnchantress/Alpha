/* CSV import for real store data: a product/shelf list and a robot NDC list.
   Builds products in the dataset shape and a report that accounts for every
   row: imported, imported with notes, or skipped with the reason, each with
   its line number in the file. It never guesses: a bad value becomes unknown
   and is noted. Uses PapaParse. No DOM; also loads in Node. */
(function (root, factory) {
  var mod = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else (root.Alpha = root.Alpha || {}).importcsv = mod;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
  var isNode = typeof require === 'function';
  var Papa = isNode ? require('papaparse') : root.Papa;
  var ndc = isNode ? require('./ndc') : root.Alpha.ndc;

  // Accepted column names (compared without case, spaces or punctuation).
  // When two columns name one field, the one earlier in its list wins, so
  // the exact names come before the generic ones ("Product Name" before
  // "Product", which is often a product code). A "Product NDC" (labeler and
  // product only, no package) is not an NDC column.
  var COLUMNS = {
    ndc: ['ndc', 'ndc11', 'ndccode', 'ndcnumber', 'ndc11code', 'packagendc', 'ndcpackagecode', 'itemndc', 'nationaldrugcode', 'ndcupc'],
    drug: ['drug', 'drugname', 'genericname', 'productname', 'itemname', 'itemdescription', 'drugdescription', 'productdescription', 'description', 'name', 'product'],
    strength: ['strength', 'str'],
    form: ['form', 'dosageform'],
    manufacturer: ['manufacturer', 'mfr', 'mfg', 'labeler', 'maker'],
    location: ['location', 'loc', 'locationcode', 'bin', 'binlocation', 'shelflocation', 'binno', 'binnumber'],
    unit: ['unit', 'face', 'fridge', 'section'],
    shelf: ['shelf', 'shelfnumber', 'shelfno'],
    countPerBottle: ['countperbottle', 'packsize', 'packagesize', 'bottlesize', 'qtyperbottle', 'pkgsize', 'pksize', 'pkgqty', 'packqty'],
    niosh: ['niosh', 'hazardous', 'nioshhazardous'],
    safetyCap: ['safetycap'],
    vial20: ['vial20', '20dram', '20dr', 'dram20'],
    vial40: ['vial40', '40dram', '40dr', 'dram40'],
    vial60: ['vial60', '60dram', '60dr', 'dram60'],
    robot: ['robot', 'inrobot'],
    preferred: ['preferred', 'preferredndc'],
    rank: ['rank', 'usagerank'],
    notes: ['notes', 'note', 'comments', 'comment']
  };
  var TRUE = ['yes', 'y', 'true', '1', 'x'], FALSE = ['no', 'n', 'false', '0'];
  var SCI = /^\d+(\.\d+)?e\+?\d+$/i;

  function key(h) { return String(h || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

  /* ---------- decoding the file's bytes ---------- */

  // Excel and pharmacy systems do not always write UTF-8. A byte-order mark
  // is honoured; otherwise the file is UTF-8 if its bytes are valid UTF-8,
  // UTF-16 if every other byte is zero, and else Windows-1252 (what Excel's
  // plain "CSV" writes on Windows). Returns { text, encoding, note } or
  // { problem } for a file that is not text at all.
  var CP1252_NOTE = 'This file is not UTF-8, so it was read as Windows-1252 (what Excel uses for plain "CSV"). Check that accented letters and symbols such as µ look right.';
  // Every reading is checked once more as text: a control character (C0 or
  // C1, other than tab and line breaks) in a UTF-16 file, or a byte Windows-1252
  // leaves undefined, is named by its line, as for UTF-8.
  function decode(bytes) {
    var r = decodeBytes(bytes);
    if (r.text == null) return r;
    r.text = r.text.replace(/\u001a$/, '');
    var m = /[\u0000-\u0008\u000e-\u001f\u007f-\u009f]/.exec(r.text);
    if (m) {
      var line = r.text.slice(0, m.index).split(/\r\n|\r|\n/).length, code = m[0].charCodeAt(0);
      return { problem: 'Line ' + line + (code >= 128 && r.encoding === 'Windows-1252'
        ? ' holds a byte with no meaning in Windows-1252 (code ' + code + '), so the file may be in another encoding or damaged. Save it as "CSV UTF-8" and import again.'
        : ' holds an invisible control character (code ' + code + ')' + (code < 32 ? ', as some barcode scanners add' : '') + '. Remove it and import again.') };
    }
    return r;
  }
  function decodeBytes(bytes) {
    var b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    function dec(enc, from, fatal) { return new TextDecoder(enc, { fatal: !!fatal }).decode(b.subarray(from)); }
    // UTF-16 read strictly: a file cut off on an odd byte, or a broken pair, is refused, not patched with �.
    function utf16(enc, from, note) {
      try { return { text: dec(enc, from, true), encoding: 'UTF-16', note: note }; }
      catch (e) { return { problem: 'This file is UTF-16 but part of it cannot be read (cut off, or damaged), so some characters would change. Save it again (Excel: File > Save As > CSV UTF-8) and import again.' }; }
    }
    // Control bytes (other than tab, line breaks and form feed) do not occur in
    // text: a file with them is an image, a PDF or another binary file.
    function binary(from) {
      var n = Math.min(b.length, from + 8192), ctl = 0;
      for (var i = from; i < n; i++) {
        var c = b[i];
        if ((c < 9 || (c > 13 && c < 32) || c === 127) && !(c === 26 && i === b.length - 1)) ctl++; // a final Ctrl-Z (old DOS end mark) is fine
      }
      if (!ctl) return null;
      if (ctl <= 3 || ctl * 100 < n - from) {
        // A text file with a stray control character (some barcode scanners add one): name the line.
        for (var j = from, line = 1; j < b.length; j++) {
          var cj = b[j];
          if (cj === 10) line++;
          else if ((cj < 9 || (cj > 13 && cj < 32) || cj === 127) && !(cj === 26 && j === b.length - 1)) {
            return { problem: 'Line ' + line + ' holds an invisible control character (code ' + cj + '), as some barcode scanners add. Remove it and import again.' };
          }
        }
      }
      return { problem: 'This is not a text file (it looks like an image, a PDF or another kind of file), so it is not a CSV.' };
    }
    // Valid UTF-8 characters (such as µ written as two bytes) next to bytes that
    // are not UTF-8: two encodings in one file (rows pasted from another
    // export). Read either way, some characters would change, so the file is
    // refused at the first line that is not UTF-8.
    function mixed(from) {
      var valid = 0, bad = -1;
      for (var i = from; i < b.length;) {
        var c = b[i], n = c < 0x80 ? 0 : c >= 0xC2 && c <= 0xDF ? 1 : c >= 0xE0 && c <= 0xEF ? 2 : c >= 0xF0 && c <= 0xF4 ? 3 : -1, ok = n > 0;
        if (n === 0) { i++; continue; }
        for (var k = 1; ok && k <= n; k++) ok = i + k < b.length && b[i + k] >= 0x80 && b[i + k] <= 0xBF;
        if (ok) { valid++; i += n + 1; } else { if (bad < 0) bad = i; i++; }
      }
      if (!valid || bad < 0) return null;
      for (var j = from, line = 1; j < bad; j++) if (b[j] === 10) line++;
      return { problem: 'Line ' + line + ' is in another encoding from the rest of the file: most of it is UTF-8, but that line has a byte that is not (Windows-1252, perhaps, from rows pasted in from another export). Read either way, some characters would change (µ would become Âµ). Save the file again as "CSV UTF-8" (or retype that line) and import again.' };
    }
    if (b[0] === 0x50 && b[1] === 0x4B && b[2] === 0x03 && b[3] === 0x04) return { problem: 'This is an Excel workbook (.xlsx) or another zipped file, not a CSV. In Excel, use File > Save As and choose "CSV UTF-8".' };
    if (b[0] === 0xD0 && b[1] === 0xCF && b[2] === 0x11 && b[3] === 0xE0) return { problem: 'This is an old Excel workbook (.xls), not a CSV. In Excel, use File > Save As and choose "CSV UTF-8".' };
    if (b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) {
      // A UTF-8 mark followed by bytes that are not UTF-8: read the rest as Windows-1252, and say so.
      try { return { text: dec('utf-8', 3, true), encoding: 'UTF-8' }; }
      catch (e) { return binary(3) || mixed(3) || { text: dec('windows-1252', 3), encoding: 'Windows-1252', note: 'This file starts with a UTF-8 mark but is not UTF-8, so it was read as Windows-1252. Check that accented letters and symbols such as µ look right.' }; }
    }
    if ((b[0] === 0xFF && b[1] === 0xFE && b[2] === 0 && b[3] === 0) || (b[0] === 0 && b[1] === 0 && b[2] === 0xFE && b[3] === 0xFF)) {
      return { problem: 'This file is in UTF-32, which Alpha does not read. Save it as "CSV UTF-8" and import again.' };
    }
    if (b[0] === 0xFF && b[1] === 0xFE) return utf16('utf-16le', 2);
    if (b[0] === 0xFE && b[1] === 0xFF) return utf16('utf-16be', 2);
    // UTF-16 without a mark: zero bytes in every odd (LE) or even (BE) place.
    var n = Math.min(b.length, 4096) & ~1, zeroOdd = 0, zeroEven = 0;
    for (var i = 0; i < n; i += 2) { if (b[i] === 0) zeroEven++; if (b[i + 1] === 0) zeroOdd++; }
    if (n >= 4) {
      if (zeroOdd > n / 2 * 0.9 && zeroEven < n / 2 * 0.1) return utf16('utf-16le', 0, 'This file has no byte-order mark; it was read as UTF-16 because every other byte is zero.');
      if (zeroEven > n / 2 * 0.9 && zeroOdd < n / 2 * 0.1) return utf16('utf-16be', 0, 'This file has no byte-order mark; it was read as UTF-16 because every other byte is zero.');
    }
    var text;
    try { text = dec('utf-8', 0, true); } catch (e) { return binary(0) || mixed(0) || { text: dec('windows-1252', 0), encoding: 'Windows-1252', note: CP1252_NOTE }; }
    if (text.indexOf('\u0000') >= 0) return { problem: 'This file contains zero bytes, so it is not a text CSV file.' };
    var bin = binary(0);
    if (bin) return bin;
    return { text: text.replace(/\u001a$/, ''), encoding: 'UTF-8' };
  }

  /* ---------- reading the file ---------- */

  // Line endings are normalised to \n before reading (CRLF, CR and mixtures).
  function countBreaks(t, a, b) { var n = 0; for (var i = a; i < b; i++) if (t.charCodeAt(i) === 10) n++; return n; }

  // Comma unless the first non-blank line has more semicolons or tabs.
  function delimiterOf(t) {
    var first = t.split(/\r\n|\r|\n/).filter(function (s) { return s.trim(); })[0] || '';
    var bare = first.replace(/"[^"]*"/g, '');
    var n = function (c) { return bare.split(c).length - 1; };
    var best = ',', most = n(',');
    [';', '\t'].forEach(function (c) { if (n(c) > most) { best = c; most = n(c); } });
    return best;
  }

  /* The whole file is read in one pass by PapaParse, which follows the CSV
     standard (RFC 4180): a quoted field may hold commas, quotes and line
     breaks, as Excel writes them (Alt+Enter). Damaged quoting is never
     guessed around: when a quote problem is found, reading stops, `problem`
     names the line, and the caller imports nothing from the file, because
     after a broken quote it cannot be known where the following rows begin.
     A quote problem is either one PapaParse reports, or a quoted field with
     line breaks that does not fit: its record has a different number of
     fields from the first row, or a later line inside it holds an NDC (so
     other rows were swallowed), or the file has one column (robot lists).
     Every record comes back with the line it starts on and ends on. */
  /* Quote marks must follow the CSV standard exactly: a quoted value starts
     with the quote (no space before it), a quote inside it is doubled, and
     the closing quote is followed by the delimiter or the end of the line. A
     quote after spaces at the start of a value is refused, never read around:
     CSV readers take it as text, which is how "a, "b, c"" files cut or merge
     values. A quote later in a value that does not start with one (GAUZE 4"
     PAD, ="99999...") is text to every CSV reader and cannot move a value
     boundary, so it is kept as written. Returns { line, why } for the first
     problem, or null. */
  function quoteSyntax(t, delim) {
    var n = t.length, i = 0, line = 1, D = delim.charCodeAt(0), Q = 34, NL = 10;
    while (i <= n) {
      if (t.charCodeAt(i) === Q) {
        var from = line; i++;
        for (;;) {
          if (i >= n) return { line: from, why: QUOTE_PROBLEM };
          var c = t.charCodeAt(i);
          if (c === Q) { if (t.charCodeAt(i + 1) === Q) { i += 2; continue; } i++; break; }
          // A value over several lines: Alt+Enter, or a quote never closed (see SWALLOWED).
          if (c === NL) return { line: from, why: SWALLOWED };
          i++;
        }
        if (i < n && t.charCodeAt(i) !== D && t.charCodeAt(i) !== NL) {
          if (/[ \t]/.test(t.charAt(i))) return { line: from, why: 'there is a space after a closing quote mark ("ATORVA" ,), which CSV does not allow, so it cannot be known where that value ends. Remove the space, or save the file as a standard CSV (Excel: File > Save As > CSV UTF-8)' };
          return { line: from, why: 'there is text right after a closing quote mark, so it cannot be known where that value ends (a quote inside a quoted value must be doubled: "12"" tubing")' };
        }
      } else {
        var s = i;
        while (i < n && t.charCodeAt(i) !== D && t.charCodeAt(i) !== NL) i++;
        var f = t.slice(s, i);
        if (/^\s+"/.test(f)) {
          return { line: line, why: 'a quote mark comes after a space ("a, "b""). CSV does not read a quote after a space as a quote, so values could be cut or merged. Save the file as a standard CSV (Excel: File > Save As > CSV UTF-8), or remove the spaces or the quote marks' };
        }
      }
      if (i >= n) break;
      if (t.charCodeAt(i) === NL) line++;
      i++;
    }
    return null;
  }

  var QUOTE_PROBLEM ='a quote on this line is not closed or is out of place, so it cannot be known where this row ends and the next rows begin';
  var SWALLOWED = 'a value that starts on this line runs over several lines. That is a line break inside a cell (Alt+Enter in Excel) or a quote that is not closed, and the two cannot be told apart safely. In Excel, Find and Replace (Ctrl+H) can replace line breaks (type Ctrl+J in Find what) with a space';
  function lines(text) {
    // Byte-order marks are dropped wherever they are (two exports pasted together).
    var t = String(text || '').replace(/﻿/g, '').replace(/\r\n?/g, '\n'), delim = delimiterOf(t);
    var out = [], prev = 0, l = 1, expected = null, problem = null;
    var lastLine = t.split('\n').length - (/\n$/.test(t) ? 1 : 0);
    var bad = quoteSyntax(t, delim);
    if (bad) return { rows: [], empty: false, lastLine: lastLine, problem: bad };
    Papa.parse(t, { delimiter: delim, skipEmptyLines: false, step: function (r, parser) {
      var cur = r.meta.cursor, cells = r.data;
      var inner = cells.join('').split('\n').length - 1;
      var quoteErr = (r.errors || []).some(function (e) { return e.type === 'Quotes'; });
      // A value that runs over several lines is either a line break typed
      // inside a cell (Alt+Enter in Excel) or a quote that was never closed and
      // swallowed the rows after it. The two cannot be told apart safely (a
      // swallowed row can leave every count looking right), so either refuses
      // the file.
      var swallowed = inner > 0;
      if (quoteErr || swallowed) {
        problem = { line: l, why: quoteErr ? QUOTE_PROBLEM : SWALLOWED };
        parser.abort();
        return;
      }
      if (cells.some(function (c) { return String(c).trim() !== ''; })) {
        out.push({ cells: cells, line: l, endLine: l + inner });
        if (expected == null) expected = cells.length;
      }
      l += countBreaks(t, prev, cur);
      prev = cur;
    } });
    return { rows: out, empty: !t.trim(), problem: problem, lastLine: lastLine, delimiter: delim };
  }

  // The first non-blank row is the header.
  function parse(text) {
    var l = lines(text), head = l.rows.shift();
    var fields = head ? head.cells.map(function (f) { return String(f).trim(); }) : [];
    var rows = l.rows.map(function (r) {
      var o = {};
      fields.forEach(function (f, i) { if (f && !(f in o)) o[f] = r.cells[i]; });
      return { data: o, line: r.line, endLine: r.endLine, count: r.cells.length, cells: r.cells };
    });
    return { rows: rows, fields: fields, empty: l.empty, problem: l.problem, lastLine: l.lastLine, delimiter: l.delimiter,
      headBad: !!(head && head.endLine > head.line), headLine: head ? head.line : 1 };
  }

  // A message for a file that was not read because of a quote problem.
  function quoteProblem(pr, lastLine, what) {
    return 'Nothing was ' + what + ' from this file. Line ' + pr.line + ': ' + pr.why + '. ' +
      (lastLine > pr.line ? 'Lines ' + pr.line + '-' + lastLine + ' were not read. ' : '') +
      'Fix that line (in the spreadsheet, or in a text editor) and import again; until then the data in use stays as it is.';
  }

  // Each field takes the column whose list names it; when two headers name the
  // same field ("Product" and "Description"), the one earlier in that list wins.
  function mapColumns(fields) {
    var map = {}, rank = {}, used = {}, cand = {};
    fields.forEach(function (f, i) {
      var k = key(f);
      Object.keys(COLUMNS).forEach(function (c) {
        var r = COLUMNS[c].indexOf(k);
        if (r >= 0) (cand[c] = cand[c] || []).push(f);
        if (r >= 0 && !used[i] && (!(c in map) || r < rank[c])) { if (c in map) used[map[c + '#']] = false; map[c] = f; map[c + '#'] = i; rank[c] = r; used[i] = true; }
      });
    });
    var out = {}; Object.keys(map).forEach(function (c) { if (c.slice(-1) !== '#') out[c] = map[c]; });
    var unused = fields.filter(function (f, i) { return !used[i]; });
    // Fields that more than one column could fill: said in the report.
    var choices = Object.keys(cand).filter(function (c) { return cand[c].length > 1 && out[c]; }).map(function (c) {
      return 'Columns ' + cand[c].map(function (f) { return '"' + f + '"'; }).join(' and ') + ' could each be the ' + (c === 'ndc' ? 'NDC' : c === 'drug' ? 'drug name' : c) + '; "' + out[c] + '" was used. If that is the wrong one, rename or delete the other column and import again.';
    });
    return { map: out, unused: unused, choices: choices };
  }

  /* ---------- values ---------- */

  function bool(v) {
    var s = String(v == null ? '' : v).trim().toLowerCase();
    if (!s) return { value: undefined };
    if (TRUE.indexOf(s) >= 0) return { value: true };
    if (FALSE.indexOf(s) >= 0) return { value: false };
    return { bad: true };
  }
  // Whole number >= min. { value } or { bad: 'reason' }.
  function int(v, min) {
    var s = String(v == null ? '' : v).trim();
    if (/^\d{1,3}(,\d{3})+$/.test(s)) s = s.replace(/,/g, ''); // 1,000 -> 1000; "1,5" stays bad
    if (!s) return { value: undefined };
    if (!/^\d+$/.test(s)) return { bad: 'is not a whole number' };
    if (Number(s) < min) return { bad: 'is below ' + min };
    return { value: Number(s) };
  }

  // "ATORVASTATIN 40 MG TAB" -> drug, strength, form; only when there is no
  // strength column and the text clearly has a number with a unit.
  // Micrograms may be written mcg, µg (micro sign or Greek mu) or ug.
  var DESC = /^(.*?[a-z].*?)\s+(\d[\d.,/-]*\s*(?:mg|mcg|[µμ]g|ug|g|ml|meq|%|units?(?:\/ml)?|iu)(?:\s*\/\s*\d*[\d.]*\s*(?:ml|g|actuation|dose|hr|h|hours?|day|24\s*hr?))?)(?![a-z0-9])\s*(.*)$/i;

  // Why a value is not a usable NDC, in words.
  function whyBadNdc(raw) {
    var s = String(raw == null ? '' : raw).trim(), d = ndc.digits(s);
    if (!s) return 'no NDC';
    if (SCI.test(s)) return 'NDC "' + s + '" was turned into a number by a spreadsheet (scientific notation); format the column as text and export again';
    if (!d.length) return 'NDC "' + s + '" has no digits';
    if (/\p{L}/u.test(s)) return '"' + s.slice(0, 40) + '" is not an NDC';
    if (d.length === 10) return 'NDC "' + s + '" has 10 digits and no hyphens, so the 5-4-2 form cannot be known (a leading zero lost in a spreadsheet, or a 10-digit NDC written without hyphens)';
    if (d.length < 10) return 'NDC "' + s + '" has only ' + d.length + ' digits (leading zeros lost in a spreadsheet?)';
    return 'NDC "' + s + '" is not a valid NDC form';
  }

  // Excel keeps a value as text with a leading apostrophe ('99999-...) or as
  // a formula (="99999-..."); the text inside is the value.
  function excelText(s) {
    var m = /^="(.*)"$/.exec(s);
    if (m) return m[1].trim();
    return s.charAt(0) === "'" ? s.slice(1).trim() : s;
  }
  // The NDC as written, with Excel's text forms and a label in front ("NDC
  // 99999-0001-01", "NDC# ...") taken off when what is left is an NDC.
  // { value, how } where how says what was taken off ('' for nothing).
  function ndcText(s) {
    var x = excelText(s);
    if (x !== s && ndc.normalize(x)) return { value: x, how: 'Excel\'s way of keeping it as text' };
    var m = /^NDC\s*[:#-]?\s*(\S.*)$/i.exec(x);
    if (m && ndc.normalize(m[1])) return { value: m[1], how: 'the label "NDC" in front taken off' };
    return { value: x === s ? s : x, how: '' };
  }

  function findLocation(code, layout) {
    var c = String(code).trim().toUpperCase();
    if (!c) return null;
    var locs = layout.locations;
    for (var i = 0; i < locs.length; i++) if (locs[i].code.toUpperCase() === c) return locs[i];
    // "71" when the layout says "071": match numerically, only if exactly one matches.
    if (/^\d+$/.test(c)) {
      var hits = locs.filter(function (l) { return /^\d+$/.test(l.code) && Number(l.code) === Number(c); });
      if (hits.length === 1) return hits[0];
    }
    return null;
  }

  /* ---------- products ---------- */

  /* Returns { products, lineOf, report }.
     report: { rows, imported, columns: {used, unused, missing}, skipped: [{row, ndc, reason}],
               notes: [{row, ndc, note}], fileNotes: [text], split, problem, fatal } where row
     is the line in the file. Every data row is either imported (perhaps with
     notes) or skipped; with fatal set, nothing is imported and problem says
     which lines were not read. */
  // If most rows (of 3 or more) have another number of fields than the header
  // (a trailing comma on every line but not on the header, or the other way
  // round), the rows that do match the header are the odd ones and may be
  // shifted: the file is refused with what to fix. Returns the message or null.
  function shapeProblem(rows, width) {
    if (rows.length < 3) return null;
    var freq = {}, mode = width;
    rows.forEach(function (r) { freq[r.count] = (freq[r.count] || 0) + 1; });
    Object.keys(freq).forEach(function (c) { if (freq[c] > (freq[mode] || 0)) mode = Number(c); });
    if (mode === width || freq[mode] * 2 <= rows.length) return null;
    return 'Most rows (' + freq[mode] + ' of ' + rows.length + ', lines ' + rows[0].line + '-' + rows[rows.length - 1].line + ') have ' + mode + ' fields, but the header has ' + width + ', so it cannot be known which values belong to which column. ' +
      (mode > width ? 'Usually each line ends with a comma and the header does not: add ' + (mode - width) + ' comma' + (mode - width > 1 ? 's' : '') + ' to the end of the header line, or remove the trailing commas from the rows.'
        : 'The header may end with a comma the rows do not have, or the rows may leave off empty values at the end: make the header and the rows match.') +
      ' Nothing was imported; fix the file and import again.';
  }
  var UOM = /^(ea|each|bx|box|bt|btl|bottle|ct|cnt|count|pk|pack|pkg|cs|case|ml|gm|g|gram|mg|mcg|ug|[µμ]g|meq|oz|l|lb|tab|tabs|tablet|tablets|cap|caps|capsule|capsules|packet|packets|pkt|amp|ampule|ampoule|syringe|syr|patch|patches|inhaler|supp|suppository|sachet|pouch|vl|vial|un|unit|units|tube|tb|kit|bag|pc|pcs)\.?$/i;
  // A cell that says a value is not known.
  var PLACEHOLDER = /^(n\/?a|none|tbd|pending|unknown|null|-+|\?+)$/i;
  function blankCell(c) { return !String(c == null ? '' : c).trim(); }
  function importProducts(text, layout) {
    var p = parse(text), cols = mapColumns(p.fields), m = cols.map;
    var report = { rows: p.rows.length, imported: 0, split: 0, skipped: [], notes: [], fileNotes: (cols.choices || []).slice(), problem: null, fatal: false,
      columns: { used: m, unused: cols.unused, missing: [] } };
    var products = [], seen = {}, lineOf = {};
    var stop = function (msg) { report.problem = msg; report.fatal = true; return { products: [], lineOf: {}, report: report }; };
    if (p.empty) return stop('The file is empty.');
    if (p.problem) {
      // Rows before the problem that already have the wrong shape (a trailing
      // comma on each line) point to the real cause; say that instead.
      report.rows = 0;
      return stop(shapeProblem(p.rows, p.fields.length) || quoteProblem(p.problem, p.lastLine, 'imported'));
    }
    if (p.headBad) return stop('The header (line ' + p.headLine + ') runs over several lines, so the columns cannot be known. Nothing was imported. Fix that line and import again.');
    if (!p.rows.length) return stop('The file has a header line but no rows.');
    ['ndc', 'drug', 'location', 'shelf'].forEach(function (c) { if (!m[c]) report.columns.missing.push(c); });
    var none = p.rows.length === 1 ? 'the 1 row (line ' + p.rows[0].line + ') was not imported.'
      : 'none of the ' + p.rows.length + ' rows (lines ' + p.rows[0].line + '-' + p.rows[p.rows.length - 1].line + ') were imported.';
    if (!m.ndc) {
      var at = null;
      p.rows.slice(0, 10).forEach(function (r) { if (!at && r.cells.some(function (c) { return COLUMNS.ndc.indexOf(key(c)) >= 0; })) at = r.line; });
      return stop('No NDC column found (expected a header such as "NDC"), so ' + none +
        (at ? ' The header seems to be on line ' + at + ': remove the line' + (at - p.headLine > 1 ? 's' : '') + ' above it (a title, for example) and import again.' : ''));
    }
    if (!m.drug) return stop('No drug name column found (expected a header such as "Drug", "Description" or "Item description"), so ' + none);
    // A drug column of yes/no or number values is a flag or a code column under a drug-like name.
    var dv = p.rows.map(function (r) { return String(r.data[m.drug] == null ? '' : r.data[m.drug]).trim(); }).filter(Boolean);
    var flagLike = dv.filter(function (v) { return /^(yes|no|y|n|true|false|x|[\d.,\-\/]+)$/i.test(v); }).length;
    if (dv.length >= 3 && flagLike > dv.length * 0.8) {
      return stop('The column used as the drug name, "' + m.drug + '", holds yes/no values or numbers (' + dv.slice(0, 3).map(function (v) { return '"' + v.slice(0, 20) + '"'; }).join(', ') + '), not drug names, so ' + none +
        ' Rename the column that holds the drug names to "Drug" (or rename this one), and import again.');
    }

    // A "Unit" column holding units of measure (EA, BX, ...) is not about shelving units.
    if (m.unit) {
      var vals = p.rows.map(function (r) { return String(r.data[m.unit] == null ? '' : r.data[m.unit]).trim(); }).filter(Boolean);
      var uom = vals.filter(function (v) { return UOM.test(v); }).length;
      if (vals.length && uom * 2 >= vals.length) {
        var eg = vals.filter(function (v, i) { return UOM.test(v) && vals.indexOf(v) === i; }).slice(0, 3);
        report.fileNotes.push('The "' + m.unit + '" column looks like a unit of measure (' + eg.join(', ') + '), not a shelving unit, so it was not used.');
        cols.unused.push(m.unit); delete m.unit;
      }
    }
    // A "Fridge" column of yes/no flags says whether the item is refrigerated, not which fridge unit.
    if (m.unit) {
      var uv = p.rows.map(function (r) { return String(r.data[m.unit] == null ? '' : r.data[m.unit]).trim().toLowerCase(); }).filter(Boolean);
      // Every value yes or no, with at least one yes (or both 1 and 0): a Face column of N and S
      // (north and south faces) or a Fridge column of 1, 2, 3 is about units.
      var allYn = uv.every(function (v) { return /^(yes|no|y|n|true|false|x|1|0)$/.test(v); });
      var aYes = uv.some(function (v) { return /^(yes|y|true|x)$/.test(v); }) || (uv.indexOf('1') >= 0 && uv.indexOf('0') >= 0);
      if (uv.length && allYn && aYes) {
        report.fileNotes.push('The "' + m.unit + '" column holds yes/no values, not unit names, so it was not used as the shelving unit.');
        cols.unused.push(m.unit); delete m.unit;
      }
    }

    // Values are matched to columns by position, so every row must have
    // exactly the header's number of fields, and cells under blank header
    // names must be blank. One row that does not fit refuses the whole file:
    // a line break typed into a value without quotes splits a row in two,
    // and the half with the right count carries a cut value that no rule
    // about neighbouring rows catches reliably (blank lines can sit between
    // the halves). There are no exceptions, not even for blank trailing
    // fields: an extra comma plus an empty last column looks exactly like a
    // trailing comma.
    var width = p.fields.length;
    var shape = shapeProblem(p.rows, width);
    if (shape) return stop(shape);
    // A line as written (cut at 300 characters), and a short list of line numbers.
    function lineText(r) {
      var text = r.cells.map(function (c) { return String(c == null ? '' : c); }).join(p.delimiter || ',');
      return text.length > 300 ? text.slice(0, 299) + '…' : text;
    }
    function listLines(list) {
      return list.slice(0, 8).map(function (r) { return r.line; }).join(', ') + (list.length > 8 ? ' and ' + (list.length - 8) + ' more (all in "Lines to fix" and in the report CSV)' : '');
    }
    var misfits = p.rows.filter(function (r) {
      return r.count !== width || !p.fields.every(function (f, i) { return f || blankCell(r.cells[i]); });
    });
    // Text in the NDC column that is not an NDC (and not a placeholder such
    // as "N/A") is what a split or shifted row leaves there, so it refuses the
    // file too, and so does a row with values but no NDC and no drug name. An
    // NDC column name there is a second header: the same columns are skipped
    // as a repeat, another order refuses the file. Checked on the rows that
    // have the right shape, so one refusal lists every line to fix.
    var headKeys = p.fields.map(key).join(',');
    function repeatHeader(r) {
      return !ndc.normalize(String(r.data[m.ndc] == null ? '' : r.data[m.ndc])) && r.cells.some(function (c) { return COLUMNS.ndc.indexOf(key(c)) >= 0; });
    }
    var misfitSet = {}; misfits.forEach(function (r) { misfitSet[r.line] = 1; });
    var odd = [];
    for (var hi = 0; hi < p.rows.length; hi++) {
      var hr = p.rows[hi];
      if (misfitSet[hr.line]) continue;
      var hv = ndcText(String(hr.data[m.ndc] == null ? '' : hr.data[m.ndc]).trim()).value;
      if (repeatHeader(hr)) {
        if (hr.cells.map(key).join(',') !== headKeys) {
          return stop('Line ' + hr.line + ' looks like a second header with the columns in another order (two files pasted together?), so the rows after it cannot be matched to columns. Nothing was imported; import the parts as separate files.');
        }
      } else if (!hv && !String(m.drug && hr.data[m.drug] || '').trim()) {
        odd.push({ r: hr, why: 'values but no NDC and no drug name' });
      } else if (/\p{L}/u.test(hv) && !ndc.normalize(hv) && !SCI.test(hv) && !PLACEHOLDER.test(hv)) {
        odd.push({ r: hr, why: 'the NDC column holds "' + hv.slice(0, 40) + '", which is not an NDC' });
      }
    }
    if (misfits.length || odd.length) {
      // Every such line is listed in report.misfits (shown as a table, and in the report CSV).
      var wrongCount = misfits.filter(function (r) { return r.count !== width; }), unnamed = misfits.filter(function (r) { return r.count === width; });
      var blankCols = p.fields.map(function (f, i) { return f ? null : 'column ' + (i + 1); }).filter(Boolean);
      report.rows = 0;
      report.misfits = misfits.map(function (r) {
        return { row: r.line, text: lineText(r),
          why: r.count !== width ? r.count + ' field' + (r.count > 1 ? 's' : '') + '; the header has ' + width
            : 'a value under ' + blankCols.join(' or ') + ', which has no name in the header' };
      }).concat(odd.map(function (o) { return { row: o.r.line, why: o.why, text: lineText(o.r) }; }))
        .sort(function (x, y) { return x.row - y.row; });
      var msg = 'Nothing was imported, so the data in use stays as it is. ';
      if (wrongCount.length) {
        msg += (wrongCount.length === 1 ? 'Line ' : 'Lines ') + listLines(wrongCount) + ' do' + (wrongCount.length === 1 ? 'es' : '') + ' not have the header\'s ' + width + ' fields. ' +
          'A line break typed inside a value splits a row in two, and an unquoted comma inside a value adds a field; either way the values cannot be matched to columns safely, so the whole file is refused. ' +
          'Fix those lines: put a split row back on one line, put a value with a comma in quotes, and delete total or note lines. ' +
          'If the program that wrote the file leaves off empty values at the end of a row, add the missing commas. ';
      }
      if (unnamed.length) {
        msg += (unnamed.length === 1 ? 'Line ' : 'Lines ') + listLines(unnamed) + ' ha' + (unnamed.length === 1 ? 's' : 've') + ' a value under ' + blankCols.join(' or ') + ', which has no name in the header, so it cannot be known what it is (it may also be a value shifted by an unquoted comma). ' +
          'Give that column a name in the header, or delete it. ';
      }
      if (odd.length) {
        msg += (odd.length === 1 ? 'Line ' : 'Lines ') + listLines(odd.map(function (o) { return o.r; })) +
          (odd.length === 1 ? ' has' : ' have') + ' text that is not an NDC in the NDC column, or values but no NDC and no drug name. That is a total, subtotal or note line, or a row split by a line break inside a value or shifted by a comma, so the values cannot be matched to columns safely. ' +
          'Delete total and note lines, or fix the rows; if a product has no NDC, leave its cell empty or write N/A. ';
      }
      return stop(msg + 'Then import again.');
    }
    // A value that starts with a space, in a column whose values do not, is
    // what an unquoted ", " inside text leaves behind ("AMOXICILLIN, CLAV..."
    // split in two). A column where most rows (of 3 or more) start with a
    // space, as in files written "a, b, c", is not checked.
    var cellsAfterFirst = 0, spacedCells = 0;
    p.rows.forEach(function (r) { for (var j = 1; j < r.cells.length; j++) { var c = String(r.cells[j] == null ? '' : r.cells[j]); if (c.trim()) { cellsAfterFirst++; if (/^\s/.test(c)) spacedCells++; } } });
    var commaSpace = spacedCells * 2 > cellsAfterFirst; // the whole file is written with ", "
    var spaced = p.fields.map(function (f, i) {
      if (commaSpace) return false;
      var n = 0; p.rows.forEach(function (r) { if (/^\s+\S/.test(String(r.cells[i] == null ? '' : r.cells[i]))) n++; });
      return i > 0 && !(p.rows.length >= 3 && n * 2 > p.rows.length);
    });
    function splitAt(row) {
      for (var i = 1; i < width; i++) if (spaced[i] && /^\s+\S/.test(String(row.cells[i] == null ? '' : row.cells[i]))) return i;
      return -1;
    }

    p.rows.forEach(function (row) {
      var r = row.data, line = row.line;
      // Excel's ="..." (a value kept as text) is the text inside, in any column
      // (the NDC column notes it, below).
      var get = function (c) {
        var v = m[c] ? String(r[m[c]] == null ? '' : r[m[c]]).trim() : '';
        var x = c !== 'ndc' && /^="(.*)"$/.exec(v);
        return x ? x[1].trim() : v;
      };
      var note = function (s) { report.notes.push({ row: line, ndc: get('ndc'), note: s }); };
      var rawNdc = get('ndc');
      if (repeatHeader(row)) { report.skipped.push({ row: line, ndc: '', reason: 'a repeat of the header line' }); return; }
      var sp = splitAt(row);
      if (sp > 0) {
        report.skipped.push({ row: line, ndc: rawNdc, reason: 'the "' + (p.fields[sp] || 'column ' + (sp + 1)) + '" value "' + String(row.cells[sp]).slice(0, 30) +
          '" starts with a space, unlike the rest of that column. With the right field count, that is what an unquoted comma inside a value leaves when another value in the row is missing (the values between are shifted), so the row is not imported. If the export pads values with spaces, remove the spaces and import again' });
        return;
      }
      if (row.endLine > line) note('a quoted field on lines ' + line + '-' + row.endLine + ' holds line breaks; they were kept');
      var xl = ndcText(rawNdc);
      if (xl.how) { note('NDC ' + rawNdc + ' read as ' + xl.value + ' (' + xl.how + ')'); rawNdc = xl.value; }
      var n = ndc.normalize(rawNdc);
      if (!n) { report.skipped.push({ row: line, ndc: rawNdc, reason: whyBadNdc(rawNdc) }); return; }
      if (seen[n]) { report.skipped.push({ row: line, ndc: rawNdc, reason: 'duplicate of line ' + seen[n] }); return; }
      var drug = get('drug');
      if (!drug) { report.skipped.push({ row: line, ndc: rawNdc, reason: 'no drug name' }); return; }
      // A drug name with no letters ("060") is a value from another column: the row is shifted.
      if (!/\p{L}/u.test(drug)) { report.skipped.push({ row: line, ndc: rawNdc, reason: 'the drug name "' + drug.slice(0, 30) + '" has no letters, so the values are probably shifted (a missing or extra field) and cannot be matched to columns safely' }); return; }
      seen[n] = line; lineOf[n] = line;

      var prod = { ndc: n, drug: drug };
      var strength = get('strength'), form = get('form');
      if (!m.strength) {
        var sm = DESC.exec(drug);
        if (sm && (/^\//.test(sm[3].trim()) || DESC.test(sm[3].trim()) || /\d\s*(mg|mcg|[µμ]g|ug|g|ml)\b/i.test(sm[3]))) {
          note('"' + drug + '" looks like a combination product, so it was not split into drug and strength');
          sm = null;
        }
        if (sm) {
          prod.drug = sm[1].trim().replace(/[,;\s]+$/, ''); strength = sm[2].trim();
          var rest = sm[3].trim(), restUsed = !form && !!rest;
          // "TAB 1000 CT": the pack count is not part of the form.
          var ct = /^(.*?)\s*\b(\d+)\s*(ct|cnt|count|ea|tablets|tabs|capsules|caps)\.?$/i.exec(rest);
          if (restUsed && ct) {
            rest = ct[1].trim(); restUsed = !!rest;
            if (!get('countPerBottle')) { prod.countPerBottle = Number(ct[2]); note('"' + ct[2] + ' ' + ct[3] + '" in the description read as a count of ' + ct[2]); }
          }
          // A form is words ("TAB", "ER CAPSULE"); a bare number or a word plus a
          // number is not known to be one, so it is left out, with a note.
          var formOk = /^[\p{L}][\p{L}\s.\/-]*$/u.test(rest);
          if (restUsed && formOk) form = rest;
          report.split++;
          note('"' + drug + '" read as drug "' + prod.drug + '", strength "' + strength + '"' + (restUsed && formOk ? ', form "' + form + '"' : '') +
            (rest && !restUsed ? '; "' + rest + '" not kept because the Form column is used' : '') +
            (rest && restUsed && !formOk ? '; "' + rest + '" not kept (not known to be the form)' : ''));
        }
      }
      if (strength) prod.strength = strength;
      if (form) prod.form = form;
      if (get('manufacturer')) prod.manufacturer = get('manufacturer');
      if (get('notes')) prod.notes = get('notes');

      var loc = null, rawLoc = get('location'), unitInLoc = null;
      if (rawLoc && PLACEHOLDER.test(rawLoc)) { note('location "' + rawLoc + '" read as not given'); rawLoc = ''; }
      if (rawLoc) {
        loc = findLocation(rawLoc, layout);
        // A unit code in the Location column ("FM-N"): its location and unit.
        if (!loc) {
          layout.locations.forEach(function (lc) { lc.units.forEach(function (u) { if (!unitInLoc && key(u.id) === key(rawLoc)) { unitInLoc = u; loc = lc; } }); });
          if (unitInLoc) { prod.location = loc.code; note('location "' + rawLoc + '" read as ' + loc.code + ', unit ' + unitInLoc.id); }
        }
        if (unitInLoc) { /* done above */ } else if (loc) {
          prod.location = loc.code;
          if (loc.code.toUpperCase() !== rawLoc.toUpperCase()) note('location "' + rawLoc + '" read as ' + loc.code);
        } else { prod.location = rawLoc.toUpperCase(); note('location "' + rawLoc + '" is not on the layout yet; the map will say so'); }
      }
      var unit = null, rawUnit = get('unit'), unitWhy = '';
      // A placeholder such as "-", "?" or "n/a" means no unit was given.
      if (rawUnit && (!key(rawUnit) || PLACEHOLDER.test(rawUnit))) { note('unit "' + rawUnit + '" read as not given'); rawUnit = ''; }
      // Names match only when both have letters or digits (a unit may have no label).
      // A unit is named by its id or its label, exactly (letter case, spaces
      // and punctuation aside). Nothing shorter: "1" or "N" can be a flag or a
      // pack unit as easily as a fridge or face (version-27 matched those and
      // invented units). Two matches leave it unknown.
      var sameUnit = function (u) {
        var r = key(rawUnit), id = key(u.id);
        if (!r) return false;
        return r === id || (!!key(u.label) && r === key(u.label));
      };
      if (unitInLoc && (!rawUnit || sameUnit(unitInLoc))) { unit = unitInLoc; prod.unit = unit.id; }
      else if (unitInLoc) { note('unit "' + rawUnit + '" does not match the unit ' + unitInLoc.id + ' given as the location; unit left unknown'); unitWhy = 'the unit columns disagree'; }
      else if (rawUnit) {
        if (!loc) { note('unit "' + rawUnit + '" ignored: no known location'); unitWhy = 'no known location'; }
        else {
          var hits = loc.units.filter(sameUnit);
          unit = hits.length === 1 ? hits[0] : null;
          if (unit) prod.unit = unit.id;
          else if (hits.length > 1) { note('unit "' + rawUnit + '" could be ' + hits.map(function (u) { return u.id; }).join(' or ') + '; unit left unknown'); unitWhy = 'unit "' + rawUnit + '" matches several units'; }
          else { note('unit "' + rawUnit + '" is not part of ' + loc.code + '; unit left unknown'); unitWhy = 'unit "' + rawUnit + '" not recognised'; }
        }
      } else if (loc && loc.units.length === 1) unit = loc.units[0];
      else if (loc) unitWhy = loc.code + ' has several units and none was given';
      else unitWhy = 'no known location';

      var sh = int(get('shelf'), 1);
      if (sh.bad) note('shelf "' + get('shelf') + '" ' + sh.bad + ' (shelves are numbered from 1 at the top); shelf left unknown');
      else if (sh.value != null) {
        if (!unit) note('shelf ' + sh.value + ' ignored: ' + unitWhy + (loc && !rawUnit ? '; the app will estimate the unit and shelf from the alphabet and mark them estimated' : ''));
        else if (sh.value > unit.shelves) note('shelf ' + sh.value + ' does not fit ' + unit.id + ' (' + unit.shelves + ' shelves); shelf left unknown');
        else prod.shelf = sh.value;
      }

      var cnt = int(get('countPerBottle'), 1);
      if (cnt.bad) note('count "' + get('countPerBottle') + '" ' + cnt.bad + '; left unknown');
      else if (cnt.value != null) prod.countPerBottle = cnt.value;
      var rk = int(get('rank'), 1);
      if (rk.bad) note('rank "' + get('rank') + '" ' + rk.bad + '; left unknown');
      else if (rk.value != null) prod.rank = rk.value;

      ['niosh', 'safetyCap', 'robot', 'preferred'].forEach(function (f) {
        var b = bool(get(f));
        if (b.bad) note(f + ' "' + get(f) + '" is not yes or no; left unknown');
        else if (b.value != null) prod[f] = b.value;
      });

      // Vial capacities: numbers, or "n/a" for products not put in vials.
      var vial = {}, nums = 0, nas = 0, bads = 0;
      ['20', '40', '60'].forEach(function (d) {
        var raw = get('vial' + d);
        if (/^n\/?a$/i.test(raw)) { nas++; return; }
        var v = int(raw, 1);
        if (v.bad) { bads++; if (!nas) note(d + ' dram "' + raw + '" ' + v.bad + '; left unknown'); }
        else if (v.value != null) { vial[d] = v.value; nums++; }
      });
      if (nas && (nums || bads)) note('vial sizes mix "n/a" with other values; vial capacity left unknown');
      else if (nas) prod.vialCapacity = 'n/a';
      else if (nums) prod.vialCapacity = vial;

      products.push(prod);
      report.imported++;
    });
    return { products: products, lineOf: lineOf, report: report };
  }

  /* ---------- robot list ---------- */

  /* Marks NDCs from a robot list as robot (and preferred, if opts.preferred).
     One column of NDCs, with or without a header. NDCs not in the products
     are reported, not invented. opts.lineOf maps NDC -> products file line,
     for notes about products the list does not mention. Returns a report;
     report.prior holds each changed product's earlier robot, preferred and
     location values (null = not set), so restoreRobot() can undo the list
     before a newer list is applied. Nothing is changed when report.fatal. */
  function applyRobotList(text, products, layout, opts) {
    opts = opts || {};
    var l = lines(text), rows = l.rows, col = 0, start = 0;
    var report = { rows: 0, matched: 0, notFound: [], skipped: [], notes: [], movedToRobot: 0, problem: null, fatal: false, prior: {} };
    if (l.problem) { report.problem = quoteProblem(l.problem, l.lastLine, 'used'); report.fatal = true; return report; }
    if (l.empty || !rows.length) { report.problem = 'The robot list is empty.'; report.fatal = true; return report; }
    var first = rows[0].cells, at = -1;
    // A drug name next to the NDC is fine in a robot list; Location, Shelf or Robot columns mean a products file.
    var looksProducts = first.map(key).filter(function (h) { return ['location', 'shelf', 'robot', 'preferred'].some(function (c) { return COLUMNS[c].indexOf(h) >= 0; }); });
    if (looksProducts.length) {
      report.problem = 'This looks like a products file (it has columns such as "' + first.filter(function (h) { return looksProducts.indexOf(key(h)) >= 0; }).slice(0, 2).join('", "') + '"), not a robot list, so it was not used. Choose the robot list (one column of NDCs; a drug name beside it is fine), or delete those columns from it, and import again.';
      report.fatal = true; return report;
    }
    first.map(key).forEach(function (h, i) { if (at < 0 && COLUMNS.ndc.indexOf(h) >= 0) at = i; });
    // A first line is a header when it has words and no NDC ("Robot inventory
    // 10/27/2026", "Drug,Item"); a first line of numbers only is data, so a bad
    // NDC there refuses the list like any other bad line.
    var looksLikeData = !first.some(function (c) { c = String(c).trim(); return /\p{L}/u.test(c) && !SCI.test(c); }) || first.some(function (c) { return !!ndc.normalize(excelText(String(c).trim())); });
    if (at >= 0) { col = at; start = 1; }
    else if (!looksLikeData) {
      start = 1;
      report.notes.push({ row: rows[0].line, ndc: '', note: 'read as a header line: "' + first.join(',') + '"' });
    }
    report.rows = rows.length - start;
    if (!report.rows) { report.problem = 'The robot list has a header line but no NDCs.'; report.fatal = true; return report; }

    // NDCs in more than one column ("NDC,Alt NDC", or two NDCs on a line): only
    // one column would be read and the others dropped unseen, so the list is refused.
    var twoCols = [];
    for (var ti = start; ti < rows.length && twoCols.length < 50; ti++) {
      if (rows[ti].cells.length !== rows[0].cells.length) continue; // refused as unreadable below
      var nd = rows[ti].cells.filter(function (c, ci) { return ci !== col && !!ndc.normalize(excelText(String(c).trim())); });
      if (nd.length) twoCols.push(rows[ti].line);
    }
    if (twoCols.length) {
      report.problem = 'Nothing was used from this list: line' + (twoCols.length > 1 ? 's ' : ' ') + twoCols.slice(0, 8).join(', ') + (twoCols.length > 8 ? ' and more' : '') +
        ' ha' + (twoCols.length > 1 ? 've' : 's') + ' NDCs in more than one column, and only one column is read, so NDCs would be left out of the robot. Put all the robot NDCs in one column (one per line) and import again.';
      report.fatal = true; return report;
    }

    var byNdc = {};
    products.forEach(function (p) { byNdc[p.ndc] = p; });
    var robotLoc = layout.locations.filter(function (lc) { return lc.kind === 'robot'; })[0];
    var seen = {};
    for (var i = start; i < rows.length; i++) {
      var line = rows[i].line;
      var raw = String(rows[i].cells[col] || '').trim();
      // Every row must have the first row's number of fields, or the NDC column is not known for it.
      if (rows[i].cells.length !== rows[0].cells.length) {
        report.skipped.push({ row: line, ndc: rows[i].cells.map(function (c) { return String(c).trim(); }).join(',').slice(0, 40),
          reason: 'has ' + rows[i].cells.length + ' fields but the first line has ' + rows[0].cells.length + ', so its NDC column is not known' });
        continue;
      }
      if (excelText(raw) !== raw && ndc.normalize(excelText(raw))) { report.notes.push({ row: line, ndc: raw, note: 'read as ' + excelText(raw) + ' (Excel\'s way of keeping it as text)' }); raw = excelText(raw); }
      var n = ndc.normalize(raw);
      if (!n) { report.skipped.push({ row: line, ndc: raw, reason: whyBadNdc(raw) }); continue; }
      if (seen[n]) { report.skipped.push({ row: line, ndc: raw, reason: 'duplicate of line ' + seen[n] }); continue; }
      seen[n] = line;
      var p = byNdc[n];
      if (!p) { report.notFound.push({ row: line, ndc: raw }); continue; }
      report.prior[n] = { robot: 'robot' in p ? p.robot : null, preferred: 'preferred' in p ? p.preferred : null, location: p.location == null ? null : p.location };
      if (p.robot === false) report.notes.push({ row: line, ndc: raw, note: 'the products file said not in the robot; the robot list wins' });
      p.robot = true;
      if (opts.preferred) {
        if (p.preferred === false) report.notes.push({ row: line, ndc: raw, note: 'the products file said not preferred; marked preferred because it is in the robot' });
        p.preferred = true;
      }
      if (p.location != null && (!robotLoc || p.location !== robotLoc.code)) {
        report.notes.push({ row: line, ndc: raw, note: 'also has location ' + p.location + ' in the products file; both kept (the map shows ' + p.location + ')' });
      }
      if (robotLoc && p.location == null) {
        p.location = robotLoc.code; report.movedToRobot++;
        report.notes.push({ row: line, ndc: raw, note: 'had no location; now shows the robot (' + robotLoc.code + ')' });
      }
      report.matched++;
    }
    // All or nothing: a robot list replaces the one in use, so a list with
    // lines that cannot be read (an NDC lost to scientific notation, say), or
    // with no NDC that matches a product, would drop NDCs from the robot.
    // Such a list is not used, and what it changed is undone.
    var unreadable = report.skipped.filter(function (x) { return !/^duplicate of line/.test(x.reason); });
    if (unreadable.length || !report.matched) {
      restoreRobot(products, report.prior);
      report.fatal = true; report.matched = 0; report.movedToRobot = 0; report.prior = {};
      report.notes = report.notes.filter(function (n) { return /Excel|read as a header line/.test(n.note); }); // notes about changes no longer apply
      report.problem = unreadable.length
        ? 'Nothing was used from this list: ' + unreadable.length + ' line' + (unreadable.length > 1 ? 's' : '') + ' could not be read (listed below). A robot list replaces the one in use, so an incomplete list would drop NDCs from the robot. Fix those lines and import again; until then the data in use stays as it is.'
        : 'Nothing was used from this list: none of its NDCs is in the product list. Check that it is the right file; the data in use stays as it is.';
      return report;
    }
    report.ndcs = Object.keys(seen);
    // Products marked robot in their own file but missing from the robot list.
    products.forEach(function (p) {
      if (p.robot === true && !seen[p.ndc]) {
        report.notes.push({ row: '-', ndc: ndc.format(p.ndc), note: 'marked in the robot by the products file' + (opts.lineOf && opts.lineOf[p.ndc] ? ' (line ' + opts.lineOf[p.ndc] + ')' : '') + ' but not in this robot list; left as given' });
      }
    });
    var byLine = function (a, b) { return (a.row === '-' ? 1e9 : a.row) - (b.row === '-' ? 1e9 : b.row); };
    report.skipped.sort(byLine); report.notes.sort(byLine);
    return report;
  }

  // Undoes an earlier robot list (its report.prior) on these products.
  function restoreRobot(products, prior) {
    if (!prior) return;
    products.forEach(function (p) {
      var was = prior[p.ndc];
      if (!was) return;
      ['robot', 'preferred', 'location'].forEach(function (f) { if (was[f] === null) delete p[f]; else p[f] = was[f]; });
    });
  }

  // A dataset built from imported products on top of a base dataset's
  // layout, rules and basket schemes. opts.productsAreSample: the products
  // are still the fictional sample (a robot list applied on its own), so the
  // data stays marked as sample.
  function buildDataset(base, products, source, opts) {
    opts = opts || {};
    return {
      meta: { id: 'imported', name: (base.layout.name || 'Pharmacy') + (opts.productsAreSample ? ' + robot list' : ' + imported products'),
        sample: !!opts.productsAreSample, layoutIsSample: !!(base.meta && (base.meta.layoutIsSample || base.meta.sample)), source: source || 'CSV import',
        robotPrior: opts.robotPrior || undefined, robotList: opts.robotList || undefined },
      layout: base.layout, products: products, rules: base.rules, basketSchemes: base.basketSchemes,
      groupLabels: base.groupLabels || []
    };
  }

  return { decode: decode, parse: parse, lines: lines, mapColumns: mapColumns, importProducts: importProducts, applyRobotList: applyRobotList, restoreRobot: restoreRobot,
    buildDataset: buildDataset, COLUMNS: COLUMNS };
});
