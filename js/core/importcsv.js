/* CSV import for real store data: a product/shelf list and a robot NDC list.
   Builds products in the dataset shape and a report of every row that did
   not fit. It never guesses: a bad value becomes unknown and is reported.
   Uses PapaParse. No DOM; also loads in Node. */
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

  function key(h) { return String(h || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

  // Every non-blank row with the file line it starts on (blank lines and
  // line breaks inside quoted fields are counted), plus CSV syntax problems.
  function lines(text) {
    var t = String(text || '').replace(/^\uFEFF/, ''), out = [], errors = [], prev = 0, line = 1;
    Papa.parse(t, { skipEmptyLines: false, step: function (r) {
      var cur = r.meta.cursor, cells = r.data;
      if (cells.some(function (c) { return String(c).trim() !== ''; })) out.push({ cells: cells, line: line });
      (r.errors || []).forEach(function (e) { errors.push({ line: line, message: e.message }); });
      for (var i = prev; i < cur; i++) if (t.charCodeAt(i) === 10) line++;
      prev = cur;
    } });
    return { rows: out, errors: errors };
  }

  // The first non-blank row is the header.
  function parse(text) {
    var l = lines(text), head = l.rows.shift();
    var fields = head ? head.cells.map(function (f) { return String(f).trim(); }) : [];
    var rows = l.rows.map(function (r) {
      var o = {};
      fields.forEach(function (f, i) { if (!(f in o)) o[f] = r.cells[i]; });
      return { data: o, line: r.line, count: r.cells.length };
    });
    return { rows: rows, fields: fields, errors: l.errors };
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

  function bool(v) {
    var s = String(v == null ? '' : v).trim().toLowerCase();
    if (!s) return { value: undefined };
    if (TRUE.indexOf(s) >= 0) return { value: true };
    if (FALSE.indexOf(s) >= 0) return { value: false };
    return { bad: true };
  }
  function int(v, min) {
    var s = String(v == null ? '' : v).trim().replace(/,/g, '');
    if (!s) return { value: undefined };
    if (!/^\d+$/.test(s) || Number(s) < min) return { bad: true };
    return { value: Number(s) };
  }

  // "ATORVASTATIN 40 MG TAB" -> drug, strength, form; only when there is no
  // strength column and the text clearly has a number with a unit.
  var DESC = /^(.*?[a-z].*?)\s+(\d[\d.,/-]*\s*(?:mg|mcg|g|ml|meq|%|units?(?:\/ml)?|iu)(?:\s*\/\s*\d*[\d.]*\s*(?:ml|g|actuation|dose))?)\b\s*(.*)$/i;

  // Why a value is not a usable NDC, in words.
  function whyBadNdc(raw) {
    var d = ndc.digits(raw);
    if (!raw) return 'no NDC';
    if (/^\d+(\.\d+)?e\+?\d+$/i.test(String(raw).trim())) return 'NDC "' + raw + '" was turned into a number by a spreadsheet (scientific notation); format the column as text and export again';
    if (d.length === 10) return 'NDC "' + raw + '" has 10 digits and no hyphens, so the 5-4-2 form cannot be known';
    if (d.length < 10) return 'NDC "' + raw + '" is too short (leading zeros lost in a spreadsheet?)';
    return 'NDC "' + raw + '" is not a valid NDC';
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

  /* Returns { products, report }.
     report: { rows, imported, columns: {used, unused, missing}, skipped: [{row, ndc, reason}],
               notes: [{row, ndc, note}], split } where row is the line number in the file. */
  function importProducts(text, layout) {
    var p = parse(text), cols = mapColumns(p.fields), m = cols.map;
    var report = { rows: p.rows.length, imported: 0, split: 0, skipped: [], notes: [],
      columns: { used: m, unused: cols.unused, missing: [] } };
    ['ndc', 'drug', 'location', 'shelf'].forEach(function (c) { if (!m[c]) report.columns.missing.push(c); });
    p.errors.forEach(function (e) { report.notes.push({ row: e.line, ndc: '', note: 'CSV problem: ' + e.message }); });
    var products = [], seen = {};
    if (!m.ndc) {
      report.skipped.push({ row: '-', ndc: '', reason: 'No NDC column found. Expected a header such as "NDC".' });
      return { products: products, report: report };
    }

    p.rows.forEach(function (row) {
      var r = row.data, line = row.line;
      var get = function (c) { return m[c] ? String(r[m[c]] == null ? '' : r[m[c]]).trim() : ''; };
      var note = function (s) { report.notes.push({ row: line, ndc: get('ndc'), note: s }); };
      var rawNdc = get('ndc');
      var n = ndc.normalize(rawNdc);
      if (!n) { report.skipped.push({ row: line, ndc: rawNdc, reason: whyBadNdc(rawNdc) }); return; }
      if (seen[n]) { report.skipped.push({ row: line, ndc: rawNdc, reason: 'duplicate of line ' + seen[n] }); return; }
      var drug = get('drug');
      if (!drug) { report.skipped.push({ row: line, ndc: rawNdc, reason: 'no drug name' }); return; }
      seen[n] = line;
      if (row.count !== p.fields.length) note('has ' + row.count + ' fields but the header has ' + p.fields.length + '; check the columns on this line');

      var prod = { ndc: n, drug: drug };
      var strength = get('strength'), form = get('form');
      if (!m.strength) {
        var sm = DESC.exec(drug);
        if (sm) { prod.drug = sm[1].trim(); strength = sm[2].trim(); if (!form && sm[3]) form = sm[3].trim(); report.split++; }
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
        }
        else { prod.location = rawLoc.toUpperCase(); note('location "' + rawLoc + '" is not on the layout yet; the map will say so'); }
      }
      var unit = null, rawUnit = get('unit');
      if (rawUnit) {
        if (!loc) note('unit "' + rawUnit + '" ignored: no known location');
        else {
          unit = loc.units.filter(function (u) { return key(u.id) === key(rawUnit) || key(u.label) === key(rawUnit); })[0] || null;
          if (unit) prod.unit = unit.id; else note('unit "' + rawUnit + '" is not part of ' + loc.code + '; unit left unknown');
        }
      } else if (loc && loc.units.length === 1) unit = loc.units[0];

      var sh = int(get('shelf'), 1);
      if (sh.bad) note('shelf "' + get('shelf') + '" is not a whole number; shelf left unknown');
      else if (sh.value != null) {
        if (!loc) note('shelf ' + sh.value + ' ignored: no known location');
        else if (!unit) note('shelf ' + sh.value + ' ignored: ' + loc.code + ' has several units and none was given');
        else if (sh.value > unit.shelves) note('shelf ' + sh.value + ' does not fit ' + unit.id + ' (' + unit.shelves + ' shelves); shelf left unknown');
        else prod.shelf = sh.value;
      }

      var cnt = int(get('countPerBottle'), 1);
      if (cnt.bad) note('count "' + get('countPerBottle') + '" is not a whole number; left unknown');
      else if (cnt.value != null) prod.countPerBottle = cnt.value;
      var rk = int(get('rank'), 1);
      if (rk.bad) note('rank "' + get('rank') + '" is not a whole number; left unknown');
      else if (rk.value != null) prod.rank = rk.value;

      ['niosh', 'safetyCap', 'robot', 'preferred'].forEach(function (f) {
        var b = bool(get(f));
        if (b.bad) note(f + ' "' + get(f) + '" is not yes or no; left unknown');
        else if (b.value != null) prod[f] = b.value;
      });

      // Vial capacities: numbers, or "n/a" for products not put in vials.
      var vial = {}, nums = 0, nas = 0;
      ['20', '40', '60'].forEach(function (d) {
        var raw = get('vial' + d);
        if (/^n\/?a$/i.test(raw)) { nas++; return; }
        var v = int(raw, 1);
        if (v.bad) note(d + ' dram "' + raw + '" is not a whole number; left unknown');
        else if (v.value != null) { vial[d] = v.value; nums++; }
      });
      if (nas && nums) note('vial sizes mix "n/a" and numbers; vial capacity left unknown');
      else if (nas) prod.vialCapacity = 'n/a';
      else if (nums) prod.vialCapacity = vial;

      products.push(prod);
      report.imported++;
    });
    return { products: products, report: report };
  }

  /* Marks NDCs from a robot list as robot (and preferred, if asked).
     The list may be one column of NDCs, with or without a header. NDCs not
     in the products are reported, not invented. Returns a report. */
  function applyRobotList(text, products, layout, opts) {
    opts = opts || {};
    var l = lines(text), rows = l.rows, col = 0, start = 0;
    if (rows.length) {
      var first = rows[0].cells, hdr = first.map(key), at = -1;
      hdr.forEach(function (h, i) { if (at < 0 && COLUMNS.ndc.indexOf(h) >= 0) at = i; });
      if (at >= 0) { col = at; start = 1; }
      // Some other header: only if the first row has no run of 5+ digits.
      else if (!first.some(function (c) { return /\d{5}/.test(c); })) start = 1;
    }
    var byNdc = {};
    products.forEach(function (p) { byNdc[p.ndc] = p; });
    var robotLoc = layout.locations.filter(function (lc) { return lc.kind === 'robot'; })[0];
    var report = { rows: rows.length - start, matched: 0, notFound: [], skipped: [], notes: [], movedToRobot: 0 };
    l.errors.forEach(function (e) { report.notes.push({ row: e.line, ndc: '', note: 'CSV problem: ' + e.message }); });
    var seen = {};
    for (var i = start; i < rows.length; i++) {
      var line = rows[i].line, raw = String(rows[i].cells[col] || '').trim(), n = ndc.normalize(raw);
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
      if (robotLoc && p.location == null) { p.location = robotLoc.code; report.movedToRobot++; }
      report.matched++;
    }
    return report;
  }

  // A dataset built from imported products on top of a base dataset's
  // layout, rules and basket schemes.
  function buildDataset(base, products, source) {
    return {
      meta: { id: 'imported', name: (base.layout.name || 'Pharmacy') + ' + imported products', sample: false,
        layoutIsSample: !!(base.meta && base.meta.sample), source: source || 'CSV import' },
      layout: base.layout, products: products, rules: base.rules, basketSchemes: base.basketSchemes
    };
  }

  return { parse: parse, mapColumns: mapColumns, importProducts: importProducts, applyRobotList: applyRobotList,
    buildDataset: buildDataset, COLUMNS: COLUMNS };
});
