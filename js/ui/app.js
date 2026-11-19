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
    // The default is drug list v1 (data/sim);
    // ?dataset=sample opens the fictional sample the tests are written for.
    var askSample = /[?&]dataset=sample(&|$)/.test(location.search || '');
    return imported || sets.real || (askSample ? sets.sample : null) || sets.sim || sets.sample || null;
  }

  function loadData() {
    S.ds = chooseDataset();
    if (!S.ds) { $('status').textContent = 'No data found. Check that app/data/sample/pharmacy.js exists.'; return false; }
    S.issues = Alpha.check.checkDataset(S.ds);
    compileRules();
    S.index = Alpha.search.createIndex(S.ds.products || [], { layout: S.ds.layout });
    resetStages();
    $('dataset-name').textContent = S.ds.meta.name;
    var banner = $('sample-banner');
    banner.hidden = !S.ds.meta.sample && !S.ds.meta.layoutIsSample && !S.ds.meta.drugList;
    // (version-49: since version-48 the drugs, makers and NDCs are real; the shelf places and stock are not)
    banner.textContent = S.ds.meta.drugList ? 'DRUG LIST v1: prototype, may contain inaccuracies.'
      : S.ds.meta.sample && S.ds.meta.layoutBuiltIn ? (S.ds.meta.publicNdcs ? 'SIMULATED STOCK: shelf locations and stock are made up. Not for dispensing.' : 'SIMULATED STOCK: drugs and NDCs are made up, not for dispensing')
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
  // Staged search (2026-11-19): name -> form -> strength -> NDC. Each stage
  // lists its options; typing narrows them, ↑/↓ move, Enter or Tab chooses
  // and goes on, Shift+Tab or Backspace in an empty box goes back. A stage
  // with one option is chosen by itself. The choices so far show as chips.
  // At the name stage a query with a number ("atorva 40") or an NDC lists
  // the matching products at once, as before.
  var STAGES = ['name', 'form', 'dose', 'ndc'];
  var STAGE = {
    name: { label: 'Drug and strength, or NDC', list: 'Matching drugs', ph: 'e.g. atorva 40', chip: 'Drug' },
    form: { label: 'Form: type to narrow or choose', list: 'Forms', ph: 'e.g. tab', chip: 'Form', noun: 'form', many: 'forms' },
    dose: { label: 'Strength: type to narrow or choose', list: 'Strengths', ph: 'e.g. 20', chip: 'Strength', noun: 'strength', many: 'strengths' },
    ndc: { label: 'NDC: type to narrow or choose', list: 'Matching products', ph: 'maker, location or NDC digits', noun: 'NDC', many: 'NDCs' }
  };
  var MAX_STAGE = 60; // a later stage lists at most this many (type to narrow)
  S.stage = 'name'; S.chips = []; S.pool = null; S.all = []; S.list = 'products'; S.done = false;

  function runSearch() {
    var q = $('q').value;
    // After a product was chosen, typing starts a new search; so does a whole NDC typed or scanned at any stage.
    if (S.stage !== 'name' && (S.done || Alpha.search.isWholeNdc(q))) resetStages();
    S.done = false;
    if (S.stage === 'name') nameStage(q); else stageOptions(q);
  }

  function resetStages() {
    if (S.stage === 'name' && !S.chips.length) return;
    S.stage = 'name'; S.chips = []; S.pool = null; S.all = []; S.done = false;
    renderStage();
  }

  // `keep`: the option to make active (going back to a stage chosen before).
  function nameStage(q, keep) {
    var r = S.index.query(q, MAX_SHOWN);
    S.list = r.kind === 'names' ? 'names' : 'products';
    S.results = r.kind === 'names' ? r.options : r.results;
    var R = S.results, first = R[0];
    if (S.list === 'names') {
      // Several drugs that the words only start (or match by something other than
      // the name, e.g. "controlled"): none is chosen until ↓ or a click.
      S.ambiguous = R.length > 1 && (first.tier > 0 || first.lead >= 1) && R.some(function (x) { return x.drug.toLowerCase() !== first.drug.toLowerCase(); });
    } else {
      // A result found only by a different spelling may be another drug
      // (hydralazine / hydroxyzine, prednisolone / prednisone): it is listed,
      // marked, and chosen only with the arrow keys or a click.
      S.ambiguous = R.length > 1 && first.tier > 0 && R.some(function (x) { return x.product.drug !== first.product.drug; });
    }
    S.active = R.length && !first.typo && !S.ambiguous ? 0 : -1;
    if (keep != null) for (var i = 0; i < R.length; i++) if (R[i].value === keep) S.active = i;
    renderResults(r, q);
    if (S.list === 'products') choose(S.active >= 0 ? R[S.active].product : null);
    // one drug with one product: shown at once, as before
    else choose(S.active >= 0 && R.length === 1 && R[0].products.length === 1 ? R[0].products[0] : null);
  }

  function stageAll(stage, pool) {
    if (stage === 'form') return S.index.forms(pool);
    if (stage === 'dose') return S.index.doses(pool);
    return S.index.ndcs(pool).map(function (p) { return { product: p, value: p.ndc }; });
  }
  function optionWords(o) {
    var p = o.product;
    return p ? [p.manufacturer, p.location, Alpha.ndc.format(p.ndc)].join(' ') : o.label;
  }
  function stageOptions(q, keep) {
    var all = S.all, opts = q.trim() ? all.filter(function (o) { return Alpha.search.narrows(q, optionWords(o), o.product && o.product.ndc); }) : all;
    S.list = S.stage === 'ndc' ? 'products' : 'options';
    S.results = opts.slice(0, MAX_STAGE);
    S.ambiguous = false;
    S.active = S.results.length ? 0 : -1;
    if (keep != null) for (var i = 0; i < S.results.length; i++) if (S.results[i].value === keep) S.active = i;
    renderResults({ mode: 'stage', total: opts.length }, q);
    choose(S.list === 'products' && S.active >= 0 ? S.results[S.active].product : null);
  }

  // Choose option i of a name, form or strength list and go on to the next stage.
  function pick(i) {
    var o = S.results[i];
    if (!o) return;
    S.chips.push({ stage: S.stage, label: o.label, value: o.value, pool: S.pool, text: $('q').value });
    S.pool = o.products;
    advance();
  }
  function advance() {
    for (;;) {
      S.stage = STAGES[S.chips.length];
      S.all = stageAll(S.stage, S.pool);
      if (S.all.length !== 1 || S.stage === 'ndc') break;
      // one option: chosen by itself
      S.chips.push({ stage: S.stage, label: S.all[0].label, value: S.all[0].value, pool: S.pool, text: '', auto: true });
      S.pool = S.all[0].products;
    }
    $('q').value = '';
    renderStage();
    stageOptions('');
    if (S.stage === 'ndc' && S.all.length === 1) { S.done = true; showShelf(); } // one NDC: that product
  }
  // Back to the last stage chosen by hand (stages with one option are passed over),
  // or to the chip at `at` (a click on it), with what was typed there.
  function back(at) {
    if (at != null) S.chips.length = at + 1;
    while (S.chips.length && S.chips[S.chips.length - 1].auto) S.chips.pop();
    var c = S.chips.pop();
    if (!c) return;
    var input = $('q');
    S.stage = c.stage; S.pool = c.pool; S.done = false;
    input.value = c.text;
    renderStage();
    if (c.stage === 'name') nameStage(c.text, c.value);
    else { S.all = stageAll(c.stage, c.pool); stageOptions(c.text, c.value); }
    input.setSelectionRange(input.value.length, input.value.length);
    updateActive();
  }

  // The label, placeholder and list name for the stage, and the chips.
  function renderStage() {
    var st = STAGE[S.stage], input = $('q');
    $('q-label').textContent = st.label;
    input.placeholder = st.ph;
    var el = $('chips');
    if (!S.chips.length) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    el.innerHTML = S.chips.map(function (c, i) {
      var k = STAGE[c.stage].chip, label = esc(chipLabel(c));
      if (c.auto) return '<li><span class="chip auto" title="The only ' + STAGE[c.stage].noun + '"><span class="chip-k">' + k + '</span> ' + label + '</span></li>';
      return '<li><button type="button" class="chip" data-c="' + i + '" aria-label="' + k + ': ' + label + '. Choose again" title="Choose the ' + (STAGE[c.stage].noun || 'drug') + ' again">' +
        '<span class="chip-k">' + k + '</span> ' + label + ' <span class="chip-x" aria-hidden="true">×</span></button></li>';
    }).join('');
  }
  function chipLabel(c) { return c.label || (c.stage === 'form' ? 'form unknown' : c.stage === 'dose' ? 'strength unknown' : ''); }

  function count(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function distinct(list, f) { var seen = {}, out = []; list.forEach(function (p) { var v = f(p) || ''; if (!seen[v.toLowerCase()]) { seen[v.toLowerCase()] = 1; out.push(v); } }); return out; }

  function renderResults(r, q) {
    var list = $('results');
    var html = '', scheme = Alpha.settings.scheme(S.ds), locs = S.ds.layout && S.ds.layout.locations;
    for (var i = 0; i < S.results.length; i++) {
      var o = S.results[i], p = o.product;
      var typo = o.typo ? ' <span class="r-typo">different spelling: check the name</span>' : '';
      if (S.list === 'products') {
        var cls = 'result' + (i < 3 ? ' top3' : '') + (i === 3 ? ' after-top3' : '');
        html += '<li id="r' + i + '" class="' + cls + '" role="option" aria-selected="' + (i === S.active) + '" data-i="' + i + '">' +
          '<span class="r-num">' + (i + 1) + '</span>' +
          '<span class="r-name">' + esc(ui.name(p)) + ' ' + ui.show(p.strength) + (p.form ? ' <span class="r-meta">' + esc(p.form) + '</span>' : '') + typo +
            (scheme ? Alpha.info.basketTag(scheme, p, locs) : '') + '</span>' +
          '<span class="r-meta"><span class="ndc">' + esc(Alpha.ndc.format(p.ndc)) + '</span> · ' +
            (p.location != null ? esc(p.location) : 'location unknown') + ' · ' + ui.show(p.manufacturer) + '</span>' +
          '</li>';
      } else {
        var ps = o.products, meta;
        if (S.stage === 'name') {
          var fs = distinct(ps, function (x) { return x.form; });
          meta = (fs.length === 1 ? (fs[0] ? esc(fs[0]) : 'form unknown') : count(fs.length, 'form', 'forms')) + ' · ' + count(ps.length, 'NDC', 'NDCs');
        } else if (S.stage === 'form') {
          var ds = distinct(ps, function (x) { return x.strength; });
          meta = (ds.length <= 4 ? ds.map(function (d) { return d ? esc(d) : 'strength unknown'; }).join(', ') : count(ds.length, 'strength', 'strengths')) + ' · ' + count(ps.length, 'NDC', 'NDCs');
        } else {
          var ls = distinct(ps, function (x) { return x.location != null ? String(x.location) : 'location unknown'; });
          meta = count(ps.length, 'NDC', 'NDCs') + ' · ' + esc(ls.slice(0, 4).join(', ') + (ls.length > 4 ? ', ...' : ''));
        }
        html += '<li id="r' + i + '" class="result r-opt" role="option" aria-selected="' + (i === S.active) + '" data-i="' + i + '">' +
          '<span class="r-num">' + (i + 1) + '</span>' +
          '<span class="r-name">' + (o.label ? esc(o.label) : '<span class="unknown-val">' + (S.stage === 'form' ? 'form unknown' : 'strength unknown') + '</span>') + typo + '</span>' +
          '<span class="r-meta">' + meta + '</span></li>';
      }
    }
    list.innerHTML = html;
    var name = S.list === 'names' ? STAGE.name.list : S.list === 'products' ? STAGE.ndc.list : STAGE[S.stage].list;
    if (list.getAttribute('aria-label') !== name) list.setAttribute('aria-label', name);
    // Writing scrollTop forces a layout, so only do it if the list was scrolled.
    if (S.listScrolled) { list.scrollTop = 0; S.listScrolled = false; }
    var input = $('q');
    input.setAttribute('aria-expanded', String(S.results.length > 0));
    updateActive(false);

    var st = '', R = S.results, bk = ' Shift+Tab or Backspace goes back.';
    if (r.mode === 'stage') {
      var info = STAGE[S.stage], of = S.chips.map(chipLabel).filter(Boolean).join(' ');
      if (!r.total) st = 'No ' + info.noun + ' of ' + of + ' matches “' + q.trim() + '”. Esc starts a new search.' + bk;
      else st = count(r.total, info.noun, info.many) + ' of ' + of + (S.stage === 'ndc' && r.total > 1 ? ', fast movers first' : '') +
        (r.total > R.length ? ' (showing ' + R.length + '; type to narrow)' : '') + ': ↑ ↓, then ' + (S.stage === 'ndc' ? 'Enter.' : 'Enter or Tab.') + bk;
    } else if (r.mode === 'empty') st = '';
    else if (!r.total) {
      st = r.badCheck ? 'Barcode ' + q.trim() + ' fails its check digit: scan it again or type the NDC.'
        : r.badShape ? '“' + q.trim() + '” is not an NDC shape. Use 5-4-2, 4-4-2, 5-3-2 or 5-4-1, or the digits alone.'
        : r.complete ? 'No product with NDC ' + r.complete + ' in this pharmacy.' : 'No matches for “' + q.trim() + '”.';
    } else if (R[0] && R[0].typo) {
      st = 'No exact match for “' + q.trim() + '”. ' + (r.total === 1 ? 'A drug with a similar spelling is' : r.total + (S.list === 'names' ? ' drugs' : ' products') + ' with similar spellings are') +
        ' listed, most similar first: it may be a different drug. Check the name, then choose with ↓ or a click.';
    } else if (S.ambiguous) {
      var names = []; R.forEach(function (x) { var d = x.drug || x.product.drug; if (names.indexOf(d) < 0) names.push(d); });
      st = r.total + ' matches for ' + (names.length > 3 ? names.length + ' different drugs' : names.join(', ')) + ': choose one with ↓ or a click.';
    } else if (S.list === 'names') {
      st = count(r.total, 'drug', 'drugs') + (r.total > MAX_SHOWN ? ' (showing ' + MAX_SHOWN + '; type more to narrow)' : '') + ': ↑ ↓, then Enter or Tab to choose the form and strength.';
    } else {
      st = r.total + (r.total === 1 ? ' match' : ' matches') + (r.total > 3 ? ', fast movers first' : '') +
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
    if (S.list === 'products') choose(S.results[S.active].product);
  }

  // A product chosen from a product list (Enter, Tab or a click).
  function take(i) {
    S.active = i;
    updateActive();
    choose(S.results[i].product);
    S.done = true;
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
    resetStages();
    input.value = Alpha.ndc.format(n);
    runSearch();
    input.focus();
    input.select();
  }

  // The listed results' basket tags, after the preset changed (the list itself stays).
  function retagResults() {
    var scheme = Alpha.settings.scheme(S.ds), locs = S.ds.layout && S.ds.layout.locations, items = $('results').children;
    if (S.list !== 'products') return; // (names, forms and strengths have no tag)
    for (var i = 0; i < items.length && i < S.results.length; i++) {
      var name = items[i].querySelector('.r-name'), old = name && name.querySelector('.basket-tag');
      if (old) old.remove();
      var tag = scheme ? Alpha.info.basketTag(scheme, S.results[i].product, locs) : '';
      if (name && tag) name.insertAdjacentHTML('beforeend', tag);
    }
  }

  function refresh() {
    compileRules();
    retagResults();
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
    var mod = e.ctrlKey || e.altKey || e.metaKey;
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'PageDown') { e.preventDefault(); move(5); }
    else if (e.key === 'PageUp') { e.preventDefault(); move(-5); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      // (not a result found only by a different spelling: that needs ↓ or a click)
      if (S.active < 0 && S.results.length && !S.results[0].typo && !S.ambiguous) { S.active = 0; updateActive(); }
      if (S.list !== 'products') { if (S.active >= 0) pick(S.active); return; }
      if (S.active >= 0) { take(S.active); showShelf(); }
      e.target.select(); // the next scan or typed search replaces the text
    } else if (e.key === 'Tab' && !e.shiftKey && !mod) {
      // Tab chooses like Enter where a choice leads on; otherwise it moves focus as usual.
      if (S.list !== 'products' && S.active >= 0) { e.preventDefault(); pick(S.active); }
      else if (S.stage === 'ndc' && S.active >= 0) take(S.active);
    } else if ((e.key === 'Tab' && e.shiftKey && !mod) || (e.key === 'Backspace' && !e.target.value && !mod)) {
      if (S.chips.length) { e.preventDefault(); back(); }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      resetStages();
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
    if (e.key === 'Escape') { var q = $('q'); resetStages(); q.value = ''; runSearch(); q.focus(); searchInView(); return; }
    // Any printable key goes to the search box (so a barcode scan always lands there).
    // The old text is selected, so what is typed replaces it; after a product was
    // chosen it starts a new search (in the middle of the stages it narrows the stage).
    if (e.key.length === 1 && e.key !== ' ') {
      var q = $('q');
      if (S.done) { resetStages(); q.value = ''; }
      q.focus(); q.select();
    }
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
  var browseAll = null; // the section whose whole list is shown ("code|unit")
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
    // The first 60 by name at once (fast); "Show all" lists the rest.
    var MAX = 60, all = browseAll === code + '|' + U.id, shown = all ? here : here.slice(0, MAX);
    $('info').innerHTML = '<h2 class="browse-title">' + esc(name) + '</h2>' +
      '<p>' + (here.length ? here.length + (here.length === 1 ? ' product is' : ' products are') + ' placed here' + (here.length > shown.length ? ' (the first ' + MAX + ' by name below)' : '') + '. Choose one to see its shelf.' : 'No product in the data is placed here.') + '</p>' +
      (shown.length ? '<ul class="browse-list">' + shown.map(function (p) {
        return '<li><button type="button" class="btn small" data-ndc="' + esc(p.ndc) + '">' + esc(Alpha.ui.name(p) + (p.strength ? ' ' + p.strength : '') + (p.form ? ' ' + p.form : '')) + '</button> <span class="ndc small muted">' + esc(Alpha.ndc.format(p.ndc)) + '</span></li>';
      }).join('') + '</ul>' : '') +
      (here.length > shown.length ? '<p><button type="button" class="btn small" id="browse-all">Show all ' + here.length + '</button></p>' : '');
    var more = $('browse-all');
    if (more) more.addEventListener('click', function () { browseAll = code + '|' + U.id; browse(code, unitId); });
    else if (!all) browseAll = null;
    $('status').textContent = 'Showing ' + name + ' from the map.';
  }

  function init() {
    if (!loadData()) return;
    Alpha.map.onPick = browse;
    var q = $('q');
    q.addEventListener('input', runSearch);
    q.addEventListener('keydown', onInputKey);
    document.addEventListener('keydown', onGlobalKey);
    // A click or tap keeps the focus where it was (in the search box), as a list of choices should.
    $('results').addEventListener('mousedown', function (e) { e.preventDefault(); });
    $('results').addEventListener('click', function (e) {
      var li = e.target.closest('.result');
      if (!li) return;
      var i = Number(li.getAttribute('data-i'));
      if (S.list !== 'products') { S.active = i; pick(i); return; }
      take(i);
      showShelf();
    });
    $('chips').addEventListener('mousedown', function (e) { if (e.target.closest('button')) e.preventDefault(); });
    $('chips').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-c]');
      if (!b) return;
      back(Number(b.getAttribute('data-c')));
      if (!e.detail) q.focus(); // from the keyboard: the chip is gone, so the search box takes the focus
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
