/* CSV import, shown in Settings > Data. Imported products are kept in this
   browser only (localStorage, or memory if storage is blocked or full) and
   can be downloaded as a data file for data/real/. */
(function (Alpha) {
  'use strict';
  var ui = Alpha.ui, esc = ui.esc, store = ui.store;
  var memory = null;      // imported state when it could not be saved
  var lastReport = store.get('importReport', null); // shown again when the dialog is rebuilt
  // What was in use before the last import that changed the data, so it can be
  // undone: { prev: the earlier import, or null for the store's own data }.
  // Kept in this browser when there is room, else until the page is closed.
  var undoState = null;
  function undoInfo() { return undoState || store.get('importUndo', null); }

  function saved() { return memory || store.get('imported', null); }

  // The dataset the import builds on: the store's own data if present, else the sample.
  function base() {
    var sets = window.ALPHA_DATASETS || {};
    return sets.real || sets.sample;
  }

  function dataset() {
    var s = saved(), b = base();
    if (!s || !b || !Array.isArray(s.products)) return null;
    var ds = Alpha.importcsv.buildDataset(b, s.products, s.source, { productsAreSample: !!s.productsAreSample, robotPrior: s.robotPrior, robotList: s.robotList });
    ds.meta.importedAt = s.when;
    return ds;
  }

  function keep(state) {
    memory = null;
    if (!store.set('imported', state)) {
      // Never let an older saved import come back after a reload in its place;
      // removing it may also make room for this one.
      store.remove('imported');
      if (!store.set('imported', state)) memory = state; // blocked or too big: keep for this session
    }
    return !memory;
  }

  function readFile(input) {
    return new Promise(function (resolve, reject) {
      var f = input.files && input.files[0];
      if (!f) { resolve(null); return; }
      var r = new FileReader();
      // Bytes, not text: the file may not be UTF-8 (see importcsv.decode).
      r.onload = function () {
        var d = Alpha.importcsv.decode(new Uint8Array(r.result));
        if (d.problem) { reject(new Error(f.name + ' was not imported: ' + d.problem)); return; }
        resolve({ name: f.name, text: d.text, encoding: d.encoding, note: d.note });
      };
      r.onerror = function () { reject(new Error('Could not read ' + f.name)); };
      r.readAsArrayBuffer(f);
    });
  }

  var busy = false;
  function doImport(el) {
    if (busy) return;
    var status = el.querySelector('#imp-status'), go = el.querySelector('#imp-go');
    var prodIn = el.querySelector('#imp-products'), robotIn = el.querySelector('#imp-robot');
    busy = true; if (go) go.disabled = true;
    var done = function () { busy = false; if (go) go.disabled = false; };
    status.textContent = 'Reading…';
    Promise.all([readFile(prodIn), readFile(robotIn)]).then(function (files) {
      var pf = files[0], rf = files[1];
      if (!pf && !rf) { done(); status.textContent = 'Choose a products CSV, a robot list, or both.'; return; }
      status.textContent = 'Importing… (a large file can take a few seconds)';
      setTimeout(function () { try { run(pf, rf); } finally { done(); } }, 30); // let the status show before the work starts
    }).catch(function (e) {
      done();
      // A file that is not readable text gets a report of its own (it replaces the earlier one).
      lastReport = { when: new Date().toLocaleString(), fileProblem: e.message, storedNote: 'Nothing was changed: the data in use is the same as before this import.' };
      if (!store.set('importReport', lastReport)) store.remove('importReport');
      Alpha.settings.open();
      var st = document.querySelector('#imp-status'); if (st) st.textContent = e.message;
      focusReport();
    });
  }

  // Builds the import. A file that is refused, or that gives no products,
  // changes nothing: the data in use stays as it was, and the report says why.
  function run(pf, rf) {
    var cur = Alpha.state.ds, layout = (base() || cur).layout, prev = saved();
    var products, lineOf = null, productsSource = null, productsAreSample = false, robotPrior = null, robotList = null;
    // The robot list in use now: kept with the import, or in store.js.
    var listInUse = prev ? prev.robotList : cur.meta && cur.meta.robotList;
    var report = { when: new Date().toLocaleString() };
    if (pf) {
      var res = Alpha.importcsv.importProducts(pf.text, layout);
      products = res.products; lineOf = res.lineOf; productsSource = pf.name;
      report.products = res.report; report.productsFile = pf.name;
      report.productsEncoding = { encoding: pf.encoding, note: pf.note };
    } else {
      // Robot list only: apply it to a copy of the products in use now, after
      // undoing the robot list applied before (a new list replaces the old one).
      products = JSON.parse(JSON.stringify(prev && Array.isArray(prev.products) ? prev.products : cur.products));
      if (prev) { Alpha.importcsv.restoreRobot(products, prev.robotPrior); lineOf = prev.lineOf || null; productsSource = prev.productsSource || null; productsAreSample = !!prev.productsAreSample; }
      // (a robot list replaces listInUse below)
      else { Alpha.importcsv.restoreRobot(products, cur.meta.robotPrior); productsAreSample = !!cur.meta.sample; } // store.js keeps what its robot list changed
    }
    var productsOk = !pf || (!report.products.fatal && report.products.imported > 0);
    if (rf && productsOk) {
      report.robot = Alpha.importcsv.applyRobotList(rf.text, products, layout, { preferred: true, lineOf: lineOf });
      report.robotFile = rf.name; report.robotEncoding = { encoding: rf.encoding, note: rf.note };
      if (!report.robot.fatal) { robotPrior = report.robot.prior; robotList = { source: rf.name, ndcs: report.robot.ndcs }; }
    } else if (rf) report.robotNotUsed = rf.name + ' was not used, because the products file was not imported.';
    else if (pf && productsOk && listInUse && listInUse.ndcs && listInUse.ndcs.length) {
      // A new products file alone: the robot list in use is applied to it again.
      var again = Alpha.importcsv.applyRobotList('NDC\n' + listInUse.ndcs.map(Alpha.ndc.format).join('\n') + '\n', products, layout, { preferred: true, lineOf: lineOf });
      ['notes', 'skipped', 'notFound'].forEach(function (k) { again[k].forEach(function (x) { x.row = '-'; }); }); // no file of its own: no line numbers
      if (!again.fatal) { report.robot = again; report.robotFile = listInUse.source + ' (the robot list in use, applied again)'; robotPrior = again.prior; robotList = listInUse; }
      else {
        // Kept, not dropped: the next products file that has its NDCs gets it again.
        robotList = listInUse;
        report.robotAgainNote = 'The robot list in use (' + listInUse.source + ') has no NDC that is in these products, so it marks none of them (products marked by their own Robot column stay marked). The list is kept and will be applied again to the next products file; import a robot list to replace it.';
      }
    }
    var robotOk = !rf || (report.robot && !report.robot.fatal);
    // All or nothing: if either file was refused, neither is used.
    var changed = productsOk && robotOk;
    if (pf && rf && productsOk && !robotOk) report.robotNotUsed = 'Neither file was used, because ' + rf.name + ' was refused; ' + pf.name + ' was read but not applied.';
    if (changed) {
      var prevState = saved();
      // The old report goes first, so a large one cannot take the room this import needs.
      store.remove('importReport');
      var source = [productsSource, rf && robotOk && rf.name].filter(Boolean).join(' + ');
      var ok = keep({ products: products, source: source, when: report.when, productsAreSample: productsAreSample,
        productsSource: productsSource, lineOf: lineOf, robotPrior: robotPrior, robotList: robotList });
      undoState = { prev: prevState || null };
      if (!store.set('importUndo', undoState)) store.remove('importUndo');
      report.canUndo = true;
      report.storedNote = ok ? 'Saved in this browser.' : 'This browser would not save it (blocked or too large); it will be gone when the page closes' + (prevState ? ', and the import saved earlier was removed from this browser so it cannot come back in its place' : '') + '. Use "Download as data file" to keep it.';
    } else {
      report.storedNote = 'Nothing was changed: the data in use is the same as before this import.';
    }
    lastReport = report;
    // A report that cannot be stored must not leave the previous one to come back after a reload.
    if (!store.set('importReport', report)) store.remove('importReport');
    Alpha.settings.reload();
    Alpha.settings.open(); // rebuild the dialog with the new data and the report
    focusReport();
  }

  // Puts back what was in use before the last import.
  function undo() {
    var u = undoInfo();
    if (!u) return;
    var kept = true;
    if (u.prev) kept = keep(u.prev); else { memory = null; store.remove('imported'); }
    undoState = null; store.remove('importUndo');
    lastReport = { when: new Date().toLocaleString(), undone: true, storedNote: 'Undone: the data in use is back to what it was before that import (' + (u.prev ? u.prev.source + ', imported ' + u.prev.when : 'the store\'s own data, no import') + ').' +
      (kept ? '' : ' This browser would not save it (its storage may be full), so it lasts until the page is closed; use "Download as data file" to keep it.') };
    if (!store.set('importReport', lastReport)) store.remove('importReport');
    Alpha.settings.reload();
    Alpha.settings.open();
    focusReport();
  }

  // Back to the store's own data; can be undone like an import (one step).
  function stop() {
    var was = saved();
    memory = null; store.remove('imported'); store.remove('importReport');
    undoState = was ? { prev: was } : null;
    if (!undoState || !store.set('importUndo', undoState)) store.remove('importUndo');
    lastReport = was ? { when: new Date().toLocaleString(), storedNote: 'Stopped using the imported data (' + was.source + '); the store\'s own data is in use.' } : null;
    if (lastReport && !store.set('importReport', lastReport)) store.remove('importReport');
    Alpha.settings.reload();
    Alpha.settings.open();
    focusReport();
  }

  function download() {
    var ds = Alpha.state.ds;
    var out = JSON.parse(JSON.stringify(ds));
    out.meta = { id: 'real', name: 'Store data' + (ds.meta.source ? ' from ' + ds.meta.source : ''), sample: !!ds.meta.sample, layoutIsSample: !!ds.meta.layoutIsSample, source: ds.meta.source || '' };
    if (ds.meta.robotPrior) out.meta.robotPrior = ds.meta.robotPrior; // so a later robot list can replace this one
    if (ds.meta.robotList) out.meta.robotList = ds.meta.robotList; // and a later products file gets it again
    var text = '/* Store data for Alpha. PRIVATE: keep it out of any public repository. */\n' +
      '(window.ALPHA_DATASETS = window.ALPHA_DATASETS || {}).real = ' + JSON.stringify(out) + ';\n';
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/javascript' }));
    a.download = 'store.js';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  // Long tables show their first rows only (drawing thousands of rows freezes
  // the page); the full report is one click away as a CSV file.
  var SHOWN = 300;
  function table(rows, cols, empty) {
    if (!rows || !rows.length) return empty ? '<p class="small muted">' + empty + '</p>' : '';
    return '<table class="report small"><thead><tr>' + cols.map(function (c) { return '<th>' + c[1] + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rows.slice(0, SHOWN).map(function (r) { return '<tr>' + cols.map(function (c) { return '<td>' + esc(r[c[0]]) + '</td>'; }).join('') + '</tr>'; }).join('') +
      '</tbody></table>' +
      (rows.length > SHOWN ? '<p class="small">Showing the first ' + SHOWN + ' of ' + rows.length + '; all of them are in the report CSV (button below).</p>' : '');
  }

  // Every entry of the last report, one per line: file, kind, line, NDC, text.
  function downloadReport() {
    var rep = lastReport, out = [['file', 'kind', 'line', 'ndc', 'text']];
    if (!rep) return;
    var q = function (v) {
      v = String(v == null ? '' : v);
      if (/^[=+\-@\t]/.test(v)) v = "'" + v; // not a formula when opened in a spreadsheet
      return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    };
    if (rep.fileProblem) out.push(['', 'problem', '', '', rep.fileProblem]);
    if (rep.robotNotUsed) out.push(['', 'not applied', '', '', rep.robotNotUsed]);
    if (rep.robotAgainNote) out.push(['', 'note', '', '', rep.robotAgainNote]);
    if (rep.storedNote) out.push(['', 'saved', '', '', rep.storedNote]);
    if (rep.products) {
      if (rep.products.problem) out.push([rep.productsFile, 'problem', '', '', rep.products.problem]);
      var notApplied = !!rep.robotNotUsed && /^Neither/.test(rep.robotNotUsed);
      if (!rep.products.fatal) out.push([rep.productsFile, 'summary', '', '', rep.products.rows + (rep.products.rows === 1 ? ' row read, ' : ' rows read, ') + rep.products.imported + (notApplied ? ' would be imported (not applied)' : ' imported') + ', ' + rep.products.skipped.length + ' skipped']);
      (rep.products.fileNotes || []).forEach(function (n) { out.push([rep.productsFile, 'file note', '', '', n]); });
      if (rep.productsEncoding && rep.productsEncoding.note) out.push([rep.productsFile, 'encoding', '', '', rep.productsEncoding.note]);
      (rep.products.misfits || []).forEach(function (s) { out.push([rep.productsFile, 'line to fix', s.row, '', s.why + ': ' + s.text]); });
      rep.products.skipped.forEach(function (s) { out.push([rep.productsFile, 'not imported', s.row, s.ndc, s.reason]); });
      rep.products.notes.forEach(function (n) { out.push([rep.productsFile, n.routine ? 'read' : 'note', n.row, n.ndc, n.note]); }); // read: how a value was read (routine)
    }
    if (rep.robot) {
      if (rep.robot.problem) out.push([rep.robotFile, 'problem', '', '', rep.robot.problem]);
      rep.robot.notFound.forEach(function (x) { out.push([rep.robotFile, 'not in the product list', x.row, x.ndc, '']); });
      rep.robot.skipped.forEach(function (x) { out.push([rep.robotFile, 'unusable', x.row, x.ndc, x.reason]); });
      rep.robot.notes.forEach(function (x) { out.push([rep.robotFile, 'note', x.row, x.ndc, x.note]); });
    }
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + out.map(function (r) { return r.map(q).join(','); }).join('\r\n') + '\r\n'], { type: 'text/csv' }));
    a.download = 'import-report.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  // Rows with at least one note (a row can have several notes).
  function noteRows(notes) { var seen = {}; notes.forEach(function (n) { seen[n.row] = 1; }); return Object.keys(seen).length; }

  // Only said when the file was not plain UTF-8.
  function encodingNote(e) {
    if (!e || !e.encoding || (e.encoding === 'UTF-8' && !e.note)) return '';
    return '<p class="note-warn small" data-testid="encoding">Read as ' + esc(e.encoding) + '. ' + esc(e.note || '') + '</p>';
  }

  function reportHtml(rep) {
    if (!rep) return '';
    var h = '<div class="import-report" id="imp-report" tabindex="-1"><h3>Import report <span class="muted small">(' + esc(rep.when) + ')</span></h3>' +
      (rep.robotNotUsed ? '<p class="note-bad" data-testid="not-applied">' + esc(rep.robotNotUsed) + '</p>' : '') +
      (rep.robotAgainNote ? '<p class="note-warn small">' + esc(rep.robotAgainNote) + '</p>' : '') +
      (rep.fileProblem ? '<p class="note-bad" data-testid="import-problem">' + esc(rep.fileProblem) + '</p>' : '');
    if (rep.products) {
      var p = rep.products, cols = p.columns;
      if (p.problem) h += '<p class="note-bad" data-testid="import-problem">' + esc(rep.productsFile) + ': ' + esc(p.problem) + '</p>';
      if (p.fatal && p.misfits && p.misfits.length) h += '<h4>Lines to fix</h4>' + table(p.misfits, [['row', 'Line'], ['why', 'Why'], ['text', 'The line']]);
      if (!p.fatal) {
        var notApplied = !!rep.robotNotUsed && /^Neither/.test(rep.robotNotUsed); // read, but the other file was refused
        h += '<p><strong>' + esc(rep.productsFile) + '</strong>' + (notApplied ? ' (read, not applied)' : '') + ': ' + p.rows + (p.rows === 1 ? ' row read, <strong>' : ' rows read, <strong>') +
          p.imported + (notApplied ? ' would be imported' : ' imported') + '</strong>, ' +
          p.skipped.length + ' skipped, ' + noteRows(p.notes.filter(function (n) { return !n.routine; })) + ' with notes to check' + (p.split ? ', ' + p.split + ' descriptions split into drug and strength' : '') + '.</p>';
        if (!p.imported) h += '<p class="note-bad">No rows could be imported, so the data in use was not changed.</p>';
        // Many rows left out: said plainly, before the tables (undo is below).
        else if (p.skipped.length * 10 > p.rows) h += '<p class="note-warn" data-testid="many-skipped">' + p.skipped.length + ' of ' + p.rows + ' rows were not imported. Check the reasons below before relying on this data' + (notApplied ? '.' : '; "Undo the last import" puts back the data in use before it.') + '</p>';
      }
      h += encodingNote(rep.productsEncoding) +
        (p.fileNotes || []).map(function (n) { return '<p class="note-warn small">' + esc(n) + '</p>'; }).join('');
      if (!p.fatal) {
        h += '<p class="small">Columns used: ' + Object.keys(cols.used).map(function (k) { return esc(k) + ' ← "' + esc(cols.used[k]) + '"'; }).join(', ') +
          (cols.unused.length ? '. Ignored: ' + cols.unused.map(function (u) { return '"' + esc(u) + '"'; }).join(', ') : '') +
          (cols.missing.length ? '. <strong>Not found: ' + cols.missing.map(esc).join(', ') + '</strong> (those stay unknown)' : '') + '.</p>';
        h += '<h4>Rows not imported</h4>' + table(p.skipped, [['row', 'Line'], ['ndc', 'NDC'], ['reason', 'Why']], 'None.');
        var check = p.notes.filter(function (n) { return !n.routine; }), routine = p.notes.filter(function (n) { return n.routine; });
        h += '<h4>' + (notApplied ? 'Read, with notes to check' : 'Imported, with notes to check') + '</h4>' + table(check, [['row', 'Line'], ['ndc', 'NDC'], ['note', 'Note']], 'None.');
        if (routine.length) h += '<details><summary>How ' + routine.length + ' value' + (routine.length > 1 ? 's were' : ' was') + ' read (descriptions split, Excel text)</summary>' + table(routine, [['row', 'Line'], ['ndc', 'NDC'], ['note', 'Note']]) + '</details>';
      }
    }
    if (rep.robot) {
      var r = rep.robot;
      if (r.problem) h += '<p class="note-bad" data-testid="robot-problem">' + esc(rep.robotFile) + ': ' + esc(r.problem) + '</p>';
      if (r.fatal) {
        // Its other notes too, as in its report CSV.
        var bad = r.skipped.map(function (x) { return { row: x.row, ndc: x.ndc, why: x.reason }; })
          .concat((r.notFound || []).map(function (x) { return { row: x.row, ndc: x.ndc, why: 'not in the product list' }; }))
          .concat((r.notes || []).map(function (x) { return { row: x.row, ndc: x.ndc, why: x.note }; }));
        bad.sort(function (a, b) { return (a.row === '-' ? 1e9 : a.row) - (b.row === '-' ? 1e9 : b.row); });
        return h + encodingNote(rep.robotEncoding) + table(bad, [['row', 'Line'], ['ndc', 'NDC'], ['why', 'Why']]) + '<p class="small">' + esc(rep.storedNote) + '</p>' + undoBtn(rep) + REPORT_BTN + '</div>';
      }
      h += '<p><strong>' + esc(rep.robotFile) + '</strong>: ' + r.rows + (r.rows === 1 ? ' NDC, <strong>' : ' NDCs, <strong>') + r.matched + ' marked as in the robot</strong>' +
        (r.movedToRobot ? ' (' + r.movedToRobot + (r.movedToRobot === 1 ? ' had no location and now shows' : ' had no location and now show') + ' the robot)' : '') + ', ' + r.notFound.length + ' not in the product list, ' + r.skipped.length + ' unusable.</p>' +
        encodingNote(rep.robotEncoding);
      var rrows = r.notFound.map(function (x) { return { row: x.row, ndc: x.ndc, why: 'not in the product list' }; })
        .concat(r.skipped.map(function (x) { return { row: x.row, ndc: x.ndc, why: 'skipped: ' + x.reason }; }))
        .concat(r.notes.map(function (x) { return { row: x.row, ndc: x.ndc, why: x.note }; }));
      rrows.sort(function (a, b) { return (a.row === '-' ? 1e9 : a.row) - (b.row === '-' ? 1e9 : b.row); });
      h += table(rrows, [['row', 'Line'], ['ndc', 'NDC'], ['why', 'Note']]);
    }
    return h + '<p class="small">' + esc(rep.storedNote) + '</p>' + undoBtn(rep) + REPORT_BTN + '</div>';
  }
  // The whole report as a CSV file, for any import (long tables show their first rows only).
  var REPORT_BTN = '<p><button type="button" class="btn small" data-act="report-csv">Download the report (CSV)</button></p>';
  function undoBtn(rep) {
    // Offered while the import it would undo is the one in use (also after a refused import, which changed nothing).
    return undoInfo() && !rep.undone ? '<p><button type="button" class="btn small" data-act="import-undo">' + (/^Stopped/.test(rep.storedNote || '') ? 'Use the imported data again' : 'Undo the last import') + '</button> <span class="small muted">puts back the data in use before ' + (/^Stopped/.test(rep.storedNote || '') ? 'you stopped' : 'the last import that changed it') + (store.raw('importUndo') == null ? ' (until the page is closed)' : '') + '</span></p>' : '';
  }

  function mount(el) {
    var s = saved();
    el.innerHTML = '<h3 class="i-section">Import CSV</h3>' +
      (s ? '<p><strong>Using imported data</strong> from ' + esc(s.source) + ' (' + esc(s.when) + '), ' + s.products.length + ' products' +
        (memory ? ', not saved in this browser' : '') + '.</p>' : '') +
      '<div class="import-form">' +
      '<label>Products / shelf CSV <input type="file" id="imp-products" accept=".csv,text/csv,text/plain"></label>' +
      '<label>Robot NDC list CSV <input type="file" id="imp-robot" accept=".csv,text/csv,text/plain"></label>' +
      '<p class="small muted">NDCs in the robot list are marked as the preferred ones.</p>' +
      '<div><button type="button" class="btn" id="imp-go">Import</button> ' +
      // Only imported data can be downloaded, so the fictional sample is never saved as store data.
      (s ? '<button type="button" class="btn" id="imp-stop">Stop using imported data</button> ' +
        '<button type="button" class="btn" id="imp-dl">Download as data file</button>' : '') + '</div>' +
      '<p class="small muted">Columns are matched by name: NDC, drug (or description), strength, form, manufacturer, location, unit, shelf, pack size, NIOSH, safety cap, 20/40/60 dram, robot, preferred, rank, notes. ' +
      'The downloaded store.js goes in data/real/ and must stay private.</p>' +
      '<p id="imp-status" class="small" role="status"></p></div>' + reportHtml(lastReport);
    el.querySelector('#imp-go').addEventListener('click', function () { doImport(el); });
    var st = el.querySelector('#imp-stop');
    if (st) { st.addEventListener('click', stop); el.querySelector('#imp-dl').addEventListener('click', download); }
    el.addEventListener('click', function (e) {
      if (e.target.closest('[data-act="report-csv"]')) downloadReport();
      else if (e.target.closest('[data-act="import-undo"]')) undo();
    });
  }

  // After an import the dialog reopens; move focus to the report, and say
  // the outcome in the status line (a live region) for screen readers.
  function focusReport() {
    var r = document.getElementById('imp-report');
    var pr = lastReport && lastReport.products, rr = lastReport && lastReport.robot;
    var refused = pr && pr.fatal ? 'Not imported: ' + pr.problem : rr && rr.fatal ? 'Robot list not used: ' + rr.problem : pr && !pr.imported && !pr.fatal ? 'No rows could be imported.' : '';
    var said = lastReport && (lastReport.fileProblem || (refused ? String(refused).split('. ')[0] + '. ' : '') + (lastReport.storedNote || ''));
    if (said) setTimeout(function () { var st = document.getElementById('imp-status'); if (st) st.textContent = said; }, 60);
    if (r) { r.scrollIntoView({ block: 'start' }); r.focus(); return true; }
    return false;
  }

  Alpha.importer = { dataset: dataset, mount: mount, focusReport: focusReport, lastReport: function () { return lastReport; } };
})(window.Alpha);
