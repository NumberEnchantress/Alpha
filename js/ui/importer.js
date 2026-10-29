/* CSV import, shown in Settings > Data. Imported products are kept in this
   browser only (localStorage, or memory if storage is blocked or full) and
   can be downloaded as a data file for data/real/. */
(function (Alpha) {
  'use strict';
  var ui = Alpha.ui, esc = ui.esc, store = ui.store;
  var memory = null;      // imported state when it could not be saved
  var lastReport = null;  // shown again when the dialog is rebuilt

  function saved() { return memory || store.get('imported', null); }

  // The dataset the import builds on: the store's own data if present, else the sample.
  function base() {
    var sets = window.ALPHA_DATASETS || {};
    return sets.real || sets.sample;
  }

  function dataset() {
    var s = saved(), b = base();
    if (!s || !b || !Array.isArray(s.products)) return null;
    var ds = Alpha.importcsv.buildDataset(b, s.products, s.source);
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
    var preferred = el.querySelector('#imp-preferred').checked;
    status.textContent = 'Reading…';
    Promise.all([readFile(prodIn), readFile(robotIn)]).then(function (files) {
      var pf = files[0], rf = files[1];
      if (!pf && !rf) { status.textContent = 'Choose a products CSV, a robot list, or both.'; return; }
      var cur = Alpha.state.ds, layout = (base() || cur).layout;
      var products, report = { when: new Date().toLocaleString() };
      if (pf) {
        var res = Alpha.importcsv.importProducts(pf.text, layout);
        products = res.products; report.products = res.report; report.productsFile = pf.name;
      } else {
        // Robot list only: apply it to a copy of the products in use now.
        products = JSON.parse(JSON.stringify(cur.products));
      }
      if (rf) { report.robot = Alpha.importcsv.applyRobotList(rf.text, products, layout, { preferred: preferred }); report.robotFile = rf.name; }
      var source = [pf && pf.name, rf && rf.name].filter(Boolean).join(' + ');
      var ok = keep({ products: products, source: source, when: report.when });
      report.storedNote = ok ? 'Saved in this browser.' : 'This browser would not save it (blocked or too large); it will be gone when the page closes. Use "Download as data file" to keep it.';
      lastReport = report;
      Alpha.settings.reload();
      Alpha.settings.open(); // rebuild the dialog with the new data and the report
      focusReport();
    }).catch(function (e) { status.textContent = e.message; });
  }

  function stop() {
    memory = null; store.remove('imported'); lastReport = null;
    Alpha.settings.reload();
    Alpha.settings.open();
  }

  function download() {
    var ds = Alpha.state.ds;
    var out = JSON.parse(JSON.stringify(ds));
    out.meta = { id: 'real', name: ds.layout.name, sample: false, layoutIsSample: !!ds.meta.layoutIsSample, source: ds.meta.source || '' };
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

  function reportHtml(rep) {
    if (!rep) return '';
    var h = '<div class="import-report" id="imp-report" tabindex="-1"><h3>Import report <span class="muted small">(' + esc(rep.when) + ')</span></h3>';
    if (rep.products) {
      var p = rep.products, cols = p.columns;
      h += '<p><strong>' + esc(rep.productsFile) + '</strong>: ' + p.rows + ' rows read, <strong>' + p.imported + ' imported</strong>, ' +
        p.skipped.length + ' skipped, ' + p.notes.length + ' with notes' + (p.split ? ', ' + p.split + ' descriptions split into drug and strength' : '') + '.</p>';
      h += '<p class="small">Columns used: ' + Object.keys(cols.used).map(function (k) { return esc(k) + ' ← "' + esc(cols.used[k]) + '"'; }).join(', ') +
        (cols.unused.length ? '. Ignored: ' + cols.unused.map(function (u) { return '"' + esc(u) + '"'; }).join(', ') : '') +
        (cols.missing.length ? '. <strong>Not found: ' + cols.missing.map(esc).join(', ') + '</strong> (those stay unknown)' : '') + '.</p>';
      h += '<h4>Rows not imported</h4>' + table(p.skipped, [['row', 'Line'], ['ndc', 'NDC'], ['reason', 'Why']], 'None.');
      h += '<h4>Imported, with notes</h4>' + table(p.notes, [['row', 'Line'], ['ndc', 'NDC'], ['note', 'Note']], 'None.');
    }
    if (rep.robot) {
      var r = rep.robot;
      h += '<p><strong>' + esc(rep.robotFile) + '</strong>: ' + r.rows + ' NDCs, <strong>' + r.matched + ' marked as in the robot</strong>' +
        (r.movedToRobot ? ' (' + r.movedToRobot + ' had no location and now show the robot)' : '') + ', ' + r.notFound.length + ' not in the product list, ' + r.skipped.length + ' unusable.</p>';
      h += table(r.notFound.map(function (x) { return { row: x.row, ndc: x.ndc, why: 'not in the product list' }; })
        .concat(r.skipped.map(function (x) { return { row: x.row, ndc: x.ndc, why: x.reason }; })), [['row', 'Line'], ['ndc', 'NDC'], ['why', 'Why']]);
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
      '<label class="opt"><input type="checkbox" id="imp-preferred" checked> NDCs in the robot list are the preferred ones (assumption 4 in NOTES.md)</label>' +
      '<div><button type="button" class="btn" id="imp-go">Import</button> ' +
      (s ? '<button type="button" class="btn" id="imp-stop">Stop using imported data</button> ' : '') +
      '<button type="button" class="btn" id="imp-dl">Download as data file</button></div>' +
      '<p class="small muted">Columns are matched by name: NDC, drug (or description), strength, form, manufacturer, location, unit, shelf, count, NIOSH, safety cap, 20/40/60 dram, robot, preferred, rank, notes. ' +
      'The downloaded store.js goes in data/real/ and must stay private.</p>' +
      '<p id="imp-status" class="small" role="status"></p></div>' + reportHtml(lastReport);
    el.querySelector('#imp-go').addEventListener('click', function () { doImport(el); });
    el.querySelector('#imp-dl').addEventListener('click', download);
    var st = el.querySelector('#imp-stop');
    if (st) st.addEventListener('click', stop);
  }

  // After an import the dialog reopens; move focus to the report.
  function focusReport() { var r = document.getElementById('imp-report'); if (r) { r.scrollIntoView({ block: 'start' }); r.focus(); return true; } return false; }

  Alpha.importer = { dataset: dataset, mount: mount, focusReport: focusReport, lastReport: function () { return lastReport; } };
})(window.Alpha);
