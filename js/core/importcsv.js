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
  var COLUMNS = {
    ndc: ['ndc', 'ndc11', 'ndccode', 'ndcnumber', 'nationaldrugcode'],
    drug: ['drug', 'drugname', 'name', 'generic', 'genericname', 'description', 'product', 'productname', 'itemdescription', 'itemname', 'drugdescription', 'productdescription'],
    strength: ['strength', 'str', 'dose'],
    form: ['form', 'dosageform'],
    manufacturer: ['manufacturer', 'mfr', 'mfg', 'labeler', 'maker'],
    location: ['location', 'loc', 'locationcode', 'bin', 'binlocation', 'shelflocation', 'binno', 'binnumber'],
    unit: ['unit', 'face', 'fridge', 'section'],
    shelf: ['shelf', 'shelfnumber', 'shelfno'],
    countPerBottle: ['countperbottle', 'count', 'packsize', 'packagesize', 'bottlesize', 'qtyperbottle', 'pkgsize', 'pksize', 'pkgqty', 'packqty'],
    niosh: ['niosh', 'hazardous', 'nioshhazardous'],
    safetyCap: ['safetycap', 'cap', 'safety'],
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
  function decode(bytes) {
    var b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    function dec(enc, from, fatal) { return new TextDecoder(enc, { fatal: !!fatal }).decode(b.subarray(from)); }
    // Control bytes (other than tab, line breaks and form feed) do not occur in
    // text: a file with them is an image, a PDF or another binary file.
    function binary(from) {
      var n = Math.min(b.length, from + 8192), ctl = 0;
      for (var i = from; i < n; i++) {
        var c = b[i];
        if ((c < 9 || (c > 13 && c < 32) || c === 127) && !(c === 26 && i === b.length - 1)) ctl++; // a final Ctrl-Z (old DOS end mark) is fine
      }
      return ctl > 0 ? { problem: 'This is not a text file (it looks like an image, a PDF or another kind of file), so it is not a CSV.' } : null;
    }
    if (b[0] === 0x50 && b[1] === 0x4B && b[2] === 0x03 && b[3] === 0x04) return { problem: 'This is an Excel workbook (.xlsx) or another zipped file, not a CSV. In Excel, use File > Save As and choose "CSV UTF-8".' };
    if (b[0] === 0xD0 && b[1] === 0xCF && b[2] === 0x11 && b[3] === 0xE0) return { problem: 'This is an old Excel workbook (.xls), not a CSV. In Excel, use File > Save As and choose "CSV UTF-8".' };
    if (b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) {
      // A UTF-8 mark followed by bytes that are not UTF-8: read the rest as Windows-1252, and say so.
      try { return { text: dec('utf-8', 3, true), encoding: 'UTF-8' }; }
      catch (e) { return binary(3) || { text: dec('windows-1252', 3), encoding: 'Windows-1252', note: 'This file starts with a UTF-8 mark but is not UTF-8, so it was read as Windows-1252. Check that accented letters and symbols such as µ look right.' }; }
    }
    if (b[0] === 0xFF && b[1] === 0xFE) return { text: dec('utf-16le', 2), encoding: 'UTF-16' };
    if (b[0] === 0xFE && b[1] === 0xFF) return { text: dec('utf-16be', 2), encoding: 'UTF-16' };
    // UTF-16 without a mark: zero bytes in every odd (LE) or even (BE) place.
    var n = Math.min(b.length, 4096) & ~1, zeroOdd = 0, zeroEven = 0;
    for (var i = 0; i < n; i += 2) { if (b[i] === 0) zeroEven++; if (b[i + 1] === 0) zeroOdd++; }
    if (n >= 4) {
      if (zeroOdd > n / 2 * 0.9 && zeroEven < n / 2 * 0.1) return { text: dec('utf-16le', 0), encoding: 'UTF-16', note: 'This file has no byte-order mark; it was read as UTF-16 because every other byte is zero.' };
      if (zeroEven > n / 2 * 0.9 && zeroOdd < n / 2 * 0.1) return { text: dec('utf-16be', 0), encoding: 'UTF-16', note: 'This file has no byte-order mark; it was read as UTF-16 because every other byte is zero.' };
    }
    var text;
    try { text = dec('utf-8', 0, true); } catch (e) { return binary(0) || { text: dec('windows-1252', 0), encoding: 'Windows-1252', note: CP1252_NOTE }; }
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
  var NDC_INSIDE = /\d{4,5}[- ]\d{3,4}[- ]\d{1,2}|\d{11}/;
  var QUOTE_PROBLEM = 'a quote on this line is not closed or is out of place, so it cannot be known where this row ends and the next rows begin';
  var SWALLOWED = 'a quoted field that starts on this line runs over several lines and takes in what look like other rows (a quote is probably missing or extra)';
  function lines(text) {
    // Byte-order marks are dropped wherever they are (two exports pasted together).
    var t = String(text || '').replace(/﻿/g, '').replace(/\r\n?/g, '\n'), delim = delimiterOf(t);
    var out = [], prev = 0, l = 1, expected = null, problem = null;
    var lastLine = t.split('\n').length - (/\n$/.test(t) ? 1 : 0);
    Papa.parse(t, { delimiter: delim, skipEmptyLines: false, step: function (r, parser) {
      var cur = r.meta.cursor, cells = r.data;
      var inner = cells.join('').split('\n').length - 1;
      var quoteErr = (r.errors || []).some(function (e) { return e.type === 'Quotes'; });
      // A stray quote that swallows rows leaves a record whose field count is
      // off, or, when the count happens to come out right (it closes in the
      // same column of a later row), a field holding at least a whole row's
      // worth of delimiters (header fields - 1). So a field with line breaks is
      // refused when its record has a different field count, when it holds
      // that many delimiters or an NDC anywhere, or when the file has one column.
      var swallowed = inner > 0 && expected != null && (expected === 1 || cells.length !== expected || cells.some(function (c) {
        c = String(c);
        if (c.indexOf('\n') < 0) return false;
        return NDC_INSIDE.test(c) || c.split(delim).length - 1 >= expected - 1;
      }));
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
    return { rows: out, empty: !t.trim(), problem: problem, lastLine: lastLine };
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
    return { rows: rows, fields: fields, empty: l.empty, problem: l.problem, lastLine: l.lastLine,
      headBad: !!(head && head.endLine > head.line), headLine: head ? head.line : 1 };
  }

  // A message for a file that was not read because of a quote problem.
  function quoteProblem(pr, lastLine, what) {
    return 'Nothing was ' + what + ' from this file. Line ' + pr.line + ': ' + pr.why + '. ' +
      (lastLine > pr.line ? 'Lines ' + pr.line + '-' + lastLine + ' were not read. ' : '') +
      'Fix that line (in the spreadsheet, or in a text editor) and import again; until then the data in use stays as it is.';
  }

  function mapColumns(fields) {
    var map = {}, unused = [];
    fields.forEach(function (f) {
      var k = key(f), hit = null;
      Object.keys(COLUMNS).forEach(function (c) { if (!hit && COLUMNS[c].indexOf(k) >= 0 && !map[c]) hit = c; });
      if (hit) map[hit] = f; else unused.push(f);
    });
    return { map: map, unused: unused };
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
    if (d.length === 10) return 'NDC "' + s + '" has 10 digits and no hyphens, so the 5-4-2 form cannot be known';
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
    return 'Most rows (' + freq[mode] + ' of ' + rows.length + ') have ' + mode + ' fields, but the header has ' + width + ', so it cannot be known which values belong to which column. ' +
      (mode > width ? 'Usually each line ends with a comma and the header does not: add ' + (mode - width) + ' comma' + (mode - width > 1 ? 's' : '') + ' to the end of the header line, or remove the trailing commas from the rows.'
        : 'Usually the header ends with a comma the rows do not have: remove it from the header line.') +
      ' Nothing was imported; fix the file and import again.';
  }
  var UOM = /^(ea|each|bx|box|bt|btl|bottle|ct|cnt|count|pk|pack|pkg|cs|case|ml|gm|g|gram|tab|tabs|cap|caps|vl|vial|un|unit|units|tube|tb|kit|bag|pc|pcs)\.?$/i;
  function blankCell(c) { return !String(c == null ? '' : c).trim(); }
  function importProducts(text, layout) {
    var p = parse(text), cols = mapColumns(p.fields), m = cols.map;
    var report = { rows: p.rows.length, imported: 0, split: 0, skipped: [], notes: [], fileNotes: [], problem: null, fatal: false,
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
    if (!m.ndc) return stop('No NDC column found (expected a header such as "NDC"), so ' + none);
    if (!m.drug) return stop('No drug name column found (expected a header such as "Drug", "Description" or "Item description"), so ' + none);

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

    // Values are matched to columns by position, so a row with a different
    // number of fields from the header may be shifted (an unquoted comma
    // inside a value, or a missing one): it is skipped, never guessed. There
    // are no exceptions, not even for blank trailing fields: an extra comma
    // plus an empty last column looks exactly like a trailing comma.
    // Cells under blank header names must be blank too.
    var width = p.fields.length;
    var shape = shapeProblem(p.rows, width);
    if (shape) return stop(shape);
    // A value that starts with a space, in a column whose values do not, is
    // what an unquoted ", " inside text leaves behind ("AMOXICILLIN, CLAV..."
    // split in two). A column where most rows (of 3 or more) start with a
    // space, as in files written "a, b, c", is not checked.
    var spaced = p.fields.map(function (f, i) {
      var n = 0; p.rows.forEach(function (r) { if (/^\s+\S/.test(String(r.cells[i] == null ? '' : r.cells[i]))) n++; });
      return i > 0 && !(p.rows.length >= 3 && n * 2 > p.rows.length);
    });
    function fits(row) {
      return row.count === width && p.fields.every(function (f, i) { return f || blankCell(row.cells[i]); });
    }
    function splitAt(row) {
      for (var i = 1; i < width; i++) if (spaced[i] && /^\s+\S/.test(String(row.cells[i] == null ? '' : row.cells[i]))) return i;
      return -1;
    }

    p.rows.forEach(function (row) {
      var r = row.data, line = row.line;
      var get = function (c) { return m[c] ? String(r[m[c]] == null ? '' : r[m[c]]).trim() : ''; };
      var note = function (s) { report.notes.push({ row: line, ndc: get('ndc'), note: s }); };
      var rawNdc = get('ndc');
      if (!fits(row)) {
        report.skipped.push({ row: line, ndc: rawNdc, reason: row.count !== width
          ? 'has ' + row.count + ' fields but the header has ' + width + ' (an unquoted comma inside a value, or a missing one), so its values cannot be matched to columns safely'
          : 'has a value under a column with no name, so its values may be shifted (an unquoted comma inside a value?) and cannot be matched to columns safely' });
        return;
      }
      var sp = splitAt(row);
      if (sp > 0) {
        report.skipped.push({ row: line, ndc: rawNdc, reason: 'the "' + (p.fields[sp] || 'column ' + (sp + 1)) + '" value "' + String(row.cells[sp]).slice(0, 30) +
          '" starts with a space, which usually means an unquoted comma split a value, so its values may be shifted and cannot be matched to columns safely' });
        return;
      }
      if (row.endLine > line) note('a quoted field on lines ' + line + '-' + row.endLine + ' holds line breaks; they were kept');
      var xl = excelText(rawNdc);
      if (xl !== rawNdc && ndc.normalize(xl)) { note('NDC ' + rawNdc + ' read as ' + xl + ' (Excel\'s way of keeping it as text)'); rawNdc = xl; }
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
          var ct = /^(.*?)\s*\b(\d+)\s*(ct|cnt|count|ea)\.?$/i.exec(rest);
          if (restUsed && ct) {
            rest = ct[1].trim(); restUsed = !!rest;
            if (!get('countPerBottle')) { prod.countPerBottle = Number(ct[2]); note('"' + ct[2] + ' ' + ct[3] + '" in the description read as a count of ' + ct[2]); }
          }
          if (restUsed) form = rest;
          report.split++;
          note('"' + drug + '" read as drug "' + prod.drug + '", strength "' + strength + '"' + (restUsed ? ', form "' + form + '"' : '') +
            (rest && !restUsed ? '; "' + rest + '" not kept because the Form column is used' : ''));
        }
      }
      if (strength) prod.strength = strength;
      if (form) prod.form = form;
      if (get('manufacturer')) prod.manufacturer = get('manufacturer');
      if (get('notes')) prod.notes = get('notes');

      var loc = null, rawLoc = get('location'), unitInLoc = null;
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
      if (rawUnit && (!key(rawUnit) || /^n\/?a$/i.test(rawUnit))) { note('unit "' + rawUnit + '" read as not given'); rawUnit = ''; }
      // Names match only when both have letters or digits (a unit may have no label).
      var sameUnit = function (u) { var r = key(rawUnit); return !!r && (r === key(u.id) || (!!key(u.label) && r === key(u.label))); };
      if (unitInLoc && (!rawUnit || sameUnit(unitInLoc))) { unit = unitInLoc; prod.unit = unit.id; }
      else if (unitInLoc) { note('unit "' + rawUnit + '" does not match the unit ' + unitInLoc.id + ' given as the location; unit left unknown'); unitWhy = 'the unit columns disagree'; }
      else if (rawUnit) {
        if (!loc) { note('unit "' + rawUnit + '" ignored: no known location'); unitWhy = 'no known location'; }
        else {
          unit = loc.units.filter(sameUnit)[0] || null;
          if (unit) prod.unit = unit.id;
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
    first.map(key).forEach(function (h, i) { if (at < 0 && COLUMNS.ndc.indexOf(h) >= 0) at = i; });
    var looksLikeData = first.some(function (c) { c = String(c).trim(); return SCI.test(c) || /\d{5}/.test(c) || ndc.digits(c).length >= 10; });
    if (at >= 0) { col = at; start = 1; }
    else if (!looksLikeData) {
      start = 1;
      report.notes.push({ row: rows[0].line, ndc: '', note: 'read as a header line: "' + first.join(',') + '"' });
    }
    report.rows = rows.length - start;
    if (!report.rows) { report.problem = 'The robot list has a header line but no NDCs.'; report.fatal = true; return report; }

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
        sample: !!opts.productsAreSample, layoutIsSample: !!(base.meta && base.meta.sample), source: source || 'CSV import',
        robotPrior: opts.robotPrior || undefined },
      layout: base.layout, products: products, rules: base.rules, basketSchemes: base.basketSchemes,
      groupLabels: base.groupLabels || []
    };
  }

  return { decode: decode, parse: parse, lines: lines, mapColumns: mapColumns, importProducts: importProducts, applyRobotList: applyRobotList, restoreRobot: restoreRobot,
    buildDataset: buildDataset, COLUMNS: COLUMNS };
});
