/* Wires search, results, info, map and shelf view together. */
(function (Alpha) {
  'use strict';
  var ui = Alpha.ui, esc = ui.esc;
  var $ = function (id) { return document.getElementById(id); };
  var MAX_SHOWN = 12; // about 4 fit on screen; fewer rows keeps each keystroke cheap

  var S = {
    ds: null, index: null, rules: [], issues: { errors: [], warnings: [] },
    results: [], active: -1, product: null
  };
  Alpha.state = S;

  /* ---------- data ---------- */
  function chooseDataset() {
    var sets = window.ALPHA_DATASETS || {};
    var imported = Alpha.settings && Alpha.settings.importedDataset ? Alpha.settings.importedDataset() : null;
    return imported || sets.real || sets.sample || null;
  }

  function loadData() {
    S.ds = chooseDataset();
    if (!S.ds) { $('status').textContent = 'No data found. Check that app/data/sample/pharmacy.js exists.'; return false; }
    S.issues = Alpha.check.checkDataset(S.ds);
    compileRules();
    S.index = Alpha.search.createIndex(S.ds.products || []);
    $('dataset-name').textContent = S.ds.meta.name;
    $('sample-banner').hidden = !S.ds.meta.sample;
    Alpha.map.init($('map'), S.ds.layout);
    Alpha.info.renderBaskets($('baskets'), Alpha.settings.scheme(S.ds));
    if (S.issues.errors.length && window.console) console.warn('Alpha data problems:', S.issues.errors);
    return true;
  }

  // Rules from the data file plus any added in Settings.
  function compileRules() {
    var c = Alpha.rules.compile((S.ds.rules || []).concat(Alpha.settings.customRules()), Alpha.rules.PRODUCT_FIELDS);
    S.rules = c.rules;
    S.ruleErrors = c.errors;
  }

  /* ---------- search and results ---------- */
  function runSearch() {
    var q = $('q').value;
    var r = S.index.search(q, MAX_SHOWN);
    S.results = r.results;
    S.active = S.results.length ? 0 : -1;
    renderResults(r, q);
    choose(S.active >= 0 ? S.results[0].product : null);
  }

  function renderResults(r, q) {
    var list = $('results');
    var html = '';
    for (var i = 0; i < S.results.length; i++) {
      var p = S.results[i].product;
      var cls = 'result' + (i < 3 ? ' top3' : '') + (i === 3 ? ' after-top3' : '');
      html += '<li id="r' + i + '" class="' + cls + '" role="option" aria-selected="' + (i === S.active) + '" data-i="' + i + '">' +
        '<span class="r-num">' + (i + 1) + '</span>' +
        '<span class="r-name">' + esc(p.drug) + ' ' + ui.show(p.strength) + (p.form ? ' <span class="r-meta">' + esc(p.form) + '</span>' : '') + '</span>' +
        '<span class="r-meta"><span class="ndc">' + esc(Alpha.ndc.format(p.ndc)) + '</span> · ' +
          (p.location != null ? esc(p.location) : 'location unknown') + ' · ' + ui.show(p.manufacturer) + '</span>' +
        '</li>';
    }
    list.innerHTML = html;
    // Writing scrollTop forces a layout, so only do it if the list was scrolled.
    if (S.listScrolled) { list.scrollTop = 0; S.listScrolled = false; }
    var input = $('q');
    input.setAttribute('aria-expanded', String(S.results.length > 0));
    updateActive(false);

    var st = '';
    if (r.mode === 'empty') st = '';
    else if (!r.total) {
      var n = Alpha.ndc.normalize(q);
      st = r.mode === 'ndc' && n ? 'No product with NDC ' + Alpha.ndc.format(n) + ' in this pharmacy.' : 'No matches for “' + q.trim() + '”.';
    } else {
      st = r.total + (r.total === 1 ? ' match' : ' matches') + (r.total > 3 ? ', most used first' : '') +
        (r.total > MAX_SHOWN ? ' (showing ' + MAX_SHOWN + '; type more to narrow)' : '') + '.';
    }
    $('status').textContent = st;
  }

  // `scroll` is false right after a new search (the list is already at the top),
  // which avoids forcing a layout on every keystroke.
  function updateActive(scroll) {
    var items = $('results').children;
    for (var i = 0; i < items.length; i++) items[i].setAttribute('aria-selected', String(i === S.active));
    var input = $('q');
    if (S.active >= 0) {
      input.setAttribute('aria-activedescendant', 'r' + S.active);
      var li = items[S.active];
      if (scroll !== false && li && li.scrollIntoView) { li.scrollIntoView({ block: 'nearest' }); S.listScrolled = true; }
    } else input.removeAttribute('aria-activedescendant');
  }

  function move(delta) {
    if (!S.results.length) return;
    S.active = Math.max(0, Math.min(S.results.length - 1, S.active + delta));
    updateActive();
    choose(S.results[S.active].product);
  }

  /* ---------- the chosen product ---------- */
  function choose(p) {
    S.product = p || null;
    var loc = Alpha.locate.locate(S.product, S.ds.layout);
    var warnings = S.product ? Alpha.rules.evaluate(S.rules, S.product, S.ds.products, Alpha.settings.disabledRules()) : [];
    Alpha.info.render($('info'), S.product, loc, warnings);
    Alpha.map.show(S.product ? loc : null);
    // The shelf column stays in place (re-flowing the grid on first use was the
    // slowest step); it shows a placeholder until something is chosen.
    Alpha.elevation.render($('elev'), loc, S.product);
  }

  // Jump straight to one NDC (used by "Show <preferred NDC>" buttons).
  function chooseNdc(n) {
    var input = $('q');
    input.value = Alpha.ndc.format(n);
    runSearch();
    input.focus();
    input.select();
  }

  function refresh() {
    compileRules();
    Alpha.info.renderBaskets($('baskets'), Alpha.settings.scheme(S.ds));
    choose(S.product);
  }

  /* ---------- keyboard, mouse, touch ---------- */
  function onInputKey(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'PageDown') { e.preventDefault(); move(5); }
    else if (e.key === 'PageUp') { e.preventDefault(); move(-5); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (S.active < 0 && S.results.length) { S.active = 0; updateActive(); }
      if (S.active >= 0) choose(S.results[S.active].product);
      e.target.select(); // the next scan or typed search replaces the text
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.target.value = '';
      runSearch();
    }
  }

  function onGlobalKey(e) {
    var t = e.target, tag = (t && t.tagName) || '';
    if (document.querySelector('dialog[open]')) return;
    if (t && t.id === 'q') return;
    var typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable);
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === '?') { e.preventDefault(); $('help').showModal(); return; }
    if (e.key === ',') { e.preventDefault(); Alpha.settings.open(); return; }
    if (e.key === 'Escape') { var q = $('q'); q.value = ''; runSearch(); q.focus(); return; }
    // Any printable key goes to the search box (so a barcode scan always lands there).
    if (e.key.length === 1 && e.key !== ' ') { $('q').focus(); }
  }

  // The first layout of a chosen product costs ~65 ms at 4x throttle (fonts,
  // first layout of the panes). Pay it once while idle after load, invisibly:
  // lay out one product, then put the empty state back in the same task.
  function warmUp() {
    if (!S.product && !$('q').value && S.ds.products.length) {
      choose(S.ds.products[0]);
      void document.body.offsetHeight;
      S.index.search('a 1');
      choose(null);
    }
    Alpha.warmed = true;
  }

  function init() {
    if (!loadData()) return;
    var q = $('q');
    q.addEventListener('input', runSearch);
    q.addEventListener('keydown', onInputKey);
    document.addEventListener('keydown', onGlobalKey);
    $('results').addEventListener('click', function (e) {
      var li = e.target.closest('.result');
      if (!li) return;
      S.active = Number(li.getAttribute('data-i'));
      updateActive();
      choose(S.results[S.active].product);
    });
    $('info').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-ndc]');
      if (b) chooseNdc(b.getAttribute('data-ndc'));
    });
    $('help-btn').addEventListener('click', function () { $('help').showModal(); });
    $('help').addEventListener('close', function () { q.focus(); });
    Alpha.settings.init({ onChange: function () { refresh(); }, reload: function () { loadData(); runSearch(); } });
    runSearch();
    q.focus();
    Alpha.readyAt = window.performance ? performance.now() : 0; // read by the speed test
    (window.requestIdleCallback || setTimeout)(warmUp);
  }

  Alpha.app = { chooseNdc: chooseNdc, refresh: refresh };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})(window.Alpha);
