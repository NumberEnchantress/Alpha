/* Settings: basket preset, text size, which rules are on, and rules the
   user adds here. Saved in localStorage when the browser allows it;
   otherwise they last until the page is closed. */
(function (Alpha) {
  'use strict';
  var ui = Alpha.ui, esc = ui.esc, store = ui.store;
  var OP_LABELS = {
    eq: 'is', ne: 'is not', in: 'is one of', notIn: 'is none of', between: 'is between', lt: 'is less than',
    lte: 'is at most', gt: 'is more than', gte: 'is at least', contains: 'contains', startsWith: 'starts with',
    known: 'is known', unknown: 'is unknown'
  };
  var SCALES = [['1', 'Normal'], ['1.15', 'Large'], ['1.3', 'Larger']];

  var prefs = { scheme: null, scale: '1', disabled: {}, custom: [] };
  var saved = true, usable = true, unreadable = false, backupKey = null, notice = null, hooks = {}, dlg = null;

  // Saved settings that cannot be read (or hold values of the wrong kind) are
  // never written over unasked: a copy is kept first, under the first free
  // key alpha.prefs-unreadable, -2, -3 ... (an identical copy is not made
  // twice). If no copy can be kept, settings are not saved at all, so the
  // original stays. The defaults are used and the page says so.
  function wrongKinds(p) {
    var plain = function (o) { return !!o && typeof o === 'object' && !Array.isArray(o); };
    return ('scheme' in p && p.scheme !== null && typeof p.scheme !== 'string') ||
      ('scale' in p && !SCALES.some(function (x) { return x[0] === p.scale; })) ||
      ('disabled' in p && (!plain(p.disabled) || Object.keys(p.disabled).some(function (k) { return typeof p.disabled[k] !== 'boolean'; }))) ||
      // each custom rule must be a rule: an object with a text id, a message and a condition
      ('custom' in p && (!Array.isArray(p.custom) || !p.custom.every(function (r) {
        // the same checks as rules in the data file
        var c = plain(r) && typeof r.id === 'string' && r.id && Alpha.rules.compile([r], Alpha.rules.PRODUCT_FIELDS);
        return !!c && !c.errors.length && !c.warnings.length; // a warning (an unknown field) means it was edited by hand and would never fire
      })));
  }
  function keepCopy(raw) {
    for (var i = 1; i <= 20; i++) {
      var k = 'prefs-unreadable' + (i > 1 ? '-' + i : ''), have = store.raw(k);
      if (have === raw) return k;
      if (have == null) return store.setRaw(k, raw) ? k : null;
    }
    return null;
  }
  function load() {
    var raw = store.raw('prefs'), p = null;
    unreadable = false; backupKey = null;
    if (raw != null) { try { p = JSON.parse(raw); } catch (e) { p = null; } }
    if (raw != null && (!p || typeof p !== 'object' || Array.isArray(p) || wrongKinds(p))) {
      unreadable = true;
      backupKey = keepCopy(raw);
      return;
    }
    if (p) {
      prefs.scheme = p.scheme || null;
      prefs.scale = SCALES.some(function (s) { return s[0] === p.scale; }) ? p.scale : '1';
      prefs.disabled = p.disabled && typeof p.disabled === 'object' ? p.disabled : {};
      prefs.custom = Array.isArray(p.custom) ? p.custom : [];
    }
  }
  function save() {
    if (unreadable && !backupKey) { saved = false; return; } // the unreadable original has no copy: keep it
    saved = store.set('prefs', prefs);
    if (saved) unreadable = false;
  }
  usable = store.usable(); saved = usable; // false when the browser blocks storage
  function applyScale() { document.documentElement.style.setProperty('--scale', prefs.scale); document.documentElement.setAttribute('data-scale', prefs.scale); }

  // The basket preset in use: built-in (data file) or the user's own.
  function scheme(ds) {
    var list = Alpha.presetsUI ? Alpha.presetsUI.all(ds) : ((ds && ds.basketSchemes) || []);
    for (var i = 0; i < list.length; i++) if (list[i].id === prefs.scheme) return list[i];
    return list[0] || null;
  }
  function useScheme(id) { prefs.scheme = id; notice = null; save(); changed(); }
  // Rebuild the open dialog after a change in another window, keeping focus.
  function rebuildKeepingFocus() {
    var a = document.activeElement, sel = null;
    if (a && dlg.contains(a)) {
      if (a.id) sel = '#' + CSS.escape(a.id);
      else if (a.name) sel = '[name="' + CSS.escape(a.name) + '"][value="' + CSS.escape(a.value) + '"]';
      else if (a.getAttribute('data-rule')) sel = '[data-rule="' + CSS.escape(a.getAttribute('data-rule')) + '"]';
      else if (a.getAttribute('data-del')) sel = '[data-del="' + CSS.escape(a.getAttribute('data-del')) + '"]';
    }
    build();
    var back = null;
    try { back = sel && dlg.querySelector(sel); } catch (e) { back = null; }
    if (back) back.focus();
  }
  // When the chosen preset cannot be found, say so instead of quietly showing another.
  function schemeProblem(ds) {
    var s = scheme(ds);
    if (unreadable) return 'The settings saved on this computer could not be read, so the defaults are in use (showing "' + (s ? s.name : 'no preset') + '"). ' +
      (backupKey ? 'A copy was kept as alpha.' + backupKey + '.' : 'No copy could be kept (the storage is full, or 20 earlier copies are already kept), so they are left as they are and changes are not saved.') + ' Check Settings.';
    if (notice) return notice;
    if (!prefs.scheme || !s || s.id === prefs.scheme) return null;
    return 'The basket preset chosen on this computer could not be found or read; showing "' + s.name + '" instead. Check Settings > Basket preset.';
  }
  function disabledRules() { return prefs.disabled; }
  function customRules() { return prefs.custom; }

  /* ---------- the dialog ---------- */
  // Plain-English version of any rule condition.
  function describe(c) {
    if (!c || typeof c !== 'object') return '?';
    if (Array.isArray(c.all)) return c.all.map(describe).join(', and ');
    if (Array.isArray(c.any)) return '(' + c.any.map(describe).join(', or ') + ')';
    if (c.not) return 'not (' + describe(c.not) + ')';
    if (c.equivalent) {
      return 'another NDC with the same ' + (Array.isArray(c.equivalent.match) ? c.equivalent.match : []).join(', ') +
        (c.equivalent.where ? ' has ' + describe(c.equivalent.where) : ' exists');
    }
    var v = Array.isArray(c.value) ? (c.op === 'between' ? c.value.join(' and ') : c.value.join(', ')) : c.value;
    return c.field + ' ' + (OP_LABELS[c.op] || c.op) + (v !== undefined ? ' ' + v : '');
  }
  function ruleText(r) { return 'When ' + describe(r.when); }
  // Message as written, with placeholders shown as [field].
  function messageText(m) { return String(m).replace(/\{\{\s*([\w.]+)\s*\}\}/g, '[$1]'); }

  function build() {
    var ds = Alpha.state.ds, S = Alpha.state, cur = scheme(ds);
    var h = '<h2 id="settings-title">Settings</h2>';
    if (!usable) h += '<p class="note-bad">This browser is not letting Alpha save settings. They will last until the page is closed.</p>';
    else if (!saved) h += '<p class="note-bad">The last change to the settings could not be saved (this browser\'s storage may be full). It will last until the page is closed.</p>';
    if (unreadable) h += '<p class="note-bad">The settings saved on this computer could not be read, so the defaults are in use. ' +
      (backupKey ? 'A copy of them was kept in this browser as alpha.' + esc(backupKey) + '; the next change you make here replaces the unreadable settings.'
        : 'No copy could be kept (the storage in this browser is full, or 20 earlier copies are already kept), so they are left as they are and changes made here are not saved. ' +
          '<button type="button" class="btn small" data-act="prefs-copies-dl">Download them and the kept copies</button> ' +
          (copyKeys().length ? '<button type="button" class="btn small" data-act="prefs-copies-rm">Remove the ' + copyKeys().length + ' kept copies</button>' : '')) + '</p>';

    var builtIns = {};
    (ds.basketSchemes || []).forEach(function (s) { builtIns[s.id] = 1; });
    h += '<fieldset><legend>Basket preset</legend>' + Alpha.presetsUI.all(ds).map(function (s) {
      return '<label class="opt"><input type="radio" name="scheme" value="' + esc(s.id) + '"' + (cur && cur.id === s.id ? ' checked' : '') + '> ' +
        esc(s.name) + ' <span class="muted">(' + s.groups.length + ' groups' + (builtIns[s.id] ? '' : ', yours') + ')</span></label>';
    }).join('') + '<p class="muted small">The preset sets the groups a script can be in and the baskets for each.</p>' +
      '<button type="button" class="btn" id="open-presets">Edit basket presets…</button></fieldset>';

    h += '<fieldset><legend>Text size</legend>' + SCALES.map(function (s) {
      return '<label class="opt inline"><input type="radio" name="scale" value="' + s[0] + '"' + (prefs.scale === s[0] ? ' checked' : '') + '> ' + s[1] + '</label>';
    }).join('') + '</fieldset>';

    var all = (ds.rules || []).map(function (r) { return { r: r, custom: false }; })
      .concat(prefs.custom.map(function (r) { return { r: r, custom: true }; }));
    h += '<fieldset><legend>Warning rules</legend><ul class="rule-list">' + all.map(function (x) {
      var r = x.r, on = !prefs.disabled[r.id];
      return '<li><label class="opt"><input type="checkbox" data-rule="' + esc(r.id) + '"' + (on ? ' checked' : '') + '> ' +
        '<span class="sevtag ' + esc(r.severity) + '">' + esc(r.severity) + '</span> ' + esc(messageText(r.message)) + '</label>' +
        '<div class="muted small">' + esc(ruleText(r)) + (x.custom ? ' · added here' : ' · from the data file') + '</div>' +
        (x.custom ? '<button type="button" class="btn small" data-del="' + esc(r.id) + '">Remove</button>' : '') + '</li>';
    }).join('') + '</ul>';
    if (S.ruleErrors && S.ruleErrors.length) {
      h += '<p class="note-bad">Rules with errors were skipped:<br>' + S.ruleErrors.map(esc).join('<br>') + '</p>';
    }
    h += '<details class="add-rule"><summary>Add a rule</summary><div class="rule-form">' +
      '<label>When <select id="nr-field">' + Alpha.rules.PRODUCT_FIELDS.map(function (f) { return '<option>' + f + '</option>'; }).join('') + '</select></label>' +
      '<label><select id="nr-op">' + Object.keys(OP_LABELS).map(function (o) { return '<option value="' + o + '">' + OP_LABELS[o] + '</option>'; }).join('') + '</select></label>' +
      '<label>Value <input id="nr-value" type="text" placeholder="e.g. 071, 078"></label>' +
      '<label>Show <select id="nr-sev"><option value="warn">warning</option><option value="danger">danger</option><option value="info">note</option></select></label>' +
      '<label class="wide">Message <input id="nr-msg" type="text" placeholder="e.g. Check the strength twice."></label>' +
      '<p class="muted small wide">For "is between" give two values separated by a comma. For "is one of" give a list. Text and numbers both work; locations like 071 compare as numbers.</p>' +
      '<button type="button" class="btn" id="nr-add">Add rule</button> <span id="nr-err" class="note-bad" role="alert"></span>' +
      '</div></details></fieldset>';

    var issues = S.issues || { errors: [], warnings: [] };
    h += '<fieldset><legend>Data</legend><p>' + esc(ds.meta.name) + (ds.meta.sample ? ' <strong>(sample, fictional)</strong>' : '') + ': ' +
      ds.products.length + ' products, ' + ds.layout.locations.length + ' locations.</p>' +
      '<p>Data check: ' + issues.errors.length + ' errors, ' + issues.warnings.length + ' warnings.</p>' +
      (issues.errors.length || issues.warnings.length ? '<details><summary>Show the list</summary><ul class="issue-list small">' +
        issues.errors.map(function (e) { return '<li class="err">' + esc(e) + '</li>'; }).join('') +
        issues.warnings.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul></details>' : '') +
      '<div id="import-area"></div></fieldset>';

    h += '<form method="dialog" class="dialog-actions"><button class="btn">Close</button></form>';
    dlg.innerHTML = h;
    if (Alpha.importer) Alpha.importer.mount(document.getElementById('import-area'));
  }

  function parseValue(op, raw) {
    if (op === 'known' || op === 'unknown') return undefined;
    var parts = raw.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    var conv = function (s) { return s === 'true' ? true : s === 'false' ? false : s; };
    if (op === 'between' || op === 'in' || op === 'notIn') return parts.map(conv);
    return conv(raw.trim());
  }

  function addRule() {
    var get = function (id) { return document.getElementById(id).value; };
    var op = get('nr-op'), when = { field: get('nr-field'), op: op };
    var v = parseValue(op, get('nr-value'));
    if (v !== undefined) when.value = v;
    var rule = { id: 'custom-' + Date.now().toString(36), severity: get('nr-sev'), message: get('nr-msg').trim(), when: when };
    var res = Alpha.rules.compile([rule], Alpha.rules.PRODUCT_FIELDS);
    var err = document.getElementById('nr-err');
    if (!rule.message) { err.textContent = 'Write a message to show.'; return; }
    if (res.errors.length) { err.textContent = res.errors.join('; ').replace(/rules\[0\] \([^)]*\)\.?/g, ''); return; }
    prefs.custom.push(rule);
    save(); changed();
    build();
  }

  function changed() { applyScale(); if (hooks.onChange) hooks.onChange(); }

  function onDialogEvent(e) {
    var t = e.target;
    if (t.name === 'scheme') { prefs.scheme = t.value; save(); changed(); }
    else if (t.name === 'scale') { prefs.scale = t.value; save(); changed(); }
    else if (t.hasAttribute && t.hasAttribute('data-rule')) {
      var id = t.getAttribute('data-rule');
      if (t.checked) delete prefs.disabled[id]; else prefs.disabled[id] = true;
      save(); changed();
    }
  }
  // The kept copies of unreadable settings (alpha.prefs-unreadable, -2 ... -20).
  function copyKeys() { return store.keys('prefs-unreadable').filter(function (k) { return /^prefs-unreadable(-\d+)?$/.test(k); }); }
  function onDialogClick(e) {
    var act = e.target.closest('[data-act]'), a = act && act.getAttribute('data-act');
    if (a === 'prefs-copies-dl') {
      var out = { 'alpha.prefs': store.raw('prefs') };
      copyKeys().forEach(function (k) { out['alpha.' + k] = store.raw(k); });
      var link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2) + '\n'], { type: 'application/json' }));
      link.download = 'unreadable-settings.json';
      document.body.appendChild(link); link.click(); link.remove();
      return;
    }
    if (a === 'prefs-copies-rm') {
      var keys = copyKeys();
      if (!window.confirm('Remove the ' + keys.length + ' kept copies of unreadable settings? This cannot be undone (download them first to keep them). The unreadable settings themselves are then copied once more, and changes here are saved again.')) return;
      keys.forEach(function (k) { store.remove(k); });
      load(); build();
      return;
    }
    var del = e.target.closest('[data-del]');
    if (del) {
      var id = del.getAttribute('data-del');
      prefs.custom = prefs.custom.filter(function (r) { return r.id !== id; });
      delete prefs.disabled[id];
      save(); changed(); build();
      var first = dlg.querySelector('input'); if (first) first.focus();
    } else if (e.target.id === 'nr-add') addRule();
    else if (e.target.id === 'open-presets') { dlg.close(); Alpha.presetsUI.open(); }
  }

  function open() { build(); dlg.showModal(); var c = dlg.querySelector('input:checked') || dlg.querySelector('input'); if (c) c.focus(); }

  function init(h) {
    hooks = h || {};
    Alpha.presetsUI.init();
    dlg = document.getElementById('settings');
    dlg.addEventListener('change', onDialogEvent);
    dlg.addEventListener('click', onDialogClick);
    dlg.addEventListener('close', function () { document.getElementById('q').focus(); });
    document.getElementById('settings-btn').addEventListener('click', open);
    // Settings changed in another window: take them, so an older window does
    // not later save its stale copy over them.
    window.addEventListener('storage', function (e) {
      if (e.key === 'alpha.prefs') {
        var was = prefs.scheme; load();
        // The preset in use was deleted in the other window: say so here too.
        if (was && was !== prefs.scheme && !(Alpha.presetsUI && Alpha.presetsUI.find(Alpha.state.ds, was))) {
          var now = scheme(Alpha.state.ds); notice = 'The basket preset in use was deleted in another window; now using "' + (now ? now.name : '') + '".';
        }
        changed(); if (dlg.open) rebuildKeepingFocus();
      }
      else if (e.key && e.key.indexOf('alpha.preset.') === 0 && dlg.open) rebuildKeepingFocus();
    });
  }

  load();
  applyScale();
  Alpha.settings = {
    savedOk: function () { return saved; },
    init: init, open: open, scheme: scheme, schemeProblem: schemeProblem, useScheme: useScheme, notify: changed, disabledRules: disabledRules, customRules: customRules,
    importedDataset: function () { return Alpha.importer ? Alpha.importer.dataset() : null; },
    reload: function () { if (hooks.reload) hooks.reload(); }
  };
})(window.Alpha);
