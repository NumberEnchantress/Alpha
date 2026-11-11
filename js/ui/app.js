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
    // The default is the store's layout with simulated stock (data/sim);
    // ?dataset=sample opens the fictional sample the tests are written for.
    var askSample = /[?&]dataset=sample(&|$)/.test(location.search || '');
    return imported || sets.real || (askSample ? sets.sample : null) || sets.sim || sets.sample || null;
  }

  function loadData() {
    S.ds = chooseDataset();
    if (!S.ds) { $('status').textContent = 'No data found. Check that app/data/sample/pharmacy.js exists.'; return false; }
    S.issues = Alpha.check.checkDataset(S.ds);
    compileRules();
    S.index = Alpha.search.createIndex(S.ds.products || []);
    $('dataset-name').textContent = S.ds.meta.name;
    var banner = $('sample-banner');
    banner.hidden = !S.ds.meta.sample && !S.ds.meta.layoutIsSample;
    // (version-49: since version-48 the drugs, makers and NDCs are real; the shelf places and stock are not)
    banner.textContent = S.ds.meta.sample && S.ds.meta.layoutReal ? (S.ds.meta.publicNdcs ? 'SIMULATED STOCK: shelf locations and stock are made up. Not for dispensing.' : 'SIMULATED STOCK: drugs and NDCs are made up, not for dispensing')
      : S.ds.meta.sample ? 'SAMPLE DATA: fictional, not for dispensing'
      : 'Imported products on the SAMPLE layout: map and shelf positions are not real';
    Alpha.map.init($('map'), S.ds.layout);
    Alpha.info.renderBaskets($('baskets'), Alpha.settings.scheme(S.ds), Alpha.settings.schemeProblem(S.ds));
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
    // A result found only by a different spelling may be another drug
    // (hydralazine / hydroxyzine, prednisolone / prednisone): it is listed,
    // marked, and chosen only with the arrow keys or a click.
    S.ambiguous = S.results.length > 1 && S.results[0].tier > 0 && S.results.some(function (x) { return x.product.drug !== S.results[0].product.drug; });
    S.active = S.results.length && !S.results[0].typo && !S.ambiguous ? 0 : -1;
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
        '<span class="r-name">' + esc(ui.name(p)) + ' ' + ui.show(p.strength) + (p.form ? ' <span class="r-meta">' + esc(p.form) + '</span>' : '') +
          (S.results[i].typo ? ' <span class="r-typo">different spelling: check the name</span>' : '') + '</span>' +
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
      st = r.badCheck ? 'Barcode ' + q.trim() + ' fails its check digit: scan it again or type the NDC.'
        : r.badShape ? '“' + q.trim() + '” is not an NDC shape. Use 5-4-2, 4-4-2, 5-3-2 or 5-4-1, or the digits alone.'
        : r.complete ? 'No product with NDC ' + r.complete + ' in this pharmacy.' : 'No matches for “' + q.trim() + '”.';
    } else if (S.ambiguous && !S.results[0].typo) {
      var names = []; S.results.forEach(function (x) { if (names.indexOf(x.product.drug) < 0) names.push(x.product.drug); });
      st = r.total + ' matches for ' + (names.length > 3 ? names.length + ' different drugs' : names.join(', ')) + ': choose one with ↓ or a click.';
    } else if (S.results[0] && S.results[0].typo) {
      st = 'No exact match for “' + q.trim() + '”. ' + (r.total === 1 ? 'A drug with a similar spelling is' : r.total + ' drugs with similar spellings are') +
        ' listed: it may be a different drug. Check the name, then choose with ↓ or a click.';
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
    Alpha.info.renderBaskets($('baskets'), Alpha.settings.scheme(S.ds), Alpha.settings.schemeProblem(S.ds));
    choose(S.product);
  }

  /* ---------- keyboard, mouse, touch ---------- */
  // One column (760 px and narrower): the shelf view is below the map, and
  // nothing scrolls while typing, so the search box stays put. Enter or a
  // click on a result is a choice: then the shelf and its caption are shown.
  function showShelf() {
    if (!window.matchMedia || !window.matchMedia('(max-width: 760px)').matches) return;
    var go = function () {
      var el = $('elev'), g = el.querySelector('.shelf-hi, .shelf-est'), cap = el.querySelector('.elev-caption');
      if (!g) { el.scrollIntoView({ block: 'start' }); return; }
      var a = g.getBoundingClientRect(), c = cap ? cap.getBoundingClientRect() : a;
      var top = Math.min(a.top, c.top), bottom = Math.max(a.bottom, c.bottom);
      // both in view if they fit, else the shelf at the top
      var dy = bottom - top <= window.innerHeight - 12 ? (bottom > window.innerHeight ? bottom - window.innerHeight + 6 : top < 0 ? top - 6 : 0) : a.top - 6;
      if (dy) window.scrollBy(0, dy);
    };
    // Again a moment later: the results list and the caption can still move the page.
    requestAnimationFrame(go); setTimeout(go, 200);
  }
  function onInputKey(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'PageDown') { e.preventDefault(); move(5); }
    else if (e.key === 'PageUp') { e.preventDefault(); move(-5); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      // (not a result found only by a different spelling: that needs ↓ or a click)
      if (S.active < 0 && S.results.length && !S.results[0].typo && !S.ambiguous) { S.active = 0; updateActive(); }
      if (S.active >= 0) { choose(S.results[S.active].product); showShelf(); }
      e.target.select(); // the next scan or typed search replaces the text
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.target.value = '';
      runSearch();
      searchInView();
    }
  }
  // On a phone, Enter scrolled down to the shelf: Esc brings the search box back.
  function searchInView() {
    if (window.matchMedia && window.matchMedia('(max-width: 760px)').matches) window.scrollTo(0, 0);
  }

  function onGlobalKey(e) {
    var t = e.target, tag = (t && t.tagName) || '';
    if (document.querySelector('dialog[open]')) return;
    if (t && t.id === 'q') return;
    var typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable);
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === '?') { e.preventDefault(); $('help').showModal(); return; }
    if (e.key === ',') { e.preventDefault(); Alpha.settings.open(); return; }
    if (e.key === 'Escape') { var q = $('q'); q.value = ''; runSearch(); q.focus(); searchInView(); return; }
    // Any printable key goes to the search box (so a barcode scan always lands there).
    // The old text is selected, so what is typed replaces it.
    if (e.key.length === 1 && e.key !== ' ') { var q = $('q'); q.focus(); q.select(); }
  }

  // The first search after load costs ~50-65 ms at 4x throttle (fonts, first
  // layout of the results list and panes). Pay it once while idle after load,
  // invisibly: run one search, lay it out, and put the empty state back, all
  // in one task so nothing is painted.
  function warmUp() {
    var q = $('q');
    if (!S.product && !q.value && S.ds.products.length) {
      q.value = 'a';
      runSearch();
      void document.body.offsetHeight;
      q.value = '';
      runSearch();
    }
    Alpha.warmed = true;
  }

  /* ---------- a section chosen on the map ---------- */
  // The shelf view shows it with nothing highlighted, and the info pane
  // lists what it holds (each one chooses that product).
  function browse(code, unitId) {
    var L = S.ds.layout.locations.filter(function (l) { return l.code === code; })[0];
    if (!L) return;
    var U = L.units.filter(function (u) { return u.id === unitId; })[0] || L.units[0];
    S.product = null; S.active = -1; updateActive(false);
    var loc = { location: L, unit: U, unitStatus: 'known', shelf: null, shelfStatus: U.shelves ? 'unknown' : 'none', browse: true, code: code };
    Alpha.map.show(loc);
    Alpha.elevation.render($('elev'), loc, null);
    var here = S.ds.products.filter(function (p) { return p.location === code && Alpha.locate.locate(p, S.ds.layout).unit === U; })
      .sort(function (a, b) { return Alpha.locate.alphaKey(a.drug) < Alpha.locate.alphaKey(b.drug) ? -1 : Alpha.locate.alphaKey(a.drug) > Alpha.locate.alphaKey(b.drug) ? 1 : 0; });
    var name = L.code + (L.name && L.name !== L.code ? ' · ' + L.name : '') + (L.units.length > 1 ? ' · ' + (U.label || U.id) : '');
    var MAX = 60, shown = here.slice(0, MAX);
    $('info').innerHTML = '<h2 class="browse-title">' + esc(name) + '</h2>' +
      '<p>' + (here.length ? here.length + (here.length === 1 ? ' product is' : ' products are') + ' placed here' + (here.length > MAX ? ' (the first ' + MAX + ' by name below)' : '') + '. Choose one to see its shelf.' : 'No product in the data is placed here.') + '</p>' +
      (shown.length ? '<ul class="browse-list">' + shown.map(function (p) {
        return '<li><button type="button" class="btn small" data-ndc="' + esc(p.ndc) + '">' + esc(Alpha.ui.name(p) + (p.strength ? ' ' + p.strength : '') + (p.form ? ' ' + p.form : '')) + '</button> <span class="ndc small muted">' + esc(Alpha.ndc.format(p.ndc)) + '</span></li>';
      }).join('') + '</ul>' : '');
    $('status').textContent = 'Showing ' + name + ' from the map.';
  }

  function init() {
    if (!loadData()) return;
    Alpha.map.onPick = browse;
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
      showShelf();
    });
    $('info').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-ndc]');
      if (b) chooseNdc(b.getAttribute('data-ndc'));
    });
    $('help-btn').addEventListener('click', function () { $('help').showModal(); });
    $('help').addEventListener('close', function () { q.focus(); });
    // Turning a phone upright after the page scrolled to the shelf (wider
    // layouts do) could leave the search box above the screen: bring its
    // label back into view when the layout becomes one column.
    var narrow = window.matchMedia ? window.matchMedia('(max-width: 760px)') : null;
    if (narrow) {
      var toNarrow = function () {
        if (!narrow.matches) return;
        var label = document.querySelector('.search-label') || q;
        requestAnimationFrame(function () { if (label.getBoundingClientRect().top < 0) label.scrollIntoView({ block: 'start' }); });
      };
      if (narrow.addEventListener) narrow.addEventListener('change', toNarrow); else if (narrow.addListener) narrow.addListener(toNarrow);
    }
    Alpha.settings.init({ onChange: function () { refresh(); }, reload: function () { loadData(); runSearch(); } });
    runSearch();
    q.focus();
    Alpha.readyAt = window.performance ? performance.now() : 0; // read by the speed test
    (window.requestIdleCallback || setTimeout)(warmUp);
  }

  Alpha.app = { chooseNdc: chooseNdc, refresh: refresh };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})(window.Alpha);
