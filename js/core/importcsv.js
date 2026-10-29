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
    drug: ['drug', 'drugname', 'name', 'generic', 'genericname', 'description', 'product', 'productname'],
    strength: ['strength', 'str', 'dose'],
    form: ['form', 'dosageform'],
    manufacturer: ['manufacturer', 'mfr', 'mfg', 'labeler', 'maker'],
    location: ['location', 'loc', 'locationcode', 'bin'],
    unit: ['unit', 'face', 'fridge', 'section'],
    shelf: ['shelf', 'shelfnumber', 'shelfno'],
    countPerBottle: ['countperbottle', 'count', 'packsize', 'packagesize', 'bottlesize', 'qtyperbottle'],
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
  // A line that starts like an NDC: inside a quoted field it means another record was swallowed.
  var NDC_START = /^\s*"?(\d{4,5}-\d{3,4}-\d{1,2}|\d{10,12})\b/;
  var BAD_QUOTE = 'a quote on this line is not closed or is misplaced, so the line could not be read; it was skipped and reading went on with the next line';

  function key(h) { return String(h || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

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

  /* Every non-blank row with the line it starts on and the line it ends on.
     A row that may have swallowed other rows is returned with badQuote, and
     reading restarts on the next physical line, so one stray quote cannot
     take the rest of the file with it. That is: PapaParse reports a quote
     error, or a field holds a line break followed by a line that has the
     delimiter in it (a merged record, e.g. an unclosed quote that a later
     inch mark happened to close). Legitimate multi-line fields without the
     delimiter are kept and get a note. */
  function lines(text) {
    var t = String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n'), delim = delimiterOf(t);
    var out = [], base = 0, line = 1, expected = null; // cells in the first row
    while (base < t.length) {
      var sub = t.slice(base), prev = 0, l = line, restartAt = -1;
      Papa.parse(sub, { delimiter: delim, skipEmptyLines: false, step: function (r, parser) {
        var cur = r.meta.cursor, cells = r.data;
        // A field with a line break is a merged record when a later line in
        // it has the delimiter or starts like an NDC, when the file has one
        // column (robot lists), or when the row's field count differs from
        // the first row's.
        var multi = cells.some(function (c) { return String(c).indexOf('\n') >= 0; });
        var merged = multi && (expected === 1 || (expected != null && cells.length !== expected) || cells.some(function (c) {
          var parts = String(c).split('\n');
          return parts.length > 1 && parts.slice(1).some(function (s) { return s.indexOf(delim) >= 0 || NDC_START.test(s); });
        }));
        if (merged || (r.errors || []).some(function (e) { return e.type === 'Quotes'; })) {
          out.push({ cells: cells, line: l, endLine: l, badQuote: true });
          var j = sub.indexOf('\n', prev);
          restartAt = j < 0 ? sub.length : j + 1;
          parser.abort();
          return;
        }
        // Line breaks inside the row's fields give the line it ends on.
        var inner = cells.join('').split('\n').length - 1;
        if (cells.some(function (c) { return String(c).trim() !== ''; })) {
          out.push({ cells: cells, line: l, endLine: l + inner });
          if (expected == null) expected = cells.length;
        }
        l += countBreaks(sub, prev, cur);
        prev = cur;
      } });
      if (restartAt < 0) break;
      line = l + 1;
      base += restartAt;
    }
    return { rows: out, empty: !t.trim() };
  }

  // The first non-blank row is the header.
  function parse(text) {
    var l = lines(text), head = l.rows.shift();
    var fields = head ? head.cells.map(function (f) { return String(f).trim(); }) : [];
    var rows = l.rows.map(function (r) {
      var o = {};
      fields.forEach(function (f, i) { if (!(f in o)) o[f] = r.cells[i]; });
      return { data: o, line: r.line, endLine: r.endLine, count: r.cells.length, badQuote: r.badQuote, cells: r.cells };
    });
    return { rows: rows, fields: fields, empty: l.empty, headBad: !!(head && (head.badQuote || head.endLine > head.line)), headLine: head ? head.line : 1 };
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
  var DESC = /^(.*?[a-z].*?)\s+(\d[\d.,/-]*\s*(?:mg|mcg|g|ml|meq|%|units?(?:\/ml)?|iu)(?:\s*\/\s*\d*[\d.]*\s*(?:ml|g|actuation|dose))?)\b\s*(.*)$/i;

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
               notes: [{row, ndc, note}], split, problem } where row is the line in the file.
     Every data row is either imported (perhaps with notes) or skipped. */
  function importProducts(text, layout) {
    var p = parse(text), cols = mapColumns(p.fields), m = cols.map;
    var report = { rows: p.rows.length, imported: 0, split: 0, skipped: [], notes: [], problem: null,
      columns: { used: m, unused: cols.unused, missing: [] } };
    var products = [], seen = {}, lineOf = {};
    if (p.empty) { report.problem = 'The file is empty.'; return { products: products, lineOf: lineOf, report: report }; }
    if (p.headBad) {
      report.problem = 'The header (line ' + p.headLine + ') has a quote problem or runs over several lines, so the columns cannot be known. Fix that line and import again.';
      p.rows.forEach(function (r) { report.skipped.push({ row: r.line, ndc: '', reason: 'header could not be read' }); });
      return { products: products, lineOf: lineOf, report: report };
    }
    if (!p.rows.length) { report.problem = 'The file has a header line but no rows.'; return { products: products, lineOf: lineOf, report: report }; }
    ['ndc', 'drug', 'location', 'shelf'].forEach(function (c) { if (!m[c]) report.columns.missing.push(c); });
    if (!m.ndc) {
      report.problem = 'No NDC column found (expected a header such as "NDC"), so none of the ' + p.rows.length + ' rows were imported.';
      p.rows.forEach(function (r) { report.skipped.push({ row: r.line, ndc: '', reason: 'no NDC column' }); });
      return { products: products, lineOf: lineOf, report: report };
    }

    p.rows.forEach(function (row) {
      var r = row.data, line = row.line;
      var get = function (c) { return m[c] ? String(r[m[c]] == null ? '' : r[m[c]]).trim() : ''; };
      var note = function (s) { report.notes.push({ row: line, ndc: get('ndc'), note: s }); };
      if (row.badQuote) {
        var first = String(row.cells[p.fields.indexOf(m.ndc)] || '').split('\n')[0].trim().slice(0, 20);
        report.skipped.push({ row: line, ndc: first, reason: BAD_QUOTE });
        return;
      }
      if (row.endLine > line) note('this row runs over lines ' + line + '-' + row.endLine + ' (a quoted field with line breaks); check nothing was merged');
      var rawNdc = get('ndc');
      // Values are matched to columns by position, so a row with a different
      // number of fields may be shifted: skip it rather than guess. Extra
      // fields that are all blank (trailing commas) are fine.
      var extraBlank = row.count > p.fields.length && row.cells.slice(p.fields.length).every(function (c) { return !String(c).trim(); });
      if (row.count !== p.fields.length && !extraBlank) {
        report.skipped.push({ row: line, ndc: rawNdc, reason: 'has ' + row.count + ' fields but the header has ' + p.fields.length + ', so its columns cannot be matched safely' });
        return;
      }
      var n = ndc.normalize(rawNdc);
      if (!n) { report.skipped.push({ row: line, ndc: rawNdc, reason: whyBadNdc(rawNdc) }); return; }
      if (seen[n]) { report.skipped.push({ row: line, ndc: rawNdc, reason: 'duplicate of line ' + seen[n] }); return; }
      var drug = get('drug');
      if (!drug) { report.skipped.push({ row: line, ndc: rawNdc, reason: 'no drug name' }); return; }
      seen[n] = line; lineOf[n] = line;

      var prod = { ndc: n, drug: drug };
      var strength = get('strength'), form = get('form');
      if (!m.strength) {
        var sm = DESC.exec(drug);
        if (sm && (/^\//.test(sm[3].trim()) || DESC.test(sm[3].trim()) || /\d\s*(mg|mcg|g|ml)\b/i.test(sm[3]))) {
          note('"' + drug + '" looks like a combination product, so it was not split into drug and strength');
          sm = null;
        }
        if (sm) {
          prod.drug = sm[1].trim().replace(/[,;\s]+$/, ''); strength = sm[2].trim();
          var rest = sm[3].trim(), restUsed = !form && !!rest;
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

      var loc = null, rawLoc = get('location');
      if (rawLoc) {
        loc = findLocation(rawLoc, layout);
        if (loc) {
          prod.location = loc.code;
          if (loc.code.toUpperCase() !== rawLoc.toUpperCase()) note('location "' + rawLoc + '" read as ' + loc.code);
        } else { prod.location = rawLoc.toUpperCase(); note('location "' + rawLoc + '" is not on the layout yet; the map will say so'); }
      }
      var unit = null, rawUnit = get('unit'), unitWhy = '';
      if (rawUnit) {
        if (!loc) { note('unit "' + rawUnit + '" ignored: no known location'); unitWhy = 'no known location'; }
        else {
          unit = loc.units.filter(function (u) { return key(u.id) === key(rawUnit) || key(u.label) === key(rawUnit); })[0] || null;
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
     for notes about products the list does not mention. Returns a report. */
  function applyRobotList(text, products, layout, opts) {
    opts = opts || {};
    var l = lines(text), rows = l.rows, col = 0, start = 0;
    var report = { rows: 0, matched: 0, notFound: [], skipped: [], notes: [], movedToRobot: 0, problem: null };
    if (l.empty || !rows.length) { report.problem = 'The robot list is empty.'; return report; }
    var first = rows[0].cells, at = -1;
    first.map(key).forEach(function (h, i) { if (at < 0 && COLUMNS.ndc.indexOf(h) >= 0) at = i; });
    var looksLikeData = first.some(function (c) { c = String(c).trim(); return SCI.test(c) || /\d{5}/.test(c) || ndc.digits(c).length >= 10; });
    if (at >= 0) { col = at; start = 1; }
    else if (!looksLikeData && !rows[0].badQuote) {
      start = 1;
      report.notes.push({ row: rows[0].line, ndc: '', note: 'read as a header line: "' + first.join(',') + '"' });
    }
    report.rows = rows.length - start;
    if (!report.rows) { report.problem = 'The robot list has a header line but no NDCs.'; return report; }

    var byNdc = {};
    products.forEach(function (p) { byNdc[p.ndc] = p; });
    var robotLoc = layout.locations.filter(function (lc) { return lc.kind === 'robot'; })[0];
    var seen = {};
    for (var i = start; i < rows.length; i++) {
      var line = rows[i].line;
      if (rows[i].badQuote) { report.skipped.push({ row: line, ndc: String(rows[i].cells[col] || '').split('\n')[0].trim().slice(0, 20), reason: BAD_QUOTE }); continue; }
      var raw = String(rows[i].cells[col] || '').trim(), n = ndc.normalize(raw);
      if (!n) { report.skipped.push({ row: line, ndc: raw, reason: whyBadNdc(raw) }); continue; }
      if (seen[n]) { report.skipped.push({ row: line, ndc: raw, reason: 'duplicate of line ' + seen[n] }); continue; }
      seen[n] = line;
      var p = byNdc[n];
      if (!p) { report.notFound.push({ row: line, ndc: raw }); continue; }
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
        report.notes.push({ row: '-', ndc: ndc.format(p.ndc), note: 'marked in the robot' + (opts.lineOf && opts.lineOf[p.ndc] ? ' on products line ' + opts.lineOf[p.ndc] : '') + ' but not in the robot list; left as given' });
      }
    });
    var byLine = function (a, b) { return (a.row === '-' ? 1e9 : a.row) - (b.row === '-' ? 1e9 : b.row); };
    report.skipped.sort(byLine); report.notes.sort(byLine);
    return report;
  }

  // A dataset built from imported products on top of a base dataset's
  // layout, rules and basket schemes. opts.productsAreSample: the products
  // are still the fictional sample (a robot list applied on its own), so the
  // data stays marked as sample.
  function buildDataset(base, products, source, opts) {
    opts = opts || {};
    return {
      meta: { id: 'imported', name: (base.layout.name || 'Pharmacy') + (opts.productsAreSample ? ' + robot list' : ' + imported products'),
        sample: !!opts.productsAreSample, layoutIsSample: !!(base.meta && base.meta.sample), source: source || 'CSV import' },
      layout: base.layout, products: products, rules: base.rules, basketSchemes: base.basketSchemes
    };
  }

  return { parse: parse, lines: lines, mapColumns: mapColumns, importProducts: importProducts, applyRobotList: applyRobotList,
    buildDataset: buildDataset, COLUMNS: COLUMNS };
});
