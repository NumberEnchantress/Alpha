/* CSV import, shown in Settings > Data. Imported products are kept in this
   browser only (localStorage, or memory if storage is blocked or full) and
   can be downloaded as a data file for data/real/. */
(function (Alpha) {
  'use strict';
  var ui = Alpha.ui, esc = ui.esc, store = ui.store;
  var memory = null;      // imported state when it could not be saved
  var lastReport = store.get('importReport', null); // shown again when the dialog is rebuilt

  function saved() { return memory || store.get('imported', null); }

  // The dataset the import builds on: the store's own data if present, else the sample.
  function base() {
    var sets = window.ALPHA_DATASETS || {};
    return sets.real || sets.sample;
  }

  function dataset() {
    var s = saved(), b = base();
    if (!s || !b || !Array.isArray(s.products)) return null;
    var ds = Alpha.importcsv.buildDataset(b, s.products, s.source, { productsAreSample: !!s.productsAreSample });
    ds.meta.importedAt = s.when;
    return ds;
  }

  function keep(state) {
    memory = null;
    if (!store.set('imported', state)) memory = state; // blocked or too big: keep for this session
    return !memory;
  }

  function readFile(input) {
    return new Promise(function (resolve, reject) {
      var f = input.files && input.files[0];
      if (!f) { resolve(null); return; }
      var r = new FileReader();
      r.onload = function () { resolve({ name: f.name, text: String(r.result) }); };
      r.onerror = function () { reject(new Error('Could not read ' + f.name)); };
      r.readAsText(f);
    });
  }

  function doImport(el) {
    var status = el.querySelector('#imp-status');
    var prodIn = el.querySelector('#imp-products'), robotIn = el.querySelector('#imp-robot');
    status.textContent = 'Reading…';
    Promise.all([readFile(prodIn), readFile(robotIn)]).then(function (files) {
      var pf = files[0], rf = files[1];
      if (!pf && !rf) { status.textContent = 'Choose a products CSV, a robot list, or both.'; return; }
      var cur = Alpha.state.ds, layout = (base() || cur).layout;
      var products, lineOf = null, report = { when: new Date().toLocaleString() };
      if (pf) {
        var res = Alpha.importcsv.importProducts(pf.text, layout);
        products = res.products; lineOf = res.lineOf; report.products = res.report; report.productsFile = pf.name;
      } else {
        // Robot list only: apply it to a copy of the products in use now.
        products = JSON.parse(JSON.stringify(cur.products));
      }
      if (rf) { report.robot = Alpha.importcsv.applyRobotList(rf.text, products, layout, { preferred: true, lineOf: lineOf }); report.robotFile = rf.name; }
      var source = [pf && pf.name, rf && rf.name].filter(Boolean).join(' + ');
      var ok = keep({ products: products, source: source, when: report.when, productsAreSample: !pf && !!cur.meta.sample });
      report.storedNote = ok ? 'Saved in this browser.' : 'This browser would not save it (blocked or too large); it will be gone when the page closes. Use "Download as data file" to keep it.';
      lastReport = report;
      store.set('importReport', report);
      Alpha.settings.reload();
      Alpha.settings.open(); // rebuild the dialog with the new data and the report
      focusReport();
    }).catch(function (e) { status.textContent = e.message; });
  }

  function stop() {
    memory = null; store.remove('imported'); store.remove('importReport'); lastReport = null;
    Alpha.settings.reload();
    Alpha.settings.open();
  }

  function download() {
    var ds = Alpha.state.ds;
    var out = JSON.parse(JSON.stringify(ds));
    out.meta = { id: 'real', name: 'Store data' + (ds.meta.source ? ' from ' + ds.meta.source : ''), sample: !!ds.meta.sample, layoutIsSample: !!ds.meta.layoutIsSample, source: ds.meta.source || '' };
    var text = '/* Store data for Alpha. PRIVATE: keep it out of any public repository. */\n' +
      '(window.ALPHA_DATASETS = window.ALPHA_DATASETS || {}).real = ' + JSON.stringify(out) + ';\n';
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/javascript' }));
    a.download = 'store.js';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function table(rows, cols, empty) {
    if (!rows || !rows.length) return empty ? '<p class="small muted">' + empty + '</p>' : '';
    return '<table class="report small"><thead><tr>' + cols.map(function (c) { return '<th>' + c[1] + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rows.map(function (r) { return '<tr>' + cols.map(function (c) { return '<td>' + esc(r[c[0]]) + '</td>'; }).join('') + '</tr>'; }).join('') +
      '</tbody></table>';
  }

  // Rows with at least one note (a row can have several notes).
  function noteRows(notes) { var seen = {}; notes.forEach(function (n) { seen[n.row] = 1; }); return Object.keys(seen).length; }

  function reportHtml(rep) {
    if (!rep) return '';
    var h = '<div class="import-report" id="imp-report" tabindex="-1"><h3>Import report <span class="muted small">(' + esc(rep.when) + ')</span></h3>';
    if (rep.products) {
      var p = rep.products, cols = p.columns;
      if (p.problem) h += '<p class="note-bad">' + esc(rep.productsFile) + ': ' + esc(p.problem) + '</p>';
      h += '<p><strong>' + esc(rep.productsFile) + '</strong>: ' + p.rows + ' rows read, <strong>' + p.imported + ' imported</strong>, ' +
        p.skipped.length + ' skipped, ' + noteRows(p.notes) + ' with notes' + (p.split ? ', ' + p.split + ' descriptions split into drug and strength' : '') + '.</p>';
      h += '<p class="small">Columns used: ' + Object.keys(cols.used).map(function (k) { return esc(k) + ' ← "' + esc(cols.used[k]) + '"'; }).join(', ') +
        (cols.unused.length ? '. Ignored: ' + cols.unused.map(function (u) { return '"' + esc(u) + '"'; }).join(', ') : '') +
        (cols.missing.length ? '. <strong>Not found: ' + cols.missing.map(esc).join(', ') + '</strong> (those stay unknown)' : '') + '.</p>';
      h += '<h4>Rows not imported</h4>' + table(p.skipped, [['row', 'Line'], ['ndc', 'NDC'], ['reason', 'Why']], 'None.');
      h += '<h4>Imported, with notes</h4>' + table(p.notes, [['row', 'Line'], ['ndc', 'NDC'], ['note', 'Note']], 'None.');
    }
    if (rep.robot) {
      var r = rep.robot;
      if (r.problem) h += '<p class="note-bad">' + esc(rep.robotFile) + ': ' + esc(r.problem) + '</p>';
      h += '<p><strong>' + esc(rep.robotFile) + '</strong>: ' + r.rows + ' NDCs, <strong>' + r.matched + ' marked as in the robot</strong>' +
        (r.movedToRobot ? ' (' + r.movedToRobot + (r.movedToRobot === 1 ? ' had no location and now shows' : ' had no location and now show') + ' the robot)' : '') + ', ' + r.notFound.length + ' not in the product list, ' + r.skipped.length + ' unusable.</p>';
      var rrows = r.notFound.map(function (x) { return { row: x.row, ndc: x.ndc, why: 'not in the product list' }; })
        .concat(r.skipped.map(function (x) { return { row: x.row, ndc: x.ndc, why: 'skipped: ' + x.reason }; }))
        .concat(r.notes.map(function (x) { return { row: x.row, ndc: x.ndc, why: x.note }; }));
      rrows.sort(function (a, b) { return (a.row === '-' ? 1e9 : a.row) - (b.row === '-' ? 1e9 : b.row); });
      h += table(rrows, [['row', 'Line'], ['ndc', 'NDC'], ['why', 'Note']]);
    }
    return h + '<p class="small">' + esc(rep.storedNote) + '</p></div>';
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
      '<p class="small muted">Columns are matched by name: NDC, drug (or description), strength, form, manufacturer, location, unit, shelf, count, NIOSH, safety cap, 20/40/60 dram, robot, preferred, rank, notes. ' +
      'The downloaded store.js goes in data/real/ and must stay private.</p>' +
      '<p id="imp-status" class="small" role="status"></p></div>' + reportHtml(lastReport);
    el.querySelector('#imp-go').addEventListener('click', function () { doImport(el); });
    var st = el.querySelector('#imp-stop');
    if (st) { st.addEventListener('click', stop); el.querySelector('#imp-dl').addEventListener('click', download); }
  }

  // After an import the dialog reopens; move focus to the report.
  function focusReport() { var r = document.getElementById('imp-report'); if (r) { r.scrollIntoView({ block: 'start' }); r.focus(); return true; } return false; }

  Alpha.importer = { dataset: dataset, mount: mount, focusReport: focusReport, lastReport: function () { return lastReport; } };
})(window.Alpha);
